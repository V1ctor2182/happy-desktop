import { describe, expect, it } from "vitest";
import {
    noteApplyRequestValidate,
    noteIdValidate,
    noteTitleOptionalValidate,
} from "./notesIpcValidation";

const id = "0123456789abcdef01234567";

describe("notes IPC validation", () => {
    it("accepts only the store's opaque id shape, because an id becomes a filename", () => {
        expect(noteIdValidate(id)).toBe(id);
        for (const rejected of ["", "../escape", `${id}x`, "0123456789ABCDEF01234567", 7, null])
            expect(() => noteIdValidate(rejected)).toThrow();
    });

    it("takes an apply request apart and rejects anything the store would have to guess about", () => {
        expect(noteApplyRequestValidate({ id, updates: ["AQID"], markdown: "# Note\n" })).toEqual({
            id,
            updates: ["AQID"],
            markdown: "# Note\n",
        });
        expect(noteApplyRequestValidate({ id, updates: ["AQID"], title: "Plan" }).title).toBe(
            "Plan",
        );

        expect(() => noteApplyRequestValidate({ id, updates: [] })).toThrow();
        expect(() =>
            noteApplyRequestValidate({ id, updates: Array.from({ length: 65 }, () => "AQID") }),
        ).toThrow();
        // Not base64: the store decodes these straight into Yjs.
        expect(() => noteApplyRequestValidate({ id, updates: ["not base64!"] })).toThrow();
        expect(() =>
            noteApplyRequestValidate({ id, updates: ["AQID"], markdown: "a\0b" }),
        ).toThrow();
        expect(() => noteApplyRequestValidate({ id: "nope", updates: ["AQID"] })).toThrow();
        expect(() => noteApplyRequestValidate(undefined)).toThrow();
    });

    it("leaves an absent title absent rather than inventing an empty one", () => {
        expect(noteTitleOptionalValidate(undefined)).toBeUndefined();
        expect(noteTitleOptionalValidate("")).toBe("");
        expect(() => noteTitleOptionalValidate("x".repeat(201))).toThrow();
    });
});
