import { createGhosttyTerminal, type GhosttyTerminal } from "@slopus/ghostty-wasm/browser";
import type { GhosttyColor, GhosttyRow, GhosttySnapshot, GhosttyStyle } from "@slopus/ghostty-wasm";
import type { TerminalCellSnapshot, TerminalGridSnapshot, TerminalRowSnapshot } from "happy2-state";

/**
 * How many scrolled-off lines the render model carries. It is well under the
 * emulator's own retention, so what the user can scroll back to is bounded by a
 * number this code states rather than by however much Ghostty happens to hold.
 */
const HISTORY_MAX = 1000;
/**
 * Once Ghostty's buffer is full it evicts a line for every line it gains, so
 * absolute row indices shift under us and captured history stops extending on
 * its own — it has to be recaptured. That is the only costly path here, so it
 * runs at most this often.
 */
const HISTORY_REBUILD_INTERVAL_MS = 250;

/**
 * One live terminal emulator: it parses raw VT byte streams into the normalized
 * render model product state exposes. This is the app's WebAssembly-backed
 * browser integration, kept out of `happy2-state` so that package stays
 * framework- and runtime-neutral.
 */
export interface TerminalEmulator {
    write(data: Uint8Array): void;
    resize(cols: number, rows: number): void;
    snapshot(): TerminalGridSnapshot;
    dispose(): void;
}

/** Creates a Ghostty WebAssembly emulator sized to the initial grid. */
export async function ghosttyEmulatorCreate(cols: number, rows: number): Promise<TerminalEmulator> {
    const terminal = await createGhosttyTerminal({ cols, rows, colorScheme: "dark" });
    return new GhosttyTerminalEmulator(terminal);
}

/**
 * Ghostty keeps scrolled-off lines, but only ever hands back the rows the
 * viewport is currently over, so history has to be read out and accumulated
 * here. Reading the whole buffer on every frame of output is far too expensive,
 * so this captures only the lines that newly scrolled off since the last
 * snapshot and falls back to a throttled recapture in the two cases where
 * appending cannot be correct: a reflow, and an emulator buffer so full that it
 * is evicting.
 */
class GhosttyTerminalEmulator implements TerminalEmulator {
    /** Scrolled-off lines, oldest first, capped at `HISTORY_MAX`. */
    private history: readonly TerminalRowSnapshot[] = [];
    /** Absolute row index one past the last line captured into `history`. */
    private capturedEnd = 0;
    /** The last frame's top visible line, the signal that eviction is scrolling. */
    private topLine = "";
    private rebuiltAt = 0;
    /** A reflow invalidates every captured line, so the next snapshot recaptures. */
    private reflowed = false;

    constructor(private readonly terminal: GhosttyTerminal) {}

    write(data: Uint8Array): void {
        this.terminal.write(data);
    }

    resize(cols: number, rows: number): void {
        this.terminal.resize(cols, rows);
        this.reflowed = true;
    }

    snapshot(): TerminalGridSnapshot {
        const current = this.terminal.snapshot();
        const historyEnd = Math.max(0, current.totalRows - current.visibleRows);
        if (this.reflowed || historyEnd < this.capturedEnd) this.historyRebuild(historyEnd);
        else if (historyEnd > this.capturedEnd) this.historyExtend(historyEnd);
        else if (this.evicting(current)) this.historyRebuild(historyEnd);
        this.topLine = rowText(current.rows[0]);
        return ghosttySnapshotToGrid(current, this.history);
    }

    dispose(): void {
        this.terminal.dispose();
    }

    /**
     * Whether the buffer is full and shedding its oldest lines. While that is
     * happening the row count no longer grows, so the only remaining evidence
     * that lines are scrolling off is the top of the screen changing.
     */
    private evicting(current: GhosttySnapshot): boolean {
        if (this.capturedEnd === 0 || rowText(current.rows[0]) === this.topLine) return false;
        const now = Date.now();
        if (now - this.rebuiltAt < HISTORY_REBUILD_INTERVAL_MS) return false;
        this.rebuiltAt = now;
        return true;
    }

    /** Appends only the lines that scrolled off since the last capture. */
    private historyExtend(historyEnd: number): void {
        const page = this.terminal.snapshotPage(this.capturedEnd, historyEnd - this.capturedEnd);
        const added = rowsToSnapshots(page.rows, page.palette);
        const next = [...this.history, ...added];
        this.history = next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next;
        this.capturedEnd = historyEnd;
    }

    /** Re-reads the newest `HISTORY_MAX` scrolled-off lines from scratch. */
    private historyRebuild(historyEnd: number): void {
        const start = Math.max(0, historyEnd - HISTORY_MAX);
        const page = this.terminal.snapshotPage(start, historyEnd - start);
        this.history = rowsToSnapshots(page.rows, page.palette);
        this.capturedEnd = historyEnd;
        this.reflowed = false;
    }
}

/** The glyphs of one Ghostty row, used only to tell two frames' top lines apart. */
function rowText(row: GhosttyRow | undefined): string {
    return row ? row.cells.map((cell) => cell.text).join("") : "";
}

function ghosttySnapshotToGrid(
    snapshot: GhosttySnapshot,
    scrollback: readonly TerminalRowSnapshot[],
): TerminalGridSnapshot {
    return {
        cols: snapshot.cols,
        rows: snapshot.visibleRows,
        title: snapshot.title,
        cursor: snapshot.cursor
            ? { x: snapshot.cursor.x, y: snapshot.cursor.y, visible: snapshot.cursor.visible }
            : null,
        lines: rowsToSnapshots(snapshot.rows, snapshot.palette),
        scrollback,
    };
}

function rowsToSnapshots(
    rows: readonly GhosttyRow[],
    palette: readonly GhosttyColor[],
): readonly TerminalRowSnapshot[] {
    return rows.map((row) => ({
        cells: row.cells.map((cell): TerminalCellSnapshot => {
            const style = cell.style;
            return {
                x: cell.x,
                text: cell.text,
                width: cell.width,
                bold: style.bold,
                dim: style.dim,
                italic: style.italic,
                underline: style.underline !== "none",
                inverse: style.inverse,
                strikethrough: style.strikethrough,
                foreground: resolveColor(style.foreground, palette),
                background: resolveColor(style.background, palette),
            };
        }),
    }));
}

/** Resolves a Ghostty style color to a CSS color, or null for the theme default. */
function resolveColor(
    color: GhosttyStyle["foreground"],
    palette: readonly GhosttyColor[],
): string | null {
    if (!color) return null;
    if (color.kind === "rgb") return `rgb(${color.red} ${color.green} ${color.blue})`;
    const resolved = palette[color.index];
    if (resolved && resolved.kind === "rgb")
        return `rgb(${resolved.red} ${resolved.green} ${resolved.blue})`;
    return null;
}
