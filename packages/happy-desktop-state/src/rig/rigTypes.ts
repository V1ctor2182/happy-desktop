/**
 * Closed, serialization-safe product projections for the Rig chat surface. Every
 * type here is what application code and the UI actually render; the injected
 * transport maps the raw `@slopus/rig` protocol shapes into these projections so
 * this package never depends on wire types, tokens, or sockets.
 */

declare const rigSessionIdBrand: unique symbol;
declare const rigEventIdBrand: unique symbol;
declare const rigProjectIdBrand: unique symbol;
declare const rigWorktreeIdBrand: unique symbol;
declare const rigTerminalIdBrand: unique symbol;
declare const rigFolderIdBrand: unique symbol;

/** Branded session identifier (CUID2 on the wire) so ids are not interchangeable with plain strings. */
export type RigSessionId = string & { readonly [rigSessionIdBrand]: true };

/** Branded identifier of a project the daemon owns durably (CUID2 on the wire). */
export type RigProjectId = string & { readonly [rigProjectIdBrand]: true };

/** Branded identifier of one of a project's git worktrees (CUID2 on the wire). */
export type RigWorktreeId = string & { readonly [rigWorktreeIdBrand]: true };

/**
 * What the workspace lists sessions under: a project, or one of its worktrees.
 * Both ids come from the same daemon id space, so one value addresses either
 * kind of group and the URL needs a single segment for it.
 */
export type RigGroupId = RigProjectId | RigWorktreeId;

/** Branded realtime event identifier used for ordering and backfill cursors. */
export type RigEventId = string & { readonly [rigEventIdBrand]: true };

/** Branded identifier of one interactive terminal the daemon runs for a session. */
export type RigTerminalId = string & { readonly [rigTerminalIdBrand]: true };

/**
 * Branded identifier of one folder in the Rig's virtual tree (CUID2 on the
 * wire). A folder is not a group: it holds chats rather than a checkout, so its
 * id is deliberately not interchangeable with a project's or a worktree's.
 */
export type RigFolderId = string & { readonly [rigFolderIdBrand]: true };

/**
 * One interactive terminal the daemon has started, as its create/stop actions
 * report it. It is the terminal's identity and size only: the live screen never
 * comes through here, it arrives on the terminal's own byte channel, so this
 * shape stays small and cheap to re-read.
 */
export interface RigTerminal {
    readonly id: RigTerminalId;
    readonly cols: number;
    readonly rows: number;
    readonly status: "running" | "exited";
    readonly exitCode: number | null;
}

export type RigPermissionMode = "auto" | "workspace_write" | "read_only" | "full_access";

export type RigServiceTier = "fast";

export type RigSessionStatus =
    | "idle"
    | "queued"
    | "running"
    | "completed"
    | "aborted"
    | "suspended"
    | "error"
    | "archived";

/** Reader-facing phase of the active turn's current work. */
export type RigWorkingPhase =
    | "working"
    | "thinking"
    | "generatingTools"
    | "callingTools"
    | "texting";

/** Reasoning/effort levels a model may expose, ordered from least to most reasoning. */
export type RigThinkingLevel =
    | "off"
    | "on"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max"
    | "ultra";

/** Happy's default reasoning level when the selected model offers it. */
export const RIG_DEFAULT_THINKING_LEVEL: RigThinkingLevel = "medium";

export type RigStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

/**
 * Both ends of the scheduled wait a session's agent is sitting inside, in epoch
 * milliseconds. Both travel together because either alone measures nothing:
 * a surface counts the interval down against its own clock.
 */
export interface RigSessionWait {
    readonly startedAt: number;
    readonly dueAt: number;
}

export type RigTaskStatus = "pending" | "in_progress" | "completed";

export type RigGoalStatus = "active" | "blocked" | "complete" | "paused";

/** JSON value type for opaque tool-call arguments; kept fully closed (no `unknown`/`any`). */
export type RigJson =
    | null
    | boolean
    | number
    | string
    | readonly RigJson[]
    | { readonly [key: string]: RigJson };

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export interface RigModel {
    readonly id: string;
    readonly name: string;
    readonly thinkingLevels: readonly RigThinkingLevel[];
    readonly defaultThinkingLevel: RigThinkingLevel;
    readonly contextWindow?: number;
}

