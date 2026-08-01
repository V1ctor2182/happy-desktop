import { createStore } from "zustand/vanilla";
import type { Loadable } from "../conversation/loadable.js";
import type { UserError } from "../types.js";
import type { RigTransport } from "./rigTransport.js";
import { rigUserError } from "./rigSupport.js";

/**
 * How much text one Rig will keep as its global instructions. The daemon is the
 * authority and refuses anything larger in its own words; knowing the same
 * number here is only so an editor can say how much room is left before
 * someone runs out of it.
 */
export const RIG_INSTRUCTIONS_MAX_BYTES = 32 * 1024;

export interface RigInstructionsSnapshot {
    /** The instructions as this Rig last confirmed them. */
    readonly stored: Loadable<string>;
    /** What the editor holds. It follows `stored` until someone types. */
    readonly draft: string;
    /** The draft says something the Rig has not been told yet. */
    readonly dirty: boolean;
    /** How many bytes the draft would occupy, against `RIG_INSTRUCTIONS_MAX_BYTES`. */
    readonly bytes: number;
    /** A write is in flight. */
    readonly saving: boolean;
    /** Why the last write was refused. Cleared by the next edit or attempt. */
    readonly saveError?: UserError;
}

/**
 * The one Rig-wide `AGENTS.md`, as an editor reads and writes it.
 *
 * Loading is a consequence of being watched rather than something a surface
 * asks for: the first subscriber starts the read, so a settings window that is
 * never opened never touches the daemon and one that is opened twice reads once.
 */
export interface RigInstructionsStore {
    get(): RigInstructionsSnapshot;
    subscribe(listener: () => void): () => void;
    /** Types into the draft without telling the Rig anything yet. */
    draftUpdate(text: string): void;
    /** Sends the draft; the Rig's own answer becomes what is stored. */
    save(): void;
    /** Throws the draft away and returns to what the Rig holds. */
    revert(): void;
    [Symbol.dispose](): void;
}

export interface RigInstructionsStoreDeps {
    readonly transport: Pick<RigTransport, "globalInstructionsRead" | "globalInstructionsWrite">;
}

const EMPTY: RigInstructionsSnapshot = {
    stored: { type: "unloaded" },
    draft: "",
    dirty: false,
    bytes: 0,
    saving: false,
};

function byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}

export function rigInstructionsStoreCreate(deps: RigInstructionsStoreDeps): RigInstructionsStore {
    const store = createStore<RigInstructionsSnapshot>()(() => EMPTY);
    let disposed = false;
    let controller: AbortController | undefined;

    /**
     * Reconciles the draft against text the Rig has just confirmed. Someone who
     * typed while the read or the write was in flight keeps what they typed —
     * losing it would be the one unrecoverable thing this surface could do — so
     * the confirmed text only takes the draft over when there is nothing to lose.
     */
    const settle = (instructions: string): void => {
        const state = store.getState();
        const draft = state.dirty ? state.draft : instructions;
        store.setState(
            {
                stored: { type: "ready", value: instructions },
                draft,
                dirty: draft !== instructions,
                bytes: byteLength(draft),
                saving: false,
            },
            true,
        );
    };

    const load = (): void => {
        if (disposed || store.getState().stored.type !== "unloaded") return;
        store.setState({ stored: { type: "loading" } }, false);
        controller = new AbortController();
        void deps.transport.globalInstructionsRead(controller.signal).then(
            (instructions) => {
                if (disposed) return;
                settle(instructions);
            },
            (error: unknown) => {
                if (disposed || controller?.signal.aborted) return;
                store.setState({ stored: { type: "error", error: rigUserError(error) } }, false);
            },
        );
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            const unsubscribe = store.subscribe(listener);
            load();
            return unsubscribe;
        },
        draftUpdate(text) {
            const state = store.getState();
            if (state.draft === text) return;
            const stored = state.stored.type === "ready" ? state.stored.value : undefined;
            const { saveError: _cleared, ...rest } = state;
            store.setState(
                {
                    ...rest,
                    draft: text,
                    dirty: stored === undefined || text !== stored,
                    bytes: byteLength(text),
                },
                true,
            );
        },
        save() {
            const state = store.getState();
            // Text past the limit is still sent: the Rig is the authority on
            // what it will keep, and its refusal says so in words the editor can
            // show. Refusing here instead would be a Save button that has
            // silently stopped working.
            if (disposed || state.saving || !state.dirty) return;
            const { saveError: _cleared, ...rest } = state;
            store.setState({ ...rest, saving: true }, true);
            const sent = state.draft;
            void deps.transport.globalInstructionsWrite(sent).then(
                (instructions) => {
                    if (disposed) return;
                    // What comes back is what the Rig kept, and the draft that
                    // produced it is no longer unsaved even if someone has typed
                    // past it since.
                    const current = store.getState();
                    const draft = current.draft === sent ? instructions : current.draft;
                    store.setState(
                        {
                            stored: { type: "ready", value: instructions },
                            draft,
                            dirty: draft !== instructions,
                            bytes: byteLength(draft),
                            saving: false,
                        },
                        true,
                    );
                },
                (error: unknown) => {
                    if (disposed) return;
                    store.setState({ saving: false, saveError: rigUserError(error) }, false);
                },
            );
        },
        revert() {
            const state = store.getState();
            if (state.stored.type !== "ready") return;
            const { saveError: _cleared, ...rest } = state;
            store.setState(
                {
                    ...rest,
                    draft: state.stored.value,
                    dirty: false,
                    bytes: byteLength(state.stored.value),
                },
                true,
            );
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            controller?.abort();
            controller = undefined;
        },
    };
}
