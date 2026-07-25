import type { ConversationAuthor } from "../conversation/conversationAuthor.js";
import type {
    ConversationActivityStatus,
    ConversationAttachment,
    ConversationEntry,
    ConversationMessageEntry,
    ConversationMessageProjection,
    ConversationToolCall,
} from "../conversation/conversationEntry.js";
import type { ConversationSummary } from "../conversation/conversationSummary.js";
import type {
    RigMessage,
    RigSession,
    RigSessionSummary,
    RigStreamingMessage,
    RigToolEntry,
    RigToolStatus,
    RigUserInputRequest,
} from "./rigTypes.js";

/** Stable identity of the machine owner, the only person in a local session. */
export const rigOwnerAuthor: ConversationAuthor = {
    id: "rig:owner",
    displayName: "You",
    username: "you",
    kind: "human",
};

/** Stable identity of the local agent; a local session has exactly one. */
export const rigAgentAuthor: ConversationAuthor = {
    id: "rig:agent",
    displayName: "Happy",
    username: "happy",
    kind: "agent",
    agentRole: "default",
};

/**
 * Projects one local message into the shared conversation message shape. The
 * collaborative fields a local session has no concept of (audience targets,
 * receipts, mentions, attachments, reactions) are empty rather than optional:
 * one message shape serves both stacks and neither carries a mode flag.
 */
function messageProjection(input: {
    readonly id: string;
    readonly sessionId: string;
    readonly author: ConversationAuthor;
    readonly text: string;
    readonly attachments?: readonly ConversationAttachment[];
    readonly generationStatus?: "streaming" | "complete" | "failed";
}): ConversationMessageProjection {
    return {
        id: input.id,
        chatId: input.sessionId,
        sequence: "",
        changePts: "",
        sender: input.author,
        kind: input.author.kind === "agent" ? "automated" : "user",
        automated: false,
        audience: input.author.kind === "agent" ? "people" : "agents",
        agentUserIds: [],
        text: input.text,
        ...(input.generationStatus ? { generationStatus: input.generationStatus } : {}),
        revision: 0,
        mentions: [],
        attachments: input.attachments ?? [],
        reactions: [],
        receipts: [],
        expiryMode: "none",
        createdAt: "",
    };
}

function messageEntry(input: {
    readonly id: string;
    readonly sessionId: string;
    readonly author: ConversationAuthor;
    readonly text: string;
    readonly attachments?: readonly ConversationAttachment[];
    readonly generationStatus?: "streaming" | "complete" | "failed";
}): ConversationMessageEntry {
    return {
        kind: "message",
        message: messageProjection(input),
        source: "server",
        delivery: "sent",
    };
}

const TOOL_STATUS: Record<RigToolStatus, ConversationActivityStatus> = {
    running: "running",
    awaiting_approval: "awaitingApproval",
    success: "success",
    failed: "failed",
    stopped: "stopped",
};

/** Restates one daemon tool entry as the transport-free activity a reader sees. */
export function rigToolCallProject(tool: RigToolEntry): ConversationToolCall {
    return {
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        arguments: tool.arguments,
        status: TOOL_STATUS[tool.status],
        ...(tool.display !== undefined ? { display: tool.display } : {}),
        failed: tool.failed,
        ...(tool.failure ? { failure: tool.failure } : {}),
        ...(tool.presentation ? { presentation: tool.presentation } : {}),
        ...(tool.permissionReview ? { review: tool.permissionReview } : {}),
    };
}

/** A local notice entry (run failures, resets, compaction marks). */
export function rigNoticeEntry(
    id: string,
    level: "info" | "warning" | "error",
    title: string,
    text: string,
): ConversationEntry {
    return { kind: "notice", id, variant: "notice", level, title, text, sequence: "" };
}

