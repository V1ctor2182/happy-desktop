import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import { referencesPreserve, rigUserError } from "./rigSupport.js";

/** One host-owned human identity that can author work sent to a remote Rig. */
export interface RigProfile {
    readonly id: string;
    readonly name: string;
    readonly parentInstanceId: string;
    readonly version: number;
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly photo?: {
        readonly imageUrl: string;
        readonly width: number;
        readonly height: number;
        readonly thumbhash: string;
    };
}

export interface RigProfilesSource {
    subscribe(
        listener: (profiles: readonly RigProfile[]) => void,
        onError: (error: unknown) => void,
    ): () => void;
}

export interface RigProfilesActions {
    profileCreate(input: { readonly name: string }): Promise<RigProfile>;
    profileUpdate(profileId: string, input: { readonly name: string }): Promise<RigProfile>;
}

export interface RigProfileSelectionPersistence {
    read(): string | undefined;
    write(profileId: string | undefined): void;
}

export interface RigProfileEditorSnapshot {
    readonly mode: "create" | "edit";
    readonly profileId?: string;
    readonly name: string;
    readonly submitting: boolean;
    readonly error?: string;
}

export interface RigProfilesSnapshot {
    readonly profiles: readonly RigProfile[];
    readonly selectedProfileId?: string;
    readonly loading: boolean;
    readonly error?: UserError;
    readonly actionError?: string;
    readonly editor?: RigProfileEditorSnapshot;
}

export interface RigProfilesStore {
    get(): RigProfilesSnapshot;
    subscribe(listener: () => void): () => void;
    profileSelect(profileId: string): void;
    profileCreateOpen(): void;
    profileEditOpen(profileId: string): void;
    profileNameUpdate(value: string): void;
    profileEditorCancel(): void;
    profileEditorSubmit(): Promise<void>;
    [Symbol.dispose](): void;
}

export interface RigProfilesStoreDeps {
    readonly source: RigProfilesSource;
    readonly actions: RigProfilesActions;
    readonly selectionPersistence?: RigProfileSelectionPersistence;
}

/** Host-owned profiles, live for exactly as long as a surface is observing them. */
export function rigProfilesStoreCreate(deps: RigProfilesStoreDeps): RigProfilesStore {
    const persistedSelection = deps.selectionPersistence?.read();
    const store = createStore<RigProfilesSnapshot>()(() => ({
        profiles: [],
        loading: true,
        ...(persistedSelection === undefined ? {} : { selectedProfileId: persistedSelection }),
    }));
    const listeners = new Set<() => void>();
    let unsubscribeSource: (() => void) | undefined;
    let disposed = false;

    const selectionWrite = (profileId: string | undefined): void => {
        deps.selectionPersistence?.write(profileId);
    };

    const profilesInput = (profiles: readonly RigProfile[]): void => {
        if (disposed) return;
        const current = store.getState();
        const selectedStillExists =
            current.selectedProfileId !== undefined &&
            profiles.some(({ id }) => id === current.selectedProfileId);
        const selectedProfileId = selectedStillExists
            ? current.selectedProfileId
            : profiles.length === 1
              ? profiles[0]?.id
              : undefined;
        if (selectedProfileId !== current.selectedProfileId) selectionWrite(selectedProfileId);
        store.setState({
            ...current,
            profiles: referencesPreserve(current.profiles, profiles),
            selectedProfileId,
            loading: false,
            error: undefined,
        });
    };

    const profileInput = (profile: RigProfile): void => {
        const current = store.getState();
        const index = current.profiles.findIndex(({ id }) => id === profile.id);
        const profiles =
            index < 0
                ? [...current.profiles, profile]
                : current.profiles.map((candidate) =>
                      candidate.id === profile.id ? profile : candidate,
                  );
        profilesInput(profiles);
    };

    const start = (): void => {
        if (disposed || unsubscribeSource) return;
        unsubscribeSource = deps.source.subscribe(profilesInput, (error) => {
            if (disposed) return;
            store.setState({
                ...store.getState(),
                loading: false,
                error: rigUserError(error),
            });
        });
    };

    const stop = (): void => {
        unsubscribeSource?.();
        unsubscribeSource = undefined;
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            start();
            return () => {
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) stop();
            };
        },
        profileSelect(profileId) {
            const current = store.getState();
            if (!current.profiles.some(({ id }) => id === profileId)) return;
            selectionWrite(profileId);
            store.setState({
                ...current,
                selectedProfileId: profileId,
                actionError: undefined,
            });
        },
        profileCreateOpen() {
            store.setState({
                ...store.getState(),
                editor: { mode: "create", name: "", submitting: false },
            });
        },
        profileEditOpen(profileId) {
            const profile = store.getState().profiles.find(({ id }) => id === profileId);
            if (!profile) return;
            store.setState({
                ...store.getState(),
                editor: {
                    mode: "edit",
                    profileId,
                    name: profile.name,
                    submitting: false,
                },
            });
        },
        profileNameUpdate(value) {
            const current = store.getState();
            if (!current.editor || current.editor.submitting) return;
            store.setState({
                ...current,
                editor: { ...current.editor, name: value, error: undefined },
            });
        },
        profileEditorCancel() {
            const current = store.getState();
            if (!current.editor) return;
            store.setState({ ...current, editor: undefined });
        },
        async profileEditorSubmit() {
            const current = store.getState();
            const editor = current.editor;
            if (!editor || editor.submitting) return;
            const name = editor.name.trim();
            if (!name) {
                store.setState({
                    ...current,
                    editor: { ...editor, error: "Enter a name for this profile." },
                });
                return;
            }
            store.setState({
                ...current,
                editor: { ...editor, name, submitting: true, error: undefined },
            });
            try {
                const profile =
                    editor.mode === "create"
                        ? await deps.actions.profileCreate({ name })
                        : await deps.actions.profileUpdate(editor.profileId!, { name });
                if (disposed) return;
                profileInput(profile);
                const next = store.getState();
                const selectedProfileId =
                    editor.mode === "create" ? profile.id : next.selectedProfileId;
                if (editor.mode === "create") selectionWrite(profile.id);
                store.setState({
                    ...next,
                    selectedProfileId,
                    editor: undefined,
                    actionError: undefined,
                });
            } catch (error) {
                if (disposed) return;
                const next = store.getState();
                if (next.editor?.mode !== editor.mode) return;
                store.setState({
                    ...next,
                    editor: {
                        ...next.editor,
                        submitting: false,
                        error: rigUserError(error).message,
                    },
                });
            }
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            stop();
            listeners.clear();
        },
    };
}

const NO_PROFILES: RigProfilesSnapshot = { profiles: [], loading: false };

export const rigProfilesStoreNoop: RigProfilesStore = {
    get: () => NO_PROFILES,
    subscribe: () => () => undefined,
    profileSelect: () => undefined,
    profileCreateOpen: () => undefined,
    profileEditOpen: () => undefined,
    profileNameUpdate: () => undefined,
    profileEditorCancel: () => undefined,
    profileEditorSubmit: () => Promise.resolve(),
    [Symbol.dispose]: () => undefined,
};
