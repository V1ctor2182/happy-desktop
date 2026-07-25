import type { CSSProperties, ReactNode } from "react";
import type { RigMenusSnapshot, RigPermissionMode } from "happy2-state";

export type RigStatusBarProps = {
    /** Derived model/effort/permission snapshot; when present, drives the left segments. */
    menus?: RigMenusSnapshot;
    /** Working directory shown as the location segment. */
    cwd?: string;
    /** Number of steering messages queued behind the current run (`queued N`). */
    queuedCount?: number;
    /** Number of running background terminals (`N background terminals running`). */
    backgroundCount?: number;
    /** Number of running delegated subagents (`N agents running`). */
    runningSubagentCount?: number;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

// Lowercased permission labels, matching the TUI footer's `permission mode (lowercased)`.
const PERMISSION_LABELS: Record<RigPermissionMode, string> = {
    auto: "auto",
    workspace_write: "workspace write",
    read_only: "read only",
    full_access: "full access",
};

function modelLabel(menus: RigMenusSnapshot): string {
    const current = menus.modelOptions.find((option) => option.current);
    return current?.name ?? menus.currentModelId;
}

function effortLabel(menus: RigMenusSnapshot): string | undefined {
    const current = menus.effortOptions.find((option) => option.current);
    return current?.label ?? menus.currentEffort;
}

function Segment(props: { kind: string; tone?: string; children: ReactNode }) {
    return (
        <span
            className="happy2-rig-status__segment"
            data-happy2-ui={`rig-status-${props.kind}`}
            data-tone={props.tone}
        >
            {props.children}
        </span>
    );
}

/**
 * RigStatusBar — the footer/status bar mirroring the TUI `#renderForter`: a dim,
 * `·`-separated line of model+reasoning, working directory, `queued N`, and the
 * (lowercased) permission mode, plus inline running summaries for background
 * terminals (`N background terminals running · /ps to view · /stop to close`) and
 * delegated subagents (`N agents running · /agents to view`). Purely presentational
 * and derived from the reactive session snapshot; it holds no state and issues no
 * work, so every value updates live as the store reconciles SSE events.
 */
export function RigStatusBar(props: RigStatusBarProps) {
    const { menus } = props;
    const queued = props.queuedCount ?? 0;
    const background = props.backgroundCount ?? 0;
    const agents = props.runningSubagentCount ?? 0;
    const effort = menus ? effortLabel(menus) : undefined;

    return (
        <footer
            className={["happy2-rig-status", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-status-bar"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-rig-status__row" data-happy2-ui="rig-status-primary">
                {menus ? (
                    <Segment kind="model" tone="warning">
                        {modelLabel(menus)}
                        {effort ? ` · ${effort}` : ""}
                    </Segment>
                ) : null}
                {props.cwd ? (
                    <Segment kind="cwd" tone="success">
                        {props.cwd}
                    </Segment>
                ) : null}
                {queued > 0 ? <Segment kind="queued">queued {queued}</Segment> : null}
                {menus ? (
                    <Segment kind="permission">
                        {PERMISSION_LABELS[menus.currentPermissionMode]}
                    </Segment>
                ) : null}
            </div>

            {background > 0 || agents > 0 ? (
                <div className="happy2-rig-status__row" data-happy2-ui="rig-status-monitors">
                    {agents > 0 ? (
                        <Segment kind="agents" tone="info">
                            {agents} {agents === 1 ? "agent" : "agents"} running · /agents to view
                        </Segment>
                    ) : null}
                    {background > 0 ? (
                        <Segment kind="background" tone="info">
                            {background} background {background === 1 ? "terminal" : "terminals"}{" "}
                            running · /ps to view · /stop to close
                        </Segment>
                    ) : null}
                </div>
            ) : null}
        </footer>
    );
}
