import {
    useEffectEvent,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ClipboardEvent,
    type CompositionEvent,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
} from "react";
import type { TerminalGridSnapshot, TerminalRowSnapshot } from "happy2-state";
import { Button } from "./Button";
import { TerminalPanelRenderer } from "./terminalPanelRenderer";

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
    /** Opens an http/https URL detected under the pointer in the terminal grid. */
    onOpenLink?(url: string): void;
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
const ESCAPE = "\x1b";
const NORMAL_KEYS: Readonly<Record<string, string>> = {
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
};
const APPLICATION_KEYS: Readonly<Record<string, string>> = {
    ArrowUp: "\x1bOA",
    ArrowDown: "\x1bOB",
    ArrowRight: "\x1bOC",
    ArrowLeft: "\x1bOD",
    Home: "\x1bOH",
    End: "\x1bOF",
};
const FIXED_KEYS: Readonly<Record<string, string>> = {
    Enter: "\r",
    Backspace: "\x7f",
    Tab: "\t",
    Escape: "\x1b",
    Insert: "\x1b[2~",
    Delete: "\x1b[3~",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
    F1: "\x1bOP",
    F2: "\x1bOQ",
    F3: "\x1bOR",
    F4: "\x1bOS",
    F5: "\x1b[15~",
    F6: "\x1b[17~",
    F7: "\x1b[18~",
    F8: "\x1b[19~",
    F9: "\x1b[20~",
    F10: "\x1b[21~",
    F11: "\x1b[23~",
    F12: "\x1b[24~",
};

