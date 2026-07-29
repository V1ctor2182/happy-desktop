import type { ChatElement, ToolPresentation } from "@slopus/rig-connect";
import type {
    ConversationActivityPresentation,
    ConversationEntry,
    ConversationJson,
    ConversationMessageProjection,
    ConversationToolCall,
} from "../conversation/conversationEntry.js";
import type { RigUserInputRequest } from "./rigTypes.js";
import { rigAgentAuthor, rigOwnerAuthor } from "./rigConversationProject.js";

export interface RigConnectConversationInput {
    readonly elements: readonly ChatElement[];
    readonly sessionId: string;
    readonly showReasoning: boolean;
    readonly ephemeral: readonly ConversationEntry[];
    readonly pendingUserInputs: readonly RigUserInputRequest[];
    readonly expandedGroupIds: ReadonlySet<string>;
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
    for (const element of elements) {
        const sequence = sequenceOf(entries.length);
        switch (element.kind) {
            case "user_message":
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
                        author: rigOwnerAuthor,
                        attachments: (element.attachments ?? []).map((attachment, index) => ({
                            kind: "inlineImage" as const,
                            id: `${element.id}:image:${String(index)}`,
                            mediaType: attachment.mediaType,
                            data: attachment.data,
                        })),
                    }),
                });
                break;
            case "system_notice":
                entries.push({
                    kind: "notice",
                    id: element.id,
                    variant: "notice",
                    level: "info",
                    text: element.text,
                    sequence,
                });
                break;
            case "inference":
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
                    title: element.outcome === "retried" ? "Retrying" : "Run failed",
                    text:
                        element.attempt === undefined
                            ? element.reason
                            : `${element.reason}. Attempt ${String(element.attempt)}.`,
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
                if (element.errorMessage)
                    entries.push({
                        kind: "notice",
                        id: `${element.id}:error`,
                        variant: "notice",
                        level: "error",
                        title: "Run failed",
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
    if (finalAgentIndex < 0) return entries;

    const finalAgent = entries[finalAgentIndex]!;
    if (finalAgent.kind !== "message") return entries;
    const status = entries[statusIndex];
    if (status?.kind === "turnStatus" && finalAgent.message.text.trim().length > 0)
        entries[statusIndex] = { ...status, copyText: finalAgent.message.text };

    const visibleCollapsed = entries.filter(
        (entry, index) =>
            entry.kind === "turnStatus" ||
            index === finalAgentIndex ||
            (entry.kind === "message" && entry.message.sender?.kind !== "agent") ||
            (entry.kind === "notice" && entry.level === "error"),
    );
    const hiddenCount = entries.length - visibleCollapsed.length;
    if (hiddenCount === 0) return entries;

    const tracedFinal: ConversationEntry = {
        ...finalAgent,
        message: {
            ...finalAgent.message,
            agentTrace: {
                turnId: groupEnd.groupId,
                agentUserId: rigAgentAuthor.id,
                status:
                    groupEnd.reason === "error" || groupEnd.reason === "abort"
                        ? "failed"
                        : "complete",
                startedAt: new Date(groupEnd.startedAt).toISOString(),
                completedAt: new Date(groupEnd.endedAt).toISOString(),
                entryCount: hiddenCount,
                toolCallCount: elements.filter((element) => element.kind === "tool_call").length,
                subagents: [],
                backgroundTerminals: [],
            },
        },
    };
    entries[finalAgentIndex] = tracedFinal;
    if (input.expandedGroupIds.has(groupEnd.groupId)) return entries;
    return visibleCollapsed.map((entry) => (entry === finalAgent ? tracedFinal : entry));
}

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
        ...(element.permissionReview
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
