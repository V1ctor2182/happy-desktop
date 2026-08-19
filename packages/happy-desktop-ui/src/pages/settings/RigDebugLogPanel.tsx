import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { CopyButton } from "../../CopyButton";
import { RigSettingsSection } from "./RigSettingsShell";

export interface RigDebugLogPanelEntry {
    readonly detail?: string;
    readonly id: number;
    readonly level: "info" | "warning" | "error";
    readonly message: string;
    readonly occurredAt: number;
    readonly source: "catalog" | "connection" | "health" | "mutation" | "sse" | "sync";
}

export interface RigDebugLogPanelProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly discardedEntries: number;
    readonly entries: readonly RigDebugLogPanelEntry[];
    readonly style?: CSSProperties;
}

function entryText(entry: RigDebugLogPanelEntry): string {
    const heading = `${new Date(entry.occurredAt).toISOString()} [${entry.level.toUpperCase()}] [${entry.source.toUpperCase()}] ${entry.message}`;
    if (entry.detail === undefined) return heading;
    return `${heading}\n${entry.detail
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}`;
}

function logText(props: RigDebugLogPanelProps): string {
    const entries = props.entries.map(entryText);
    if (props.discardedEntries > 0) {
        entries.unshift(
            `… ${props.discardedEntries.toLocaleString("en-US")} earlier ${props.discardedEntries === 1 ? "entry" : "entries"} discarded from the retained buffer`,
        );
    }
    return entries.join("\n\n");
}

/** Live, copyable connection and state diagnostics for one Rig. */
export function RigDebugLogPanel(props: RigDebugLogPanelProps) {
    const scrollport = useRef<HTMLPreElement>(null);
    const text = logText(props);
    const lastEntryId = props.entries.at(-1)?.id;

    // eslint-disable-next-line happy2-react/no-layout-effect -- incoming diagnostics change scrollHeight; the explicitly following log must reach its newest line before paint
    useLayoutEffect(() => {
        const element = scrollport.current;
        if (element) element.scrollTop = element.scrollHeight;
    }, [lastEntryId]);

    return (
        <RigSettingsSection
            description="Connection transitions, reconciliation, raw SSE events, health, and mutation failures from this Rig."
            rows="cards"
            title="State log"
        >
            <section
                className={["happy2-rig-debug-log", props.className].filter(Boolean).join(" ")}
                data-happy-desktop-ui="rig-debug-log"
                data-testid={props["data-testid"]}
                style={props.style}
            >
                <header className="happy2-rig-debug-log__header">
                    <span className="happy2-rig-debug-log__title">Live diagnostics</span>
                    <span className="happy2-rig-debug-log__count">
                        {props.entries.length.toLocaleString("en-US")} retained
                    </span>
                    <CopyButton
                        data-happy-desktop-ui="rig-debug-log-copy"
                        label="Copy debug log"
                        text={text}
                    />
                </header>
                <pre
                    aria-label="Live Rig debug log"
                    aria-live="off"
                    className="happy2-rig-debug-log__scrollport"
                    data-happy-desktop-ui="rig-debug-log-scrollport"
                    ref={scrollport}
                    role="log"
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the scrollable log needs a keyboard focus stop so arrow/Page keys can read retained output
                    tabIndex={0}
                >
                    <code className="happy2-rig-debug-log__content">
                        {text || "Waiting for internal state events…"}
                    </code>
                </pre>
            </section>
        </RigSettingsSection>
    );
}
