import type {
    RigPluginInstallResult,
    RigPluginManagementFailure,
    RigPluginManagementSource,
    RigPluginRemovalResult,
} from "happy2-state";
import type {
    DesktopPluginInstallResult,
    DesktopPluginManagementFailure,
    DesktopPluginUninstallResult,
} from "../shared/desktopContract";

/**
 * Adapts the desktop shell's plugin lifecycle to the catalog store's source.
 *
 * Changing what is installed belongs to the main process for the same reason
 * reading it does: it is the only side that may hold the daemon endpoint and its
 * token, and the only side whose machine the folders are on. This side sends one
 * string the person supplied and receives one finished description of what the
 * machine did with it, so the whole adapter is a call and a rename.
 *
 * Nothing is validated here. A folder that is not a plugin, a path that does not
 * exist, a manifest that is wrong — every one of those is the machine's answer,
 * in the machine's own words, and a guess made in this window could only ever
 * contradict it. The one thing this side decides is that a shell offering no
 * lifecycle at all supplies no source, so the surface leaves the controls out
 * rather than showing ones that would always refuse.
 */
export function rigPluginManagementSourceCreate(
    desktop:
        | {
              pluginInstall(source: string): Promise<DesktopPluginInstallResult>;
              pluginUninstall(folder: string): Promise<DesktopPluginUninstallResult>;
          }
        | undefined,
): RigPluginManagementSource | undefined {
    if (!desktop) return undefined;
    return {
        async install(source): Promise<RigPluginInstallResult> {
            const result = await desktop.pluginInstall(source);
            return result.ok
                ? {
                      ok: true,
                      plugin: {
                          classification: result.plugin.classification,
                          description: result.plugin.description,
                          id: result.plugin.folder,
                          name: result.plugin.name,
                          version: result.plugin.version,
                      },
                  }
                : { failure: failureProject(result.failure), ok: false };
        },
        async remove(id): Promise<RigPluginRemovalResult> {
            const result = await desktop.pluginUninstall(id);
            return result.ok
                ? {
                      ok: true,
                      plugin: {
                          dataDirectory: result.plugin.dataDirectory,
                          id: result.plugin.folder,
                          name: result.plugin.name,
                      },
                  }
                : { failure: failureProject(result.failure), ok: false };
        },
    };
}

/**
 * The shell's word for the daemon is `rig`; above this line the machine is the
 * machine, because the surface is written for one that may not be this one. The
 * distinction the name carries — the machine answered, or this window never
 * managed to ask it — is the part that matters and is kept exactly.
 */
function failureProject(failure: DesktopPluginManagementFailure): RigPluginManagementFailure {
    return failure.reason === "rig"
        ? { code: failure.code, message: failure.message, reason: "machine" }
        : { kind: failure.kind, message: failure.message, reason: "host" };
}
