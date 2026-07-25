import type {
    RigMenusSnapshot,
    RigModelSelection,
    RigThinkingLevel,
} from "happy2-state";
import type { ComposerModelControlProps } from "./ComposerModelControl";

/** Provider and model ids joined for composer choice ids (matches rig menu ids). */
const MODEL_ID_SEP = " ";

function rigModelChoiceId(providerId: string, modelId: string): string {
    return `${providerId}${MODEL_ID_SEP}${modelId}`;
}

function currentEffortId(menus: RigMenusSnapshot): string {
    const current = menus.effortOptions.find((option) => option.current);
    return current?.level ?? menus.currentEffort ?? menus.effortOptions[0]?.level ?? "";
}

/**
 * Maps a rig session menu snapshot into props for the shared composer model pill
 * used in cloud chat, so local and cloud pickers stay one component.
 */
export function rigComposerModelControlProps(
    menus: RigMenusSnapshot,
    handlers: {
        readonly onModelChange: (selection: RigModelSelection) => void;
        readonly onEffortChange: (effort?: RigThinkingLevel) => void;
        readonly disabled?: boolean;
    },
): ComposerModelControlProps {
    return {
        disabled: handlers.disabled,
        model: rigModelChoiceId(menus.currentProviderId, menus.currentModelId),
        models: menus.modelOptions.map((option) => ({
            id: rigModelChoiceId(option.providerId, option.modelId),
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
        onEffortChange: (id) => handlers.onEffortChange(id as RigThinkingLevel),
    };
}
