import { HAPPY_AGENT_PROTOCOL_VERSION } from "@slopus/happy-agent-client";
import type { ServerCompatibility } from "./types.js";

export const MINIMUM_RIG_PROTOCOL_VERSION = HAPPY_AGENT_PROTOCOL_VERSION;
export const MAXIMUM_RIG_PROTOCOL_VERSION = HAPPY_AGENT_PROTOCOL_VERSION;

export const CHECKING_SERVER_COMPATIBILITY: ServerCompatibility = {
    status: "checking",
    minimumSupportedProtocolVersion: MINIMUM_RIG_PROTOCOL_VERSION,
    maximumSupportedProtocolVersion: MAXIMUM_RIG_PROTOCOL_VERSION,
};

export function serverCompatibility(
    protocolVersion: number,
): Exclude<ServerCompatibility, { status: "checking" }> {
    const version =
        Number.isSafeInteger(protocolVersion) && protocolVersion >= 0 ? protocolVersion : 0;
    const supported = {
        minimumSupportedProtocolVersion: MINIMUM_RIG_PROTOCOL_VERSION,
        maximumSupportedProtocolVersion: MAXIMUM_RIG_PROTOCOL_VERSION,
        serverProtocolVersion: version,
    };
    if (version < MINIMUM_RIG_PROTOCOL_VERSION) return { ...supported, status: "server_outdated" };
    if (version > MAXIMUM_RIG_PROTOCOL_VERSION) return { ...supported, status: "client_outdated" };
    return { ...supported, status: "compatible" };
}

export function describeServerCompatibility(compatibility: ServerCompatibility): string {
    if (compatibility.status === "server_outdated") {
        return `The Happy Agent server protocol is version ${String(compatibility.serverProtocolVersion)}, but this client requires at least version ${String(compatibility.minimumSupportedProtocolVersion)}.`;
    }
    if (compatibility.status === "client_outdated") {
        return `The Happy Agent server protocol is version ${String(compatibility.serverProtocolVersion)}, but this client supports at most version ${String(compatibility.maximumSupportedProtocolVersion)}.`;
    }
    return compatibility.status === "compatible"
        ? "The Happy Agent server is compatible."
        : "The Happy Agent server compatibility check is still in progress.";
}
