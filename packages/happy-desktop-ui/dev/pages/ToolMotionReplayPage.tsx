import {
    useLayoutEffect,
    useMemo,
    useState,
    useSyncExternalStore,
    type CSSProperties,
} from "react";
import {
    rigAgentAuthor,
    rigOwnerAuthor,
    type ComposerSnapshot,
    type RigMenusSnapshot,
} from "happy-desktop-state";
import { type ActivityMotion } from "../../src/AgentActivityRow";
import { ComposerFooterBar } from "../../src/ConversationDock";
import { ComposerModelControl } from "../../src/ComposerModelControl";
import { ContextMeter } from "../../src/ContextMeter";
import { ConversationView } from "../../src/ConversationView";
import { RigActivityControl } from "../../src/RigActivityControl";
import { RigSessionControls } from "../../src/RigSessionControls";
import { type RigUserInputAnswerMap } from "../../src/RigUserInputPrompt";
import { rigComposerModelControlProps } from "../../src/rigComposerModelControl";
import { ComponentPage } from "../kit";
import rawRecording from "../recordings/conversations/gold-five-minute-session.v1.json?raw";
import rawSubagentRecording from "../recordings/conversations/gold-subagent-lifecycle.v1.json?raw";
import {
    RigConversationReplayDriver,
    rigConversationReplayRecordingParse,
    rigConversationReplayTimeline,
    type RigConversationReplayRecording,
} from "../replay/rigConversationReplayDriver";

/** The component plan this page documents. The selector and page header share it. */
export const componentNumber = "C-256";

const RECORDINGS = [
    rigConversationReplayRecordingParse(rawSubagentRecording),
    rigConversationReplayRecordingParse(rawRecording),
];
const FRAME_MS = 1_000 / 60;

const COMPOSER: Omit<ComposerSnapshot, "scopeId"> = {
    agentUserIds: [],
    attachments: [],
    capabilities: { commands: [], mentions: false, shellMode: false },
    focused: false,
    mentionCandidates: [],
    revision: 0,
    submission: { status: "idle" },
    text: "",
};

interface VariantSpec {
    readonly detail: string;
    readonly id: string;
    readonly label: string;
    readonly motion: ActivityMotion;
    readonly streamingCaret: boolean;
}

const VARIANTS: readonly VariantSpec[] = [
    {
        detail: "No typing animation",
        id: "calm",
        label: "Still",
        motion: "calm",
        streamingCaret: true,
    },
    {
        detail: "Typing animation for status",
        id: "verb-typed",
        label: "Status",
        motion: "verb-typed",
        streamingCaret: true,
    },
    {
        detail: "Typing animation for args and text",
        id: "calm-typed",
        label: "Prod",
        motion: "calm-typed",
        streamingCaret: true,
    },
    {
        detail: "Typing animation for status, args, and text",
        id: "current",
        label: "Current",
        motion: "typewriter",
        streamingCaret: false,
    },
];

interface ReplayClock {
    readonly baseDisplayMs: number;
    readonly playingSince: number | null;
}

const noop = () => undefined;

function durationLabel(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

function frameIndexAt(recording: RigConversationReplayRecording, sourceMs: number): number {
    let low = 0;
    let high = recording.frames.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (recording.frames[middle]!.atMs <= sourceMs) low = middle + 1;
        else high = middle;
    }
    return low - 1;
}

const CONTROL_ROW: CSSProperties = {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "8px",
};

const MOTION_GRID: CSSProperties = {
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))",
    maxWidth: "1160px",
};

