import type {
    AgentTurnTraceDetails,
    AgentTurnTraceEntrySummary,
    AgentTurnTraceSummary,
    ConversationActivity,
    ConversationMessageEntry,
    ConversationMessageProjection,
    DeepReadonly,
    ConversationAuthor,
    Loadable,
} from "happy2-state";
import type { EmojiItem, ToneName } from "./ChatPageComponents.js";
import type { IconName } from "../../Icon.js";
/**
 * The active chat port share projected for the header and info panel. A chat has
 * at most one active share, so both surfaces render one `PortShareControl` driven
 * by this view plus the shared open/disable handlers.
 */
export type PortShareView = {
    id: string;
    name: string;
    subtitle?: string;
    opening: boolean;
    disabling: boolean;
    error?: string;
};

export type Conversation = {
    composerPlaceholder: string;
    icon?: "hash" | "spark" | "inbox";
    id: string;
    memberCount?: number;
    members?: {
        initials: string;
        tone?: ToneName;
    }[];
    title: string;
    topic?: string;
};
type ChatMessage = {
    kind: "message";
    agent?: boolean;
    /**
     * The message is user-attributed but was posted through automation (a
     * plugin/API acting on the author's behalf). Drives the restrained
     * "Automated" marker; independent of `agent` (agent/system authorship).
     */
    automated?: boolean;
    author: string;
    body: string;
    conversationId: string;
    generationStatus?: "streaming" | "complete" | "failed";
    id: string;
    gutterTime?: string;
    initials?: string;
    reactions?: {
        active?: boolean;
        count: number;
        emoji: string;
    }[];
    time: string;
    tone?: ToneName;
};
type ChatDivider = {
    kind: "divider";
    conversationId: string;
    id: string;
    label: string;
};
export type LiveChatMessage = ChatMessage & {
    /**
     * A locally authored item is outgoing before the server returns its sender
     * projection. The acknowledgement retains its client mutation id so this
     * stays true through confirmation even if a delayed identity projection
     * has not arrived yet.
     */
    own: boolean;
    /**
     * Stable React identity for an optimistic message and its authoritative
     * acknowledgement. The server message id remains in `id` for actions.
     */
    renderKey: string;
    serverMessage?: DeepReadonly<ConversationMessageProjection>;
    senderId?: string;
    photoFileId?: string;
    delivery?: "sending" | "sent" | "failed";
    agentTrace?: DeepReadonly<AgentTurnTraceSummary>;
    /**
     * An earlier text block of a turn whose steps are shown, split back out of
     * the reply so the transcript reads in the order the agent worked. It is a
     * projection of the durable message, not a message of its own: the actions,
     * attachments, and trace control all stay on the real reply below it.
     */
    turnBlock?: boolean;
};
type ChatNotice = {
    kind: "notice";
    id: string;
    conversationId: string;
    icon: IconName;
    text: string;
};
/** One step of an agent turn, listed above the message that turn is producing. */
export type ChatTraceStep = {
    kind: "traceStep";
    id: string;
    conversationId: string;
    /** The assistant message whose turn produced this step. */
    messageId: string;
    /** Whether the step reads as one tight line in a run of calls. */
    tool: boolean;
    /** Projected for the shared activity row, so both stacks render one component. */
    activity: ConversationActivity;
};
export type WorkspaceEntry = ChatDivider | LiveChatMessage | ChatNotice | ChatTraceStep;
export function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
    return `${Math.round(size / (102.4 * 1024)) / 10} MB`;
}
export function mutationId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
/**
 * The message row this one follows, looking past the trace steps a turn lists
 * between its text blocks. Skipping them is what keeps a turn under one avatar:
 * the block that opens the turn carries the identity and everything the agent
 * writes after its tools continues that group.
 */
function previousMessageEntry(
    list: readonly WorkspaceEntry[],
    index: number,
): LiveChatMessage | undefined {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const entry = list[cursor];
        if (entry?.kind === "message") return entry;
        if (entry?.kind === "traceStep") continue;
        return undefined;
    }
    return undefined;
}
/**
 * Whether this message resumes prose directly under a run of tool steps. Those
 * steps are deliberately tight so a run of calls reads as one list, which leaves
 * the text below them without the clearance a fresh block has — the run would
 * otherwise read as belonging to that text instead of the text above it.
 * Roomier steps (reasoning, terminals) already carry their own clearance.
 */
