import { contextBridge, ipcRenderer } from "electron";
import {
    buildIdentityArgument,
    desktopIpc,
    mediaPreviewArgument,
    type DesktopBrowserStatus,
    type DesktopBuildIdentity,
    type DesktopMediaPreview,
    type DesktopNoteApplyRequest,
    type DesktopPluginAppRequest,
    type DesktopPluginCatalog,
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
