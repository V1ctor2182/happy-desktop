import { Avatar } from "../../Avatar";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { Spinner } from "../../Spinner";
import { TextField } from "../../TextField";
import { RigSettingsSection } from "./RigSettingsShell";

export interface RigProfileSettingsProps {
    /** The name in the field, which is the stored one until it is edited. */
    readonly name: string;
    readonly email: string;
    readonly imageUrl?: string;
    /** True while the fields differ from what this machine has stored. */
    readonly dirty?: boolean;
    readonly loading?: boolean;
    readonly saving?: boolean;
    /** Why the profile could not be read at all. */
    readonly error?: string;
    /** Why the last save was refused. */
    readonly saveError?: string;
    /** Why the profile cannot currently be saved. */
    readonly unavailable?: string;
    onNameChange(value: string): void;
    onEmailChange(value: string): void;
    onRevert(): void;
    onSave(): void;
}

const initials = (name: string): string =>
    name
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toLocaleUpperCase();

/**
 * The Profile category: the one identity this machine authors work as, edited
 * where it is shown. There is no list and no separate editor — the fields are
 * the profile, and a save is offered only once they differ from what is stored.
 */
export function RigProfileSettings(props: RigProfileSettingsProps) {
    const blocked = props.unavailable !== undefined;
    return (
        <RigSettingsSection
            description="Who this Mac is when it authors work. The name and email become the Git identity on every commit an agent makes here."
            title="Profile"
        >
            {props.unavailable ? <Banner tone="warning">{props.unavailable}</Banner> : null}
            {props.error ? (
                <Banner tone="danger" title="Profile unavailable">
                    {props.error}
                </Banner>
            ) : null}
            {props.loading ? (
                <Box className="happy2-rig-settings__pending">
                    <Spinner size={16} />
                    <span>Reading the profile…</span>
                </Box>
            ) : (
                <form
                    className="happy2-rig-profile"
                    data-happy-desktop-ui="rig-profile"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!blocked) props.onSave();
                    }}
                >
                    <Box className="happy2-rig-profile__identity">
                        <Avatar
                            imageUrl={props.imageUrl}
                            initials={initials(props.name) || "?"}
                            size="lg"
                        />
                        <Box className="happy2-rig-profile__naming">
                            <span className="happy2-rig-profile__name">
                                {props.name.trim() === "" ? "Unnamed" : props.name}
                            </span>
                            <span className="happy2-rig-profile__status">
                                {props.email.trim() === "" ? "No Git email yet" : props.email}
                            </span>
                        </Box>
                    </Box>
                    {props.saveError ? (
                        <Banner tone="danger" title="Not saved">
                            {props.saveError}
                        </Banner>
                    ) : null}
                    <TextField
                        disabled={blocked}
                        fullWidth
                        label="Name"
                        onValueChange={props.onNameChange}
                        placeholder="Your name"
                        size="medium"
                        value={props.name}
                    />
                    <TextField
                        disabled={blocked}
                        fullWidth
                        label="Git email"
                        onValueChange={props.onEmailChange}
                        placeholder="you@example.com"
                        size="medium"
                        type="email"
                        value={props.email}
                    />
                    <Box className="happy2-rig-profile__actions">
                        <span className="happy2-rig-profile__state">
                            {props.saving
                                ? "Saving…"
                                : props.dirty
                                  ? "Unsaved changes"
                                  : "Saved on this Mac"}
                        </span>
                        <Button
                            disabled={!props.dirty || props.saving}
                            onClick={props.onRevert}
                            size="small"
                            variant="ghost"
                        >
                            Revert
                        </Button>
                        <Button
                            disabled={blocked || !props.dirty}
                            loading={props.saving}
                            size="small"
                            type="submit"
                            variant="primary"
                        >
                            Save
                        </Button>
                    </Box>
                </form>
            )}
        </RigSettingsSection>
    );
}