export function afterToolSteps(list: readonly WorkspaceEntry[], index: number): boolean {
    const previous = list[index - 1];
    return list[index]?.kind === "message" && previous?.kind === "traceStep" && previous.tool;
}
/**
 * The layout class for one row's place in the transcript: the identity line that
 * opens a turn owns no body, and prose resuming under a run of tool steps needs
 * the clearance those tight rows do not provide.
 */
export function entryLayoutClass(
    list: readonly WorkspaceEntry[],
    index: number,
): string | undefined {
    const entry = list[index];
    if (entry?.kind === "message" && entry.turnBlock && entry.body.length === 0)
        return "happy2-message--turn-header";
    return afterToolSteps(list, index) ? "happy2-message--after-trace-steps" : undefined;
}
export function messagesGrouped(
    list: readonly WorkspaceEntry[],
    index: number,
    message: LiveChatMessage,
): boolean {
    const previous = previousMessageEntry(list, index);
    if (!previous) return false;
    const previousMessage = previous;
    const ownRun = previousMessage.own && message.own;
    const sameAuthor = ownRun || previousMessage.author === message.author;
    /* Automation attribution is part of the message identity: a hand-typed and an
       automated message from the same author must not merge into one turn, or the
       automated follow-up would lose its "Automated" marker (only a group's lead
       row renders the meta row) and read as manually typed. */
    const sameAutomation = Boolean(previousMessage.automated) === Boolean(message.automated);
    return (
        sameAuthor &&
        sameAutomation &&
        (ownRun ||
            ((previousMessage.serverMessage?.audience ?? "people") ===
                (message.serverMessage?.audience ?? "people") &&
                sameIds(
                    previousMessage.serverMessage?.agentUserIds ?? [],
                    message.serverMessage?.agentUserIds ?? [],
                )))
    );
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}
export const emojiItems: EmojiItem[] = [
    { id: "rocket", char: "🚀", name: "rocket" },
    { id: "eyes", char: "👀", name: "eyes" },
    { id: "check", char: "✅", name: "check mark" },
    { id: "fire", char: "🔥", name: "fire" },
    { id: "tada", char: "🎉", name: "party" },
    { id: "thumbsup", char: "👍", name: "thumbs up" },
];
export const composerHint = "Enter to send · Shift+Enter for a new line";
export const composerAudienceHint = "Enter to send · Shift+Tab to switch audience";
const tones: ToneName[] = ["violet", "ember", "mint", "ocean", "rose", "amber", "slate"];
export function toneFor(id: string): ToneName {
    let hash = 0;
    for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return tones[hash % tones.length]!;
}
export function identityInitials(identity: Pick<ConversationAuthor, "displayName">): string {
    return identity.displayName
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toUpperCase();
}
function messageTime(value: string): string {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
        new Date(value),
    );
}
function compactTime(value: string): string {
    const parts = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
    }).formatToParts(new Date(value));
    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    return hour && minute ? `${hour}:${minute}` : messageTime(value);
}
function dayLabel(value: string): string {
    const date = new Date(value);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "Today";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }).format(date);
}
function messageEntry(item: DeepReadonly<ConversationMessageEntry>): LiveChatMessage {
    const message = item.message;
    const sender = message.sender;
    const own = item.source === "local" || item.clientMutationId !== undefined;
    const name = sender?.displayName ?? message.senderBot?.name ?? (own ? "You" : "Happy Place");
    const deleted = Boolean(message.deletedAt);
    return {
        kind: "message",
        id: message.id,
        own,
        renderKey: item.clientMutationId ?? message.id,
        conversationId: message.chatId,
        author: name,
        initials: sender ? identityInitials(sender) : name.slice(0, 2).toUpperCase(),
        senderId: sender?.id,
        photoFileId: sender?.photoFileId ?? message.senderBot?.photoFileId,
        tone: sender ? toneFor(sender.id) : "brand",
        agent: message.kind === "automated",
        automated: message.automated,
        generationStatus: deleted ? undefined : message.generationStatus,
        agentTrace: deleted ? undefined : message.agentTrace,
        time: messageTime(message.createdAt),
        gutterTime: compactTime(message.createdAt),
        body: deleted ? "Message deleted" : message.text,
        reactions: message.reactions
            .map((reaction) => ({
                active: reaction.reacted,
                count: reaction.count,
                emoji: reaction.emoji ?? (reaction.customEmojiId ? `:${reaction.key}:` : ""),
            }))
            .filter((reaction) => reaction.emoji.length > 0),
        serverMessage: message,
        delivery: item.delivery,
    };
}
/** A turn whose trace has stopped advancing collapses behind its "View traces" link. */
export function turnTerminal(trace: DeepReadonly<AgentTurnTraceSummary> | undefined): boolean {
    return trace !== undefined && (trace.status === "complete" || trace.status === "failed");
}
/** The turn traces the transcript renders steps for, keyed by assistant message id. */
export type ChatTraceProjection = {
    readonly traces: Readonly<Record<string, Loadable<DeepReadonly<AgentTurnTraceDetails>>>>;
    readonly expandedMessageIds: readonly string[];
};
/**
 * Decides whether a message's turn shows its steps in the transcript: a running
 * turn always streams its tools and reasoning so the reader watches it work, and
 * a finished turn does so only while the reader keeps it expanded.
 */
