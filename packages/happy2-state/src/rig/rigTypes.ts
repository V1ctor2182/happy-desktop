/**
 * Closed, serialization-safe product projections for the Rig chat surface. Every
 * type here is what application code and the UI actually render; the injected
 * transport maps the raw `@slopus/rig` protocol shapes into these projections so
 * this package never depends on wire types, tokens, or sockets.
 *
 * Terminals (Rig's remote terminals) are intentionally out of scope for this
 * chat-focused layer; they are deferred until the chat/tools/menus surface is
 * complete.
 */

declare const rigSessionIdBrand: unique symbol;
declare const rigEventIdBrand: unique symbol;
declare const rigProjectIdBrand: unique symbol;
declare const rigWorktreeIdBrand: unique symbol;

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

export type RigStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

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

export type RigToolPresentation =
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
    readonly status:
        | "initializing"
        | "ready"
        | "failed"
        | "archiving"
        | "archive_failed"
        | "archived";
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
    /** Fractional index the host sorts sessions by within their own group. */
    readonly orderKey: string;
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
    readonly title?: string;
    readonly recap?: string;
    /** Chronological sort key: when the session was first created. */
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly lastMessageAt?: number;
}

export interface RigSession {
    readonly id: RigSessionId;
    readonly projectId: RigProjectId;
    readonly worktreeId?: RigWorktreeId;
    /** Fractional index this session sorts by within its own group. */
    readonly orderKey: string;
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
    readonly decision: "allow" | "ask";
    readonly risk: "low" | "medium" | "high";
    readonly userAuthorization: "low" | "medium" | "high";
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

/** The in-flight agent message for the current run, assembled from `agent_event` deltas. */
export interface RigStreamingMessage {
    readonly runId: string;
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
