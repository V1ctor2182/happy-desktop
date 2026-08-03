import { contextBridge, ipcRenderer } from "electron";
import {
    buildIdentityArgument,
    desktopIpc,
    mediaPreviewArgument,
    type DesktopBrowserStatus,
    type DesktopPreviewNavigation,
    type DesktopBuildIdentity,
    type DesktopMediaPreview,
    type DesktopNoteApplyRequest,
    type DesktopPluginAppRequest,
    type DesktopPluginCatalog,
    type DesktopPluginInventory,
    type DesktopPluginInventoryFrame,
    type DesktopRuntimeSnapshot,
    type DesktopStartRequest,
    type DesktopWindowState,
    type HappyDesktopBridge,
    type HappyMediaPreviewBridge,
    type RemoteRigSnapshot,
    type RigInstallTerminalEvent,
} from "../shared/desktopContract";

/**
 * The development identity main launched this window with. A packaged build
 * passes none, and anything unparseable is treated as none: an identity is a
 * label on a window, never something the renderer should fail over.
 */
function buildIdentityRead(): DesktopBuildIdentity | undefined {
    const argument = process.argv.find((value) => value.startsWith(buildIdentityArgument));
    if (!argument) return undefined;
    try {
        return JSON.parse(argument.slice(buildIdentityArgument.length)) as DesktopBuildIdentity;
    } catch {
        return undefined;
    }
}

const identity = buildIdentityRead();

/**
 * The readers of what is installed in this window, and the projection the main
 * process is running for them.
 *
 * Following is reference-counted here because the main process should be told
 * about this window once, not once per screen that happens to be reading. The
 * first reader opens a projection and takes the reading as it stands from the
 * same call that opened it — there is no gap between the two in which a change
 * could be missed. The last one to leave closes it again, so a window that
 * navigates away from the catalog stops costing anything.
 *
 * Every reader is its own record rather than its function, so the same function
 * subscribed twice is two readers with two independent releases, and releasing
 * one does not silently release the other.
 */
interface InventoryReader {
    readonly listen: (inventory: DesktopPluginInventory) => void;
    /** The projection this reader joined, which is what its release names. */
    readonly token: string;
}
const inventoryReaders = new Set<InventoryReader>();
let inventoryReceive:
    | ((event: Electron.IpcRendererEvent, frame: DesktopPluginInventoryFrame) => void)
    | undefined;
/**
 * The projection this window is currently on, or nothing when it is on none.
 *
 * A message already handed to the channel is delivered whatever has happened
 * since, so a reading sent for a projection this window has left still arrives,
 * and it arrives looking exactly like a current one. Naming the projection is
 * what tells the two apart: main puts this name on every reading and on every
 * opening answer, and anything wearing another name is not about the projection
 * anybody here is reading. Without it a queued reading from a closed projection
 * would count as the newest thing this window had been told, and the answer the
 * new reader is waiting for would be discarded as older than it.
 */
let inventoryToken: string | undefined;
let inventoryTokenNext = 0;
/**
 * How many readings this window has been told, under the projection it is on. A
 * follow's answer is the state as it was when the answer was made and travels
 * back across a process boundary, so a reading can overtake it. Comparing this
 * against what it was when the follow was asked is how an overtaken answer is
 * recognized — applying it would roll the reader back to an older reading and
 * leave them there until the machine happened to change again.
 */
let inventoryRevision = 0;

function inventoryTokenCreate(): string {
    inventoryTokenNext += 1;
    return `${String(inventoryTokenNext)}.${Math.random().toString(36).slice(2)}`;
}

function pluginInventoryFollow(listener: (inventory: DesktopPluginInventory) => void): () => void {
    if (inventoryReaders.size === 0) {
        inventoryToken = inventoryTokenCreate();
        inventoryReceive = (_event, frame) => {
            if (frame.token !== inventoryToken) return;
            inventoryRevision += 1;
            // A copy, because a reader is free to stop as it is being told.
            const told = Array.from(inventoryReaders);
            for (const each of told) if (inventoryReaders.has(each)) each.listen(frame.inventory);
        };
        ipcRenderer.on(desktopIpc.pluginInventoryChanged, inventoryReceive);
    }
    const token = inventoryToken ?? inventoryTokenCreate();
    const reader: InventoryReader = { listen: listener, token };
    inventoryReaders.add(reader);
    /*
     * Every reader asks for the opening reading itself, and is the only one told
     * the answer. The listener above is already installed by the time the ask
     * goes out, so a reader who is not told this answer has not missed anything:
     * they were told something newer instead, which is exactly what the guards
     * below are for.
     */
    const revision = inventoryRevision;
    void ipcRenderer
        .invoke(desktopIpc.pluginInventoryFollow, token)
        .then((frame: DesktopPluginInventoryFrame) => {
            if (frame.token !== token || token !== inventoryToken) return;
            if (revision !== inventoryRevision) return;
            if (!inventoryReaders.has(reader)) return;
            reader.listen(frame.inventory);
        });
    let released = false;
    return () => {
        if (released) return;
        released = true;
        inventoryReaders.delete(reader);
        // Named with the projection this reader was on, so a release that arrives
        // late cannot be counted against, or close, a projection opened since.
        void ipcRenderer.invoke(desktopIpc.pluginInventoryUnfollow, reader.token);
        if (inventoryReaders.size > 0 || !inventoryReceive) return;
        ipcRenderer.removeListener(desktopIpc.pluginInventoryChanged, inventoryReceive);
        inventoryReceive = undefined;
        inventoryToken = undefined;
    };
}

