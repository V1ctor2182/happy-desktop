import { useRef, useState, type CSSProperties } from "react";
import type {
    RigBackgroundProcess,
    RigFileSearchResult,
    RigMenusSnapshot,
    RigModelSelection,
    RigPermissionMode,
    RigQueuedMessage,
    RigGoal,
    RigServiceTier,
    RigSessionUsage,
    RigSubagentSummary,
    RigTask,
    RigThinkingLevel,
    RigTranscriptEntry,
    RigUserInputRequest,
} from "happy2-state";
import { Button } from "./Button";
import { Composer } from "./Composer";
import { RigCommandPalette, type RigCommandId } from "./RigCommandPalette";
import { RigFileMention } from "./RigFileMention";
import { RigSessionControls } from "./RigSessionControls";
import { RigStatusBar } from "./RigStatusBar";
import { RigActivityPanel } from "./RigActivityPanel";
import { RigTranscript } from "./RigTranscript";
import { RigUsagePanel } from "./RigUsagePanel";
import { RigUserInputPrompt, type RigUserInputAnswerMap } from "./RigUserInputPrompt";

/**
 * Finds the active `@`-mention token at the end of the draft: the run of
 * non-whitespace after the last `@` that starts a token (at string start or after
 * whitespace). Returns the query text after `@`, or null when no mention is being
 * typed. A trailing space closes the mention, so `@src/a.ts ` yields null.
 */
export function rigMentionPrefix(draft: string): string | null {
    const match = /(?:^|\s)@(\S*)$/.exec(draft);
    return match ? match[1] : null;
}

