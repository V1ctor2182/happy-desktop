import type { ChatElement, RigProfile, ToolPresentation } from "@slopus/rig-connect";
import type { ConversationAuthor } from "../conversation/conversationAuthor.js";
import {
    noticeInformational,
    type ConversationActivityPresentation,
    type ConversationEntry,
    type ConversationJson,
    type ConversationMessageProjection,
    type ConversationToolCall,
} from "../conversation/conversationEntry.js";
import { inlineImageSize } from "../conversation/inlineImageSize.js";
import type { AgentTurnTraceSummary } from "../types.js";
import { rigInboundMessageProject } from "./rigInboundMessageProject.js";
import type { RigSubagentSummary, RigUserInputRequest } from "./rigTypes.js";
import { rigAgentAuthor, rigInboundAuthor, rigOwnerAuthor } from "./rigConversationProject.js";
import { rigCompactionSubject } from "./rigTokenFormat.js";

export interface RigConnectConversationInput {
    readonly elements: readonly ChatElement[];
    readonly sessionId: string;
    readonly showReasoning: boolean;
    readonly ephemeral: readonly ConversationEntry[];
    readonly pendingUserInputs: readonly RigUserInputRequest[];
    readonly expandedGroupIds: ReadonlySet<string>;
    /** Named senders for background-work news, matched by the description it quotes. */
    readonly subagents: readonly RigSubagentSummary[];
    /**
     * Images this window sent, by message identity. A message is shown from the
     * prediction made when it was submitted, and that prediction is text alone,
     * so what was attached to it is known only to the sender until the whole
     * transcript is read again. These fill that gap and are ignored for any
     * message that arrived carrying its own.
     */
    readonly sentImages?: ReadonlyMap<
        string,
        readonly { readonly mediaType: string; readonly data: string }[]
    >;
}

/** Current human profile carried by one attributed Rig message. */
function profileAuthor(
    profile: RigProfile | undefined,
    identity: string | null,
): ConversationAuthor {
    if (identity === null) return rigOwnerAuthor;
    if (!profile) return { ...rigOwnerAuthor, id: identity };
    return {
        id: identity,
        displayName: profile.name,
        username: profile.name,
        kind: "human",
        ...(profile.photo === undefined
            ? {}
            : { imageUrl: `data:${profile.photo.mediaType};base64,${profile.photo.data}` }),
    };
}

/**
 * Projects rig-connect's flat application transcript into Happy's shared
 * conversation rows. The element order is already authoritative; this pass only
 * changes presentation vocabulary and assigns matching sequence keys.
 */
export function rigConnectConversationProject(
    input: RigConnectConversationInput,
): readonly ConversationEntry[] {
    const entries: ConversationEntry[] = [];
    for (let start = 0; start < input.elements.length; ) {
        const groupId = input.elements[start]!.groupId;
        let end = start + 1;
        while (end < input.elements.length && input.elements[end]!.groupId === groupId) end += 1;
        entries.push(...rigConnectGroupProject(input.elements.slice(start, end), input));
        start = end;
    }

    for (const entry of input.ephemeral) entries.push(entry);
    for (const request of input.pendingUserInputs)
        entries.push({
            kind: "request",
            id: `request:${request.requestId}`,
            sequence: "",
            request: {
                kind: "userInput",
                requestId: request.requestId,
                questions: request.questions,
            },
        });
    return entries.map(resequence);
}