export interface RigModelProvider {
    readonly id: string;
    readonly models: readonly RigModel[];
    readonly serviceTiers: readonly RigServiceTier[];
    readonly disabledReason?: "not_authenticated" | "not_enabled" | "no_models";
}

export interface RigModelCatalog {
    readonly defaultModelId: string;
    readonly defaultProviderId: string;
    readonly models: readonly RigModel[];
    readonly providers: readonly RigModelProvider[];
}

// ---------------------------------------------------------------------------
// Messages, blocks, and tool presentations
// ---------------------------------------------------------------------------

export type RigFileDiffKind = "add" | "delete" | "update";
export type RigFileDiffLineKind = "add" | "context" | "delete";

export interface RigFileDiffLine {
    readonly kind: RigFileDiffLineKind;
    readonly text: string;
}

export interface RigFileDiffHunk {
    readonly oldStart: number;
    readonly newStart: number;
    readonly lines: readonly RigFileDiffLine[];
}

export interface RigFileDiff {
    readonly path: string;
    readonly kind: RigFileDiffKind;
    readonly hunks: readonly RigFileDiffHunk[];
    readonly language?: string;
    readonly added?: number;
    readonly deleted?: number;
    readonly omittedLines?: number;
}

export type RigExplorationOperation =
    | { readonly kind: "list"; readonly target: string }
    | { readonly kind: "read"; readonly name: string }
    | {
          readonly kind: "search";
          readonly command: string;
          readonly path?: string;
          readonly query?: string;
      };

export type RigToolPresentation =
    | {
          readonly type: "exploration";
          readonly operations: readonly RigExplorationOperation[];
      }
    | {
          readonly type: "fileDiff";
          readonly files: readonly RigFileDiff[];
          readonly omittedFiles?: number;
      }
    | { readonly type: "execCommand"; readonly command: string; readonly output: string }
    | {
          readonly type: "backgroundTerminalInteraction";
          readonly command: string;
          readonly input: string;
      };

export interface RigToolFailure {
    readonly kind: "execution_failed" | "interrupted" | "invalid_arguments" | "tool_unavailable";
    readonly message?: string;
}

/**
 * One image sent with a local user turn. A local session has no upload step, so
 * the bytes travel with the message; `data` is base64 without a data-URL prefix.
 */
export interface RigImageInput {
    readonly mediaType: string;
    readonly data: string;
}

export type RigBlock =
    | { readonly type: "text"; readonly text: string }
    | {
          readonly type: "image";
          readonly mediaType: string;
          readonly data: string;
          readonly detail?: "high" | "original";
      }
    | { readonly type: "thinking"; readonly thinking: string; readonly redacted: boolean }
    | {
          readonly type: "toolCall";
          readonly id: string;
          readonly name: string;
          readonly arguments: RigJson;
          readonly presentation?: RigToolPresentation;
      }
    | {
          readonly type: "toolResult";
          readonly toolCallId: string;
          readonly toolName: string;
          readonly display: string;
          readonly failed: boolean;
          readonly failure?: RigToolFailure;
          readonly presentation?: RigToolPresentation;
      };

export interface RigMessage {
    readonly id: string;
    readonly role: "system" | "user" | "agent";
    readonly blocks: readonly RigBlock[];
    /** Model-facing bookkeeping messages that must never render as transcript content. */
    readonly internal: boolean;
}

// ---------------------------------------------------------------------------
// User-input requests (question prompts)
// ---------------------------------------------------------------------------

export interface RigUserInputOption {
    readonly label: string;
    readonly description: string;
}

export interface RigUserInputQuestion {
    readonly id: string;
    readonly header: string;
    readonly question: string;
    readonly multiSelect: boolean;
    readonly required: boolean;
    readonly options: readonly RigUserInputOption[];
}

