import type { TerminalConnection } from "../transport.js";
import type {
    HappyAgentGroupId,
    HappyAgentOpenInTargets,
    HappyAgentTerminalId,
    HappyAgentWorkspaceFileBytes,
} from "./happyAgentTypes.js";

/**
 * Desktop-local services that are not Happy Agent product resources.
 *
 * The state package talks to Happy Agent directly for every `/v0` read and
 * mutation. This boundary is intentionally limited to work that needs the
 * desktop host: launching another application, turning local bytes into an
 * isolated preview asset, placing an attachment chosen by the user, and
 * attaching the terminal's binary WebSocket protocol.
 */
export interface HappyAgentHostServices {
    openInTargetsRead(): Promise<HappyAgentOpenInTargets>;
    openIn(groupId: HappyAgentGroupId, targetId: string): Promise<void>;
    workspaceFileBytesRead(
        groupId: HappyAgentGroupId,
        path: string,
        signal?: AbortSignal,
    ): Promise<HappyAgentWorkspaceFileBytes>;
    htmlPreviewOpen(groupId: HappyAgentGroupId, path: string): Promise<string>;
    /**
     * Where a file the reader chose lives on this machine, when it lives
     * anywhere. A pasted screenshot exists only in the browser and answers
     * undefined, as does a host that cannot tell.
     */
    attachmentSourcePath(file: File): string | undefined;
    /**
     * Whether an agent working in this group could open that path as it stands,
     * because its work and the reader's disk are the same machine. When they
     * are, an attachment needs no transfer at all and is named where it lies.
     * A container workspace and a Happy Agent on another machine both answer false, and
     * the caller sends the bytes instead.
     */
    attachmentSourceReachable(groupId: HappyAgentGroupId, sourcePath: string): Promise<boolean>;
    /** Places an attachment by value, as base64. The route for bytes with no path. */
    attachmentWrite(
        groupId: HappyAgentGroupId,
        name: string,
        content: string,
    ): Promise<{ readonly path: string }>;
    terminalConnect(
        workspaceId: HappyAgentGroupId,
        terminalId: HappyAgentTerminalId,
    ): TerminalConnection;
}