function ToolMotionReplayLab(props: { recording: RigConversationReplayRecording }) {
    const { recording } = props;
    const [driver] = useState(() => new RigConversationReplayDriver(recording));
    const snapshot = useSyncExternalStore(driver.subscribe, driver.get, driver.get);
    const [requestSelections, setRequestSelections] = useState<
        ReadonlyMap<string, Readonly<Record<string, readonly string[]>>>
    >(() => new Map());
    const [requestAnsweredAt, setRequestAnsweredAt] = useState<ReadonlyMap<string, number>>(
        () => new Map(),
    );
    const [variantId, setVariantId] = useState("calm-typed");
    const [skipSilence, setSkipSilence] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [clock, setClock] = useState<ReplayClock>(() => ({
        baseDisplayMs: 0,
        playingSince: performance.now(),
    }));
    const [wallNow, setWallNow] = useState(() => clock.playingSince ?? 0);
    // The mapping scans thousands of exact frames, but changes only when the
    // skip toggle changes—not on every animation frame.
    const timeline = useMemo(
        () => rigConversationReplayTimeline(recording, skipSilence),
        [recording, skipSilence],
    );
    const composer = useMemo<ComposerSnapshot>(
        () => ({ ...COMPOSER, scopeId: recording.id }),
        [recording.id],
    );
    const variant = VARIANTS.find((candidate) => candidate.id === variantId) ?? VARIANTS[0]!;
    const displayMs =
        clock.playingSince === null
            ? clock.baseDisplayMs
            : Math.min(
                  clock.baseDisplayMs + (wallNow - clock.playingSince) * speed,
                  timeline.displayDurationMs,
              );
    const sourceMs = timeline.sourceAt(displayMs);
    const playing = clock.playingSince !== null && displayMs < timeline.displayDurationMs;
    const sourceEpochNow = recording.startedAt + sourceMs;
    const currentFrameIndex = frameIndexAt(recording, sourceMs);
    const currentFrame = recording.frames[currentFrameIndex];
    const activeSilentWindow = timeline.windows.find(
        (window) => displayMs > window.displayStartMs && displayMs < window.displayEndMs,
    );

    // The virtual clock is an imperative integration with the external replay
    // store. It lands before paint so ConversationView never displays a clock
    // that is ahead of the protocol snapshot underneath it.
    // eslint-disable-next-line happy2-react/no-layout-effect -- virtual-clock integration must apply crossed protocol frames before the browser paints their timestamp
    useLayoutEffect(() => {
        driver.seek(sourceMs);
    }, [driver, sourceMs]);

    // eslint-disable-next-line happy2-react/no-layout-effect -- the external replay store needs symmetric browser cleanup
    useLayoutEffect(() => {
        return () => driver.dispose();
    }, [driver]);

    // eslint-disable-next-line happy2-react/no-layout-effect -- requestAnimationFrame is the replay clock and requires symmetric browser cleanup
    useLayoutEffect(() => {
        if (!playing) return;
        let animationFrame = 0;
        const tick = (now: number) => {
            setWallNow(now);
            animationFrame = window.requestAnimationFrame(tick);
        };
        animationFrame = window.requestAnimationFrame(tick);
        return () => {
            window.cancelAnimationFrame(animationFrame);
        };
    }, [playing]);

    const rebaseClock = (
        nextDisplayMs: number,
        continuePlaying: boolean,
        displayDurationMs = timeline.displayDurationMs,
    ) => {
        const now = performance.now();
        setWallNow(now);
        setClock({
            baseDisplayMs: Math.min(Math.max(nextDisplayMs, 0), displayDurationMs),
            playingSince: continuePlaying ? now : null,
        });
    };
    const pauseAt = (nextDisplayMs: number) => rebaseClock(nextDisplayMs, false);
    const playFrom = (nextDisplayMs: number) => rebaseClock(nextDisplayMs, true);
    const elapsedMs =
        snapshot.runStatus === "running" && snapshot.runStartedAt !== undefined
            ? Math.max(0, sourceEpochNow - snapshot.runStartedAt)
            : snapshot.turnElapsedMs;
    const activeAgents = snapshot.subagents.filter(
        (subagent) => subagent.status === "queued" || subagent.status === "running",
    );
    const activeActivity = {
        agents: activeAgents.length,
        terminals: snapshot.backgroundProcesses.length,
    };
    const activityTotal = activeActivity.agents + activeActivity.terminals;
    const modelControl = snapshot.menus ? (
        <ComposerModelControl
            {...rigComposerModelControlProps(snapshot.menus, {
                disabled: true,
                onEffortChange: noop,
                onModelChange: noop,
            })}
        />
    ) : undefined;
    const footerMenus: RigMenusSnapshot | undefined = snapshot.menus
        ? {
              ...snapshot.menus,
              currentServiceTier: undefined,
              serviceTierOptions: [
                  { tier: null, label: "Standard", current: true },
                  { tier: "fast", label: "Fast", current: false },
              ],
          }
        : undefined;
    const footerControl = (
        <ComposerFooterBar
            leading={
                <>
                    <RigSessionControls
                        disabled
                        fields={["permission", "tier"]}
                        menuPlacement="above"
                        menus={footerMenus}
                        onEffortChange={noop}
                        onModelChange={noop}
                        onPermissionModeChange={noop}
                        onServiceTierChange={noop}
                        variant="ghost"
                    />
                </>
            }
            trailing={<ContextMeter totalTokens={200_000} usedTokens={47_000} />}
        />
    );
    const visibleRequestIds = new Set(
        snapshot.entries.flatMap((entry) =>
            entry.kind === "request" &&
            entry.request.kind === "userInput" &&
            entry.request.status !== "answered"
                ? [entry.request.requestId]
                : [],
        ),
    );
    const replayRequestSubmissions = [
        ...snapshot.requestSubmissions.filter(
            (submission) => !requestAnsweredAt.has(submission.requestId),
        ),
        ...[...requestAnsweredAt].flatMap(([requestId, answeredAt]) =>
            visibleRequestIds.has(requestId) && sourceMs >= answeredAt
                ? [{ requestId, status: "pending" as const }]
                : [],
        ),
    ];
    const replayRequestSelections = new Map([...snapshot.requestSelections, ...requestSelections]);

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                width: "100%",
            }}
        >
            <div
                aria-label="Motion profile, least to most dynamic"
                role="radiogroup"
                style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "1160px" }}
            >
                <span
                    style={{
                        color: "var(--text-secondary)",
                        fontSize: "12px",
                        fontWeight: 600,
                    }}
                >
                    Motion · least → most
                </span>
                <div style={MOTION_GRID}>
                    {VARIANTS.map((candidate) => {
                        const selected = candidate.id === variant.id;
                        return (
                            <button
                                aria-checked={selected}
                                aria-label={`${candidate.label}: ${candidate.detail}`}
                                key={candidate.id}
                                onClick={() => setVariantId(candidate.id)}
                                role="radio"
                                style={{
                                    alignItems: "flex-start",
                                    background: selected ? "var(--surface-hover)" : "transparent",
                                    border: `1px solid ${selected ? "var(--text-secondary)" : "var(--divider)"}`,
                                    borderRadius: "7px",
                                    color: "var(--text)",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "2px",
                                    minHeight: "52px",
                                    padding: "7px 10px",
                                    textAlign: "left",
                                }}
                                type="button"
                            >
                                <span style={{ fontSize: "13px", fontWeight: 650 }}>
                                    {candidate.label}
                                </span>
                                <span
                                    style={{
                                        color: "var(--text-secondary)",
                                        fontSize: "12px",
                                        fontWeight: 400,
                                        lineHeight: "16px",
                                    }}
                                >
                                    {candidate.detail}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div
                style={{
                    ...CONTROL_ROW,
                    justifyContent: "space-between",
                    maxWidth: "1160px",
                }}
            >
                <div style={CONTROL_ROW}>
                    <button
                        onClick={() =>
                            playing
                                ? pauseAt(displayMs)
                                : playFrom(displayMs >= timeline.displayDurationMs ? 0 : displayMs)
                        }
                        type="button"
                    >
                        {playing
                            ? "Pause"
                            : displayMs >= timeline.displayDurationMs
                              ? "Replay"
                              : "Play"}
                    </button>
                    <button onClick={() => playFrom(0)} type="button">
                        Restart
                    </button>
                    <button
                        onClick={() => pauseAt(displayMs - FRAME_MS)}
                        title="Back one 60 Hz display frame"
                        type="button"
                    >
                        Back 1 frame
                    </button>
                    <button
                        onClick={() => pauseAt(displayMs + FRAME_MS)}
                        title="Forward one 60 Hz display frame"
                        type="button"
                    >
                        Forward 1 frame
                    </button>
                </div>
                <div style={CONTROL_ROW}>
                    <label
                        style={{
                            alignItems: "center",
                            display: "flex",
                            flexDirection: "row",
                            gap: "6px",
                        }}
                    >
                        Speed
                        <select
                            onChange={(event) => {
                                if (clock.playingSince !== null) rebaseClock(displayMs, true);
                                setSpeed(Number(event.target.value));
                            }}
                            value={speed}
                        >
                            <option value={0.25}>0.25×</option>
                            <option value={0.5}>0.5×</option>
                            <option value={1}>1×</option>
                            <option value={2}>2×</option>
                            <option value={4}>4×</option>
                        </select>
                    </label>
                    <label
                        style={{
                            alignItems: "center",
                            display: "flex",
                            flexDirection: "row",
                            gap: "6px",
                        }}
                        title="Compress source gaps of eight seconds or more to two seconds. Every protocol frame still applies."
                    >
                        <input
                            checked={skipSilence}
                            onChange={(event) => {
                                const nextSkip = event.target.checked;
                                const nextTimeline = rigConversationReplayTimeline(
                                    recording,
                                    nextSkip,
                                );
                                setSkipSilence(nextSkip);
                                rebaseClock(
                                    nextTimeline.displayAt(sourceMs),
                                    clock.playingSince !== null,
                                    nextTimeline.displayDurationMs,
                                );
                            }}
                            type="checkbox"
                        />
                        Skip quiet
                    </label>
                </div>
            </div>

            <div style={{ ...CONTROL_ROW, maxWidth: "1160px" }}>
                <input
                    max={timeline.displayDurationMs}
                    min={0}
                    onChange={(event) => pauseAt(Number(event.target.value))}
                    step={1}
                    style={{ flex: "1 1 auto" }}
                    type="range"
                    value={Math.round(displayMs)}
                />
                <span
                    style={{
                        color: "var(--text-secondary)",
                        fontFamily: "var(--happy2-font-mono)",
                        fontSize: "12px",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                    }}
                >
                    source {durationLabel(sourceMs)} / {durationLabel(timeline.sourceDurationMs)}
                    {skipSilence
                        ? ` · playback ${durationLabel(displayMs)} / ${durationLabel(timeline.displayDurationMs)}`
                        : ""}
                </span>
            </div>

            <div
                style={{
                    alignItems: "baseline",
                    color: "var(--text-secondary)",
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    fontFamily: "var(--happy2-font-mono)",
                    fontSize: "12px",
                    fontVariantNumeric: "tabular-nums",
                    gap: "12px",
                }}
            >
                <span>
                    frame {Math.max(0, currentFrameIndex + 1).toLocaleString()}/
                    {recording.frames.length.toLocaleString()}
                </span>
                <span>
                    {currentFrame
                        ? `${currentFrame.event.type} · ${currentFrame.source}`
                        : "before first frame"}
                </span>
                <span>
                    {driver.protocolSession.providerId} · {driver.protocolSession.modelId} ·{" "}
                    {driver.protocolSession.effort ?? "default effort"}
                </span>
                <span>
                    {timeline.windows.length} quiet windows ·{" "}
                    {durationLabel(timeline.sourceDurationMs - timeline.displayDurationMs)}{" "}
                    skippable
                </span>
                {activeSilentWindow ? (
                    <span>
                        compressing{" "}
                        {(
                            (activeSilentWindow.sourceEndMs - activeSilentWindow.sourceStartMs) /
                            1_000
                        ).toFixed(1)}
                        s quiet window
                    </span>
                ) : null}
            </div>

            <div
                style={{
                    border: "1px solid var(--divider)",
                    borderRadius: "8px",
                    display: "flex",
                    height: "min(760px, calc(100vh - 372px))",
                    maxWidth: "100%",
                    minHeight: "320px",
                    overflow: "hidden",
                    width: "1160px",
                }}
            >
                <ConversationView
                    activityTreatment="focused"
                    agentAuthor={rigAgentAuthor}
                    activityControl={
                        activityTotal > 0 ? (
                            <RigActivityControl
                                agents={activeActivity.agents}
                                backgroundTerminals={activeActivity.terminals}
                                onClick={noop}
                            />
                        ) : undefined
                    }
                    composer={composer}
                    composerControls={modelControl}
                    composerFooterControl={footerControl}
                    composerPlaceholder="Message Happy in “less chaotic tool calls”…"
                    conversationId={recording.id}
                    elapsedMs={elapsedMs}
                    entries={snapshot.entries}
                    expandedTurnIds={snapshot.expandedTurnIds}
                    motion={variant.motion}
                    onComposerSend={noop}
                    onComposerValueChange={noop}
                    now={sourceEpochNow}
                    onDelegationSelect={noop}
                    onRequestAnswer={(requestId) =>
                        setRequestAnsweredAt((current) => {
                            const next = new Map(current);
                            next.set(requestId, sourceMs);
                            return next;
                        })
                    }
                    onRequestSelectionChange={(requestId: string, answers: RigUserInputAnswerMap) =>
                        setRequestSelections((current) => {
                            const next = new Map(current);
                            next.set(requestId, answers);
                            return next;
                        })
                    }
                    onTraceToggle={(turnId) => driver.turnTraceToggle(turnId)}
                    requestSelections={replayRequestSelections}
                    requestSubmissions={replayRequestSubmissions}
                    running={snapshot.runStatus === "running"}
                    streamingCaret={variant.streamingCaret}
                    style={{ flex: "1 1 auto", minWidth: 0 }}
                    viewerId={rigOwnerAuthor.id}
                    workingLabel={snapshot.workingLabel}
                    workingPhase={snapshot.workingPhase}
                    workingWait={
                        snapshot.workingWait
                            ? { ...snapshot.workingWait, now: sourceEpochNow }
                            : undefined
                    }
                />
            </div>
        </div>
    );
}

function ToolMotionReplaySwitcher() {
    const [recordingId, setRecordingId] = useState(RECORDINGS[0]!.id);
    const recording =
        RECORDINGS.find((candidate) => candidate.id === recordingId) ?? RECORDINGS[0]!;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
            <label
                style={{
                    alignItems: "center",
                    display: "flex",
                    flexDirection: "row",
                    fontSize: "13px",
                    gap: "8px",
                    maxWidth: "1160px",
                }}
            >
                Recording
                <select
                    onChange={(event) => setRecordingId(event.target.value)}
                    value={recording.id}
                >
                    {RECORDINGS.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                            {candidate.label}
                        </option>
                    ))}
                </select>
                <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                    {durationLabel(recording.durationMs)} ·{" "}
                    {recording.frames.length.toLocaleString()} exact frames
                </span>
            </label>
            <ToolMotionReplayLab key={recording.id} recording={recording} />
        </div>
    );
}

export function ToolMotionReplayPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Sanitized exact Rig arrival deltas replayed through rig-connect, the production chat store, and ConversationView. Active agent/task/terminal counts appear as transcript rows beneath the latest message, never above the composer. Switch between the five-minute composite and a fully real Sol parent run with three concurrent Sol/Terra subagents and a follow-up."
            title="ToolMotionReplay · Gold sessions"
        >
            <ToolMotionReplaySwitcher />
        </ComponentPage>
    );
}
