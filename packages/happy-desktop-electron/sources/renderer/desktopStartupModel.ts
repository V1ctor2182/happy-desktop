import type { DesktopStartupValues } from "happy-desktop-app";
import type { DesktopStartRequest } from "../shared/desktopContract";

/** Projects the only supported desktop start mode into the startup screen. */
export function desktopStartupValues(_request?: DesktopStartRequest): DesktopStartupValues {
    return { mode: "local" };
}

/** The startup screen can only request the local Happy Agent runtime. */
export function desktopStartRequestFromValues(_values: DesktopStartupValues): DesktopStartRequest {
    return { mode: "local" };
}
