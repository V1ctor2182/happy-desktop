import type { DaemonConfig, GitFileChange, Project } from "@slopus/happy-agent-client";
import type {
    RigChangedFileDocument,
    RigGitChangedFile,
    RigModel,
    RigModelCatalog,
    RigProjectCompute,
    RigProjectComputeState,
    RigProjectId,
    RigThinkingLevel,
} from "./rigTypes.js";

type ProviderModel = DaemonConfig["providers"][string]["models"][number];

function modelProject(
    config: DaemonConfig,
    modelId: string,
    reference?: ProviderModel,
): RigModel | undefined {
    const definition = config.models[modelId];
    if (definition === undefined) return undefined;
    return {
        id: modelId,
        name: reference?.name ?? definition.name,
        thinkingLevels: (reference?.efforts ?? definition.efforts) as RigThinkingLevel[],
        defaultThinkingLevel: (reference?.defaultEffort ??
            definition.defaultEffort) as RigThinkingLevel,
    };
}

/** Projects Happy Agent's `/v0/config` model catalog into the product model vocabulary. */
export function rigHappyAgentModelCatalogProject(config: DaemonConfig): RigModelCatalog {
    return {
        defaultModelId: config.defaults.modelId,
        defaultProviderId: config.defaults.providerId,
        models: Object.keys(config.models).flatMap((modelId) => {
            const model = modelProject(config, modelId);
            return model === undefined ? [] : [model];
        }),
        providers: Object.entries(config.providers).map(([providerId, provider]) => {
            const references = provider.models.filter((model) => model.enabled);
            const models = references.flatMap((reference) => {
                const model = modelProject(config, reference.id, reference);
                return model === undefined ? [] : [model];
            });
            const serviceTiers = [
                ...new Set(
                    references.flatMap(
                        (reference) =>
                            reference.serviceTiers ??
                            config.models[reference.id]?.serviceTiers ??
                            [],
                    ),
                ),
            ].filter((tier): tier is "fast" => tier === "fast");
            return {
                id: providerId,
                models,
                serviceTiers,
                ...(provider.enabled
                    ? models.length === 0
                        ? { disabledReason: "no_models" as const }
                        : {}
                    : { disabledReason: "not_enabled" as const }),
            };
        }),
    };
}

/** Projects the project-owned default compute selection used by new workspaces. */
export function rigHappyAgentProjectComputeProject(project: Project): RigProjectComputeState {
    const selected = project.settings.defaultWorkspaceCompute;
    return {
        projectId: project.id as RigProjectId,
        // Happy Agent versions the project resource rather than maintaining a
        // second counter for one setting. The UI uses this only as opaque
        // confirmed-state metadata.
        generation: project.initialization.attempt,
        compute:
            selected.type === "host"
                ? { type: "local" }
                : { type: "docker", image: selected.image },
    };
}

export function rigHappyAgentComputeRequest(
    compute: RigProjectCompute | undefined,
): { readonly type: "host" } | { readonly type: "docker"; readonly image: string } {
    return compute?.type === "docker" ? { type: "docker", image: compute.image } : { type: "host" };
}

export function rigHappyAgentGitChangeProject(change: GitFileChange): RigGitChangedFile {
    const status =
        change.status === "added" ||
        change.status === "deleted" ||
        change.status === "renamed" ||
        change.status === "untracked"
            ? change.status
            : "modified";
    return {
        path: change.path,
        status,
        // Git state is a computed snapshot rather than a versioned resource.
        // The facts that affect an open diff are its status and line counts.
        revision: `${status}:${change.insertions}:${change.deletions}`,
        ...(change.binary ? {} : { addedLines: change.insertions, deletedLines: change.deletions }),
    };
}

export function rigHappyAgentChangedFileProject(input: {
    readonly path: string;
    readonly oldPath?: string;
    readonly oldContent: string;
    readonly newContent: string;
    readonly hash?: string;
}): RigChangedFileDocument {
    return {
        path: input.path,
        oldPath: input.oldPath ?? input.path,
        oldContent: input.oldContent,
        newContent: input.newContent,
        ...(input.hash === undefined ? {} : { hash: input.hash }),
    };
}

export function rigTextEncodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function rigTextDecodeBase64(value: string): string {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}
