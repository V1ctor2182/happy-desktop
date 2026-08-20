import { BrowserTerminalConnection, TERMINAL_PROTOCOL, terminalSocketUrl } from "happy-desktop-app";
import type {
    RigHostServices,
    RigOpenInTarget,
    RigOpenInTargets,
    RigWorkspaceFileBytes,
} from "happy-desktop-state";

const OPEN_IN_RECENT_KEY = "happy2.rig.open-in-recent.v1";
const TERMINAL_CAPABILITY_PROTOCOL_PREFIX = "happy2-capability.";

type WorkspaceFileBytesResponse = Omit<RigWorkspaceFileBytes, "url">;

function recentTargetRead(): string | undefined {
    try {
        return localStorage.getItem(OPEN_IN_RECENT_KEY) ?? undefined;
    } catch {
        return undefined;
    }
}

function recentTargetWrite(targetId: string): void {
    try {
        localStorage.setItem(OPEN_IN_RECENT_KEY, targetId);
    } catch {
        // The workspace store retains this selection for the current renderer.
    }
}

function capabilityOf(baseUrl: string): string | undefined {
    return new URL(baseUrl, globalThis.location?.href).pathname.split("/").filter(Boolean).at(0);
}

function serviceUrl(
    baseUrl: string,
    path: string,
    parameters: Readonly<Record<string, string>> = {},
): string {
    const url = new URL(`${baseUrl.replace(/\/$/u, "")}${path}`, globalThis.location?.href);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    return url.toString();
}

async function jsonRead<Value>(response: Response): Promise<Value> {
    if (!response.ok) {
        let message = `The desktop service request failed (${String(response.status)}).`;
        try {
            const body = (await response.json()) as { readonly error?: unknown };
            if (typeof body.error === "string" && body.error.length > 0) message = body.error;
        } catch {
            // Keep the status-based message when the host did not return JSON.
        }
        throw new Error(message);
    }
    return (await response.json()) as Value;
}

async function getJson<Value>(
    baseUrl: string,
    path: string,
    parameters?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
): Promise<Value> {
    return await jsonRead<Value>(await fetch(serviceUrl(baseUrl, path, parameters), { signal }));
}

async function postJson<Value>(baseUrl: string, path: string, body: unknown): Promise<Value> {
    return await jsonRead<Value>(
        await fetch(serviceUrl(baseUrl, path), {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
            method: "POST",
        }),
    );
}

/**
 * Renderer access to the small set of services that truly belong to the
 * desktop host. Agent resources use `HappyAgentClient` directly.
 */
export function happyAgentHostServicesCreate(baseUrl: string): RigHostServices {
    const capability = capabilityOf(baseUrl);
    return {
        openInTargetsRead: async (): Promise<RigOpenInTargets> => {
            const targets = await getJson<readonly RigOpenInTarget[]>(baseUrl, "/open-in-targets");
            const recentId = recentTargetRead();
            return {
                targets,
                ...(recentId !== undefined && targets.some((target) => target.id === recentId)
                    ? { recentId }
                    : {}),
            };
        },
        openIn: async (workspaceId, targetId) => {
            await postJson<Record<string, never>>(baseUrl, "/open-in", {
                workspaceId,
                target: targetId,
            });
            recentTargetWrite(targetId);
        },
        workspaceFileBytesRead: async (
            workspaceId,
            path,
            signal,
        ): Promise<RigWorkspaceFileBytes> => {
            const file = await getJson<WorkspaceFileBytesResponse>(
                baseUrl,
                "/workspace-file-bytes",
                { workspaceId, path },
                signal,
            );
            return {
                ...file,
                url: serviceUrl(baseUrl, "/workspace-file-media", {
                    workspaceId,
                    path,
                    hash: file.hash,
                }),
            };
        },
        htmlPreviewOpen: async (workspaceId, path) =>
            (
                await getJson<{ readonly url: string }>(baseUrl, "/html-preview", {
                    workspaceId,
                    path,
                })
            ).url,
        attachmentSourcePath: (file) => window.happyDesktop?.attachmentSourcePath(file),
        attachmentSourceReachable: async (workspaceId, sourcePath) =>
            (
                await postJson<{ readonly reachable: boolean }>(
                    baseUrl,
                    "/attachment-source-reachable",
                    { workspaceId, sourcePath },
                )
            ).reachable,
        attachmentWrite: (workspaceId, name, content) =>
            postJson<{ readonly path: string }>(baseUrl, "/attachment", {
                workspaceId,
                name,
                content,
            }),
        terminalConnect: (workspaceId, terminalId) =>
            new BrowserTerminalConnection(
                terminalSocketUrl(
                    baseUrl.replace(/\/$/u, ""),
                    `/v0/workspaces/${encodeURIComponent(workspaceId)}/terminals/${encodeURIComponent(terminalId)}/attach`,
                ),
                [
                    TERMINAL_PROTOCOL,
                    ...(capability === undefined
                        ? []
                        : [`${TERMINAL_CAPABILITY_PROTOCOL_PREFIX}${capability}`]),
                ],
            ),
    };
}
