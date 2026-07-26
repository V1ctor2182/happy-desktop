import {
    entryKey,
    entrySequence,
    type ConversationActivity,
    type ConversationActivityFailure,
    type ConversationActivityPresentation,
    type ConversationActivityReview,
    type ConversationAttachment,
    type ConversationDiffHunk,
    type ConversationEntry,
    type ConversationFileDiff,
    type ConversationJson,
    type ConversationMessageEntry,
    type ConversationReaction,
    type ConversationRequest,
    type ConversationRequestQuestion,
    type ConversationToolCall,
} from "./conversationEntry.js";
import type { AgentTurnTraceSummary } from "../types.js";

/**
 * Merges incoming entries into the current list while preserving the reference
 * of every entry whose rendered content is unchanged. React row identity — focus,
 * selection, open menus, measured heights — depends on this: an unchanged entry
 * must come back as the very same object so its row is never replaced.
 *
 * Locally created entries that the incoming list does not yet contain are kept
 * (a send in flight is still on screen), and the result is ordered by sequence.
 */
export function entriesMerge<Entry extends ConversationEntry>(
    current: readonly Entry[],
    incoming: readonly Entry[],
): readonly Entry[] {
    const existingById = new Map(current.map((entry) => [entryKey(entry), entry]));
    const existingByMutation = new Map(
        current
            .filter((entry) => entry.kind === "message" && entry.clientMutationId !== undefined)
            .map((entry) => [(entry as ConversationMessageEntry).clientMutationId!, entry]),
    );
    const consumed = new Set<Entry>();
    const next = incoming.map((entry) => {
        const mutationId = entry.kind === "message" ? entry.clientMutationId : undefined;
        const previous =
            existingById.get(entryKey(entry)) ??
            (mutationId ? existingByMutation.get(mutationId) : undefined);
        if (previous) consumed.add(previous);
        if (previous && entryEquivalent(previous, entry)) return previous;
        return entry;
    });
    for (const entry of current)
        if (!consumed.has(entry) && entry.kind === "message" && entry.delivery !== "sent")
            next.push(entry);
    next.sort(entryCompare);
    return sameReferences(current, next) ? current : next;
}

/** Whether two entries render identically, so the existing object may be kept. */
export function entryEquivalent(left: ConversationEntry, right: ConversationEntry): boolean {
    if (left === right) return true;
    if (left.kind !== right.kind) return false;
    if (left.kind === "message" && right.kind === "message") {
        if (
            left.delivery !== right.delivery ||
            left.source !== right.source ||
            left.clientMutationId !== right.clientMutationId ||
            left.error !== right.error
        )
            return false;
        if (left.message === right.message) return true;
        if (left.source !== "server") return false;
        return (
            left.message.id === right.message.id &&
            left.message.changePts === right.message.changePts &&
            left.message.revision === right.message.revision &&
            left.message.deletedAt === right.message.deletedAt &&
            left.message.text === right.message.text &&
            left.message.generationStatus === right.message.generationStatus &&
            traceEqual(left.message.agentTrace, right.message.agentTrace) &&
            left.message.sender === right.message.sender &&
            reactionsEqual(left.message.reactions, right.message.reactions) &&
            attachmentsEqual(left.message.attachments, right.message.attachments)
        );
    }
    // Non-message entries are rebuilt from their producer's durable snapshot, so
    // structural equality of their payload is what "unchanged" means here.
    return entryKey(left) === entryKey(right) && payloadEqual(left, right);
}

/** Orders entries the way a reader sees them: by sequence, local sends last. */
export function entryCompare(left: ConversationEntry, right: ConversationEntry): number {
    const leftLocal = left.kind === "message" && left.source === "local";
    const rightLocal = right.kind === "message" && right.source === "local";
    if (leftLocal !== rightLocal) return leftLocal ? 1 : -1;
    if (leftLocal && left.kind === "message" && right.kind === "message")
        return left.message.createdAt.localeCompare(right.message.createdAt);
    const leftSequence = entrySequence(left);
    const rightSequence = entrySequence(right);
    try {
        const difference = BigInt(leftSequence) - BigInt(rightSequence);
        return difference < 0n ? -1 : difference > 0n ? 1 : 0;
    } catch {
        return leftSequence.localeCompare(rightSequence);
    }
}

