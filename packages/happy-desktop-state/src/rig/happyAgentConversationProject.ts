import type { ChatElement, ToolPresentation } from "../happyAgentConnection/index.js";
import type { ConversationAuthor } from "../conversation/conversationAuthor.js";
import {
    noticeInformational,
    type ConversationActivityPresentation,
    type ConversationAttachment,
    type ConversationEntry,
    type ConversationJson,
    type ConversationMessageProjection,
    type ConversationRequestEntry,
    type ConversationToolCall,
} from "../conversation/conversationEntry.js";
import { inlineImageSize } from "../conversation/inlineImageSize.js";
import type { AgentTurnTraceSummary } from "../types.js";
import { rigInboundMessageOmit } from "./rigInboundMessageProject.js";
import {
    rigDelegatedChildrenByRow,
    rigDelegationEntryProject,
    type RigPlaceableSubagent,
} from "./rigDelegationProject.js";
import type { RigAnsweredUserInput, RigSubagentSummary, RigUserInputRequest } from "./rigTypes.js";
import { rigAgentAuthor, rigOwnerAuthor } from "./rigConversationProject.js";
import { rigCompactionSubject } from "./rigTokenFormat.js";

type RigProfile = NonNullable<Extract<ChatElement, { kind: "user_message" }>["profile"]>;

