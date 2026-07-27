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
    const latestAgentText = new Map<string, string>();
    const toolCounts = new Map<string, number>();

    for (const element of input.elements) {
        const sequence = sequenceOf(entries.length);
        switch (element.kind) {
            case "user_message":
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
            case "agent_text":
                latestAgentText.set(element.turnId, element.text);
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
                toolCounts.set(element.turnId, (toolCounts.get(element.turnId) ?? 0) + 1);
                entries.push({
                    kind: "agentActivity",
                    id: element.id,
                    occurredAt: element.createdAt,
                    sequence,
                    activity: { kind: "tool", tool: toolProject(element) },
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
            case "turn_end":
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
                    id: element.id,
                    sequence: sequenceOf(entries.length),
                    status: element.outcome === "success" ? "complete" : "failed",
                    ...(latestAgentText.has(element.turnId)
                        ? { copyText: latestAgentText.get(element.turnId) }
                        : {}),
                    durationMs: element.elapsedMs,
                    ...((toolCounts.get(element.turnId) ?? 0) > 0
                        ? { tools: toolCounts.get(element.turnId) }
                        : {}),
                });
                break;
        }
    }

    for (const entry of input.ephemeral) entries.push(resequence(entry, entries.length));
    for (const request of input.pendingUserInputs)
        entries.push({
            kind: "request",
            id: `request:${request.requestId}`,
            sequence: sequenceOf(entries.length),
            request: {
                kind: "userInput",
                requestId: request.requestId,
                questions: request.questions,
            },
        });
    return entries;
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

function resequence(entry: ConversationEntry, index: number): ConversationEntry {
    const sequence = sequenceOf(index);
    return entry.kind === "message"
        ? { ...entry, message: { ...entry.message, sequence, changePts: sequence } }
        : { ...entry, sequence };
}

function sequenceOf(index: number): string {
    return String(index + 1).padStart(8, "0");
}