export interface RigUserInputRequest {
    readonly requestId: string;
    readonly questions: readonly RigUserInputQuestion[];
}

// ---------------------------------------------------------------------------
// Tasks, goals, subagents, background processes
// ---------------------------------------------------------------------------

export interface RigTask {
    readonly id: string;
    readonly subject: string;
    readonly description: string;
    readonly status: RigTaskStatus;
    readonly activeForm?: string;
    readonly owner?: string;
    readonly blockedBy: readonly string[];
    readonly blocks: readonly string[];
}

export interface RigGoal {
    readonly objective: string;
    readonly status: RigGoalStatus;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface RigSubagentSummary {
    readonly id: RigSessionId;
    readonly parentSessionId: RigSessionId;
    /** Tool invocation in the parent transcript which created this child session. */
    readonly parentToolCallId?: string;
    readonly description: string;
    readonly taskName?: string;
    readonly modelId: string;
    readonly status: RigSessionStatus;
    readonly depth: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly activeSince?: number;
    readonly elapsedMs?: number;
    readonly latestText?: string;
    readonly totalTokens?: number;
}

export interface RigQueuedMessage {
    readonly id: string;
    /** Flattened text of the queued user turn, shown as a preview in the composer. */
    readonly text: string;
}

export interface RigFileSearchResult {
    /** Basename shown as the primary label in the mention list. */
    readonly fileName: string;
    /** Workspace-relative path inserted into the composer as `@path`. */
    readonly path: string;
}

// ---------------------------------------------------------------------------
// Session usage (token/cost accounting, `/usage`)
// ---------------------------------------------------------------------------

/** Token + cost totals attributed to one model within a session. */
export interface RigUsageGroup {
    readonly modelId: string;
    readonly providerId: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly totalTokens: number;
    /** Reasoning tokens when the provider reports an exact breakdown. */
    readonly reasoningTokens?: number;
    /** Total US-dollar cost for this group. */
    readonly cost: number;
}

/** Approximate context-window occupancy for the session's current model. */
export interface RigUsageContext {
    readonly modelId: string;
    readonly providerId: string;
    readonly totalTokens: number;
    /** True when the count is estimated rather than provider-reported. */
    readonly approximate: boolean;
}

/**
 * How much room is left in the model's context window. Phrased as remaining
 * rather than consumed because the question being asked is "how much longer can
 * this conversation go", and a total answers that only after arithmetic.
 *
 * Only exists when the model declares a window; a model that does not is not
 * reported as full, or as empty, but not reported at all.
 */
export interface RigContextGauge {
    readonly usedTokens: number;
    readonly remainingTokens: number;
    readonly totalTokens: number;
    /** Remaining share of the window, 0–1. */
    readonly remainingFraction: number;
    /** True when the underlying token count is estimated, not provider-reported. */
    readonly approximate: boolean;
}

/** One provider rate-limit window (five-hour or weekly) with reset timing. */
export interface RigUsageQuotaWindow {
    readonly kind: "fiveHour" | "weekly";
    readonly usedPercent: number;
    /** Epoch millis when the window resets. */
    readonly resetsAt: number;
}

/** Provider-level quota for a session, with any reported rate-limit windows. */
export interface RigUsageQuota {
    readonly providerId: string;
    readonly windows: readonly RigUsageQuotaWindow[];
}

/**
 * Aggregate usage snapshot for a session (`/usage`). Read on demand and polled
 * while its panel is visible: there is no realtime usage event, so this is the
 * secondary-surface polling case, never durable snapshot state.
 */
export interface RigSessionUsage {
    readonly currentProviderId: string;
    readonly groups: readonly RigUsageGroup[];
    readonly totalTokens: number;
    readonly totalCost: number;
    readonly context?: RigUsageContext;
    readonly quotas: readonly RigUsageQuota[];
}

export interface RigBackgroundProcess {
    readonly id: number;
    readonly command: string;
    readonly cwd: string;
    readonly status: "running";
}

/** Terminal result of a composer shell-mode command run (`shellRun`). */
export interface RigShellCommandResult {
    readonly command: string;
    readonly commandId: string;
    readonly output: string;
    readonly exitCode: number | null;
    readonly timedOut: boolean;
    readonly errorMessage?: string;
    /** Background session id when the command detached into a background terminal. */
    readonly backgroundProcessId?: number;
}

// ---------------------------------------------------------------------------
// Projects and worktrees
// ---------------------------------------------------------------------------

/**
 * The picture that stands for a project in a list. The daemon derives it from the
 * repository or its hosting provider, so `url` is already a fetchable image the
 * renderer can put straight into an `<img>`; `width`/`height` are the intrinsic
 * pixel size so a row can reserve its box before the bytes arrive.
 */
export interface RigProjectAvatar {
    readonly url: string;
    readonly width: number;
    readonly height: number;
}

/**
 * One directory the daemon has adopted as a durable project. This — not the raw
 * working directory — is what the workspace lists: it carries a name the daemon
 * derived from the git remote (or the user renamed) and a picture, and it keeps
 * a stable id across restarts, so a project is addressable without hashing a path.
 */
export interface RigProject {
    readonly id: RigProjectId;
    readonly name: string;
    /**
     * Fractional index the host sorts projects by, ascending then by id. It is
     * opaque: compare it, never parse it, and only the host mints new values.
     */
    readonly orderKey: string;
    /** Canonical absolute path of the project root. */
    readonly path: string;
    /** Presentation path (home-relative when the daemon's host supplied one). */
    readonly displayPath: string;
    /** `home` is the catch-all project for sessions started outside any repository. */
    readonly kind: "regular" | "home";
    /** Whether the daemon has finished deriving the project's name and picture. */
    readonly status: "initializing" | "ready" | "failed";
    readonly avatar?: RigProjectAvatar;
    /** Current changed-file total for this checkout, omitted until Git state is available. */
    readonly changedFiles?: number;
    /** Aggregate textual diff against HEAD, omitted until Git state is available. */
    readonly addedLines?: number;
    readonly deletedLines?: number;
    readonly changes?: readonly RigGitChangedFile[];
}

/**
 * Where the host runs a session started in a project, when the project itself
 * decides. `local` is the machine the host is on; `docker` is a container built
 * from `image` with the checkout mounted inside it.
 *
 * A project that states neither is represented by the absence of this value
 * rather than by a third member: "nothing stated" is not a place work runs, it
 * is the host's own configuration deciding, and giving it a name here would let
 * a surface claim the machine when the host may well have said a container.
 */
export type RigProjectCompute =
    | { readonly type: "local" }
    | { readonly type: "docker"; readonly image: string };

/**
 * One project's durable compute configuration, exactly as the host holds it.
 *
 * It is read on its own rather than carried on the project row because the live
 * catalog the workspace list is built from does not describe it at all: a row
 * that carried it would have it only on the reads that happen to come from the
 * host's own project read, and lose it again on the next live publish.
 */
export interface RigProjectComputeState {
    readonly projectId: RigProjectId;
    /** Absent when the project states nothing and the host's configuration decides. */
    readonly compute?: RigProjectCompute;
    /**
     * How many times this project's choice has changed. The host builds a
     * container's name out of it, so a change is what retires the container the
     * previous choice built instead of reusing it.
     */
    readonly generation: number;
}

/**
 * One git worktree the daemon created inside a project. Sessions started in it
 * belong to the project but list under the worktree, so parallel work on separate
 * branches reads as separate groups rather than as unrelated directories.
 */
export interface RigWorktree {
    readonly id: RigWorktreeId;
    readonly projectId: RigProjectId;
    readonly name: string;
    /** Fractional index the host sorts a project's worktrees by. */
    readonly orderKey: string;
    readonly path: string;
    readonly displayPath: string;
    readonly status: "initializing" | "ready" | "failed" | "archiving" | "archived";
    /**
     * Whether the checkout this worktree names is still on disk. The host
     * watches for it, so a directory removed outside Happy turns a listed
     * worktree `missing` without anything being asked of it.
     */
    readonly presence: "present" | "missing";
    /**
     * Why the host could not prepare or remove this checkout, when it says. The
     * reason is part of the worktree's durable record rather than of the request
     * that produced it, so it outlives the window that asked for the checkout.
     */
    readonly error?: string;
    /** Current changed-file total for this checkout, omitted until Git state is available. */
    readonly changedFiles?: number;
    /** Aggregate textual diff against HEAD, omitted until Git state is available. */
    readonly addedLines?: number;
    readonly deletedLines?: number;
    readonly changes?: readonly RigGitChangedFile[];
}

/** One current working-tree change, reconciled from Git after each watcher hint. */
export interface RigGitChangedFile {
    readonly path: string;
    /** Original repository path when Git reports a rename or copy. */
    readonly previousPath?: string;
    readonly status: "added" | "deleted" | "modified" | "renamed" | "untracked";
    /** Lightweight disk identity used to reload an open file after a Git watcher hint. */
    readonly revision: string;
    /** Lines this file gained and lost against HEAD; absent when it is binary. */
    readonly addedLines?: number;
    readonly deletedLines?: number;
}

/** Current working-tree text loaded for an ordinary workspace-file tab. */
export interface RigWorkspaceFileDocument {
    readonly path: string;
    readonly content: string;
    /** SHA-256 identity returned by Rig and required for a conflict-safe save. */
    readonly hash: string;
}

/**
 * One workspace file's bytes, loaded to be shown rather than edited. `content`
 * is base64 so the transport stays JSON; the surface turns it into an object URL
 * of `contentType` and hands that to an `<img>`, `<video>`, or `<audio>`.
 */
export interface RigWorkspaceFileBytes {
    readonly path: string;
    /** Media type implied by the file's extension, or `application/octet-stream`. */
    readonly contentType: string;
    /**
     * Where the bytes are, rather than the bytes themselves. A picture element
     * wants a source it can fetch: handing it the file inline makes the whole
     * file resident in the document, decoded from base64 before anything is
     * shown, and denies a video the range requests it seeks with.
     */
    readonly url: string;
    readonly size: number;
    readonly hash: string;
}

/** HEAD and working-tree text loaded for one changed-file diff tab. */
export interface RigChangedFileDocument {
    readonly path: string;
    readonly oldPath: string;
    readonly oldContent: string;
    readonly newContent: string;
    /** Working-tree identity, absent only when the file is deleted. */
    readonly hash?: string;
}

/** Everything the workspace list needs to group sessions: the projects and their worktrees. */
export interface RigProjectCatalog {
    readonly projects: readonly RigProject[];
    readonly worktrees: readonly RigWorktree[];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface RigSessionSummary {
    readonly id: RigSessionId;
    /** The project the daemon filed this session under; always set. */
    readonly projectId: RigProjectId;
    /** Set when the session runs inside one of the project's worktrees. */
    readonly worktreeId?: RigWorktreeId;
    /**
     * The folder this chat was filed into, absent while it is still unsorted.
     *
     * Filing is the reader's own arrangement and says nothing about where the
     * session runs: a folder holds chats from any project, and the project it
     * belongs to is `projectId` whatever folder it sits in.
     */
    readonly folderId?: RigFolderId;
    /**
     * Fractional index the host sorts sessions by within their own group.
     *
     * Absent for a session that has no place in an ordered list. A subagent is
     * the case that matters: it syncs and can be opened by id, but it belongs to
     * the session that started it, so it must never take a row of its own.
     */
    readonly orderKey?: string;
    /** Canonical absolute working directory. */
    readonly cwd: string;
    /** Original Rig path retained for presentation when it differs from `cwd`. */
    readonly displayCwd: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly permissionMode: RigPermissionMode;
    readonly effort?: RigThinkingLevel;
    readonly serviceTier?: RigServiceTier;
    readonly status: RigSessionStatus;
    /** Present while the agent is inside a scheduled `wait`/`wait_until`. */
    readonly wait?: RigSessionWait;
    /** Why this chat is waiting for the person, as durably tracked by Rig. */
    readonly unreadReason?: "attention_needed" | "turn_finished";
    readonly title?: string;
    readonly recap?: string;
    /** Chronological sort key: when the session was first created. */
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly lastMessageAt?: number;
    readonly draft?: string;
    readonly draftUpdatedAt?: number;
}

export interface RigSession {
    readonly id: RigSessionId;
    readonly projectId: RigProjectId;
    readonly worktreeId?: RigWorktreeId;
    /** Fractional index this session sorts by; absent for a subagent (see `RigSessionSummary`). */
    readonly orderKey?: string;
    readonly cwd: string;
    readonly displayCwd: string;
    readonly providerId: string;
    readonly modelId: string;
    readonly models: readonly RigModel[];
    readonly effort?: RigThinkingLevel;
    readonly serviceTier?: RigServiceTier;
    readonly permissionMode: RigPermissionMode;
    readonly modelLocked: boolean;
    readonly status: RigSessionStatus;
    readonly title?: string;
    readonly recap?: string;
    readonly draft?: string;
    readonly draftUpdatedAt?: number;
    readonly messages: readonly RigMessage[];
    /**
     * Steering messages queued to submit after the current tool call. Non-internal
     * user turns the runner has accepted but not yet started; the composer previews
     * them so a person sees what will be sent next (and can flush early with esc).
     */
    readonly queuedMessages: readonly RigQueuedMessage[];
    readonly pendingUserInputs: readonly RigUserInputRequest[];
    readonly goal?: RigGoal;
    readonly tasks: readonly RigTask[];
    readonly subagents: readonly RigSubagentSummary[];
    readonly backgroundProcesses: readonly RigBackgroundProcess[];
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly lastEventId?: RigEventId;
}

// ---------------------------------------------------------------------------
// Streaming / live tool execution
// ---------------------------------------------------------------------------

export type RigToolStatus = "running" | "awaiting_approval" | "success" | "failed" | "stopped";

export interface RigPermissionReview {
    readonly action: string;
    readonly reason: string;
    readonly decision: "allow" | "ask" | "deny";
    readonly risk: "low" | "medium" | "high" | "critical";
    readonly userAuthorization: "unknown" | "low" | "medium" | "high";
}

/** Live state of one tool call, merged from stream deltas and (once known) its result. */
export interface RigToolEntry {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly arguments: RigJson;
    readonly status: RigToolStatus;
    readonly display?: string;
    readonly failed: boolean;
    readonly failure?: RigToolFailure;
    readonly presentation?: RigToolPresentation;
    readonly permissionReview?: RigPermissionReview;
}

export type RigStreamingBlock =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "thinking"; readonly text: string }
    | { readonly kind: "tool"; readonly tool: RigToolEntry };

/** One in-flight durable agent message, assembled from its `agent_event` deltas. */
export interface RigStreamingMessage {
    readonly runId: string;
    readonly messageId: string;
    readonly blocks: readonly RigStreamingBlock[];
}

// ---------------------------------------------------------------------------
// Menus (pickers derived from catalog + current session selection)
// ---------------------------------------------------------------------------

export interface RigModelOption {
    readonly providerId: string;
    readonly modelId: string;
    readonly name: string;
    readonly disabled: boolean;
    readonly current: boolean;
}

export interface RigEffortOption {
    readonly level: RigThinkingLevel;
    readonly label: string;
    readonly current: boolean;
    readonly isDefault: boolean;
}

export interface RigPermissionModeOption {
    readonly mode: RigPermissionMode;
    readonly label: string;
    readonly current: boolean;
}

export interface RigServiceTierOption {
    readonly tier: RigServiceTier | null;
    readonly label: string;
    readonly current: boolean;
}

export interface RigMenusSnapshot {
    readonly modelOptions: readonly RigModelOption[];
    readonly effortOptions: readonly RigEffortOption[];
    readonly permissionModeOptions: readonly RigPermissionModeOption[];
    readonly serviceTierOptions: readonly RigServiceTierOption[];
    readonly currentProviderId: string;
    readonly currentModelId: string;
    readonly currentEffort?: RigThinkingLevel;
    readonly currentPermissionMode: RigPermissionMode;
    readonly currentServiceTier?: RigServiceTier;
}

/**
 * One transcript row's measured geometry, as the reading position needs it. A
 * restored position is a pixel offset into a list whose rows have wildly
 * different heights, so the offset only means anything alongside the heights it
 * was measured against.
 */
export interface RigScrollMeasurement {
    /** A row's render key, which is whatever the transcript keyed that row by. */
    readonly key: string | number | bigint;
    readonly index: number;
    readonly start: number;
    readonly end: number;
    readonly size: number;
    readonly lane: number;
}

/**
 * Where a conversation is being read. `following` distinguishes a reader parked
 * at the newest message — who should stay there as more arrives — from one who
 * has scrolled up to a fixed point and expects to find it again.
 */
export interface RigScrollPosition {
    readonly scrollTop: number;
    readonly following: boolean;
    readonly measurements?: readonly RigScrollMeasurement[];
}

/**
 * Every file in a project or worktree checkout, not just the changed ones.
 * `truncated` says the repository held more than the host was willing to list,
 * so the panel can admit it rather than showing part of a tree as the whole.
 */
export interface RigWorkspaceFiles {
    readonly paths: readonly string[];
    readonly truncated: boolean;
}

/** One application a project directory can be opened in. */
export interface RigOpenInTarget {
    readonly id: string;
    readonly label: string;
    /**
     * The application's own icon as an image URL supplied by the host — the
     * picture of the thing being launched, not a glyph from our vocabulary.
     * Absent when the host has no artwork for it.
     */
    readonly iconUrl?: string;
}

/**
 * The applications a host offers, with the one opened most recently. The recent
 * id belongs to the same answer because a control that wears the last-used
 * application has to know it before it can draw itself.
 */
export interface RigOpenInTargets {
    readonly targets: readonly RigOpenInTarget[];
    readonly recentId?: string;
}

/** Current model/effort/permission/tier selection used to derive menu options. */
export interface RigSelection {
    readonly providerId: string;
    readonly modelId: string;
    readonly effort?: RigThinkingLevel;
    readonly permissionMode: RigPermissionMode;
    readonly serviceTier?: RigServiceTier;
}

// ---------------------------------------------------------------------------
// Action inputs
// ---------------------------------------------------------------------------

export interface RigSessionCreateInput {
    readonly cwd: string;
    /** Files the session under one of the project's worktrees rather than its root. */
    readonly worktreeId?: RigWorktreeId;
    readonly providerId?: string;
    readonly modelId?: string;
    readonly effort?: RigThinkingLevel;
    readonly serviceTier?: RigServiceTier;
    readonly permissionMode?: RigPermissionMode;
}

export interface RigModelSelection {
    readonly providerId?: string;
    readonly modelId: string;
    readonly effort?: RigThinkingLevel;
}

export interface RigUserInputAnswers {
    readonly requestId: string;
    readonly answers: Readonly<Record<string, readonly string[]>>;
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

declare const rigInboxItemIdBrand: unique symbol;

/**
 * Branded identity of one question an agent asked. It is the session and the
 * request together, because a request id is only unique inside its session.
 */
export type RigInboxItemId = string & { readonly [rigInboxItemIdBrand]: true };

export type RigInboxItemStatus = "pending" | "answered";

/** One agent question waiting on the person, or the answer they already gave. */
export interface RigInboxItem {
    readonly id: RigInboxItemId;
    readonly sessionId: RigSessionId;
    readonly requestId: string;
    readonly projectId: RigProjectId;
    /** Files the asking session under one of the project's worktrees. */
    readonly worktreeId?: RigWorktreeId;
    /** The asking session's title, when it has earned one. */
    readonly sessionTitle?: string;
    readonly questions: readonly RigUserInputQuestion[];
    readonly status: RigInboxItemStatus;
    /** Chosen option labels by question id; present once answered. */
    readonly answers?: Readonly<Record<string, readonly string[]>>;
    readonly createdAt: number;
    readonly resolvedAt?: number;
}
