import {
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ClipboardEvent,
    type KeyboardEvent,
} from "react";
import type { TerminalCellSnapshot, TerminalGridSnapshot, TerminalRowSnapshot } from "happy2-state";
import { Button } from "./Button";

export interface TerminalPanelProps {
    /** The current renderable grid, once output or recovery has arrived. */
    grid?: TerminalGridSnapshot;
    status: "connecting" | "connected" | "disconnected" | "exited" | "error";
    error?: string;
    exitCode?: number | null;
    /**
     * Fixed height in pixels, for a terminal docked at the bottom of a surface it
     * shares with other content. Omitting it — together with `onHeightChange` —
     * makes the terminal fill whatever box its parent gives it and drops the drag
     * divider, which is what a terminal that owns its whole column wants: there is
     * nothing above or below for a divider to trade space with.
     */
    height?: number;
    /**
     * Closes the terminal. Omit it where the container already owns closing (a tab
     * strip, say), so the header does not offer a second control for the same act.
     */
    onClose?(): void;
    onHeightChange?(height: number): void;
    onInput(data: string): void;
    onReconnect(): void;
    onResize(cols: number, rows: number): void;
}

// One authoritative cell geometry, shared by layout, the cursor overlay, and the
// size derivation. The width is exactly one advance of the bundled JetBrains
// Mono at 14px (0.6em), so a column in CSS `ch` and this pixel value agree.
const CELL_WIDTH = 8.4;
const CELL_HEIGHT = 18;
const ROWS_PADDING_HORIZONTAL = 12;
const ROWS_PADDING_VERTICAL = 8;
/*
 * What an inverse cell swaps against when it carries no explicit colors: the
 * screen's own two colors. They have to be this pair — the surface the terminal
 * is painted on and the text painted on it — or the swap lands on colors the
 * cell is not actually sitting between and stops being a swap. A fixed dark
 * terminal background, in particular, is invisible against light text.
 */
const DEFAULT_FOREGROUND = "var(--text)";
const DEFAULT_BACKGROUND = "var(--surface)";

