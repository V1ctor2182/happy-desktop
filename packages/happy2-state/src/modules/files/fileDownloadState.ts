import { createStore, type StoreApi } from "zustand/vanilla";

export type FileDownloadSnapshot =
    | { readonly status: "idle" }
    | { readonly status: "downloading" }
    | { readonly status: "failed"; readonly message: string };

export type FileDownloadOutput = { readonly type: "fileDownloadRequested" };

export type FileDownloadInput =
    | { readonly type: "fileDownloadSucceeded" }
    | { readonly type: "fileDownloadFailed"; readonly message: string };

export interface FileDownloadState {
    readonly download: FileDownloadSnapshot;
    fileDownloadStart(): void;
    fileDownloadInput(event: FileDownloadInput): void;
}

export type FileDownloadStore = StoreApi<FileDownloadState>;

/**
 * Creates one file-overlay download surface. It owns only the visible in-flight
 * and failure state, emits the browser download request to its host, and accepts
 * completion through a private typed input so confirmed state is never fabricated.
 */
export function fileDownloadStoreCreate(
    output: (event: FileDownloadOutput) => void = () => undefined,
): FileDownloadStore {
    return createStore<FileDownloadState>()((set, get) => ({
        download: { status: "idle" },
        fileDownloadStart() {
            if (get().download.status === "downloading") return;
            set({ download: { status: "downloading" } });
            output({ type: "fileDownloadRequested" });
        },
        fileDownloadInput(event) {
            set({
                download:
                    event.type === "fileDownloadSucceeded"
                        ? { status: "idle" }
                        : { status: "failed", message: event.message },
            });
        },
    }));
}