export function traceStepsShown(
    entry: LiveChatMessage,
    projection: ChatTraceProjection | undefined,
): boolean {
    if (!entry.agentTrace) return false;
    return (
        !turnTerminal(entry.agentTrace) ||
        (projection?.expandedMessageIds.includes(entry.id) ?? false)
    );
}
/**
 * Keeps only the steps that describe work the reader cannot already see. A
 * `response` step carries the assistant text the message itself renders, and a
 * `status` step is turn bookkeeping ("Starting turn", "Inference 2", "Turn
 * completed"); listing either would duplicate or pad the transcript. What
 * survives — reasoning, tools, terminals, subagents — is exactly what the local
 * conversation lists between a request and its answer.
 */
function traceStepListed(step: DeepReadonly<AgentTurnTraceEntrySummary>): boolean {
    return step.kind !== "response" && step.kind !== "status";
}
/**
 * The one line a step shows. A server-side step carries the whole span it
 * summarized — a paragraph of thinking, a tool's result — so the transcript
 * takes its first real line and drops the emphasis markers that would otherwise
 * read as literal asterisks in a plain row.
 */
function traceStepSubject(detail: string): string {
    const line = detail.split("\n").find((value) => value.trim().length > 0) ?? "";
    return line
        .trim()
        .replace(/^#{1,6}\s+/u, "")
        .replace(/\*\*(.+?)\*\*/gu, "$1")
        .replace(/__(.+?)__/gu, "$1")
        .trim();
}
/**
 * Projects one summarized step onto the shared activity vocabulary. The server
 * already worded every step it records — thinking included — so each becomes a
 * labeled activity and renders through the same quiet row a local session's
 * streamed tool call does, rather than growing a second treatment per kind.
 */
function traceStepActivity(step: DeepReadonly<AgentTurnTraceEntrySummary>): ConversationActivity {
    const subject = step.detail ? traceStepSubject(step.detail) : undefined;
    return {
        kind: "labeled",
        label: step.title,
        ...(subject ? { subject } : {}),
        status:
            step.status === "running" ? "running" : step.status === "failed" ? "failed" : "success",
        // Commands and paths are literal; thinking is prose and reads as text.
        mono: step.kind === "tool" || step.kind === "terminal",
    };
}
/**
 * Splits the reply back into the text blocks the agent committed, using the
 * turn's `response` steps as the split points. The server joins those blocks
 * with a blank line to build the one durable reply, so each block must match the
 * reply's next run of text exactly; anything else — a truncated step detail, an
 * edited message — fails the match and the reply stays whole rather than being
 * rendered from a guess.
 */
function turnTextBlocks(
    body: string,
    responses: readonly string[],
): { readonly leading: string[]; readonly tail: string } {
    const leading: string[] = [];
    let rest = body;
    for (const response of responses) {
        const block = response.trim();
        if (block.length === 0) continue;
        // The turn's closing block is the reply itself, so it keeps the durable
        // message's identity, actions, and trace control instead of becoming a
        // projection of it.
        if (rest === block) return { leading, tail: block };
        if (!rest.startsWith(`${block}\n\n`)) return { leading: [], tail: body };
        leading.push(block);
        rest = rest.slice(block.length + 2);
    }
    // Text the turn has not committed yet — the block still streaming — closes
    // the turn the same way a committed final block does.
    if (rest.length > 0) return { leading, tail: rest };
    const tail = leading.pop();
    return tail === undefined ? { leading: [], tail: body } : { leading, tail };
}
/**
 * Expands one turn into the entries that precede its reply: the text blocks the
 * agent committed before its final answer, with the steps it took interleaved in
 * the order they happened. The reply itself is not returned here — it follows
 * these entries, carrying the tail text plus every message action, so a turn
 * opens under one avatar and its answer lands last as a continuation.
 */
function turnEntries(
    entry: LiveChatMessage,
    projection: ChatTraceProjection | undefined,
): { readonly entries: WorkspaceEntry[]; readonly body: string } {
    if (!traceStepsShown(entry, projection)) return { entries: [], body: entry.body };
    const loaded = projection?.traces[entry.id];
    if (loaded?.type !== "ready") return { entries: [], body: entry.body };
    const steps = loaded.value.entries;
    const { leading, tail } = turnTextBlocks(
        entry.body,
        steps.flatMap((step) => (step.kind === "response" && step.detail ? [step.detail] : [])),
    );
    const entries: WorkspaceEntry[] = [];
    let block = 0;
    for (const step of steps) {
        if (step.kind === "response") {
            const text = leading[block];
            if (text === undefined) continue;
            block += 1;
            entries.push({
                ...entry,
                id: entry.id,
                renderKey: `${entry.renderKey} block-${block}`,
                body: text,
                turnBlock: true,
                reactions: undefined,
                agentTrace: undefined,
                generationStatus: undefined,
            });
            continue;
        }
        if (!traceStepListed(step)) continue;
        entries.push({
            kind: "traceStep",
            id: `${entry.id} ${step.id}`,
            conversationId: entry.conversationId,
            messageId: entry.id,
            tool: step.kind === "tool",
            activity: traceStepActivity(step),
        });
    }
    // A turn that went to work before writing anything would otherwise open with
    // bare steps and only name the agent afterwards, so its own steps would read
    // as trailing whatever came before it. The identity leads instead, and every
    // step and text block below it continues that one group.
    if (entries[0]?.kind === "traceStep")
        entries.unshift({
            ...entry,
            renderKey: `${entry.renderKey} turn`,
            body: "",
            turnBlock: true,
            reactions: undefined,
            agentTrace: undefined,
            generationStatus: undefined,
        });
    // The control that folds a turn away rides the line that opened it, beside
    // the agent's name, so expanding and collapsing never moves it: what changes
    // is what hangs below that line, not where the reader clicks.
    const opening = entries[0];
    if (opening?.kind === "message") opening.agentTrace = entry.agentTrace;
    return { entries, body: tail };
}
export function entriesProject(
    items: readonly DeepReadonly<ConversationMessageEntry>[],
    traces?: ChatTraceProjection,
): WorkspaceEntry[] {
    const result: WorkspaceEntry[] = [];
    let previousDay = "";
    for (const item of items) {
        const message = item.message;
        const date = new Date(message.createdAt).toDateString();
        if (date !== previousDay) {
            result.push({
                kind: "divider",
                id: `day-${message.chatId}-${date}`,
                conversationId: message.chatId,
                label: dayLabel(message.createdAt),
            });
            previousDay = date;
        }
        if (message.service) {
            result.push({
                kind: "notice",
                id: message.id,
                conversationId: message.chatId,
                icon: message.service.type === "agent_effort_changed" ? "settings" : "users",
                text: message.text,
            });
            continue;
        }
        // A turn reads top to bottom as the agent worked: what it wrote first,
        // then the steps it took, then the answer it settled on.
        const projected = messageEntry(item);
        const turn = turnEntries(projected, traces);
        result.push(...turn.entries, {
            ...projected,
            body: turn.body,
            // An expanded turn already carries its control on the line that
            // opened it, so the answer closing that turn adds no second one.
            ...(turn.entries.length > 0 ? { agentTrace: undefined } : {}),
        });
    }
    return result;
}
