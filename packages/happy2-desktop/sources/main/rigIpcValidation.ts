// Renderer-input validation for the Rig installation terminal IPC. The rich Rig
// data connection no longer flows over IPC (the renderer reaches the daemon
// through the main process's HTTP proxy), so only the install-terminal input and
// size validators remain.

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

/**
 * The three Happy Cloud answers as the renderer sent them. They are validated
 * together because they are one decision the person made on one screen, and a
 * partial or renamed answer must be rejected rather than half-recorded.
 */
export function onboardingCloudChoiceValidate(value: unknown): {
    readonly joined: boolean;
    readonly mobileSessions: boolean;
    readonly remoteControl: boolean;
} {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof (value as Record<string, unknown>).joined !== "boolean" ||
        typeof (value as Record<string, unknown>).mobileSessions !== "boolean" ||
        typeof (value as Record<string, unknown>).remoteControl !== "boolean"
    )
        throw new Error("The Happy Cloud choice is invalid.");
    const choice = value as Record<string, boolean>;
    return {
        joined: choice.joined!,
        mobileSessions: choice.mobileSessions!,
        remoteControl: choice.remoteControl!,
    };
}