export function TerminalPanel(props: TerminalPanelProps) {
    const screen = useRef<HTMLDivElement>(null);
    const rows = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const renderer = useRef<TerminalPanelRenderer | undefined>(undefined);
    const drag = useRef<{ startHeight: number; startY: number } | undefined>(undefined);
    const linkedCells = useRef<HTMLElement[]>([]);
    const composing = useRef(false);
    const previousScrollbackCount = useRef(0);
    const previousScrollbackTail = useRef<TerminalRowSnapshot | undefined>(undefined);
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

    // WTerm gives one imperative renderer ownership of the grid DOM. Keeping it
    // alive for this screen lifetime preserves row nodes, selection, and scroll
    // anchors while terminal snapshots continue to arrive through React props.
    // eslint-disable-next-line happy2-react/no-layout-effect -- an imperative terminal renderer owns the children of this stable host
    useLayoutEffect(() => {
        const element = rows.current;
        if (!element) return;
        const next = new TerminalPanelRenderer(element);
        renderer.current = next;
        return () => {
            next.destroy();
            if (renderer.current === next) renderer.current = undefined;
        };
    }, [collapsed]);
    // eslint-disable-next-line happy2-react/no-layout-effect -- apply the immutable grid snapshot to the imperative terminal renderer before paint
    useLayoutEffect(() => {
        renderer.current?.render(props.grid);
    }, [collapsed, props.grid]);
    // Scroll position is live browser state. Match WTerm's follow-at-bottom
    // behavior and the product contract that newly advancing scrollback returns
    // the user to current output.
    // eslint-disable-next-line happy2-react/no-layout-effect -- restore the terminal scroll offset after the grid DOM changes
    useLayoutEffect(() => {
        const element = screen.current;
        const scrollback = props.grid?.scrollback ?? [];
        const tail = scrollback.at(-1);
        const advanced =
            scrollback.length > previousScrollbackCount.current ||
            (scrollback.length > 0 && tail !== previousScrollbackTail.current);
        previousScrollbackCount.current = scrollback.length;
        previousScrollbackTail.current = tail;
        if (!element) return;
        if (following.current || advanced) screenScrollToBottom();
        else if (element.scrollHeight <= element.clientHeight) {
            element.scrollTop = 0;
            following.current = true;
        }
    }, [collapsed, props.grid]);

    function screenScrollToBottom() {
        const element = screen.current;
        if (!element) return;
        following.current = true;
        element.scrollTop = element.scrollHeight;
    }
    function screenScroll() {
        const element = screen.current;
        if (!element) return;
        // A scroll that lands within one row of the end is still "at the bottom",
        // so fractional layout and a trackpad's last pixel do not silently stop
        // the terminal from following its output.
        following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= CELL_HEIGHT;
    }
    function inputSend(data: string) {
        if (!data) return;
        // Typing always returns to the live prompt, matching native terminals and
        // WTerm even when the user had been reading older history.
        screenScrollToBottom();
        props.onInput(data);
    }
    function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (composing.current || event.nativeEvent.isComposing) return;
        const key = event.key.toLowerCase();
        if ((event.metaKey || event.ctrlKey) && key === "c") {
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed) return;
        }
        // Let the browser produce a paste event so clipboard text can be wrapped
        // according to the terminal's current bracketed-paste mode.
        if ((event.metaKey || event.ctrlKey) && key === "v") return;
        if (event.metaKey && !event.ctrlKey) {
            if (event.key === "Backspace") {
                event.preventDefault();
                event.stopPropagation();
                inputSend("\x15");
            } else if (key === "a") {
                event.preventDefault();
                event.stopPropagation();
                const selection = window.getSelection();
                const element = rows.current;
                if (selection && element) {
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }
            return;
        }
        // WTerm handles printable input on keydown as well as control keys. This
        // avoids relying on an `input` event from an invisible textarea, which
        // Electron does not reliably emit for every raw-mode CLI interaction.
        event.preventDefault();
        event.stopPropagation();
        const sequence = terminalKeySequence(
            event,
            props.grid?.inputModes?.cursorKeysApplication === true,
        );
        if (sequence) inputSend(sequence);
    }
    function inputPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
        event.preventDefault();
        event.stopPropagation();
        const text = event.clipboardData.getData("text");
        if (!text) return;
        if (props.grid?.inputModes?.bracketedPaste) {
            // Clipboard content cannot be allowed to inject the closing marker.
            inputSend(`\x1b[200~${text.split(ESCAPE).join("")}\x1b[201~`);
        } else {
            inputSend(text);
        }
    }
    function compositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
        composing.current = false;
        if (event.data) inputSend(event.data);
        event.currentTarget.value = "";
    }
    function inputFallback(event: React.FormEvent<HTMLTextAreaElement>) {
        if (composing.current) return;
        const value = event.currentTarget.value;
        if (value) {
            inputSend(value);
            event.currentTarget.value = "";
        }
    }
    function screenFocus() {
        // A terminal click returns keyboard capture unless the user has an
        // active grid selection they may be copying. This mirrors native
        // terminal selection behavior instead of cancelling the click early.
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) input.current?.focus({ preventScroll: true });
    }
    function screenClick(event: MouseEvent<HTMLDivElement>) {
        const link = terminalLinkAt(event.target);
        const selection = window.getSelection();
        if (link && (!selection || selection.isCollapsed)) {
            props.onOpenLink?.(link.url);
            return;
        }
        screenFocus();
    }
    function linkHover(event: PointerEvent<HTMLDivElement>) {
        for (const cell of linkedCells.current) delete cell.dataset.terminalLink;
        linkedCells.current = [];
        const link = terminalLinkAt(event.target);
        if (!link || !props.onOpenLink) return;
        linkedCells.current = link.cells;
        for (const cell of link.cells) cell.dataset.terminalLink = "";
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
                    onClick={screenClick}
                    onCopy={terminalSelectionCopy}
                    onKeyDown={(event) => {
                        if (
                            event.target === event.currentTarget &&
                            (event.key === "Enter" || event.key === " ")
                        ) {
                            event.preventDefault();
                            screenFocus();
                        }
                    }}
                    onPointerLeave={() => {
                        for (const cell of linkedCells.current) delete cell.dataset.terminalLink;
                        linkedCells.current = [];
                    }}
                    onPointerMove={linkHover}
                    onScroll={screenScroll}
                    ref={screen}
                    role="application"
                    tabIndex={-1}
                >
                    <div
                        className="happy2-terminal-panel__rows"
                        data-happy2-ui="terminal-rows"
                        ref={rows}
                    />
                    {cursor?.visible ? (
                        <div
                            aria-hidden
                            className="happy2-terminal-panel__cursor"
                            data-happy2-ui="terminal-cursor"
                            style={{
                                // Offset by the rows wrapper padding so cell
                                // coordinates align with painted glyphs, and past
                                // history, which the screen-relative row excludes.
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
                    <textarea
                        aria-label="Terminal input"
                        autoCapitalize="off"
                        autoComplete="off"
                        className="happy2-terminal-panel__input"
                        enterKeyHint="send"
                        /* `input` is the browser's text-entry event. Keeping the
                           terminal's byte forwarding on it provides the IME and
                           accessibility fallback after keydown handles ordinary
                           terminal keys directly, following WTerm. */
                        onCompositionEnd={compositionEnd}
                        onCompositionStart={() => (composing.current = true)}
                        onInput={inputFallback}
                        onKeyDown={keyDown}
                        onBlur={() => focusedSet(false)}
                        onFocus={() => focusedSet(true)}
                        onPaste={inputPaste}
                        ref={input}
                        spellCheck={false}
                    />
                </div>
            )}
        </section>
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

interface TerminalLink {
    readonly cells: HTMLElement[];
    readonly url: string;
}

/** Resolves the web URL occupying the terminal cell under one pointer event. */
function terminalLinkAt(target: EventTarget): TerminalLink | undefined {
    if (!(target instanceof Element)) return undefined;
    const cell = target.closest<HTMLElement>(".happy2-terminal-panel__cell");
    const row = cell?.closest<HTMLElement>(".happy2-terminal-panel__row");
    if (!cell || !row) return undefined;
    const explicitUrl = terminalWebUrl(cell.dataset.hyperlink);
    if (explicitUrl) {
        return {
            url: explicitUrl,
            cells: [...row.querySelectorAll<HTMLElement>(".happy2-terminal-panel__cell")].filter(
                (candidate) => terminalWebUrl(candidate.dataset.hyperlink) === explicitUrl,
            ),
        };
    }
    const column = Number(cell.dataset.column);
    if (!Number.isFinite(column)) return undefined;
    const cells = [...row.querySelectorAll<HTMLElement>(".happy2-terminal-panel__cell")];
    const characters: string[] = [];
    for (const candidate of cells) {
        const start = Number(candidate.dataset.column);
        if (!Number.isFinite(start)) continue;
        const text = candidate.textContent ?? "";
        for (const [offset, character] of [...text].entries())
            characters[start + offset] = character;
    }
    const text = Array.from(
        { length: characters.length },
        (_unused, index) => characters[index] ?? " ",
    ).join("");
    for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"']+/giu)) {
        const raw = match[0];
        const url = raw.replace(/[),.;:!?}\]]+$/u, "");
        const start = match.index;
        const end = start + url.length;
        if (column < start || column >= end) continue;
        return {
            url,
            cells: cells.filter((candidate) => {
                const candidateStart = Number(candidate.dataset.column);
                const candidateWidth = Number(candidate.dataset.width);
                return candidateStart < end && candidateStart + candidateWidth > start;
            }),
        };
    }
    return undefined;
}

