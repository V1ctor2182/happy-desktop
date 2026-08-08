import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { FormRow } from "../../FormRow";
import { SegmentedControl } from "../../SegmentedControl";
import { Select, type SelectOption } from "../../Select";
import { Spinner } from "../../Spinner";
import { Switch } from "../../Switch";
import { RigSettingsSection } from "./RigSettingsShell";

export type RigAppearanceChoice = "system" | "light" | "dark";

export type RigGeneralSettingsProps = {
    appearance: RigAppearanceChoice;
    /** The default a new session starts on, keyed `${providerId}:${modelId}`. */
    defaultModelKey?: string;
    /** Every model the enabled providers offer, already labelled for display. */
    modelOptions: readonly SelectOption[];
    effort?: string;
    /** The chosen model's own reasoning levels; empty when it exposes none. */
    effortOptions: readonly SelectOption[];
    permissionMode: string;
    permissionModeOptions: readonly SelectOption[];
    /** Set while the catalog is still being read, so the pickers say so. */
    loading?: boolean;
    error?: string;
    /** Why daemon-backed defaults cannot currently be changed. Appearance remains local. */
    unavailable?: string;
    /** Whether this window offers the features that are not finished yet. */
    experimentalFeaturesEnabled: boolean;
    /** Whether active session, project, and workspace titles shimmer. */
    titleShimmerEnabled: boolean;
    onAppearanceChange: (appearance: RigAppearanceChoice) => void;
    onExperimentalFeaturesChange: (enabled: boolean) => void;
    onTitleShimmerChange: (enabled: boolean) => void;
    onDefaultModelChange: (key: string) => void;
    onEffortChange: (effort: string) => void;
    onPermissionModeChange: (mode: string) => void;
};

const appearanceSegments = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
];

/**
 * The General category: how the window looks, and what a new session on this
 * machine starts with. The model list is the daemon's catalog, so the picker
 * names one model rather than a per-provider matrix of defaults — the providers
 * already decide which models exist.
 */
export function RigGeneralSettings(props: RigGeneralSettingsProps) {
    return (
        <>
            {props.error ? (
                <Banner tone="danger" title="Models unavailable">
                    {props.error}
                </Banner>
            ) : null}
            {props.unavailable ? (
                <Banner tone="neutral" title="Rig reconnecting">
                    {props.unavailable}
                </Banner>
            ) : null}
            <RigSettingsSection
                description="How Happy looks and moves in this window."
                title="Appearance"
            >
                <FormRow
                    control={
                        <SegmentedControl
                            onChange={(value) =>
                                props.onAppearanceChange(value as RigAppearanceChoice)
                            }
                            segments={appearanceSegments}
                            size="small"
                            value={props.appearance}
                        />
                    }
                    description="Applies to this window immediately"
                    label="Theme"
                />
                <FormRow
                    control={
                        <Switch
                            aria-label="Shimmer active titles"
                            checked={props.titleShimmerEnabled}
                            id="rig-settings-title-shimmer"
                            onChange={props.onTitleShimmerChange}
                            size="small"
                        />
                    }
                    description="Animates running session, project, and workspace names"
                    htmlFor="rig-settings-title-shimmer"
                    label="Shimmer active titles"
                />
            </RigSettingsSection>
            <RigSettingsSection
                description="What a session started on this machine begins with. Each session can still be changed from its composer."
                title="New sessions"
            >
                <FormRow
                    control={
                        props.loading ? (
                            <Box className="happy2-rig-settings__pending">
                                <Spinner size={16} />
                                <span>Reading the model catalog…</span>
                            </Box>
                        ) : (
                            <Box width={280}>
                                <Select
                                    aria-label="Default model"
                                    disabled={props.unavailable !== undefined}
                                    fullWidth
                                    id="rig-settings-default-model"
                                    onValueChange={props.onDefaultModelChange}
                                    options={[...props.modelOptions]}
                                    placeholder="Choose a model"
                                    size="small"
                                    value={props.defaultModelKey}
                                />
                            </Box>
                        )
                    }
                    description="Chosen from the models the enabled providers offer"
                    htmlFor="rig-settings-default-model"
                    label="Default model"
                />
                <FormRow
                    control={
                        <Box width={280}>
                            <Select
                                aria-label="Reasoning effort"
                                disabled={
                                    props.unavailable !== undefined ||
                                    props.effortOptions.length === 0
                                }
                                fullWidth
                                id="rig-settings-effort"
                                onValueChange={props.onEffortChange}
                                options={[...props.effortOptions]}
                                placeholder={
                                    props.effortOptions.length === 0
                                        ? "Not offered by this model"
                                        : "Model default"
                                }
                                size="small"
                                value={props.effort}
                            />
                        </Box>
                    }
                    description="How much the model is asked to think before it answers"
                    htmlFor="rig-settings-effort"
                    label="Reasoning effort"
                />
                <FormRow
                    control={
                        <Box width={280}>
                            <Select
                                aria-label="Default access mode"
                                disabled={props.unavailable !== undefined}
                                fullWidth
                                id="rig-settings-permission-mode"
                                onValueChange={props.onPermissionModeChange}
                                options={[...props.permissionModeOptions]}
                                size="small"
                                value={props.permissionMode}
                            />
                        </Box>
                    }
                    description="How much of the machine a new session may touch without asking"
                    htmlFor="rig-settings-permission-mode"
                    label="Default access mode"
                />
            </RigSettingsSection>
            <RigSettingsSection
                description="Work that is still being built. It can change or disappear between releases."
                title="Experimental features"
            >
                <FormRow
                    control={
                        <Switch
                            aria-label="Enable experimental features"
                            checked={props.experimentalFeaturesEnabled}
                            id="rig-settings-experimental-features"
                            onChange={props.onExperimentalFeaturesChange}
                            size="small"
                        />
                    }
                    description="Shows Notes and the inbox in the sidebar. Kept on this machine only."
                    htmlFor="rig-settings-experimental-features"
                    label="Enable experimental features"
                />
            </RigSettingsSection>
        </>
    );
}
