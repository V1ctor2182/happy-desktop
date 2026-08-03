import type { AgentTurnTraceSummary, FileSummary, MessageSummary, UserError } from "../types.js";
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
          /**
           * Intrinsic pixel size read from the payload's own header, so a surface
           * reserves this image's real box instead of one invented shape for
           * every image. Absent only for a format the header parser cannot read.
           */
          readonly width?: number;
          readonly height?: number;
          readonly detail?: "high" | "original";
      }
    | {
          readonly kind: "linked";
          /** Stable identity supplied by the producer. */
          readonly id: string;
          readonly attachmentKind: "audio" | "file" | "image" | "url" | "video" | "webapp";
          readonly name: string;
          readonly source: string;
          readonly description?: string;
          readonly mediaType?: string;
          readonly bytes?: number;
          readonly width?: number;
          readonly height?: number;
          readonly durationMs?: number;
          readonly thumbhash?: string;
          /** Fetchable thumbnail for a linked card, such as an imported webapp icon. */
          readonly thumbnailUrl?: string;
          /** Capability-scoped HTTP(S) address the host may open or download. */
          readonly openUrl?: string;
          /** Imported webapp identity, opened through the owning Rig rather than as a URL. */
          readonly webapp?: string;
          readonly webappPath?: string;
          readonly webappQuery?: Readonly<Record<string, string>>;
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
    | { readonly kind: "waiting"; readonly label: string }
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
    /**
     * The turn this row opens, when it is the first row of an expanded turn. It
     * carries the control that folds the turn back up, which has to ride the row
     * the turn begins on: a turn that ran tools and answered nothing has no
     * message to hang it from, and one that answered in the middle would put
     * "Hide traces" below the work it hides.
     */
    readonly agentTrace?: AgentTurnTraceSummary;
}

/**
 * A service row: something the session says about itself rather than something
 * anyone wrote. Every variant is one row in the transcript with one identity and
 * one place in the order, and `text` is always the complete sentence a reader
 * gets even when nothing else about the variant is understood.
 */
interface ConversationNoticeEntryBase {
    readonly kind: "notice";
    readonly id: string;
    readonly sequence: string;
    readonly text: string;
}

/** The ordinary service line and the section boundary that closes a turn. */
export interface ConversationServiceNoticeEntry extends ConversationNoticeEntryBase {
    /** `divider` closes a section (a completed turn); `notice` is a service line. */
    readonly variant: "notice" | "divider";
    readonly level: "info" | "warning" | "error";
    /** Automatic recovery attempt represented by this notice. */
    readonly retry?: {
        readonly attempt?: number;
        readonly maxAttempts?: number;
    };
    readonly title?: string;
}

/**
 * The lifecycle a compute instance reports while it materializes the workspace a
 * session runs in. These are exactly the states Rig publishes on a compute
 * preparation notice, so a reader is never shown a phase the daemon did not
 * declare.
 */
export type ConversationComputeState =
    | "unprovisioned"
    | "provisioning"
    | "ready"
    | "failed"
    | "stopped";

/**
 * One durable compute lifecycle event in the transcript.
 *
 * A session that runs on provisioned compute spends its first seconds — and,
 * when a provider breaks, its whole life — waiting on a machine rather than on a
 * model. That wait belongs in the transcript beside the messages it delays: it
 * is authoritative session history, ordered with everything else and reconciled
 * the same way, not a toast that disappears before the reader looks up.
 *
 * It is a service notice, not a row type of its own: the daemon publishes it as
 * one, it takes its place in the order the same way, and a surface that only
 * understands notices still has `text`. What the variant adds is the complete
 * concrete payload behind that sentence, so a row can say which provider, which
 * step, how far, and how long instead of restating one line of prose.
 *
 * Every field is projected verbatim from Rig's own notice. Nothing is inferred:
 * a metric Rig did not measure is absent rather than guessed.
 */
export interface ConversationComputeNoticeEntry extends ConversationNoticeEntryBase {
    readonly variant: "compute";
    readonly state: ConversationComputeState;
    /** The provider's own step name inside the lifecycle, such as `pulling_image`. */
    readonly phase: string;
    /** The compute provider plugin that owns the instance. */
    readonly provider: string;
    /** Instance identity, shared by every event of one materialization. */
    readonly instanceId: string;
    /** The provider's progress or failure sentence, as it wrote it. */
    readonly message: string;
    /** Materialization progress in percent, when the provider reports one. */
    readonly percent?: number;
    /** Milliseconds spent preparing so far, when Rig measured it. */
    readonly elapsedMs?: number;
}

/**
 * Everything a service row can be, as one closed union discriminated by
 * `variant`. A reader of an unfamiliar variant never falls through to a partial
 * shape: it either narrows and renders the payload, or renders `text`.
 */
export type ConversationNoticeEntry =
    | ConversationServiceNoticeEntry
    | ConversationComputeNoticeEntry;

/**
 * Whether a service row is ordinary progress a collapsed turn may fold away.
 * Compute rows are the session's machine reporting itself, so their preparation
 * steps are as foldable as any other progress — until one of them says the
 * machine never came up.
 */
export function noticeInformational(entry: ConversationNoticeEntry): boolean {
    return entry.variant === "compute" ? entry.state !== "failed" : entry.level === "info";
}

/**
 * Whether a service row is a failure: the thing a reader must still see after
 * everything else about the turn has been folded away.
 */
export function noticeFailed(entry: ConversationNoticeEntry): boolean {
    return entry.variant === "compute" ? entry.state === "failed" : entry.level === "error";
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
    readonly reason?: "completed" | "steering" | "compaction" | "abort" | "error";
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