function payloadEqual(left: ConversationEntry, right: ConversationEntry): boolean {
    if (left.kind === "notice" && right.kind === "notice")
        return (
            left.variant === right.variant &&
            left.level === right.level &&
            left.title === right.title &&
            left.text === right.text
        );
    if (left.kind === "agentActivity" && right.kind === "agentActivity")
        return activityEqual(left.activity, right.activity);
    if (left.kind === "request" && right.kind === "request")
        return requestEqual(left.request, right.request);
    if (left.kind === "turnStatus" && right.kind === "turnStatus")
        return (
            left.status === right.status &&
            left.copyText === right.copyText &&
            left.durationMs === right.durationMs &&
            left.tools === right.tools
        );
    return false;
}

/**
 * Whether two turn summaries render identically. The rig rebuilds a turn summary
 * on every activity tick while its `changePts` stays put, so without this a
 * running message would keep its first "View trace" projection forever.
 */
function traceEqual(
    left: AgentTurnTraceSummary | undefined,
    right: AgentTurnTraceSummary | undefined,
): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    return (
        left.turnId === right.turnId &&
        left.status === right.status &&
        left.entryCount === right.entryCount &&
        left.finalTextOffset === right.finalTextOffset &&
        left.toolCallCount === right.toolCallCount &&
        left.totalTokens === right.totalTokens &&
        left.startedAt === right.startedAt &&
        left.completedAt === right.completedAt &&
        left.latest?.kind === right.latest?.kind &&
        left.latest?.title === right.latest?.title &&
        left.latest?.detail === right.latest?.detail
    );
}

/** Whether two requests render identically, field by field for every variant. */
function requestEqual(left: ConversationRequest, right: ConversationRequest): boolean {
    if (left === right) return true;
    if (left.kind !== right.kind || left.requestId !== right.requestId) return false;
    if (left.kind === "userInput" && right.kind === "userInput")
        return (
            left.questions.length === right.questions.length &&
            left.questions.every((question, index) =>
                questionEqual(question, right.questions[index]),
            )
        );
    if (left.kind === "permissionReview" && right.kind === "permissionReview")
        return toolEqual(left.tool, right.tool) && reviewEqual(left.review, right.review);
    if (left.kind === "pluginManagement" && right.kind === "pluginManagement")
        return (
            left.action === right.action &&
            left.status === right.status &&
            left.displayName === right.displayName &&
            left.shortName === right.shortName &&
            left.description === right.description &&
            left.reason === right.reason &&
            left.lastError === right.lastError
        );
    if (left.kind === "documentWrite" && right.kind === "documentWrite")
        return (
            left.status === right.status &&
            left.documentId === right.documentId &&
            left.documentTitle === right.documentTitle &&
            left.expiresAt === right.expiresAt &&
            left.lastError === right.lastError
        );
    return false;
}

function questionEqual(
    left: ConversationRequestQuestion,
    right: ConversationRequestQuestion | undefined,
): boolean {
    if (left === right) return true;
    if (!right) return false;
    return (
        left.id === right.id &&
        left.header === right.header &&
        left.question === right.question &&
        left.multiSelect === right.multiSelect &&
        left.required === right.required &&
        left.options.length === right.options.length &&
        left.options.every(
            (option, index) =>
                option.label === right.options[index]?.label &&
                option.description === right.options[index]?.description,
        )
    );
}

function attachmentsEqual(
    left: readonly ConversationAttachment[],
    right: readonly ConversationAttachment[],
): boolean {
    if (left === right) return true;
    return (
        left.length === right.length &&
        left.every((attachment, index) => attachmentEqual(attachment, right[index]))
    );
}

function attachmentEqual(
    left: ConversationAttachment,
    right: ConversationAttachment | undefined,
): boolean {
    if (left === right) return true;
    if (!right || left.kind !== right.kind) return false;
    if (left.kind === "file" && right.kind === "file")
        return left.file === right.file || left.file.id === right.file.id;
    if (left.kind === "inlineImage" && right.kind === "inlineImage")
        return (
            left.id === right.id &&
            left.mediaType === right.mediaType &&
            left.detail === right.detail &&
            left.data === right.data
        );
    return false;
}

function activityEqual(left: ConversationActivity, right: ConversationActivity): boolean {
    if (left === right) return true;
    if (left.kind !== right.kind) return false;
    if (left.kind === "reasoning" && right.kind === "reasoning")
        return left.text === right.text && left.streaming === right.streaming;
    if (left.kind === "shell" && right.kind === "shell")
        return (
            left.command === right.command &&
            left.output === right.output &&
            left.exitCode === right.exitCode &&
            left.running === right.running &&
            left.timedOut === right.timedOut
        );
    if (left.kind === "tool" && right.kind === "tool") return toolEqual(left.tool, right.tool);
    return false;
}

