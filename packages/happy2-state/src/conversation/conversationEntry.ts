import type { FileSummary, MessageSummary, UserError } from "../types.js";
import type { ConversationAuthor } from "./conversationAuthor.js";

/** Structured value carried verbatim from an agent tool call into its render. */
export type ConversationJson =
    | string
    | number
    | boolean
    | null
    | readonly ConversationJson[]
    | { readonly [key: string]: ConversationJson };

/**
 * One reaction bucket on a conversation message: the aggregate counts a reader
 * sees, without the actor list (loaded on demand by the owning surface).
 */
export interface ConversationReaction {
    readonly key: string;
    readonly emoji?: string;
    readonly customEmojiId?: string;
    readonly count: number;
    readonly reacted: boolean;
}

/**
 * One thing attached to a message. A cloud attachment is a durable server file
 * the viewer fetches by id; a local session has no upload step and carries the
 * bytes inline. Both are attachments to a reader, so they share one type rather
 * than forcing each surface to know which stack produced the message.
 */
export type ConversationAttachment =
    | { readonly kind: "file"; readonly file: FileSummary }
    | {
          readonly kind: "inlineImage";
          /** Stable within its message, so a row keeps identity across reconciles. */
          readonly id: string;
          readonly mediaType: string;
          /** Base64 payload exactly as the producer supplied it. */
          readonly data: string;
          readonly detail?: "high" | "original";
      };

/**
 * The render projection of one authored message. Collaborative fields (sender
 * identity, reactions, audience) are part of the shape for every producer; a
 * local session simply leaves them empty rather than growing a second type.
 * `attachments` widens the server file list to the shared attachment union so an
 * inline local image survives without a parallel message shape.
 */
export interface ConversationMessageProjection extends Omit<
    MessageSummary,
    "sender" | "reactions" | "attachments"
> {
    readonly sender?: ConversationAuthor;
    readonly reactions: readonly ConversationReaction[];
    readonly attachments: readonly ConversationAttachment[];
}

/** Lifecycle of one piece of agent activity, shared by tool calls and shell runs. */
export type ConversationActivityStatus =
    | "running"
    | "awaitingApproval"
    | "success"
    | "failed"
    | "stopped";

export type ConversationDiffKind = "add" | "delete" | "update";
export type ConversationDiffLineKind = "add" | "context" | "delete";

export interface ConversationDiffLine {
    readonly kind: ConversationDiffLineKind;
    readonly text: string;
}

export interface ConversationDiffHunk {
    readonly oldStart: number;
    readonly newStart: number;
    readonly lines: readonly ConversationDiffLine[];
}

export interface ConversationFileDiff {
    readonly path: string;
    readonly kind: ConversationDiffKind;
    readonly hunks: readonly ConversationDiffHunk[];
    readonly language?: string;
    readonly added?: number;
    readonly deleted?: number;
    readonly omittedLines?: number;
}

/** The rich body an activity expands into, when the producer knows its shape. */
export type ConversationActivityPresentation =
    | {
          readonly type: "exploration";
          readonly operations: readonly (
              | { readonly kind: "list"; readonly target: string }
              | { readonly kind: "read"; readonly name: string }
              | {
                    readonly kind: "search";
                    readonly command: string;
                    readonly path?: string;
                    readonly query?: string;
                }
          )[];
      }
    | {
          readonly type: "fileDiff";
          readonly files: readonly ConversationFileDiff[];
          readonly omittedFiles?: number;
      }
    | { readonly type: "execCommand"; readonly command: string; readonly output: string }
    | {
          readonly type: "backgroundTerminalInteraction";
          readonly command: string;
          readonly input: string;
      };

export interface ConversationActivityFailure {
    readonly kind: "execution_failed" | "interrupted" | "invalid_arguments" | "tool_unavailable";
    readonly message?: string;
}

/** Why an activity is paused for a human decision, shown inline with its row. */
export interface ConversationActivityReview {
    readonly action: string;
    readonly reason: string;
    readonly decision: "allow" | "ask" | "deny";
    readonly risk: "low" | "medium" | "high" | "critical";
    readonly userAuthorization: "unknown" | "low" | "medium" | "high";
}

/** One tool invocation with everything a reader needs at a glance plus on demand. */
export interface ConversationToolCall {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly arguments: ConversationJson;
    readonly status: ConversationActivityStatus;
    readonly display?: string;
    readonly failed: boolean;
    readonly failure?: ConversationActivityFailure;
    readonly presentation?: ConversationActivityPresentation;
    readonly review?: ConversationActivityReview;
}

/**
 * What an `agentActivity` entry is. Glanceable by default and expandable on
 * demand: nobody reads tool transcripts line by line, so every variant carries
 * a one-line identity plus the payload a reader can open.
 */
