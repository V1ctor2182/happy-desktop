import type { ChatElement, ToolPresentation } from "@slopus/rig-connect";
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
import type { RigSubagentSummary, RigUserInputRequest } from "./rigTypes.js";
import { rigAgentAuthor, rigInboundAuthor, rigOwnerAuthor } from "./rigConversationProject.js";
import { rigFriendAuthor } from "./rigSessionShareReplicaProject.js";
import type { ConversationAuthor } from "../conversation/conversationAuthor.js";

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

/**
 * Recognizes background-work news by the sentence Rig sends. The transcript marks
 * an element as a notification only while its live submission event is on the
 * wire, so a session whose history is reloaded from scratch arrives with that
 * marker gone and the wording is the only durable evidence left. Every outcome is
 * spelled out and the metrics tail is quote-free, so an ordinary typed message
 * cannot fall into it.
 */
const backgroundWorkNotice =
    /^Background work "([\s\S]+)" ((?:completed|failed|was stopped|was suspended|stopped when the local server restarted)[^"]*)$/;

/**
 * Names the sender of a notification injected into the user slot and rewrites the
 * line it will now be attributed to. Background-work news is the only such
 * notification that says where it came from: it quotes the subagent's
 * description, which identifies that child session while it is still listed. The
 * reader gets one row per named subagent instead of a run of identical
 * "Background work" lines, so the quote is dropped from the body its author line
 * now carries. Anything else keeps the unattributed inbound identity and its text.
 */
function notificationProject(
    text: string,
    subagents: readonly RigSubagentSummary[],
): { readonly author: ConversationAuthor; readonly text: string } {
    const notice = backgroundWorkNotice.exec(text);
    if (!notice) return { author: rigInboundAuthor, text };
    const description = notice[1]!;
    const outcome = notice[2]!;
    const subagent = subagents.find((candidate) => candidate.description === description);
    return {
        author: {
            ...rigInboundAuthor,
            // A pruned subagent still names itself in the text it sent, so the
            // quote stands in as identity when the child session is gone.
            id: `${rigInboundAuthor.id}:${subagent?.id ?? description}`,
            displayName: description,
            // The child session's own id, so its mark is the one that session
            // wears everywhere else. A pruned subagent has only its description
            // left to be recognized by, which is stable for as long as it is.
            sessionId: subagent?.id ?? description,
            username: subagent?.taskName ?? rigInboundAuthor.username,
        },
        text: `Background work ${outcome}`,
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
                // A notification uses the user slot but nobody typed it: it is
                // subagent or workflow news arriving in the session, so it reads
                // as incoming from its sender rather than as the reader's turn.
                const notification =
                    element.source === "notification" || backgroundWorkNotice.test(element.text)
                        ? notificationProject(element.text, input.subagents)
                        : undefined;
                // A message somebody this session is shared with wrote. It is
                // attributed by the name the owner of the share registered for
                // them and by nothing their own machine sent, which is why the
                // element's `displayName` is the only name read here.
                const friend = element.friendAuthor;
                entries.push({
                    kind: "message",
                    source: "server",
                    delivery: element.delivery,
                    ...(friend && element.friendMessageContext
                        ? { contextNote: FRIEND_MESSAGE_CONTEXT[element.friendMessageContext] }
                        : {}),
                    message: messageProject({
                        id: element.messageId,
                        sessionId: input.sessionId,
                        sequence,
                        text: notification?.text ?? element.text,
                        createdAt: element.createdAt,
                        author: friend
                            ? rigFriendAuthor({
                                  displayName: friend.displayName,
                                  shareMemberId: friend.shareMemberId,
                              })
                            : (notification?.author ?? rigOwnerAuthor),
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
                        if (attachment.kind === "webapp")
                            return {
                                kind: "linked",
                                id: attachment.id,
                                attachmentKind: "webapp",
                                name: attachment.name,
                                source: attachment.webapp,
                                description: attachment.description,
                                webapp: attachment.webapp,
                                thumbhash: attachment.thumbhash,
                                thumbnailUrl: attachment.image,
                                ...(attachment.path ? { webappPath: attachment.path } : {}),
                                ...(attachment.query ? { webappQuery: attachment.query } : {}),
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
                        ...(element.estimatedTokensAfter === undefined
                            ? {}
                            : {
                                  subject: `${String(element.estimatedTokensBefore)} → ${String(element.estimatedTokensAfter)} tokens`,
                              }),
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

    if (!groupEnd) return entries;
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

/**
 * Where a friend's message stands with the agent, said as something a reader can
 * act on rather than as the word the wire used. It matters because a friend
 * writing into a shared session is not the same as the agent having read them:
 * the owner is the only one who can tell whether their words landed.
 */
const FRIEND_MESSAGE_CONTEXT: Record<"included" | "overflow" | "pending", string> = {
    included: "In the agent's context",
    overflow: "Outside the agent's context",
    pending: "Waiting to reach the agent",
};

function messageProject(input: {
    readonly id: string;
    readonly sessionId: string;
    readonly sequence: string;
    readonly text: string;
    readonly createdAt: number;
    readonly author: typeof rigOwnerAuthor;
    readonly attachments?: ConversationMessageProjection["attachments"];
    readonly generationStatus?: ConversationMessageProjection["generationStatus"];
}): ConversationMessageProjection {
    return {
        id: input.id,
        chatId: input.sessionId,
        sequence: input.sequence,
        changePts: input.sequence,
        sender: input.author,
        kind: input.author.kind === "agent" ? "automated" : "user",
        automated: false,
        audience: input.author.kind === "agent" ? "people" : "agents",
        agentUserIds: [],
        text: input.text,
        revision: 0,
        mentions: [],
        attachments: input.attachments ?? [],
        reactions: [],
        receipts: [],
        expiryMode: "none",
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
        ...(element.presentation
            ? { presentation: presentationProject(element.presentation) }
            : {}),
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

function presentationProject(presentation: ToolPresentation): ConversationActivityPresentation {
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
