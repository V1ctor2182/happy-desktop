import type {
    DesktopActiveTarget,
    DesktopStartRequest,
    DesktopTopology,
    DesktopTopologyTarget,
} from "../shared/desktopContract";

export function desktopStartRequestValidate(request: unknown): DesktopStartRequest {
    if (
        request &&
        typeof request === "object" &&
        !Array.isArray(request) &&
        (request as Record<string, unknown>).mode === "local" &&
        Object.keys(request).every((key) => key === "mode")
    )
        return { mode: "local" };
    throw new Error("Happy Desktop supports local Rig mode only.");
}

export function desktopTopologyFromRequest(
    id: string,
    _request: DesktopStartRequest,
): DesktopTopology {
    if (!desktopTopologyIdValid(id)) throw new Error("The desktop topology identity is invalid.");
    return { id, mode: "local" };
}

export function desktopTopologyRequest(_topology: DesktopTopology): DesktopStartRequest {
    return { mode: "local" };
}

export function desktopTopologyTarget(topology: DesktopTopology): DesktopTopologyTarget {
    return {
        detail: `System Rig · ${topology.id.slice(-6)}`,
        id: topology.id,
        kind: "local",
        label: "This Mac",
        mode: "local",
    };
}

export function desktopActiveTarget(
    topology: DesktopTopology,
    rigVersion?: string,
    rigHttpUrl?: string,
): DesktopActiveTarget {
    if (!rigVersion) throw new Error("The local Rig version is unavailable.");
    if (!rigHttpUrl) throw new Error("The local Rig HTTP proxy is unavailable.");
    return {
        ...desktopTopologyTarget(topology),
        authentication: "rig",
        mode: "local",
        rigVersion,
        rigHttpUrl,
    };
}

/**
 * One Happy Agent version named by a renderer. It reaches a GitHub release tag
 * and a directory name, so nothing but a semantic version is let through.
 */
export function desktopDaemonVersionValidate(value: unknown): string {
    if (
        typeof value === "string" &&
        value.length <= 128 &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value)
    )
        return value;
    throw new Error("The requested Happy Agent version is invalid.");
}

export function desktopTopologyIdValidate(value: unknown): string {
    if (desktopTopologyIdValid(value)) return value;
    throw new Error("The desktop topology identity is invalid.");
}

export function desktopTopologyIdValid(value: unknown): value is string {
    return typeof value === "string" && /^top_[a-f0-9]{32}$/u.test(value);
}
