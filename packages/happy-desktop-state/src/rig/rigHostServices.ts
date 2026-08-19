import type { TerminalConnection } from "../transport.js";
import type {
    RigGroupId,
    RigOpenInTargets,
    RigTerminalId,
    RigWorkspaceFileBytes,
} from "./rigTypes.js";

/**
 * Desktop-local services that are not Happy Agent product resources.
 *
 * The state package talks to Happy Agent directly for every `/v0` read and
 * mutation. This boundary is intentionally limited to work that needs the
 * desktop host: launching another application, turning local bytes into an
 * isolated preview asset, placing an attachment chosen by the user, and
 * attaching the terminal's binary WebSocket protocol.
 */
export interface RigHostServices {
    openInTargetsRead(): Promise<RigOpenInTargets>;
    openIn(groupId: RigGroupId, targetId: string): Promise<void>;
    workspaceFileBytesRead(
        groupId: RigGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<RigWorkspaceFileBytes>;
    htmlPreviewOpen(groupId: RigGroupId, path: string): Promise<string>;
    attachmentWrite(
        groupId: RigGroupId,
        name: string,
        content: string,
    ): Promise<{ readonly path: string }>;
    terminalConnect(workspaceId: RigGroupId, terminalId: RigTerminalId): TerminalConnection;
}