/** A shell-mode run, rendered as agent activity while it runs and after it exits. */
export function rigShellEntry(
    id: string,
    run: {
        readonly command: string;
        readonly output: string;
        readonly exitCode: number | null;
        readonly running: boolean;
        readonly timedOut: boolean;
    },
): ConversationEntry {
    return { kind: "agentActivity", id, activity: { kind: "shell", ...run }, sequence: "" };
}

function messageText(message: RigMessage): string {
    let text = "";
    for (const block of message.blocks) if (block.type === "text") text += block.text;
    return text;
}

/**
 * The images a local message carries inline. A local session has no upload step,
 * so these are attachments whose bytes travel with the message rather than file
 * ids; their index-based identity is stable for the life of the message.
 */
function messageAttachments(message: RigMessage): readonly ConversationAttachment[] {
    const attachments: ConversationAttachment[] = [];
    message.blocks.forEach((block, index) => {
        if (block.type !== "image") return;
        attachments.push({
            kind: "inlineImage",
            id: `${message.id}:image:${index}`,
            mediaType: block.mediaType,
            data: block.data,
            ...(block.detail !== undefined ? { detail: block.detail } : {}),
        });
    });
    return attachments;
}

function userEntry(sessionId: string, message: RigMessage): ConversationEntry {
    return messageEntry({
        id: message.id,
        sessionId,
        author: rigOwnerAuthor,
        text: messageText(message),
        attachments: messageAttachments(message),
    });
}

type RigToolResultBlock = Extract<RigMessage["blocks"][number], { type: "toolResult" }>;

/**
 * Pairs every durable tool call with its result, keyed by the call's positional
 * entry id rather than by tool call id. The daemon delivers a call and its result
 * in separate messages, so correlation spans the whole session; but a provider may
 * reuse a call id across turns, so a call claims the first still-unclaimed result
 * for its id in message order. Matching by id alone would show one late result on
 * every earlier call that happened to share the id.
 */
function toolResultsPair(messages: readonly RigMessage[]): ReadonlyMap<string, RigToolResultBlock> {
    const paired = new Map<string, RigToolResultBlock>();
    const unclaimed = new Map<string, string[]>();
    for (const message of messages)
        message.blocks.forEach((block, index) => {
            if (block.type === "toolCall") {
                const queue = unclaimed.get(block.id);
                if (queue) queue.push(`${message.id}:${index}`);
                else unclaimed.set(block.id, [`${message.id}:${index}`]);
            } else if (block.type === "toolResult") {
                const entryId = unclaimed.get(block.toolCallId)?.shift();
                if (entryId !== undefined) paired.set(entryId, block);
            }
        });
    return paired;
}

function appendAgentEntries(
    entries: ConversationEntry[],
    sessionId: string,
    message: RigMessage,
    results: ReadonlyMap<string, RigToolResultBlock>,
    showReasoning: boolean,
): void {
    message.blocks.forEach((block, index) => {
        // Every entry id — text, reasoning, tool — is the block's position in its
        // message. A tool call id is the provider's, may repeat across turns, and
        // would collapse two distinct tool rows into one entry key if used here.
        const id = `${message.id}:${index}`;
        if (block.type === "text") {
            if (block.text)
                entries.push(
                    messageEntry({
                        id,
                        sessionId,
                        author: rigAgentAuthor,
                        text: block.text,
                        generationStatus: "complete",
                    }),
                );
        } else if (block.type === "thinking") {
            if (showReasoning && !block.redacted)
                entries.push({
                    kind: "agentActivity",
                    id,
                    activity: { kind: "reasoning", text: block.thinking, streaming: false },
                    sequence: "",
                });
        } else if (block.type === "toolCall") {
            const result = results.get(id);
            entries.push({
                kind: "agentActivity",
                id,
                sequence: "",
                activity: {
                    kind: "tool",
                    tool: rigToolCallProject({
                        toolCallId: block.id,
                        toolName: block.name,
                        arguments: block.arguments,
                        status: result ? (result.failed ? "failed" : "success") : "success",
                        display: result?.display,
                        failed: result?.failed ?? false,
                        failure: result?.failure,
                        presentation: result?.presentation,
                    }),
                },
            });
        }
    });
}