function terminalWebUrl(candidate: string | undefined): string | undefined {
    if (!candidate) return undefined;
    try {
        const url = new URL(candidate);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

/** Converts one browser key event using WTerm's VT input mapping. */
function terminalKeySequence(
    event: KeyboardEvent<HTMLTextAreaElement>,
    cursorKeysApplication: boolean,
): string | undefined {
    if (event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.key.length === 1) {
            const code = event.key.toLowerCase().charCodeAt(0);
            if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
        }
        if (event.key === "[") return "\x1b";
        if (event.key === "\\") return "\x1c";
        if (event.key === "]") return "\x1d";
        if (event.key === "^") return "\x1e";
        if (event.key === "_") return "\x1f";
    }
    if (event.key === "Enter" && event.shiftKey) return "\x1b[13;2u";
    if (event.key === "Tab" && event.shiftKey) return "\x1b[Z";
    const fixed = FIXED_KEYS[event.key];
    if (fixed) return event.altKey ? `\x1b${fixed}` : fixed;
    const navigation = (cursorKeysApplication ? APPLICATION_KEYS : NORMAL_KEYS)[event.key];
    if (navigation) return event.altKey ? `\x1b${navigation}` : navigation;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey)
        return event.altKey ? `\x1b${event.key}` : event.key;
    return undefined;
}

function statusLabel(props: TerminalPanelProps): string {
    if (props.error) return props.error;
    if (props.status === "exited") return `Exited ${props.exitCode ?? ""}`.trim();
    return props.status[0]!.toUpperCase() + props.status.slice(1);
}