function rigConnectGroupProject(
    elements: readonly ChatElement[],
    input: RigConnectConversationInput,
): readonly ConversationEntry[] {
    const entries: ConversationEntry[] = [];
    let groupEnd: Extract<ChatElement, { kind: "group_end" }> | undefined;
    // `inference` only says the model was asked and had not answered yet, so its
    // spinner is stale the moment the group ends. A turn that ends empty keeps
    // every row it produced, and without this it would spin forever.
    const ended = elements.some((element) => element.kind === "group_end");
    const hasTerminalFailure = elements.some(
        (element) => element.kind === "failure" && element.outcome === "failed",
    );
    for (const element of elements) {
        const sequence = sequenceOf(entries.length);
        switch (element.kind) {
            case "user_message": {
                // Several things reach the user slot without the owner typing
                // them: subagent and workflow news, and a message another agent
                // addressed to this one. Each reads as incoming from the sender
                // that produced it rather than as the reader's own turn.
                const inbound = rigInboundMessageProject({
                    text: element.text,
                    subagents: input.subagents,
                    inboundAuthor: rigInboundAuthor,
                    notification: element.source === "notification",
                });
                entries.push({
                    kind: "message",
                    source: "server",
                    delivery: element.delivery,
                    message: messageProject({
                        id: element.messageId,
                        sessionId: input.sessionId,
                        sequence,
                        text: inbound?.text ?? element.text,
                        createdAt: element.createdAt,
                        author: inbound?.author ?? profileAuthor(element.profile, element.identity),
                        attachments: (
                            element.attachments ??
                            input.sentImages?.get(element.messageId) ??
                            []
                        ).map((attachment, index) => ({
                            kind: "inlineImage" as const,
                            id: `${element.id}:image:${String(index)}`,
                            mediaType: attachment.mediaType,
                            data: attachment.data,
                            ...inlineImageSize(attachment.data),
                        })),
                    }),
                });
                break;
            }
            case "system_notice": {
                // A service line that says what it is gets the row that shows
                // it properly. Rig attributes compute preparation to every
                // session running out of that workspace, so this is the moment
                // a reader waiting on a machine can see why. Anything else, and
                // any notice whose structured kind this build does not know,
                // keeps Rig's complete sentence as an ordinary service line.
                const structured = element.structured;
                entries.push(
                    structured?.kind === "compute_preparation"
                        ? {
                              kind: "notice",
                              variant: "compute",
                              id: element.id,
                              sequence,
                              state: structured.state,
                              phase: structured.phase,
                              provider: structured.provider,
                              instanceId: structured.computeInstanceId,
                              message: structured.message,
                              ...(structured.percent === undefined
                                  ? {}
                                  : { percent: structured.percent }),
                              ...(structured.elapsedMs === undefined
                                  ? {}
                                  : { elapsedMs: structured.elapsedMs }),
                              text: element.text,
                          }
                        : {
                              kind: "notice",
                              id: element.id,
                              variant: "notice",
                              level: "info",
                              text: element.text,
                              sequence,
                          },
                );
                break;
            }
            case "inference":
                if (ended) break;
                entries.push({
                    kind: "agentActivity",
                    id: element.id,
                    occurredAt: element.createdAt,
                    sequence,
                    activity: {
                        kind: "waiting",
                        label: "Waiting for model",
                    },
                });
                break;
            case "agent_text":
                entries.push({
                    kind: "message",
                    source: "server",
                    delivery: "sent",
                    message: messageProject({
                        id: element.id,
                        sessionId: input.sessionId,
                        sequence,
                        text: element.text,
                        createdAt: element.createdAt,
                        author: rigAgentAuthor,
                        generationStatus: element.complete ? "complete" : "streaming",
                    }),
                });
                break;
            case "agent_attachments": {
                const attachments: ConversationMessageProjection["attachments"] =
                    element.attachments.map((attachment) => {
                        if (attachment.kind === "url")
                            return {
                                kind: "linked",
                                id: attachment.id,
                                attachmentKind: "url",
                                name: attachment.title,
                                source: attachment.source,
                                ...(attachment.description
                                    ? { description: attachment.description }
                                    : {}),
                                openUrl: attachment.source,
                            };
                        if (attachment.kind === "applet")
                            return {
                                kind: "linked",
                                id: attachment.id,
                                attachmentKind: "applet",
                                name: attachment.name,
                                source: attachment.applet,
                                description: attachment.description,
                                applet: attachment.applet,
                                thumbhash: attachment.thumbhash,
                                thumbnailUrl: attachment.image,
                                ...(attachment.path ? { appletPath: attachment.path } : {}),
                                ...(attachment.query ? { appletQuery: attachment.query } : {}),
                            };
                        return {
                            kind: "linked",
                            id: attachment.id,
                            attachmentKind: attachment.kind,
                            name: attachment.name,
                            source: attachment.source,
                            mediaType: attachment.mediaType,
                            bytes: attachment.bytes,
                            ...(attachment.kind === "image" || attachment.kind === "video"
                                ? { width: attachment.width, height: attachment.height }
                                : {}),
                            ...(attachment.kind === "audio" || attachment.kind === "video"
                                ? { durationMs: attachment.duration }
                                : {}),
                            ...(attachment.kind === "image"
                                ? { thumbhash: attachment.thumbhash }
                                : attachment.kind === "video"
                                  ? {
                                        thumbhash: attachment.preview.thumbhash,
                                        thumbnailUrl: attachment.preview.path,
                                    }
                                  : {}),
                            ...(attachment.downloadUrl ? { openUrl: attachment.downloadUrl } : {}),
                        };
                    });
                let targetIndex = entries.length - 1;
                while (targetIndex >= 0) {
                    const candidate = entries[targetIndex];
                    if (candidate?.kind === "message" && candidate.message.sender?.kind === "agent")
                        break;
                    targetIndex -= 1;
                }
                const target = targetIndex < 0 ? undefined : entries[targetIndex];
                if (target?.kind === "message") {
                    entries[targetIndex] = {
                        ...target,
                        message: { ...target.message, attachments },
                    };
                } else
                    entries.push({
                        kind: "message",
                        source: "server",
                        delivery: "sent",
                        message: messageProject({
                            id: element.messageId,
                            sessionId: input.sessionId,
                            sequence,
                            text: "",
                            createdAt: element.createdAt,
                            author: rigAgentAuthor,
                            attachments,
                            generationStatus: "complete",
                        }),
                    });
                break;
            }
            case "thinking":
                if (input.showReasoning)
                    entries.push({
                        kind: "agentActivity",
                        id: element.id,
                        occurredAt: element.createdAt,
                        sequence,
                        activity: {
                            kind: "reasoning",
                            text: element.text,
                            streaming: !element.complete,
                        },
                    });
                break;
            case "tool_call":
                entries.push({
                    kind: "agentActivity",
                    id: element.id,
                    occurredAt: element.createdAt,
                    sequence,
                    activity: { kind: "tool", tool: toolProject(element) },
                });
                break;
            case "failure":
                entries.push({
                    kind: "notice",
                    id: element.id,
                    variant: "notice",
                    level: element.outcome === "retried" ? "warning" : "error",
                    ...(element.outcome === "retried"
                        ? { retry: { attempt: element.attempt } }
                        : {}),
                    title: element.outcome === "retried" ? "Retrying" : "Failure",
                    text: element.reason,
                    sequence,
                });
                break;
            case "compaction":
                entries.push({
                    kind: "agentActivity",
                    id: element.id,
                    occurredAt: element.createdAt,
                    sequence,
                    activity: {
                        kind: "labeled",
                        label:
                            element.status === "running"
                                ? "Compacting context"
                                : "Compacted context",
                        subject: rigCompactionSubject(
                            element.estimatedTokensBefore,
                            element.estimatedTokensAfter,
                        ),
                        status:
                            element.status === "running"
                                ? "running"
                                : element.status === "completed"
                                  ? "success"
                                  : "failed",
                        mono: false,
                    },
                });
                break;
            case "group_end":
                groupEnd = element;
                if (element.errorMessage && !hasTerminalFailure)
                    entries.push({
                        kind: "notice",
                        id: `${element.id}:error`,
                        variant: "notice",
                        level: "error",
                        title: "Failure",
                        text: element.errorMessage,
                        sequence,
                    });
                entries.push({
                    kind: "turnStatus",
                    id: `${element.id}:status`,
                    sequence: sequenceOf(entries.length),
                    status:
                        element.reason === "steering"
                            ? "steered"
                            : element.reason === "error" || element.reason === "abort"
                              ? "failed"
                              : "complete",
                    reason: element.reason,
                    durationMs: element.elapsedMs,
                    tools: elements.filter((candidate) => candidate.kind === "tool_call").length,
                });
                break;
        }
    }

    // A standalone manual compaction already has its meaningful activity and
    // completion rows. Generic tool-only collapsing would fabricate an empty
    // agent reply and trace control around them.
    if (!groupEnd || groupEnd.turnKind === "compaction") return entries;
    let finalAgentIndex = -1;
    let statusIndex = -1;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (!entry) continue;
        if (statusIndex < 0 && entry.kind === "turnStatus") statusIndex = index;
        if (entry.kind === "message" && entry.message.sender?.kind === "agent") {
            finalAgentIndex = index;
            break;
        }
    }
    const finalAgent = finalAgentIndex < 0 ? undefined : entries[finalAgentIndex];
    if (finalAgent?.kind === "message") {
        const status = entries[statusIndex];
        if (status?.kind === "turnStatus" && finalAgent.message.text.trim().length > 0)
            entries[statusIndex] = { ...status, copyText: finalAgent.message.text };
    }

    /*
     * Collapsing hides the turn's work, not the record of it going wrong: a
     * failure or a retry is why the answer reads the way it does, and burying it
     * behind a control the reader has no reason to open would leave a broken run
     * looking like a clean one. Every non-informational notice therefore stays.
     */
    const visibleCollapsed = entries.filter(
        (entry, index) =>
            entry.kind === "turnStatus" ||
            index === finalAgentIndex ||
            (entry.kind === "message" && entry.message.sender?.kind !== "agent") ||
            (entry.kind === "notice" && !noticeInformational(entry)),
    );
    const hiddenCount = entries.length - visibleCollapsed.length;
    if (hiddenCount === 0) return entries;

    const trace: AgentTurnTraceSummary = {
        turnId: groupEnd.groupId,
        agentUserId: rigAgentAuthor.id,
        status: groupEnd.reason === "error" || groupEnd.reason === "abort" ? "failed" : "complete",
        startedAt: new Date(groupEnd.startedAt).toISOString(),
        completedAt: new Date(groupEnd.endedAt).toISOString(),
        entryCount: hiddenCount,
        toolCallCount: elements.filter((element) => element.kind === "tool_call").length,
        subagents: [],
        backgroundTerminals: [],
    };

    /*
     * Expanded, the control folds the turn back up, so it rides the first row of
     * the turn — usually a tool call, and the only row there is when the turn
     * ran tools and answered nothing. Collapsed, the one row on screen is the
     * final answer, and it carries the control that reveals the rest.
     */
    if (input.expandedGroupIds.has(groupEnd.groupId)) {
        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index]!;
            if (entry.kind === "agentActivity") {
                entries[index] = { ...entry, agentTrace: trace };
                break;
            }
            if (entry.kind === "message" && entry.message.sender?.kind === "agent") {
                entries[index] = { ...entry, message: { ...entry.message, agentTrace: trace } };
                break;
            }
        }
        return entries;
    }
    /*
     * A turn that worked without answering still collapses to one row: a faint
     * empty result standing in for the reply it never wrote. Without it the
     * turn would have nowhere to keep its control, and folding it up would hide
     * the fact that it ran at all.
     *
     * A turn that did no work has nothing to stand in for. One that only failed
     * is entirely on screen already — its notices are the turn — so it keeps
     * them as they are rather than growing an empty answer and a control that
     * would reveal nothing.
     */
    if (!finalAgent || finalAgent.kind !== "message") {
        if (!entries.some((entry) => entry.kind === "agentActivity")) return entries;
        const empty: ConversationEntry = {
            kind: "message",
            source: "server",
            delivery: "sent",
            message: {
                ...messageProject({
                    id: `${groupEnd.groupId}:empty-agent-text`,
                    sessionId: input.sessionId,
                    sequence: "",
                    text: "",
                    createdAt: groupEnd.endedAt,
                    author: rigAgentAuthor,
                    generationStatus: "complete",
                }),
                agentTrace: trace,
            },
        };
        const statusPosition = visibleCollapsed.findIndex((entry) => entry.kind === "turnStatus");
        return statusPosition < 0
            ? [...visibleCollapsed, empty]
            : [
                  ...visibleCollapsed.slice(0, statusPosition),
                  empty,
                  ...visibleCollapsed.slice(statusPosition),
              ];
    }
    const tracedFinal: ConversationEntry = {
        ...finalAgent,
        message: { ...finalAgent.message, agentTrace: trace },
    };
    entries[finalAgentIndex] = tracedFinal;
    return visibleCollapsed.map((entry) => (entry === finalAgent ? tracedFinal : entry));
}

