import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { CopyButton } from "../../CopyButton";
import { FormRow } from "../../FormRow";
import { Spinner } from "../../Spinner";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

/**
 * The retained recovery material, as this screen is currently showing it. It is
 * read on demand rather than carried alongside the account, so it has its own
 * in-flight and failed states.
 */
export type HappyAgentEncryptionSecret =
    | { readonly status: "hidden" }
    | { readonly status: "reading" }
    | { readonly error: string; readonly status: "failed" }
    | { readonly secret: string; readonly status: "revealed" };

/**
 * Where this account's end-to-end encryption stands, exactly as Happy Agent
 * reports it. `checking` and `resetting` are waits; the two `_required` states
 * are unfinished setup this screen offers to resume; `ready` is an account whose
 * root lives on this machine and can be shown.
 */
export type HappyAgentEncryption =
    | { readonly status: "inactive" }
    | { readonly status: "checking" }
    | { readonly status: "create_required" }
    | { readonly status: "restore_required" }
    | { readonly status: "resetting" }
    | {
          readonly identityKey: string;
          readonly secret: HappyAgentEncryptionSecret;
          readonly status: "ready";
      };

export interface HappyAgentEncryptionSettingsProps {
    readonly encryption: HappyAgentEncryption;
    /** Resumes setup. Required whenever the keys still have to be created or restored. */
    onKeysContinue?(): void;
    /** Asks for the retained secret key and shows it. */
    onSecretReveal?(): void;
    /** Puts the shown secret key away again. */
    onSecretHide?(): void;
}

/**
 * What protects this account's synced data, and the one act available from here.
 *
 * It sits between the account and the devices because that is the order the
 * three are true in: an account is signed into, its encryption decides what can
 * be read, and only then does a list of machines sharing that reading mean
 * anything. It is not part of the profile above — the profile is who this
 * machine says it is when it authors work, which is a different subject from
 * what its data is locked with.
 *
 * A settled account offers its secret key, because that key is the only way this
 * account is ever reached from another machine and the person who owns it must
 * be able to read it back without dismantling anything. The key is never on
 * screen unasked: it is fetched when the reader asks, shown with a copy control,
 * and put away again.
 */
export function HappyAgentEncryptionSettings(props: HappyAgentEncryptionSettingsProps) {
    const encryption = props.encryption;
    if (encryption.status === "inactive") return null;
    return (
        <HappyAgentSettingsSection title="Encryption">
            <EncryptionBody {...props} />
        </HappyAgentSettingsSection>
    );
}

function EncryptionBody(props: HappyAgentEncryptionSettingsProps) {
    const encryption = props.encryption;
    if (encryption.status === "inactive") return null;
    if (encryption.status === "checking" || encryption.status === "resetting")
        return (
            <FormRow
                control={
                    <Box className="happy-agent-settings__pending">
                        <Spinner size={16} />
                        <span>{encryption.status === "resetting" ? "Clearing…" : "Checking…"}</span>
                    </Box>
                }
                description={
                    encryption.status === "resetting"
                        ? "Clearing an encrypted bundle this machine cannot open"
                        : "Reading what this account's encryption still needs"
                }
                label="Status"
            />
        );
    if (encryption.status !== "ready")
        return (
            <FormRow
                control={
                    props.onKeysContinue ? (
                        <Button
                            icon="lock"
                            onClick={props.onKeysContinue}
                            size="small"
                            variant="secondary"
                        >
                            {encryption.status === "create_required" ? "Set up" : "Unlock"}
                        </Button>
                    ) : null
                }
                description={
                    encryption.status === "create_required"
                        ? "Not set up yet — nothing this machine authors is synced"
                        : "Locked on this machine until its secret key is entered"
                }
                label="Status"
            />
        );
    const secret = encryption.secret;
    return (
        <>
            <FormRow
                control={
                    props.onSecretReveal && props.onSecretHide ? (
                        <Button
                            icon={secret.status === "revealed" ? "lock" : "eye"}
                            loading={secret.status === "reading"}
                            onClick={
                                secret.status === "revealed"
                                    ? props.onSecretHide
                                    : props.onSecretReveal
                            }
                            size="small"
                            variant="secondary"
                        >
                            {secret.status === "revealed" ? "Hide secret key" : "Show secret key"}
                        </Button>
                    ) : null
                }
                description={`End-to-end encrypted · ${encryption.identityKey}`}
                label="Status"
            />
            {secret.status === "failed" ? (
                <Banner tone="danger" title="Secret key unavailable">
                    {secret.error}
                </Banner>
            ) : null}
            {secret.status === "revealed" ? (
                <Box
                    className="happy-agent-profile__secret"
                    data-happy-desktop-ui="happy-agent-encryption-secret"
                >
                    <code>{secret.secret}</code>
                    <CopyButton label="Copy secret key" text={secret.secret} />
                </Box>
            ) : null}
        </>
    );
}
