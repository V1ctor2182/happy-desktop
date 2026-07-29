import { useMemo, useSyncExternalStore } from "react";
import { Banner, FileAttachment, Modal, ModalOverlay, StoreSurface } from "happy2-ui";
import {
    fileDownloadStoreCreate,
    type FileDownloadStore,
    type FilesStore,
    type HappyState,
} from "happy2-state";
export interface DesktopFileOverlayProps {
    fileId: string;
    state: HappyState;
    onClose: () => void;
}
/** Hosts one route-addressable file card over the still-mounted primary surface. */
export function DesktopFileOverlay(props: DesktopFileOverlayProps) {
    const files = props.state.files();
    // Store identity follows the addressed file. Reusing it across ordinary
    // FilesStore notifications preserves the overlay's visible download state.
    const downloadStore = useMemo(
        () =>
            fileDownloadSurfaceCreate({
                fileId: props.fileId,
                files,
                state: props.state,
            }),
        [props.fileId, props.state, files],
    );
    const download = useSyncExternalStore(
        downloadStore.subscribe,
        downloadStore.getState,
        downloadStore.getInitialState,
    );
    return (
        <StoreSurface store={files}>
            {(snapshot) => {
                const file = () =>
                    snapshot.files.find((candidate) => candidate.id === props.fileId);
                return (
                    <ModalOverlay onDismiss={props.onClose}>
                        {/* The attachment row below carries the filename (it is the
                            download affordance), so the title names only the kind —
                            no duplicated filename in one small card. */}
                        <Modal
                            icon="doc"
                            onClose={props.onClose}
                            size="large"
                            title={kindTitle(file()?.kind)}
                        >
                            {download.download.status === "failed" ? (
                                <Banner tone="danger" title="Download failed">
                                    {download.download.message}
                                </Banner>
                            ) : null}
                            {download.download.status === "downloading" ? (
                                <Banner tone="info">Downloading the original file…</Banner>
                            ) : null}
                            <FileAttachment
                                kind={file()?.kind ?? "file"}
                                name={file()?.originalName ?? props.fileId}
                                onOpen={() => downloadStore.getState().fileDownloadStart()}
                                size={file() ? formatBytes(file()!.size) : undefined}
                                variant="chat"
                            />
                        </Modal>
                    </ModalOverlay>
                );
            }}
        </StoreSurface>
    );
}

function fileDownloadSurfaceCreate(options: {
    fileId: string;
    files: FilesStore;
    state: HappyState;
}): FileDownloadStore {
    let downloadStore: FileDownloadStore;
    downloadStore = fileDownloadStoreCreate(() => {
        void (async () => {
            try {
                const file = options.files
                    .getState()
                    .files.find((candidate) => candidate.id === options.fileId);
                const bytes = await options.state.fileDownload(options.fileId);
                const url = URL.createObjectURL(new Blob([bytes], { type: file?.contentType }));
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = file?.originalName ?? "download";
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                downloadStore.getState().fileDownloadInput({ type: "fileDownloadSucceeded" });
            } catch (error) {
                downloadStore.getState().fileDownloadInput({
                    type: "fileDownloadFailed",
                    message:
                        error instanceof Error
                            ? error.message
                            : "The file could not be downloaded.",
                });
            }
        })();
    });
    return downloadStore;
}
function kindTitle(kind?: string): string {
    switch (kind) {
        case "photo":
            return "Photo";
        case "video":
            return "Video";
        case "gif":
            return "GIF";
        default:
            return "File";
    }
}
function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
    return `${Math.round(size / (102.4 * 1024)) / 10} MB`;
}
