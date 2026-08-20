import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

const ESTIMATED_ENTRY_HEIGHT = 68;
const ENTRY_GAP = 17;
const CONTENT_INSET = 12;
const SCROLLPORT_HEIGHT = 320;

function discardedText(count: number): string {
    return `… ${count.toLocaleString("en-US")} earlier ${count === 1 ? "entry" : "entries"} discarded from the retained buffer`;
}

/** Live, copyable connection and state diagnostics for one Rig. */
export function RigDebugLogPanel(props: RigDebugLogPanelProps) {
    const scrollport = useRef<HTMLDivElement>(null);
    const following = useRef(true);
    const discardedOffset = props.discardedEntries > 0 ? 1 : 0;
    const itemCount = props.entries.length + discardedOffset;
    const lastEntryId = props.entries.at(-1)?.id;
    const itemKey = (index: number): number | string =>
        index < discardedOffset
            ? "discarded"
            : (props.entries[index - discardedOffset]?.id ?? index);
    // TanStack Virtual deliberately owns mutable measurement functions. This
    // leaf stays outside compiler memoization while its retained entries keep
    // their stable ids and DOM identity.
    // eslint-disable-next-line react-hooks/incompatible-library
    const virtualizer = useVirtualizer({
        anchorTo: "end",
        count: itemCount,
        directDomUpdates: true,
        directDomUpdatesMode: "transform",
        estimateSize: () => ESTIMATED_ENTRY_HEIGHT,
        followOnAppend: true,
        gap: ENTRY_GAP,
        getItemKey: itemKey,
        getScrollElement: () => scrollport.current,
        initialOffset: () =>
            CONTENT_INSET * 2 +
            itemCount * ESTIMATED_ENTRY_HEIGHT +
            Math.max(0, itemCount - 1) * ENTRY_GAP,
        initialRect: { width: 0, height: SCROLLPORT_HEIGHT },
        overscan: 4,
        paddingEnd: CONTENT_INSET,
        paddingStart: CONTENT_INSET,
        scrollEndThreshold: ENTRY_GAP * 2,
        useFlushSync: false,
    });
    // eslint-disable-next-line happy2-react/no-layout-effect -- a full retained buffer appends without changing its item count; the virtual scroll integration must follow that new keyed row before paint only while the reader remains at the end
    useLayoutEffect(() => {
        if (following.current) virtualizer.scrollToEnd();
    }, [lastEntryId, virtualizer]);

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
                        text={() => logText(props)}
                    />
                </header>
                <div
                    aria-label="Live Rig debug log"
                    aria-live="off"
                    className="happy2-rig-debug-log__scrollport"
                    data-happy-desktop-ui="rig-debug-log-scrollport"
                    onScroll={() => {
                        following.current = virtualizer.isAtEnd(ENTRY_GAP * 2);
                    }}
                    ref={scrollport}
                    role="log"
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the scrollable log needs a keyboard focus stop so arrow/Page keys can read retained output
                    tabIndex={0}
                >
                    <div className="happy2-rig-debug-log__content" ref={virtualizer.containerRef}>
                        {itemCount === 0 ? (
                            <code className="happy2-rig-debug-log__empty">
                                Waiting for internal state events…
                            </code>
                        ) : (
                            virtualizer.getVirtualItems().map((item) => {
                                const entry = props.entries[item.index - discardedOffset];
                                const text = entry
                                    ? entryText(entry)
                                    : discardedText(props.discardedEntries);
                                return (
                                    <pre
                                        className="happy2-rig-debug-log__entry"
                                        data-index={item.index}
                                        key={item.key}
                                        ref={virtualizer.measureElement}
                                    >
                                        <code>{text}</code>
                                    </pre>
                                );
                            })
                        )}
                    </div>
                </div>
            </section>
        </RigSettingsSection>
    );
}