export function TerminalPanel(props: TerminalPanelProps) {
    const screen = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const drag = useRef<{ startHeight: number; startY: number } | undefined>(undefined);
    const [focused, focusedSet] = useState(false);
    // Whether new output should keep scrolling the screen into view. A terminal
    // follows its own output, but the moment the reader scrolls up into history
    // it must stay where they put it — otherwise the next line of output yanks
    // what they are reading off the screen.
    const following = useRef(true);
    const resize = useEffectEvent((cols: number, rows: number) => props.onResize(cols, rows));
    // With nothing to show, a dead session collapses to its header line so it
    // does not push the conversation around; once output exists it stays
    // visible through disconnects for context.
    const collapsed =
        !props.grid &&
        (props.status === "error" || props.status === "disconnected" || props.status === "exited");
    // Terminal autofocus is a mount/visibility concern, never a response to an
    // unrelated ChatPage render. Otherwise a freshly allocated callback prop
    // would steal the composer's focus whenever its draft changes.
    // eslint-disable-next-line happy2-react/no-layout-effect -- move real keyboard focus to the capture field on mount
    useLayoutEffect(() => {
        if (!collapsed) input.current?.focus({ preventScroll: true });
    }, [collapsed]);
    // eslint-disable-next-line happy2-react/no-layout-effect -- observe the live screen box to size the PTY in cells
    useLayoutEffect(() => {
        const element = screen.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) return;
            // Rows own the terminal's 12px/8px inset, so size the PTY from the
            // cell viewport inside that inset. Rounding the outer screen would
            // request columns and rows that cannot actually fit.
            const cols = Math.max(
                1,
                Math.floor((entry.contentRect.width - ROWS_PADDING_HORIZONTAL * 2) / CELL_WIDTH),
            );
            const rows = Math.max(
                1,
                Math.floor((entry.contentRect.height - ROWS_PADDING_VERTICAL * 2) / CELL_HEIGHT),
            );
            resize(cols, rows);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [collapsed]);
    // Scroll position is the browser's, not React's, so following the output has
    // to be re-applied imperatively after each frame commits its new rows. There
    // is no dependency list because any render may have grown the transcript.
    // eslint-disable-next-line happy2-react/no-layout-effect -- scroll offset is live DOM state React cannot render
    useLayoutEffect(() => {
        const element = screen.current;
        if (element && following.current) element.scrollTop = element.scrollHeight;
    });
    function screenScroll() {
        const element = screen.current;
        if (!element) return;
        // A scroll that lands within one row of the end is still "at the bottom",
        // so fractional layout and a trackpad's last pixel do not silently stop
        // the terminal from following its output.
        following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= CELL_HEIGHT;
    }
    function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        const sequences: Partial<Record<string, string>> = {
            Enter: "\r",
            Backspace: "\x7f",
            Tab: "\t",
            ArrowUp: "\x1b[A",
            ArrowDown: "\x1b[B",
            ArrowRight: "\x1b[C",
            ArrowLeft: "\x1b[D",
            Escape: "\x1b",
        };
        const sequence = sequences[event.key];
        if (sequence) {
            event.preventDefault();
            props.onInput(sequence);
        } else if (event.ctrlKey && event.key.length === 1) {
            event.preventDefault();
            props.onInput(String.fromCharCode(event.key.toUpperCase().charCodeAt(0) - 64));
        }
    }
    function screenFocus() {
        // A terminal click returns keyboard capture unless the user has an
        // active grid selection they may be copying. This mirrors native
        // terminal selection behavior instead of cancelling the click early.
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) input.current?.focus({ preventScroll: true });
    }
    const height = props.height;
    const onHeightChange = props.onHeightChange;
    // A terminal with no height of its own fills its parent, so it has nothing to
    // trade space with and offers no divider.
    const resizable = height !== undefined && onHeightChange !== undefined;
    function dragStart(event: React.PointerEvent<HTMLDivElement>) {
        if (height === undefined) return;
        drag.current = { startHeight: height, startY: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    const cursor = props.grid?.cursor;
    const scrollback = props.grid?.scrollback ?? [];
    const lines = props.grid?.lines ?? [];
    return (
        <section
            className="happy2-terminal-panel"
            data-collapsed={collapsed ? "" : undefined}
            data-fill={height === undefined ? "" : undefined}
            data-happy2-ui="terminal-panel"
            style={
                collapsed
                    ? undefined
                    : ({
                          ...(height === undefined ? {} : { height: `${height}px` }),
                          "--happy2-terminal-cell-width": `${CELL_WIDTH}px`,
                          "--happy2-terminal-cell-height": `${CELL_HEIGHT}px`,
                      } as CSSProperties)
            }
        >
            {collapsed || !resizable ? null : (
                <div
                    aria-label="Resize terminal"
                    className="happy2-terminal-panel__resize"
                    data-happy2-ui="terminal-resize"
                    onPointerDown={dragStart}
                    onPointerMove={(event) => {
                        const current = drag.current;
                        if (!current) return;
                        onHeightChange(current.startHeight + current.startY - event.clientY);
                    }}
                    onPointerUp={() => (drag.current = undefined)}
                    role="separator"
                />
            )}
            <header className="happy2-terminal-panel__header">
                <span className="happy2-terminal-panel__title" data-happy2-ui="terminal-title">
                    {props.grid?.title || "Terminal"}
                </span>
                <span className="happy2-terminal-panel__status">{statusLabel(props)}</span>
                <div className="happy2-terminal-panel__actions">
                    {props.status === "disconnected" || props.status === "error" ? (
                        <Button
                            icon="play"
                            onClick={props.onReconnect}
                            size="small"
                            variant="ghost"
                        >
                            Reconnect
                        </Button>
                    ) : null}
                    {props.onClose ? (
                        <Button
                            aria-label="Close terminal"
                            icon="close"
                            iconOnly
                            onClick={props.onClose}
                            size="small"
                            variant="ghost"
                        />
                    ) : null}
                </div>
            </header>
            {collapsed ? null : (
                <div
                    className="happy2-terminal-panel__screen"
                    data-focused={focused ? "" : undefined}
                    data-happy2-ui="terminal-screen"
                    onClick={screenFocus}
                    onCopy={terminalSelectionCopy}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") screenFocus();
                    }}
                    onScroll={screenScroll}
                    ref={screen}
                    role="application"
                    tabIndex={-1}
                >
                    <div className="happy2-terminal-panel__rows" data-happy2-ui="terminal-rows">
                        {/* History is keyed from its oldest line, so a line
                            scrolling off the screen appends one row instead of
                            renumbering every row above it. */}
                        {scrollback.map((row, rowIndex) => terminalRow(row, `history:${rowIndex}`))}
                        {lines.map((row, rowIndex) => terminalRow(row, `screen:${rowIndex}`))}
                        {cursor?.visible ? (
                            <div
                                aria-hidden
                                className="happy2-terminal-panel__cursor"
                                data-happy2-ui="terminal-cursor"
                                style={{
                                    // Offset by the rows wrapper padding so cell
                                    // coordinates align with painted glyphs, and
                                    // past history, which the cursor's own
                                    // screen-relative row does not count.
                                    left: `calc(${ROWS_PADDING_HORIZONTAL}px + ${cursor.x}ch)`,
                                    top: `${
                                        ROWS_PADDING_VERTICAL +
                                        (scrollback.length + cursor.y) * CELL_HEIGHT
                                    }px`,
                                    width: "1ch",
                                    height: `${CELL_HEIGHT}px`,
                                }}
                            />
                        ) : null}
                    </div>
                    <textarea
                        aria-label="Terminal input"
                        className="happy2-terminal-panel__input"
                        /* `input` is the browser's text-entry event. Keeping the
                           terminal's byte forwarding on it avoids depending on
                           React's change-event normalization for this deliberately
                           invisible, immediately cleared capture field. */
                        onInput={(event) => {
                            if (event.currentTarget.value) props.onInput(event.currentTarget.value);
                            event.currentTarget.value = "";
                        }}
                        onKeyDown={keyDown}
                        onBlur={() => focusedSet(false)}
                        onFocus={() => focusedSet(true)}
                        ref={input}
                    />
                </div>
            )}
        </section>
    );
}