/** Positional ordering keys, so the shared merge/compare helpers order the list. */
function sequenced(entries: readonly ConversationEntry[]): readonly ConversationEntry[] {
    return entries.map((entry, index) => {
        const sequence = String(index + 1).padStart(8, "0");
        if (entry.kind === "message")
            return { ...entry, message: { ...entry.message, sequence, changePts: sequence } };
        return { ...entry, sequence };
    });
}

export interface RigConversationBuildInput {
    readonly sessionId: string;
    readonly session?: RigSession;
    readonly streaming?: RigStreamingMessage;
    /** Run notices and shell runs that are not part of the durable message log. */
    readonly ephemeral: readonly ConversationEntry[];
    readonly showReasoning: boolean;
    readonly pendingUserInputs: readonly RigUserInputRequest[];
}

/**
 * Builds the ordered conversation a local session renders: durable messages
 * (with their tool calls correlated to results), run notices, the streaming
 * reply, and anything currently waiting on the reader. Every entry is emitted;
 * grouping a turn and collapsing a finished one belongs to the turn pass, which
 * needs the complete list. Streaming
 * output is an ordinary message entry carrying a generation status rather than
 * a separate top-level field, so the same row settles in place when the run ends.
 */
export function rigConversationBuild(
    input: RigConversationBuildInput,
): readonly ConversationEntry[] {
    const entries: ConversationEntry[] = [];
    const session = input.session;
    if (session) {
        const results = toolResultsPair(session.messages);
        for (const message of session.messages) {
            if (message.internal) continue;
            if (message.role === "user") {
                entries.push(userEntry(input.sessionId, message));
                continue;
            }
            if (message.role === "system") {
                const text = messageText(message);
                if (text) entries.push(rigNoticeEntry(message.id, "info", "System", text));
                continue;
            }
            appendAgentEntries(entries, input.sessionId, message, results, input.showReasoning);
        }
    }

    for (const notice of input.ephemeral) entries.push(notice);

    const streaming = input.streaming;
    if (streaming)
        streaming.blocks.forEach((block, index) => {
            const id = `${streaming.runId}:stream:${index}`;
            if (block.kind === "text")
                entries.push(
                    messageEntry({
                        id,
                        sessionId: input.sessionId,
                        author: rigAgentAuthor,
                        text: block.text,
                        generationStatus: "streaming",
                    }),
                );
            else if (block.kind === "thinking") {
                if (input.showReasoning)
                    entries.push({
                        kind: "agentActivity",
                        id,
                        sequence: "",
                        activity: { kind: "reasoning", text: block.text, streaming: true },
                    });
            } else
                entries.push({
                    kind: "agentActivity",
                    id,
                    sequence: "",
                    activity: { kind: "tool", tool: rigToolCallProject(block.tool) },
                });
        });

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

    return sequenced(entries);
}

/** Falls back through title, recap, and id so a row always names its session. */
function summaryTitle(session: RigSessionSummary): string {
    if (session.title && session.title.trim().length > 0) return session.title;
    if (session.recap && session.recap.trim().length > 0) return session.recap;
    return `Session ${session.id.slice(0, 8)}`;
}

/**
 * Projects one local session into the shared conversation row: its working
 * directory is the subtitle that tells two sessions apart, and its run state is
 * the live-activity marker every agent-driven conversation renders.
 */
export function rigConversationSummaryProject(session: RigSessionSummary): ConversationSummary {
    return {
        id: session.id,
        title: summaryTitle(session),
        subtitle: session.displayCwd || session.cwd,
        activity: session.status === "running" || session.status === "queued" ? "running" : "idle",
        updatedAt: session.lastMessageAt ?? session.updatedAt,
        participants: [rigOwnerAuthor, rigAgentAuthor],
    };
}