function messageProject(input: {
    readonly id: string;
    readonly sessionId: string;
    readonly sequence: string;
    readonly text: string;
    readonly createdAt: number;
    readonly author: ConversationAuthor;
    readonly attachments?: ConversationMessageProjection["attachments"];
    readonly generationStatus?: ConversationMessageProjection["generationStatus"];
}): ConversationMessageProjection {
    return {
        id: input.id,
        chatId: input.sessionId,
        sessionId: input.sessionId,
        sequence: input.sequence,
        changePts: input.sequence,
        sender: input.author,
        text: input.text,
        attachments: input.attachments ?? [],
        reactions: [],
        createdAt: new Date(input.createdAt).toISOString(),
        ...(input.generationStatus ? { generationStatus: input.generationStatus } : {}),
    };
}

function toolProject(element: Extract<ChatElement, { kind: "tool_call" }>): ConversationToolCall {
    return {
        toolCallId: element.toolCallId,
        toolName: element.name,
        arguments: jsonProject(element.arguments),
        status:
            element.status === "succeeded"
                ? "success"
                : element.status === "failed"
                  ? "failed"
                  : element.status === "interrupted"
                    ? "stopped"
                    : "running",
        ...((element.result ?? element.progress)
            ? { display: element.result ?? element.progress }
            : {}),
        failed: element.status === "failed",
        ...presentationEntry(element.presentation),
        // A review still running has only the action it is weighing: no
        // verdict, no reason, no risk. The row states a decision, so it waits
        // for one rather than painting a blank verdict beside the call.
        ...(element.permissionReview?.status === "completed"
            ? {
                  review: {
                      action: element.permissionReview.action,
                      reason: element.permissionReview.reason,
                      decision: element.permissionReview.decision,
                      risk: element.permissionReview.risk,
                      userAuthorization: element.permissionReview.userAuthorization,
                  },
              }
            : {}),
    };
}

