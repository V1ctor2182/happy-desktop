// Renderer-input validation for the Rig IPC that is left. The rich Rig data
// connection no longer flows over IPC (the renderer reaches the daemon through
// the main process's HTTP proxy), so what remains is the install terminal's
// input and size, and the address a browser tunnel is opened on.

import type { DesktopBrowserProxyTarget } from "../shared/desktopContract";
import { RIG_NODE_ID } from "./rigNodeRoute";

/**
 * The machine and session a browser tunnel is asked for.
 *
 * The machine is checked against the identity Rig itself accepts for a peer, so
 * a renderer cannot name one by a string the daemon would never have published
 * — and an absent machine means this window's own Rig, which is the only case
 * where nothing needs naming.
 */
export function desktopBrowserProxyTargetValidate(value: unknown): DesktopBrowserProxyTarget {
    if (typeof value !== "object" || value === null)
        throw new Error("The Rig browser target is invalid.");
    const target = value as { readonly nodeId?: unknown; readonly sessionId?: unknown };
    const sessionId = boundedString(target.sessionId, "The Rig browser session identity", 256);
    if (target.nodeId === undefined) return { sessionId };
    if (typeof target.nodeId !== "string" || !RIG_NODE_ID.test(target.nodeId))
        throw new Error("The Rig browser machine identity is invalid.");
    return { nodeId: target.nodeId, sessionId };
}

export function rigTerminalInputValidate(value: unknown): string {
    return boundedString(value, "Terminal input", 65_536, true);
}

export function rigTerminalSizeValidate(cols: unknown, rows: unknown) {
    return terminalSize(cols, rows);
}

function boundedString(value: unknown, label: string, maximum: number, empty = false): string {
    if (
        typeof value !== "string" ||
        (!empty && value.length === 0) ||
        value.length > maximum ||
        value.includes("\0")
    )
        throw new Error(`${label} is invalid.`);
    return value;
}

function terminalSize(cols: unknown, rows: unknown) {
    if (
        !Number.isSafeInteger(cols) ||
        !Number.isSafeInteger(rows) ||
        (cols as number) < 2 ||
        (cols as number) > 1000 ||
        (rows as number) < 1 ||
        (rows as number) > 1000
    )
        throw new Error("The Rig terminal size is invalid.");
    return { cols: cols as number, rows: rows as number };
}
