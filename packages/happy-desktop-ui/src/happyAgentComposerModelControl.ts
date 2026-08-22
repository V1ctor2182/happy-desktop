import type {
    HappyAgentMenusSnapshot,
    HappyAgentModelSelection,
    HappyAgentThinkingLevel,
} from "happy-desktop-state";
import type { ComposerModelControlProps } from "./ComposerModelControl";

/** Provider and model ids joined for composer choice ids (matches agent menu ids). */
const MODEL_ID_SEP = " ";

function happyAgentModelChoiceId(providerId: string, modelId: string): string {
    return `${providerId}${MODEL_ID_SEP}${modelId}`;
}

/** The daemon reports a provider by id only, so its group heading is that id, titled. */
function happyAgentProviderName(id: string): string {
    return id
        .split(/[_-]/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join(" ");
}

function currentEffortId(menus: HappyAgentMenusSnapshot): string {
    const current = menus.effortOptions.find((option) => option.current);
    return current?.level ?? menus.currentEffort ?? menus.effortOptions[0]?.level ?? "";
}

/**
 * Maps a session menu snapshot into props for the shared composer model pill.
 */
export function happyAgentComposerModelControlProps(
    menus: HappyAgentMenusSnapshot,
    handlers: {
        readonly onModelChange: (selection: HappyAgentModelSelection) => void;
        readonly onEffortChange: (effort?: HappyAgentThinkingLevel) => void;
        readonly disabled?: boolean;
    },
): ComposerModelControlProps {
    return {
        disabled: handlers.disabled,
        model: happyAgentModelChoiceId(menus.currentProviderId, menus.currentModelId),
        models: menus.modelOptions.map((option) => ({
            group: happyAgentProviderName(option.providerId),
            id: happyAgentModelChoiceId(option.providerId, option.modelId),
            label: option.name,
        })),
        effort: currentEffortId(menus),
        efforts: menus.effortOptions.map((option) => ({
            id: option.level,
            label: option.label,
        })),
        onModelChange: (id) => {
            const [providerId, modelId] = id.split(MODEL_ID_SEP);
            if (modelId) handlers.onModelChange({ providerId, modelId });
        },
        onEffortChange: (id) => handlers.onEffortChange(id as HappyAgentThinkingLevel),
    };
}