export interface HappyAgentConversationInput {
    readonly elements: readonly ChatElement[];
    readonly sessionId: string;
    readonly showReasoning: boolean;
    readonly ephemeral: readonly ConversationEntry[];
    readonly pendingUserInputs: readonly RigUserInputRequest[];
    readonly answeredUserInputs: readonly RigAnsweredUserInput[];
    readonly expandedGroupIds: ReadonlySet<string>;
    /** Children delegated from this session, matched to the call that spawned each. */
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
 * Projects Happy Agent's flat application transcript into Happy's shared
 * conversation rows. The element order is already authoritative; this pass only
 * changes presentation vocabulary and assigns matching sequence keys.
 */
export function happyAgentConversationProject(
    input: HappyAgentConversationInput,
): readonly ConversationEntry[] {
    const entries: ConversationEntry[] = [];
    const userInputs = new Map<string, ProjectableUserInput>();
    for (const request of input.pendingUserInputs)
        userInputs.set(request.requestId, { state: "pending", request });
    // The resolved inbox record is authoritative across the brief interval in
    // which a session snapshot can still carry the same request as pending.
    for (const request of input.answeredUserInputs)
        userInputs.set(request.requestId, { state: "answered", request });
    const matchedUserInputIds = new Set<string>();
    const omittedInboundMessageIds = new Set<string>();
    for (const element of input.elements) {
        if (element.kind !== "user_message") continue;
        if (userMessageOmit(element, input)) omittedInboundMessageIds.add(element.id);
    }
    const delegatedChildByRow = rigDelegatedChildrenByRow({
        parentSessionId: input.sessionId,
        parentToolCalls: input.elements.flatMap((element) =>
            element.kind === "tool_call"
                ? [{ rowId: element.id, toolCallId: element.toolCallId }]
                : [],
        ),
        subagents: input.subagents,
    });

    for (let start = 0; start < input.elements.length; ) {
        const groupId = input.elements[start]!.groupId;
        let end = start + 1;
        while (end < input.elements.length && input.elements[end]!.groupId === groupId) end += 1;
        entries.push(
            ...rigConnectGroupProject(
                input.elements.slice(start, end),
                input,
                userInputs,
                matchedUserInputIds,
                omittedInboundMessageIds,
                delegatedChildByRow,
                groupOpensWithOnlyOmittedUserMessages(
                    input.elements,
                    end,
                    omittedInboundMessageIds,
                ),
            ),
        );
        start = end;
    }

    for (const entry of input.ephemeral) entries.push(entry);
    // Older connectors may report a pending request before its tool element is
    // available. Keep that question actionable at the end until the transcript
    // catches up; answered records never append out of sequence.
    for (const request of input.pendingUserInputs) {
        if (matchedUserInputIds.has(request.requestId)) continue;
        entries.push(userInputRequestProject({ state: "pending", request }, ""));
    }
    return entries.map(resequence);
}

type ProjectableUserInput =
    | { readonly state: "pending"; readonly request: RigUserInputRequest }
    | { readonly state: "answered"; readonly request: RigAnsweredUserInput };

function userInputRequestProject(
    input: ProjectableUserInput,
    sequence: string,
): ConversationRequestEntry {
    if (input.state === "answered")
        return {
            kind: "request",
            id: `request:${input.request.requestId}`,
            sequence,
            request: {
                kind: "userInput",
                requestId: input.request.requestId,
                questions: input.request.questions,
                status: "answered",
                answers: input.request.answers,
                createdAt: input.request.createdAt,
                resolvedAt: input.request.resolvedAt,
            },
        };
    const request = input.request;
    return {
        kind: "request",
        id: `request:${request.requestId}`,
        sequence,
        request: {
            kind: "userInput",
            requestId: request.requestId,
            questions: request.questions,
            status: "pending",
        },
    };
}

/** The images one user message shows, from the element or this window's own send. */
function userMessageAttachments(
    element: Extract<ChatElement, { kind: "user_message" }>,
    input: HappyAgentConversationInput,
): readonly { readonly mediaType: string; readonly data: string }[] {
    return element.attachments ?? input.sentImages?.get(element.messageId) ?? [];
}

/**
 * Whether one user-slot element is collaboration transport rather than dialogue.
 * Both signals are structural: the daemon's own `source` marker, and a shape
 * Happy's composer cannot submit.
 */
function userMessageOmit(
    element: Extract<ChatElement, { kind: "user_message" }>,
    input: HappyAgentConversationInput,
): boolean {
    return rigInboundMessageOmit({
        notification: element.source === "notification",
        opaqueAgent:
            element.text.trim().length === 0 && userMessageAttachments(element, input).length === 0,
    });
}

/**
 * A model-facing collaboration update can end one inference group and open the
 * next without producing reader-visible dialogue. Its paired "Steered" footer
 * would otherwise become an orphan above the continuing Happy output.
 *
 * The omission set was classified once before grouping, so this lookahead
 * never reclassifies the following messages merely to decide about a footer.
 */
function groupOpensWithOnlyOmittedUserMessages(
    elements: readonly ChatElement[],
    start: number,
    omittedInboundMessageIds: ReadonlySet<string>,
): boolean {
    const groupId = elements[start]?.groupId;
    if (groupId === undefined) return false;
    let found = false;
    for (let index = start; index < elements.length; index += 1) {
        const element = elements[index]!;
        if (element.groupId !== groupId || element.kind !== "user_message") break;
        found = true;
        if (!omittedInboundMessageIds.has(element.id)) return false;
    }
    return found;
}

function rigConnectGroupProject(
    elements: readonly ChatElement[],
    input: HappyAgentConversationInput,
    userInputs: ReadonlyMap<string, ProjectableUserInput>,
    matchedUserInputIds: Set<string>,
    omittedInboundMessageIds: ReadonlySet<string>,
    delegatedChildByRow: ReadonlyMap<string, RigPlaceableSubagent>,
    /** The next group opens with omitted transport, so a "Steered" footer here would orphan. */
    nextGroupOpensOmitted: boolean,
): readonly ConversationEntry[] {
    const entries: ConversationEntry[] = [];
    /*
     * Children spawned by a call in this group. Each one is the lasting state of
     * its own spawn call, so it replaces that call where it happened rather than
     * collecting under a synthetic container at the end of the run. A child with
     * no `parentToolCallId` cannot be placed and is left to the Activity surface.
     */
    let groupEnd: Extract<ChatElement, { kind: "group_end" }> | undefined;
    const groupSteered = elements.some(
        (element) => element.kind === "group_end" && element.reason === "steering",
    );
    const hasTerminalFailure = elements.some(
        (element) => element.kind === "failure" && element.outcome === "failed",
    );
    for (const element of elements) {
        const sequence = sequenceOf(entries.length);
        switch (element.kind) {
            case "user_message": {
                // Rig also uses the user slot for collaboration transport:
                // lifecycle notices and opaque encrypted slots steer the model
                // but are not dialogue, so they leave no row behind.
                if (omittedInboundMessageIds.has(element.id)) break;
                entries.push({
                    kind: "message",
                    source: "server",
                    delivery: element.delivery,
                    message: messageProject({
                        id: element.messageId,
                        sessionId: input.sessionId,
                        sequence,
                        text: element.text,
                        createdAt: element.createdAt,
                        author: profileAuthor(element.profile, element.identity),
                        attachments: userMessageAttachments(element, input).map(
                            (attachment, index) => ({
                                kind: "inlineImage" as const,
                                id: `${element.id}:image:${String(index)}`,
                                mediaType: attachment.mediaType,
                                data: attachment.data,
                                ...inlineImageSize(attachment.data),
                            }),
                        ),
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
                // This is an empty live protocol placeholder, not transcript
                // content. The conversation footer owns the one live status
                // and replaces "Waiting for model" when real output arrives.
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
                    element.attachments.flatMap((attachment): readonly ConversationAttachment[] => {
                        if (attachment.kind === "url")
                            return [
                                {
                                    kind: "linked",
                                    id: attachment.id,
                                    attachmentKind: "url",
                                    name: attachment.title,
                                    source: attachment.source,
                                    ...(attachment.description
                                        ? { description: attachment.description }
                                        : {}),
                                    openUrl: attachment.source,
                                },
                            ];
                        if (attachment.kind === "applet")
                            return [
                                {
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
                                },
                            ];
                        return [
                            {
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
                                ...(attachment.downloadUrl
                                    ? { openUrl: attachment.downloadUrl }
                                    : {}),
                            },
                        ];
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
                if (input.showReasoning) {
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
                }
                break;
            case "tool_call":
                {
                    const userInput = userInputs.get(element.toolCallId);
                    const child = delegatedChildByRow.get(element.id);
                    if (userInput) {
                        matchedUserInputIds.add(element.toolCallId);
                        entries.push(userInputRequestProject(userInput, sequence));
                    } else if (child) {
                        // The child is the lasting state of this call, so it
                        // takes the call's place in the transcript.
                        entries.push(
                            rigDelegationEntryProject(child, { id: element.id, sequence }),
                        );
                    } else
                        entries.push({
                            kind: "agentActivity",
                            id: element.id,
                            occurredAt: element.createdAt,
                            sequence,
                            activity: { kind: "tool", tool: toolProject(element, groupSteered) },
                        });
                }
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
            case "group_end": {
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
                /* Steering that produced no visible message has no visible
                   cause, so its footer would read as the reader interrupting a
                   turn they never touched. */
                if (element.reason === "steering" && nextGroupOpensOmitted) break;
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
     *
     * A delegated child stays for the same reason in a different tense: it is
     * not a step this turn finished but a run still going somewhere else, and
     * the row is how the reader reaches it. A tool-only turn with no child keeps
     * its last real activity row instead of fabricating an empty agent reply.
     */
    const firstDelegationIndex = entries.findIndex((entry) => entry.kind === "delegation");
    let lastActivityIndex = -1;
    if (finalAgentIndex < 0 && firstDelegationIndex < 0)
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            if (entries[index]?.kind === "agentActivity") {
                lastActivityIndex = index;
                break;
            }
        }
    const actualAnchorIndex =
        finalAgentIndex >= 0
            ? finalAgentIndex
            : firstDelegationIndex >= 0
              ? firstDelegationIndex
              : lastActivityIndex;
    const visibleCollapsed = entries.filter(
        (entry, index) =>
            entry.kind === "turnStatus" ||
            entry.kind === "delegation" ||
            index === actualAnchorIndex ||
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

    /** The same entry carrying this turn's trace, or nothing if it cannot hold one. */
    const withTrace = (entry: ConversationEntry): ConversationEntry | undefined => {
        if (entry.kind === "agentActivity") return { ...entry, agentTrace: trace };
        if (entry.kind === "delegation") return { ...entry, agentTrace: trace };
        if (entry.kind === "message" && entry.message.sender?.kind === "agent")
            return { ...entry, message: { ...entry.message, agentTrace: trace } };
        return undefined;
    };

    /*
     * Expanded, the control folds the turn back up, so it rides the first row of
     * the turn — usually a tool call. Collapsed, it rides the final answer, the
     * first persistent delegation, or the last real activity when there was no
     * prose.
     */
    if (input.expandedGroupIds.has(groupEnd.groupId)) {
        for (let index = 0; index < entries.length; index += 1) {
            const traced = withTrace(entries[index]!);
            if (!traced) continue;
            entries[index] = traced;
            break;
        }
        return entries;
    }
    const actualAnchor = entries[actualAnchorIndex];
    if (!actualAnchor) return visibleCollapsed;
    const tracedAnchor = withTrace(actualAnchor);
    if (!tracedAnchor) return visibleCollapsed;
    entries[actualAnchorIndex] = tracedAnchor;
    return visibleCollapsed.map((entry) => (entry === actualAnchor ? tracedAnchor : entry));
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

function toolProject(
    element: Extract<ChatElement, { kind: "tool_call" }>,
    groupSteered: boolean,
): ConversationToolCall {
    const waitWokeFromInput =
        groupSteered && element.name === "wait_agent" && element.status === "interrupted";
    return {
        toolCallId: element.toolCallId,
        toolName: element.name,
        arguments: jsonProject(element.arguments),
        status:
            waitWokeFromInput || element.status === "succeeded"
                ? "success"
                : element.status === "failed"
                  ? "failed"
                  : element.status === "interrupted"
                    ? "stopped"
                    : "running",
        ...(!waitWokeFromInput && (element.result ?? element.progress)
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
                ...(presentation.terminalId === undefined
                    ? {}
                    : { backgroundProcessId: presentation.terminalId }),
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
                backgroundProcessId: presentation.terminalId,
            };
        case "search":
            return {
                type: "search",
                target: presentation.target,
                query: presentation.query,
                ...(presentation.sources === undefined ? {} : { sources: presentation.sources }),
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
