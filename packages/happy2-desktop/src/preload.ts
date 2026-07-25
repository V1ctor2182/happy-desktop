import { contextBridge, ipcRenderer } from "electron";
import {
    desktopIpc,
    type DesktopRuntimeSnapshot,
    type DesktopStartRequest,
    type HappyDesktopBridge,
    type RigInstallTerminalEvent,
} from "./shared/desktopContract";

const bridge: HappyDesktopBridge = {
    directoryPick: () => ipcRenderer.invoke(desktopIpc.directoryPick),
    applicationMenuOpen: () => ipcRenderer.invoke(desktopIpc.applicationMenuOpen),
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
