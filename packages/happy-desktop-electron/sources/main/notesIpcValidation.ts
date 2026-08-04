// Renderer-input validation for the notes IPC. The renderer is trusted to author
// a note's content, but not to name a file, so every identity is checked against
// the store's opaque-id shape and every payload is bounded before it reaches disk.

import type { DesktopNoteApplyRequest } from "../shared/desktopContract";

const NOTE_TITLE_MAX_LENGTH = 200;
const NOTE_MARKDOWN_MAX_BYTES = 4 * 1024 * 1024;
const NOTE_UPDATE_MAX_LENGTH = 1_400_000;
const NOTE_UPDATES_MAX_COUNT = 64;

export function noteIdValidate(value: unknown): string {
    if (typeof value !== "string" || !/^[0-9a-f]{24}$/.test(value))
        throw new Error("The note identity is invalid.");
    return value;
}

export function noteTitleValidate(value: unknown): string {
    if (typeof value !== "string" || value.length > NOTE_TITLE_MAX_LENGTH)
        throw new Error("The note title is invalid.");
    return value;
}

export function noteTitleOptionalValidate(value: unknown): string | undefined {
    return value === undefined ? undefined : noteTitleValidate(value);
}

export function noteApplyRequestValidate(value: unknown): DesktopNoteApplyRequest {
    if (typeof value !== "object" || value === null)
        throw new Error("The note update request is invalid.");
    const request = value as Record<string, unknown>;
    const id = noteIdValidate(request.id);
    if (!Array.isArray(request.updates) || request.updates.length === 0)
        throw new Error("The note update request carries no updates.");
    if (request.updates.length > NOTE_UPDATES_MAX_COUNT)
        throw new Error("The note update request carries too many updates at once.");
    const updates = request.updates.map((update) => {
        // Base64 only: the store decodes these straight into Yjs, and a decoder
        // is a poor place to discover that the input was never an update at all.
        if (
            typeof update !== "string" ||
            update.length === 0 ||
            update.length > NOTE_UPDATE_MAX_LENGTH ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(update)
        )
            throw new Error("A note update is invalid.");
        return update;
    });
    const markdown = request.markdown;
    if (markdown !== undefined) {
        if (typeof markdown !== "string" || markdown.includes("\0"))
            throw new Error("The note Markdown is invalid.");
        if (Buffer.byteLength(markdown, "utf8") > NOTE_MARKDOWN_MAX_BYTES)
            throw new Error("The note Markdown is too large.");
    }
    return {
        id,
        updates,
        ...(markdown === undefined ? {} : { markdown }),
        ...(request.title === undefined ? {} : { title: noteTitleValidate(request.title) }),
    };
}
