import { contextBridge, ipcRenderer } from "electron";
import {
    desktopIpc,
    type DesktopRuntimeSnapshot,
    type DesktopStartRequest,
    type DesktopWindowState,
    type HappyDesktopBridge,
    type RemoteRigSnapshot,
    type RigInstallTerminalEvent,
} from "../shared/desktopContract";

const bridge: HappyDesktopBridge = {
    browserProxyApply: (sessionId) => ipcRenderer.invoke(desktopIpc.browserProxyApply, sessionId),
    browserOpenSubscribe(listener: (url: string) => void) {
        const receive = (_event: Electron.IpcRendererEvent, url: string) => listener(url);
        ipcRenderer.on(desktopIpc.browserOpenRequested, receive);
        return () => ipcRenderer.removeListener(desktopIpc.browserOpenRequested, receive);
    },
    directoryPick: () => ipcRenderer.invoke(desktopIpc.directoryPick),
    applicationMenuOpen: () => ipcRenderer.invoke(desktopIpc.applicationMenuOpen),
    remoteRigAdd: (destination) => ipcRenderer.invoke(desktopIpc.remoteRigAdd, destination),
    remoteRigGet: () => ipcRenderer.invoke(desktopIpc.remoteRigGet),
    remoteRigRemove: (id) => ipcRenderer.invoke(desktopIpc.remoteRigRemove, id),
    remoteRigRetry: (id) => ipcRenderer.invoke(desktopIpc.remoteRigRetry, id),
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

contextBridge.exposeInMainWorld("happyDesktop", bridge);