/**
 * Whether two tool calls render identically. Every field the row can show must
 * appear here: a stale row is worse than a replaced one. The comparison is
 * structural rather than by reference because a producer that re-parses its
 * session from the wire hands us fresh objects on every poll, so reference
 * equality would report "changed" for every tool on every reconcile.
 */
function toolEqual(left: ConversationToolCall, right: ConversationToolCall): boolean {
    if (left === right) return true;
    return (
        left.toolCallId === right.toolCallId &&
        left.toolName === right.toolName &&
        left.status === right.status &&
        left.display === right.display &&
        left.failed === right.failed &&
        jsonEqual(left.arguments, right.arguments) &&
        failureEqual(left.failure, right.failure) &&
        presentationEqual(left.presentation, right.presentation) &&
        reviewEqual(left.review, right.review)
    );
}

function failureEqual(
    left: ConversationActivityFailure | undefined,
    right: ConversationActivityFailure | undefined,
): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    return left.kind === right.kind && left.message === right.message;
}

function reviewEqual(
    left: ConversationActivityReview | undefined,
    right: ConversationActivityReview | undefined,
): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    return (
        left.action === right.action &&
        left.reason === right.reason &&
        left.decision === right.decision &&
        left.risk === right.risk &&
        left.userAuthorization === right.userAuthorization
    );
}

function presentationEqual(
    left: ConversationActivityPresentation | undefined,
    right: ConversationActivityPresentation | undefined,
): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    if (left.type !== right.type) return false;
    if (left.type === "execCommand" && right.type === "execCommand")
        return left.command === right.command && left.output === right.output;
    if (
        left.type === "backgroundTerminalInteraction" &&
        right.type === "backgroundTerminalInteraction"
    )
        return left.command === right.command && left.input === right.input;
    if (left.type === "fileDiff" && right.type === "fileDiff")
        return (
            left.omittedFiles === right.omittedFiles &&
            left.files.length === right.files.length &&
            left.files.every((file, index) => fileDiffEqual(file, right.files[index]))
        );
    return false;
}

function fileDiffEqual(
    left: ConversationFileDiff,
    right: ConversationFileDiff | undefined,
): boolean {
    if (left === right) return true;
    if (!right) return false;
    return (
        left.path === right.path &&
        left.kind === right.kind &&
        left.language === right.language &&
        left.added === right.added &&
        left.deleted === right.deleted &&
        left.omittedLines === right.omittedLines &&
        left.hunks.length === right.hunks.length &&
        left.hunks.every((hunk, index) => hunkEqual(hunk, right.hunks[index]))
    );
}

function hunkEqual(left: ConversationDiffHunk, right: ConversationDiffHunk | undefined): boolean {
    if (left === right) return true;
    if (!right) return false;
    return (
        left.oldStart === right.oldStart &&
        left.newStart === right.newStart &&
        left.lines.length === right.lines.length &&
        left.lines.every(
            (line, index) =>
                line.kind === right.lines[index]?.kind && line.text === right.lines[index]?.text,
        )
    );
}

/** Structural equality for a tool's arguments, which are arbitrary JSON. */
function jsonEqual(left: ConversationJson, right: ConversationJson): boolean {
    if (left === right) return true;
    if (left === null || right === null) return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right)) return false;
        return left.length === right.length && left.every((v, i) => jsonEqual(v, right[i]!));
    }
    if (typeof left === "object" && typeof right === "object") {
        const leftRecord = left as Record<string, ConversationJson>;
        const rightRecord = right as Record<string, ConversationJson>;
        const leftKeys = Object.keys(leftRecord);
        if (leftKeys.length !== Object.keys(rightRecord).length) return false;
        return leftKeys.every(
            (key) => key in rightRecord && jsonEqual(leftRecord[key]!, rightRecord[key]!),
        );
    }
    return false;
}

function reactionsEqual(
    left: readonly ConversationReaction[],
    right: readonly ConversationReaction[],
): boolean {
    return (
        left.length === right.length &&
        left.every(
            (reaction, index) =>
                reaction.key === right[index]?.key &&
                reaction.count === right[index]?.count &&
                reaction.reacted === right[index]?.reacted,
        )
    );
}

function sameReferences(
    left: readonly ConversationEntry[],
    right: readonly ConversationEntry[],
): boolean {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