export type RigChatViewProps = {
    title?: string;
    /** Secondary header line, e.g. the session cwd. */
    subtitle?: string;
    running: boolean;
    elapsedMs?: number;
    entries: readonly RigTranscriptEntry[];
    menus?: RigMenusSnapshot;
    pendingUserInputs: readonly RigUserInputRequest[];
    /** Steering messages queued to submit after the current tool call (preview only). */
    queuedMessages?: readonly RigQueuedMessage[];
    placeholder?: string;
    composerDisabled?: boolean;
    sendPending?: boolean;
    /** Submits the composer draft text; the view then clears the draft. */
    onSend: (text: string) => void;
    /**
     * Runs a composer shell-mode command (draft prefixed with `!`). When omitted,
     * a `!`-prefixed draft sends as an ordinary message. The view clears the draft.
     */
    onShellRun?: (command: string) => void;
    /**
     * Slash-command ids to offer when the composer draft begins with `/`. Only
     * include ids wired to a real action; omit the prop to disable the palette.
     */
    commands?: readonly RigCommandId[];
    /** Runs a chosen slash command; the view then clears the composer draft. */
    onCommand?: (id: RigCommandId) => void;
    /**
     * Searches workspace files for the `@`-mention query. Supplying it enables the
     * mention autocomplete; omit it to disable the affordance. Called on each edit
     * of the mention token; the owner may debounce or cap `limit` as needed.
     */
    onFilesSearch?: (query: string) => Promise<readonly RigFileSearchResult[]>;
    /** Whether thinking entries are shown; pair with `onReasoningToggle` to expose the control. */
    showReasoning?: boolean;
    /** Toggles thinking visibility; omit to hide the control. */
    onReasoningToggle?: () => void;
    /** Whether completed turns collapse to a summary; pair with `onTurnCompactToggle`. */
    compactTurns?: boolean;
    /** Toggles turn compaction; omit to hide the control. */
    onTurnCompactToggle?: () => void;
    /** Whether the `/usage` panel is open; pair with `onUsageToggle` to expose the control. */
    usageOpen?: boolean;
    /** The usage snapshot to render while the panel is open (undefined before first load). */
    usage?: RigSessionUsage;
    /** True while a usage load/poll is in flight. */
    usageLoading?: boolean;
    /** Displayable error from the most recent failed usage load. */
    usageError?: string;
    /** Toggles the usage panel open/closed; omit to hide the control. */
    onUsageToggle?: () => void;
    /** Whether the activity panel (goal + tasks + subagents) is open. */
    activityOpen?: boolean;
    /** The session's persistent goal, rendered in the activity panel. */
    goal?: RigGoal;
    /** The session task list, rendered in the activity panel. */
    tasks?: readonly RigTask[];
    /** The delegated subagents, rendered in the activity monitor. */
    subagents?: readonly RigSubagentSummary[];
    /** Reference "now" (epoch millis) for subagent elapsed timing. */
    now?: number;
    /** Toggles the activity panel open/closed; omit to hide the control. */
    onActivityToggle?: () => void;
    /** Number of running background terminals, shown in the footer status bar. */
    backgroundCount?: number;
    /** Running background terminals, rendered in the activity panel (`/ps`). */
    backgroundProcesses?: readonly RigBackgroundProcess[];
    /** Requests termination of one background terminal (`/stop`). */
    onBackgroundProcessStop?: (processId: number) => void;
    onAbort: () => void;
    onModelChange: (selection: RigModelSelection) => void;
    onEffortChange: (effort?: RigThinkingLevel) => void;
    onPermissionModeChange: (mode: RigPermissionMode) => void;
    onServiceTierChange: (tier?: RigServiceTier) => void;
    onAnswerInput: (requestId: string, answers: RigUserInputAnswerMap) => void;
    onImageOpen?: (entryId: string, index: number) => void;
    /** Rewinds the conversation back to a user message; enables the per-user affordance. */
    onRewind?: (entryId: string) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * RigChatView — the assembled chat surface for one Rig session: a header with the
 * title, live status, and the model/effort/permission/tier controls; a scrolling
 * transcript; any pending user-input prompts; and a composer with send/abort. The
 * composer draft is the view's only local UI state (Rig state does not own it);
 * every other value and mutation flows through props from the subscribing app.
 */
export function RigChatView(props: RigChatViewProps) {
    const [draft, setDraft] = useState("");
    // Transient `@`-mention typeahead: candidate files for the active mention token.
    // Not durable product state — a query response for an input affordance — so it
    // lives as narrow local UI state, cleared as soon as the mention token closes.
    const [mentions, setMentions] = useState<readonly RigFileSearchResult[]>([]);
    // Orders async search responses so a slower earlier query never overwrites a
    // newer one; compared by value in the resolve handler (no effect needed).
    const mentionSeq = useRef(0);
    const sendEnabled = draft.trim().length > 0 && !props.composerDisabled;

    // The slash-command palette opens whenever the draft begins with `/` and the
    // owner wired commands. Its query is the text after the slash, so typing in
    // the composer filters the palette without any extra local state.
    const commands = props.commands ?? [];
    const paletteOpen = commands.length > 0 && !!props.onCommand && draft.startsWith("/");
    const paletteQuery = draft.startsWith("/") ? draft.slice(1) : "";

    const mentionQuery = props.onFilesSearch && !paletteOpen ? rigMentionPrefix(draft) : null;
    const mentionOpen = mentionQuery !== null;

    // Drive the mention search from the edit event (not an effect): compute the new
    // token, and either search for candidates or clear the popover synchronously.
    const changeDraft = (value: string) => {
        setDraft(value);
        const query =
            props.onFilesSearch && !value.startsWith("/") ? rigMentionPrefix(value) : null;
        if (query === null) {
            setMentions([]);
            return;
        }
        const seq = (mentionSeq.current += 1);
        void props.onFilesSearch!(query).then(
            (files) => {
                if (seq === mentionSeq.current) setMentions(files);
            },
            () => {
                if (seq === mentionSeq.current) setMentions([]);
            },
        );
    };

    // Replace the active `@token` at the end of the draft with `@path ` so the next
    // keystroke starts a fresh word rather than re-triggering the mention.
    const insertMention = (file: RigFileSearchResult) => {
        const next = draft.replace(/(?:^|\s)@\S*$/, (whole) => {
            const lead = whole.startsWith("@") ? "" : whole[0];
            return `${lead}@${file.path} `;
        });
        mentionSeq.current += 1;
        setMentions([]);
        setDraft(next);
    };

    const submit = () => {
        const text = draft.trim();
        if (text.length === 0) return;
        // A slash draft is a command affordance, not a message: submitting it
        // does nothing so an accidental Enter never sends `/model` to the agent.
        if (paletteOpen) return;
        // Shell mode: a `!`-prefixed draft runs a workspace command instead of
        // sending a message, when the owner wired `onShellRun`.
        if (props.onShellRun && text.startsWith("!")) {
            const command = text.slice(1).trim();
            if (command.length > 0) props.onShellRun(command);
            setDraft("");
            setMentions([]);
            return;
        }
        props.onSend(text);
        setDraft("");
        setMentions([]);
    };

    const runCommand = (id: RigCommandId) => {
        props.onCommand?.(id);
        setDraft("");
        setMentions([]);
    };

    return (
        <section
            className={["happy2-rig-chat", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-chat-view"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <header className="happy2-rig-chat__header" data-happy2-ui="rig-chat-header">
                <div className="happy2-rig-chat__identity">
                    <span className="happy2-rig-chat__title" data-happy2-ui="rig-chat-title">
                        {props.title ?? "Untitled session"}
                    </span>
                    {props.subtitle ? (
                        <span
                            className="happy2-rig-chat__subtitle"
                            data-happy2-ui="rig-chat-subtitle"
                        >
                            {props.subtitle}
                        </span>
                    ) : null}
                </div>
                <div className="happy2-rig-chat__header-actions">
                    <span
                        className="happy2-rig-chat__status"
                        data-running={props.running ? "" : undefined}
                        data-happy2-ui="rig-chat-status"
                    >
                        <span aria-hidden="true" className="happy2-rig-chat__status-dot" />
                        {props.running ? "Running" : "Idle"}
                    </span>
                    {props.onReasoningToggle ? (
                        <button
                            aria-pressed={props.showReasoning ? "true" : "false"}
                            className="happy2-rig-chat__view-toggle"
                            data-active={props.showReasoning ? "" : undefined}
                            data-happy2-ui="rig-chat-reasoning-toggle"
                            onClick={props.onReasoningToggle}
                            type="button"
                        >
                            Thinking
                        </button>
                    ) : null}
                    {props.onTurnCompactToggle ? (
                        <button
                            aria-pressed={props.compactTurns ? "true" : "false"}
                            className="happy2-rig-chat__view-toggle"
                            data-active={props.compactTurns ? "" : undefined}
                            data-happy2-ui="rig-chat-compact-toggle"
                            onClick={props.onTurnCompactToggle}
                            type="button"
                        >
                            Compact
                        </button>
                    ) : null}
                    {props.onUsageToggle ? (
                        <button
                            aria-pressed={props.usageOpen ? "true" : "false"}
                            className="happy2-rig-chat__view-toggle"
                            data-active={props.usageOpen ? "" : undefined}
                            data-happy2-ui="rig-chat-usage-toggle"
                            onClick={props.onUsageToggle}
                            type="button"
                        >
                            Usage
                        </button>
                    ) : null}
                    {props.onActivityToggle ? (
                        <button
                            aria-pressed={props.activityOpen ? "true" : "false"}
                            className="happy2-rig-chat__view-toggle"
                            data-active={props.activityOpen ? "" : undefined}
                            data-happy2-ui="rig-chat-activity-toggle"
                            onClick={props.onActivityToggle}
                            type="button"
                        >
                            Activity
                        </button>
                    ) : null}
                    {props.menus ? (
                        <RigSessionControls
                            menus={props.menus}
                            onEffortChange={props.onEffortChange}
                            onModelChange={props.onModelChange}
                            onPermissionModeChange={props.onPermissionModeChange}
                            onServiceTierChange={props.onServiceTierChange}
                        />
                    ) : null}
                </div>
            </header>

            <div className="happy2-rig-chat__scroll" data-happy2-ui="rig-chat-scroll">
                {props.usageOpen ? (
                    <div className="happy2-rig-chat__usage" data-happy2-ui="rig-chat-usage">
                        <RigUsagePanel
                            error={props.usageError}
                            loading={props.usageLoading}
                            usage={props.usage}
                        />
                    </div>
                ) : props.activityOpen ? (
                    <div className="happy2-rig-chat__usage" data-happy2-ui="rig-chat-activity">
                        <RigActivityPanel
                            backgroundProcesses={props.backgroundProcesses ?? []}
                            onBackgroundProcessStop={props.onBackgroundProcessStop}
                            goal={props.goal}
                            now={props.now ?? 0}
                            subagents={props.subagents ?? []}
                            tasks={props.tasks ?? []}
                        />
                    </div>
                ) : (
                    <RigTranscript
                        elapsedMs={props.elapsedMs}
                        entries={props.entries}
                        onImageOpen={props.onImageOpen}
                        onRewind={props.onRewind}
                        running={props.running}
                    />
                )}
            </div>

            {props.pendingUserInputs.length > 0 ? (
                <div className="happy2-rig-chat__inputs" data-happy2-ui="rig-chat-inputs">
                    {props.pendingUserInputs.map((request) => (
                        <RigUserInputPrompt
                            key={request.requestId}
                            onAnswer={props.onAnswerInput}
                            pending={props.sendPending}
                            request={request}
                        />
                    ))}
                </div>
            ) : null}

            {props.queuedMessages && props.queuedMessages.length > 0 ? (
                <div
                    className="happy2-rig-chat__steering"
                    data-happy2-ui="rig-chat-steering"
                    role="status"
                >
                    <span
                        className="happy2-rig-chat__steering-title"
                        data-happy2-ui="rig-chat-steering-title"
                    >
                        <span aria-hidden="true" className="happy2-rig-chat__steering-dot" />
                        Messages to be submitted after next tool call (esc to send now)
                    </span>
                    {props.queuedMessages.map((message) => (
                        <span
                            className="happy2-rig-chat__steering-item"
                            data-happy2-ui="rig-chat-steering-item"
                            key={message.id}
                        >
                            {message.text}
                        </span>
                    ))}
                </div>
            ) : null}

            <RigStatusBar
                backgroundCount={props.backgroundCount}
                cwd={props.subtitle}
                menus={props.menus}
                queuedCount={props.queuedMessages?.length}
                runningSubagentCount={
                    props.subagents?.filter((subagent) => subagent.status === "running").length
                }
            />

            <div className="happy2-rig-chat__dock" data-happy2-ui="rig-chat-dock">
                {paletteOpen ? (
                    <div className="happy2-rig-chat__palette" data-happy2-ui="rig-chat-palette">
                        <RigCommandPalette
                            autoFocus={false}
                            commands={commands}
                            onClose={() => setDraft("")}
                            onCommand={runCommand}
                            onQueryChange={(value) => setDraft(`/${value}`)}
                            query={paletteQuery}
                        />
                    </div>
                ) : null}
                {mentionOpen ? (
                    <div className="happy2-rig-chat__palette" data-happy2-ui="rig-chat-mention">
                        <RigFileMention
                            files={mentions}
                            onSelect={insertMention}
                            query={mentionQuery ?? ""}
                        />
                    </div>
                ) : null}
                <div className="happy2-rig-chat__dock-inner">
                    {props.running ? (
                        <Button
                            className="happy2-rig-chat__abort"
                            data-action="abort"
                            icon="close"
                            onClick={props.onAbort}
                            size="small"
                            variant="secondary"
                        >
                            Stop
                        </Button>
                    ) : null}
                    <Composer
                        disabled={props.composerDisabled}
                        hint="Enter to send"
                        onSend={submit}
                        onValueChange={changeDraft}
                        pending={props.sendPending}
                        placeholder={props.placeholder ?? "Message Rig…"}
                        sendEnabled={sendEnabled}
                        value={draft}
                    />
                </div>
            </div>
        </section>
    );
}