/** One transcript line, painted identically whether it is history or the screen. */
function terminalRow(row: TerminalRowSnapshot, key: string) {
    return (
        <div className="happy2-terminal-panel__row" key={key}>
            {layoutRow(row.cells).map(({ cell, gap }, index) => (
                <span
                    className="happy2-terminal-panel__cell"
                    data-column={cell.x}
                    data-inverse={cell.inverse ? "" : undefined}
                    data-width={cell.width}
                    key={`${cell.x}:${index}`}
                    style={cellStyle(cell, gap)}
                >
                    {cell.text || " "}
                </span>
            ))}
        </div>
    );
}

function terminalSelectionCopy(event: ClipboardEvent<HTMLDivElement>): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rows = [
        ...event.currentTarget.querySelectorAll<HTMLElement>(".happy2-terminal-panel__row"),
    ]
        .filter((row) => range.intersectsNode(row))
        .map((row) => terminalRowSelectionText(row, range));
    if (rows.length === 0) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", rows.join("\n"));
}

function terminalRowSelectionText(row: HTMLElement, range: Range): string {
    let previousEnd: number | undefined;
    let text = "";
    for (const cell of row.querySelectorAll<HTMLElement>(".happy2-terminal-panel__cell")) {
        if (!range.intersectsNode(cell)) continue;
        const selectedText = terminalCellSelectionText(cell, range);
        if (!selectedText) continue;
        const column = Number(cell.dataset.column);
        const width = Number(cell.dataset.width);
        if (previousEnd !== undefined && column > previousEnd) {
            text += " ".repeat(column - previousEnd);
        }
        text += selectedText;
        previousEnd = column + width;
    }
    return text;
}

function terminalCellSelectionText(cell: HTMLElement, range: Range): string {
    const text = cell.textContent ?? "";
    let start = 0;
    let end = text.length;
    if (cell.contains(range.startContainer)) {
        const prefix = document.createRange();
        prefix.selectNodeContents(cell);
        prefix.setEnd(range.startContainer, range.startOffset);
        start = prefix.toString().length;
    }
    if (cell.contains(range.endContainer)) {
        const prefix = document.createRange();
        prefix.selectNodeContents(cell);
        prefix.setEnd(range.endContainer, range.endOffset);
        end = prefix.toString().length;
    }
    return text.slice(start, end);
}

/**
 * Assigns each sparse cell the column gap from the previous cell's right edge,
 * so cells land on their declared columns and wide cells reserve two columns.
 */
function layoutRow(
    cells: readonly TerminalCellSnapshot[],
): readonly { cell: TerminalCellSnapshot; gap: number }[] {
    let previousEnd = 0;
    return cells.map((cell) => {
        const gap = Math.max(0, cell.x - previousEnd);
        previousEnd = cell.x + cell.width;
        return { cell, gap };
    });
}

function cellStyle(cell: TerminalCellSnapshot, gap: number): CSSProperties {
    // Inverse swaps foreground and background, falling back to theme defaults so
    // the swap is visible even when the cell carries no explicit colors.
    const foreground = cell.inverse
        ? (cell.background ?? DEFAULT_BACKGROUND)
        : (cell.foreground ?? undefined);
    const background = cell.inverse
        ? (cell.foreground ?? DEFAULT_FOREGROUND)
        : (cell.background ?? undefined);
    return {
        marginLeft: gap > 0 ? `${gap}ch` : undefined,
        width: `${cell.width}ch`,
        color: foreground,
        background,
        fontWeight: cell.bold ? 600 : undefined,
        fontStyle: cell.italic ? "italic" : undefined,
        opacity: cell.dim ? 0.6 : undefined,
        textDecorationLine: underlineDecoration(cell),
    };
}

function underlineDecoration(cell: TerminalCellSnapshot): string | undefined {
    const parts = [cell.underline ? "underline" : "", cell.strikethrough ? "line-through" : ""]
        .filter(Boolean)
        .join(" ");
    return parts || undefined;
}

function statusLabel(props: TerminalPanelProps): string {
    if (props.error) return props.error;
    if (props.status === "exited") return `Exited ${props.exitCode ?? ""}`.trim();
    return props.status[0]!.toUpperCase() + props.status.slice(1);
}
