import { createStore, type StoreApi } from "zustand/vanilla";

export interface SetupDraftSnapshot {
    readonly defaultAgent: {
        readonly name: string;
        readonly username: string;
        readonly attempted: boolean;
    };
    readonly customImage: {
        readonly visible: boolean;
        readonly name: string;
        readonly dockerfile: string;
        readonly attempted: boolean;
    };
}

export interface SetupDraftState extends SetupDraftSnapshot {
    defaultAgentNameUpdate(value: string): void;
    defaultAgentUsernameUpdate(value: string): void;
    defaultAgentSubmitAttempt(): void;
    customImageVisibilityToggle(): void;
    customImageNameUpdate(value: string): void;
    customImageDockerfileUpdate(value: string): void;
    customImageSubmitAttempt(): void;
}

export type SetupDraftStore = StoreApi<SetupDraftState>;

export interface SetupDraftStoreOptions {
    readonly defaultAgent: {
        readonly name: string;
        readonly username: string;
    };
}

/**
 * Creates the setup form-draft surface. It keeps the default-agent and custom-image
 * inputs stable across authoritative setup reconciliation without opening transport
 * or persistence resources, and exists so React never mirrors those drafts locally.
 */
export function setupDraftStoreCreate(options: SetupDraftStoreOptions): SetupDraftStore {
    return createStore<SetupDraftState>()((set) => ({
        defaultAgent: {
            name: options.defaultAgent.name,
            username: options.defaultAgent.username,
            attempted: false,
        },
        customImage: {
            visible: false,
            name: "",
            dockerfile: "",
            attempted: false,
        },
        defaultAgentNameUpdate(value) {
            set((snapshot) => ({
                ...snapshot,
                defaultAgent: { ...snapshot.defaultAgent, name: value },
            }));
        },
        defaultAgentUsernameUpdate(value) {
            set((snapshot) => ({
                ...snapshot,
                defaultAgent: { ...snapshot.defaultAgent, username: value },
            }));
        },
        defaultAgentSubmitAttempt() {
            set((snapshot) => ({
                ...snapshot,
                defaultAgent: { ...snapshot.defaultAgent, attempted: true },
            }));
        },
        customImageVisibilityToggle() {
            set((snapshot) => ({
                ...snapshot,
                customImage: {
                    ...snapshot.customImage,
                    visible: !snapshot.customImage.visible,
                },
            }));
        },
        customImageNameUpdate(value) {
            set((snapshot) => ({
                ...snapshot,
                customImage: { ...snapshot.customImage, name: value },
            }));
        },
        customImageDockerfileUpdate(value) {
            set((snapshot) => ({
                ...snapshot,
                customImage: { ...snapshot.customImage, dockerfile: value },
            }));
        },
        customImageSubmitAttempt() {
            set((snapshot) => ({
                ...snapshot,
                customImage: { ...snapshot.customImage, attempted: true },
            }));
        },
    }));
}
