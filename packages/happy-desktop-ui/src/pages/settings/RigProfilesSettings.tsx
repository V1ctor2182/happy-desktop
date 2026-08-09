import { Avatar } from "../../Avatar";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { Spinner } from "../../Spinner";
import { TextField } from "../../TextField";
import { RigSettingsSection } from "./RigSettingsShell";

export interface RigProfileRow {
    readonly email: string;
    readonly id: string;
    readonly name: string;
    readonly imageUrl?: string;
    readonly selected: boolean;
}

export interface RigProfileEditor {
    readonly email: string;
    readonly mode: "create" | "edit";
    readonly name: string;
    readonly saving: boolean;
    readonly error?: string;
    onNameChange(value: string): void;
    onEmailChange(value: string): void;
    onSave(): void;
    onCancel(): void;
}

export interface RigProfilesSettingsProps {
    readonly profiles: readonly RigProfileRow[];
    readonly loading?: boolean;
    readonly error?: string;
    readonly actionError?: string;
    readonly unavailable?: string;
    readonly editor?: RigProfileEditor;
    onProfileCreate(): void;
    onProfileEdit(profileId: string): void;
    onProfileSelect(profileId: string): void;
}

const initials = (name: string): string =>
    name
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toLocaleUpperCase();

/** Human identities owned by this host and used for work sent to remote Rigs. */
export function RigProfilesSettings(props: RigProfilesSettingsProps) {
    return (
        <RigSettingsSection
            description="Choose who you are when this Mac sends work to another Rig. Profiles supply the Git identity for remote projects, workspaces, and sessions."
            rows="cards"
            title="Profiles"
        >
            {props.unavailable ? <Banner tone="warning">{props.unavailable}</Banner> : null}
            {props.error ? (
                <Banner tone="danger" title="Profiles unavailable">
                    {props.error}
                </Banner>
            ) : null}
            {props.actionError ? (
                <Banner tone="danger" title="Profile not changed">
                    {props.actionError}
                </Banner>
            ) : null}
            {props.editor ? (
                <form
                    className="happy2-rig-profile-form"
                    data-happy-desktop-ui="rig-profile-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.editor?.onSave();
                    }}
                >
                    <span className="happy2-rig-profile-form__title">
                        {props.editor.mode === "create" ? "New profile" : "Edit profile"}
                    </span>
                    {props.editor.error ? (
                        <Banner tone="danger" title="Not saved">
                            {props.editor.error}
                        </Banner>
                    ) : null}
                    <TextField
                        autoFocus
                        fullWidth
                        label="Name"
                        onValueChange={props.editor.onNameChange}
                        placeholder="Your name"
                        size="medium"
                        value={props.editor.name}
                    />
                    <TextField
                        fullWidth
                        label="Git email"
                        onValueChange={props.editor.onEmailChange}
                        placeholder="you@example.com"
                        size="medium"
                        type="email"
                        value={props.editor.email}
                    />
                    <Box className="happy2-rig-profile-form__actions">
                        <Button onClick={props.editor.onCancel} variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={props.unavailable !== undefined}
                            loading={props.editor.saving}
                            type="submit"
                            variant="primary"
                        >
                            Save profile
                        </Button>
                    </Box>
                </form>
            ) : (
                <Box className="happy2-rig-profile__toolbar">
                    <Button
                        disabled={props.unavailable !== undefined}
                        icon="plus"
                        onClick={props.onProfileCreate}
                        size="small"
                        variant="secondary"
                    >
                        Add profile
                    </Button>
                </Box>
            )}
            {props.profiles.map((profile) => (
                <article
                    className="happy2-rig-profile"
                    data-happy-desktop-ui="rig-profile"
                    data-selected={profile.selected ? "" : undefined}
                    key={profile.id}
                >
                    <button
                        className="happy2-rig-profile__select"
                        onClick={() => props.onProfileSelect(profile.id)}
                        type="button"
                    >
                        <Avatar
                            imageUrl={profile.imageUrl}
                            initials={initials(profile.name)}
                            size="md"
                        />
                        <Box className="happy2-rig-profile__naming">
                            <span className="happy2-rig-profile__name">{profile.name}</span>
                            <span className="happy2-rig-profile__status">{profile.email}</span>
                        </Box>
                    </button>
                    <Button
                        aria-label={`Edit ${profile.name}`}
                        disabled={props.unavailable !== undefined}
                        icon="edit"
                        iconOnly
                        onClick={() => props.onProfileEdit(profile.id)}
                        size="small"
                        variant="ghost"
                    />
                </article>
            ))}
            {props.loading && props.profiles.length === 0 && !props.error ? (
                <Box className="happy2-rig-settings__pending">
                    <Spinner size={16} />
                    <span>Reading profiles…</span>
                </Box>
            ) : null}
            {!props.loading && props.profiles.length === 0 && !props.error && !props.editor ? (
                <EmptyState
                    description="Create a profile before sending work to another Rig."
                    icon="users"
                    size="panel"
                    title="No profiles"
                />
            ) : null}
        </RigSettingsSection>
    );
}