const bridge: HappyDesktopBridge = {
    ...(identity ? { buildIdentity: identity } : {}),
    appearanceSet: (mode) => ipcRenderer.send(desktopIpc.appearanceSet, mode),
    browserProxyApply: (sessionId) => ipcRenderer.invoke(desktopIpc.browserProxyApply, sessionId),
    browserOpenSubscribe(listener: (url: string) => void) {
        const receive = (_event: Electron.IpcRendererEvent, url: string) => listener(url);
        ipcRenderer.on(desktopIpc.browserOpenRequested, receive);
        return () => ipcRenderer.removeListener(desktopIpc.browserOpenRequested, receive);
    },
    browserStatusSubscribe(listener: (status: DesktopBrowserStatus) => void) {
        const receive = (_event: Electron.IpcRendererEvent, status: DesktopBrowserStatus) =>
            listener(status);
        ipcRenderer.on(desktopIpc.browserStatusChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.browserStatusChanged, receive);
    },
    previewNavigationSubscribe(listener: (step: DesktopPreviewNavigation) => void) {
        const receive = (_event: Electron.IpcRendererEvent, step: DesktopPreviewNavigation) =>
            listener(step);
        ipcRenderer.on(desktopIpc.previewNavigationChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.previewNavigationChanged, receive);
    },
    pluginApplicationsGet: () => ipcRenderer.invoke(desktopIpc.pluginApplicationsGet),
    pluginAppRequest: (origin: string, requestId: string, request: DesktopPluginAppRequest) =>
        ipcRenderer.invoke(desktopIpc.pluginAppRequest, { origin, request, requestId }),
    pluginAppCancel: (origin: string, requestId: string) =>
        ipcRenderer.invoke(desktopIpc.pluginAppCancel, { origin, requestId }),
    pluginApplicationsSubscribe(listener: (catalog: DesktopPluginCatalog) => void) {
        const receive = (_event: Electron.IpcRendererEvent, catalog: DesktopPluginCatalog) =>
            listener(catalog);
        ipcRenderer.on(desktopIpc.pluginApplicationsChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.pluginApplicationsChanged, receive);
    },
    pluginInventorySubscribe(listener: (inventory: DesktopPluginInventory) => void) {
        return pluginInventoryFollow(listener);
    },
    // `send`, not `invoke`: the shell has nothing to answer, and a badge that
    // made the window await the operating system would be a worse badge.
    dockUnreadSet: (count: number) => ipcRenderer.send(desktopIpc.dockUnreadSet, count),
    mediaPreviewOpen: (url: string) => ipcRenderer.invoke(desktopIpc.mediaPreviewOpen, url),
    directoryPick: () => ipcRenderer.invoke(desktopIpc.directoryPick),
    desktopConfigGet: () => ipcRenderer.invoke(desktopIpc.desktopConfigGet),
    desktopConfigWrite: (config) => ipcRenderer.invoke(desktopIpc.desktopConfigWrite, config),
    applicationMenuOpen: () => ipcRenderer.invoke(desktopIpc.applicationMenuOpen),
    noteApply: (request: DesktopNoteApplyRequest) =>
        ipcRenderer.invoke(desktopIpc.noteApply, request),
    noteCreate: (title) => ipcRenderer.invoke(desktopIpc.noteCreate, title),
    noteRead: (id) => ipcRenderer.invoke(desktopIpc.noteRead, id),
    noteRemove: (id) => ipcRenderer.invoke(desktopIpc.noteRemove, id),
    noteRename: (id, title) => ipcRenderer.invoke(desktopIpc.noteRename, id, title),
    notesList: () => ipcRenderer.invoke(desktopIpc.notesList),
    notesSubscribe(listener: () => void) {
        const receive = () => listener();
        ipcRenderer.on(desktopIpc.notesChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.notesChanged, receive);
    },
    remoteRigAdd: (request) => ipcRenderer.invoke(desktopIpc.remoteRigAdd, request),
    remoteRigConnect: (id) => ipcRenderer.invoke(desktopIpc.remoteRigConnect, id),
    remoteRigDisconnect: (id) => ipcRenderer.invoke(desktopIpc.remoteRigDisconnect, id),
    remoteRigGet: () => ipcRenderer.invoke(desktopIpc.remoteRigGet),
    remoteRigRemove: (id) => ipcRenderer.invoke(desktopIpc.remoteRigRemove, id),
    remoteRigSubscribe(listener: (rigs: readonly RemoteRigSnapshot[]) => void) {
        const receive = (_event: Electron.IpcRendererEvent, rigs: readonly RemoteRigSnapshot[]) =>
            listener(rigs);
        ipcRenderer.on(desktopIpc.remoteRigChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.remoteRigChanged, receive);
    },
    runtimeGet: () => ipcRenderer.invoke(desktopIpc.runtimeGet),
    runtimeReset: () => ipcRenderer.invoke(desktopIpc.runtimeReset),
    runtimeRetry: () => ipcRenderer.invoke(desktopIpc.runtimeRetry),
    runtimeStart: (request: DesktopStartRequest) =>
        ipcRenderer.invoke(desktopIpc.runtimeStart, request),
    rigInstallOpen: () => ipcRenderer.invoke(desktopIpc.rigInstallOpen),
    rigInstallConfirm: (terminalId, cols, rows) =>
        ipcRenderer.invoke(desktopIpc.rigInstallConfirm, terminalId, cols, rows),
    rigInstallInput: (terminalId, data) =>
        ipcRenderer.invoke(desktopIpc.rigInstallInput, terminalId, data),
    rigInstallResize: (terminalId, cols, rows) =>
        ipcRenderer.invoke(desktopIpc.rigInstallResize, terminalId, cols, rows),
    rigInstallClose: (terminalId) => ipcRenderer.invoke(desktopIpc.rigInstallClose, terminalId),
    topologySelect: (topologyId) => ipcRenderer.invoke(desktopIpc.topologySelect, topologyId),
    updateInstall: () => ipcRenderer.invoke(desktopIpc.updateInstall),
    windowStateGet: () => ipcRenderer.invoke(desktopIpc.windowStateGet),
    windowStateSubscribe(listener: (state: DesktopWindowState) => void) {
        const receive = (_event: Electron.IpcRendererEvent, state: DesktopWindowState) =>
            listener(state);
        ipcRenderer.on(desktopIpc.windowStateChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.windowStateChanged, receive);
    },
    subscribe(listener: (snapshot: DesktopRuntimeSnapshot) => void) {
        const receive = (_event: Electron.IpcRendererEvent, snapshot: DesktopRuntimeSnapshot) =>
            listener(snapshot);
        ipcRenderer.on(desktopIpc.runtimeChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.runtimeChanged, receive);
    },
    rigInstallSubscribe(listener: (event: RigInstallTerminalEvent) => void) {
        const receive = (_event: Electron.IpcRendererEvent, event: RigInstallTerminalEvent) =>
            listener(event);
        ipcRenderer.on(desktopIpc.rigInstallEvent, receive);
        return () => ipcRenderer.removeListener(desktopIpc.rigInstallEvent, receive);
    },
};

const mediaPreview: HappyMediaPreviewBridge = {
    mediaPreviewGet: () => ipcRenderer.invoke(desktopIpc.mediaPreviewGet),
    mediaPreviewClose: () => ipcRenderer.invoke(desktopIpc.mediaPreviewClose),
    mediaPreviewSubscribe(listener: (preview: DesktopMediaPreview | undefined) => void) {
        const receive = (
            _event: Electron.IpcRendererEvent,
            preview: DesktopMediaPreview | undefined,
        ) => listener(preview);
        ipcRenderer.on(desktopIpc.mediaPreviewChanged, receive);
        return () => ipcRenderer.removeListener(desktopIpc.mediaPreviewChanged, receive);
    },
};

/*
 * A window gets one bridge or the other, never both, and which one is settled by
 * how the window was launched rather than by what the page it loads says about
 * itself. The preview window therefore has no route to the application's
 * capabilities at all, instead of having them and being asked not to use them.
 */
if (process.argv.includes(mediaPreviewArgument))
    contextBridge.exposeInMainWorld("happyMediaPreview", mediaPreview);
else contextBridge.exposeInMainWorld("happyDesktop", bridge);