/**
 * The presentation key, present only when this surface can draw the kind.
 *
 * A kind it cannot draw is left off entirely rather than carried as an empty
 * value, so the row falls back to the tool's own result text — which is what
 * `display` already holds — instead of showing a shape with nothing in it.
 */
function presentationEntry(presentation: ToolPresentation | undefined): {
    presentation?: ConversationActivityPresentation;
} {
    if (presentation === undefined) return {};
    const projected = presentationProject(presentation);
    return projected === undefined ? {} : { presentation: projected };
}

function presentationProject(
    presentation: ToolPresentation,
): ConversationActivityPresentation | undefined {
    switch (presentation.kind) {
        case "command":
            return {
                type: "execCommand",
                command: presentation.command,
                output: presentation.output ?? "",
            };
        case "exploration":
            return { type: "exploration", operations: presentation.steps };
        case "file_edit":
            return {
                type: "fileDiff",
                files: presentation.files,
                ...(presentation.omittedFiles === undefined
                    ? {}
                    : { omittedFiles: presentation.omittedFiles }),
            };
        case "terminal_input":
            return {
                type: "backgroundTerminalInteraction",
                command: presentation.command,
                input: presentation.input,
            };
        // A search outside the workspace, which this surface has no row for yet.
        // Its result text is what the reader sees until it does.
        case "search":
            return undefined;
    }
}

function jsonProject(value: unknown): ConversationJson {
    if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string"
    ) {
        return value;
    }
    if (Array.isArray(value)) return value.map(jsonProject);
    if (typeof value === "object") {
        const projected: Record<string, ConversationJson> = {};
        for (const [key, child] of Object.entries(value)) projected[key] = jsonProject(child);
        return projected;
    }
    return null;
}

function resequence(entry: ConversationEntry, index?: number): ConversationEntry {
    const sequence = sequenceOf(index ?? 0);
    return entry.kind === "message"
        ? { ...entry, message: { ...entry.message, sequence, changePts: sequence } }
        : { ...entry, sequence };
}

function sequenceOf(index: number): string {
    return String(index + 1).padStart(8, "0");
}