export type ConversationActivity =
    | { readonly kind: "tool"; readonly tool: ConversationToolCall }
    | { readonly kind: "reasoning"; readonly text: string; readonly streaming: boolean }
    | {
          readonly kind: "shell";
          readonly command: string;
          readonly output: string;
          readonly exitCode: number | null;
          readonly running: boolean;
          readonly timedOut: boolean;
      }
    /**
     * A step whose producer already labeled it. A local session streams the tool
     * call itself and the client derives the wording; a cloud turn is summarized
     * by the server, which sends the label and its subject and keeps the payload
     * out of the transcript. Both are one step of an agent's work, so both render
     * as the same row rather than growing a second one.
     */
    | {
          readonly kind: "labeled";
          readonly label: string;
          readonly subject?: string;
          readonly status: ConversationActivityStatus;
          /** Literal commands and paths read as code; prose does not. */
          readonly mono: boolean;
      };

/**
 * Something waiting on a human: the payload behind a `request` entry. This is
 * the one request vocabulary for both stacks. A local session asks structured
 * questions and pauses risky tools; a cloud chat gates plugin management and
 * document writes. They are the same idea — an agent blocked on a decision — so
 * a single closed union describes all of them and one row component renders them.
 */
export type ConversationRequest =
    | {
          readonly kind: "userInput";
          readonly requestId: string;
          readonly questions: readonly ConversationRequestQuestion[];
      }
    | {
          readonly kind: "permissionReview";
          readonly requestId: string;
          /** The paused call, so the row can show what is about to run. */
          readonly tool: ConversationToolCall;
          readonly review: ConversationActivityReview;
      }
    | {
          readonly kind: "pluginManagement";
          readonly requestId: string;
          readonly action: "install" | "update" | "uninstall";
          readonly status: ConversationRequestStatus;
          readonly displayName: string;
          readonly shortName: string;
          readonly description: string;
          readonly reason?: string;
          readonly lastError?: string;
      }
    | {
          readonly kind: "documentWrite";
          readonly requestId: string;
          readonly status: ConversationRequestStatus;
          readonly documentId: string;
          readonly documentTitle: string;
          readonly expiresAt: string;
          readonly lastError?: string;
      };

/** Where a request stands; `pending` is the only state awaiting a human. */
export type ConversationRequestStatus =
    | "pending"
    | "processing"
    | "approved"
    | "denied"
    | "failed"
    | "expired";

/** One request-scoped local submission lifecycle rendered beside its request. */
export type ConversationRequestSubmission =
    | { readonly requestId: string; readonly status: "pending" }
    | { readonly requestId: string; readonly status: "failed"; readonly error: UserError };

/** The request's identity, stable across reconciles for every variant. */
export function requestId(request: ConversationRequest): string {
    return request.requestId;
}

export interface ConversationRequestQuestion {
    readonly id: string;
    readonly header: string;
    readonly question: string;
    readonly multiSelect: boolean;
    readonly required: boolean;
    readonly options: readonly ConversationRequestOption[];
}

export interface ConversationRequestOption {
    readonly label: string;
    readonly description: string;
}

export interface ConversationMessageEntry {
    readonly kind: "message";
    readonly message: ConversationMessageProjection;
    readonly source: "server" | "local";
    readonly delivery: "sending" | "pending_steering" | "sent" | "failed";
    readonly clientMutationId?: string;
    readonly error?: UserError;
}

export interface ConversationActivityEntry {
    readonly kind: "agentActivity";
    readonly id: string;
    readonly activity: ConversationActivity;
    /** Durable event time for the activity, in Unix milliseconds when available. */
    readonly occurredAt?: number;
    /** Ordering key inside the conversation, compared like a message sequence. */
    readonly sequence: string;
}

export interface ConversationNoticeEntry {
    readonly kind: "notice";
    readonly id: string;
    /** `divider` closes a section (a completed turn); `notice` is a service line. */
    readonly variant: "notice" | "divider";
    readonly level: "info" | "warning" | "error";
    readonly title?: string;
    readonly text: string;
    readonly sequence: string;
}

export interface ConversationRequestEntry {
    readonly kind: "request";
    readonly id: string;
    readonly request: ConversationRequest;
    readonly sequence: string;
}

/**
 * Permanent readout under a finished turn: how long it took from the request
 * and how many tools it used. Running turns use the message-list footer instead.
 */
export interface ConversationTurnStatusEntry {
    readonly kind: "turnStatus";
    readonly id: string;
    readonly sequence: string;
    readonly status: "complete" | "failed" | "steered";
    /** Final assistant text copied by the settled footer action. */
    readonly copyText?: string;
    /** Final duration from request sent through completion, when known. */
    readonly durationMs?: number;
    readonly tools?: number;
}

/**
 * Everything a conversation can contain, as one closed union. A cloud chat and a
 * local Rig session both produce exactly these entries; neither stack renders a
 * shape the other cannot express.
 */
export type ConversationEntry =
    | ConversationMessageEntry
    | ConversationActivityEntry
    | ConversationNoticeEntry
    | ConversationRequestEntry
    | ConversationTurnStatusEntry;

/** The stable render identity of an entry; the row key React must keep. */
export function entryKey(entry: ConversationEntry): string {
    return entry.kind === "message" ? entry.message.id : entry.id;
}

/** The ordering key of an entry, in the same space as a message sequence. */
export function entrySequence(entry: ConversationEntry): string {
    return entry.kind === "message" ? entry.message.sequence : entry.sequence;
}
