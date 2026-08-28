import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { Checkbox } from "../../Checkbox";
import { CopyButton } from "../../CopyButton";
import { Icon } from "../../Icon";
import { SetupProgress } from "../../SetupPage";
import { Spinner } from "../../Spinner";
import { TextField } from "../../TextField";
import { WelcomeDeck, type WelcomeSlide } from "../../WelcomeDeck";

/** One checkable condition on the account password. */
export interface HappySocialJoinPasswordRule {
    readonly id: "length" | "variety";
    readonly satisfied: boolean;
}

/** One step of the work that runs once the account has everything it needs. */
export interface HappySocialJoinStage {
    readonly id: "account" | "username" | "keys" | "network";
    readonly state: "pending" | "active" | "done";
}

/**
 * The whole join flow as one value. `step` says which screen is on; the rest of
 * each member is everything that screen draws. The surface renders this and
 * decides nothing else.
 */
export type HappySocialJoinState =
    | { readonly step: "checking" }
    | { readonly error?: string; readonly step: "unavailable" }
    | {
          readonly awaitingBrowser: boolean;
          readonly error?: string;
          readonly starting: boolean;
          readonly step: "account";
      }
    | {
          readonly error?: string;
          readonly step: "username";
          readonly submitting: boolean;
          readonly username: string;
      }
    | {
          readonly password: string;
          readonly rules: readonly HappySocialJoinPasswordRule[];
          readonly satisfied: boolean;
          readonly step: "password";
      }
    | { readonly confirmation: string; readonly error?: string; readonly step: "confirmation" }
    | {
          readonly acknowledged: boolean;
          readonly error?: string;
          readonly saving: boolean;
          readonly secret: string;
          readonly step: "secret";
      }
    | {
          readonly error?: string;
          readonly password: string;
          readonly secret: string;
          readonly step: "restore";
          readonly submitting: boolean;
          readonly valid: boolean;
      }
    | {
          readonly confirmation: string;
          readonly error?: string;
          readonly step: "vault-delete";
          readonly submitting: boolean;
          readonly valid: boolean;
      }
    | { readonly stages: readonly HappySocialJoinStage[]; readonly step: "connecting" };

/**
 * The words that authorize destroying a vault, shown exactly as they must be
 * typed. Happy Social refuses the deletion on anything else.
 */
export const HAPPY_SOCIAL_VAULT_DELETE_PHRASE = "YES DELETE MY VAULT";

export interface HappySocialJoinProps {
    readonly state: HappySocialJoinState;
    onAccountConnect(): void;
    onAcknowledgementChange(value: boolean): void;
    onConfirmationChange(value: string): void;
    onConfirmationSubmit(): void;
    onPasswordChange(value: string): void;
    onPasswordSubmit(): void;
    onRestorePasswordChange(value: string): void;
    onRestoreSecretChange(value: string): void;
    onRestoreSubmit(): void;
    onSecretSubmit(): void;
    onUsernameChange(value: string): void;
    onUsernameSubmit(): void;
    onVaultDeleteCancel(): void;
    onVaultDeleteConfirmationChange(value: string): void;
    onVaultDeleteOpen(): void;
    onVaultDeleteSubmit(): void;
}

const PASSWORD_RULE_LABELS: Record<HappySocialJoinPasswordRule["id"], string> = {
    length: "At least 10 characters",
    variety: "At least four different characters",
};

/*
 * What Happy Social is, on the one screen where a reader has not agreed to it
 * yet. It is the same deck the product opens with rather than a paragraph,
 * because the first screen of the flow is the only place the offer is made and
 * a single sentence under a heading cannot carry two unrelated promises.
 *
 * The first slide says what the thing is in plain words rather than selling a
 * feeling, because it is the only sentence a reader gets before deciding
 * whether to sign in at all; the two after it take one promise each. Every
 * slogan is written to two wrapped lines, and every title to one, at the 480px
 * measure this host gives the deck — that is what lets the dots and the action
 * below them hold still while it advances.
 */
const HAPPY_SOCIAL_SLIDES: readonly WelcomeSlide[] = [
    {
        id: "together",
        art: { kind: "scene", name: "mirror-ball" },
        title: "Join Happy Social",
        copy: "Happy Social is an end-to-end encrypted service for sharing sessions, working alongside other people, and talking in channels.",
    },
    {
        id: "private",
        art: { kind: "scene", name: "monkey-hear-no-evil" },
        title: "Nobody else is listening",
        copy: "Talk with people and with agents without anyone looking in. It is readable only on your own devices.",
    },
    {
        id: "cloud",
        art: { kind: "scene", name: "cloud-variation" },
        title: "Agents you can share",
        copy: "Run agents on our hardware or your own, in secure shared spaces — for a whole team, or just for you.",
    },
];

const STAGE_LABELS: Record<HappySocialJoinStage["id"], string> = {
    account: "Account connected",
    keys: "Encryption keys ready",
    network: "Opening your encrypted connection",
    username: "Username reserved",
};

/**
 * C-275 HappySocialJoin — the ordered errand that takes an account from signed
 * out to live: sign in, claim a username, create or restore the encryption
 * keys, and wait for the connection to open.
 *
 * One screen is on at a time and `state.step` chooses it. Nothing here knows
 * how any step is performed; every action is a callback, and every advance
 * arrives as a new `state`.
 */
export function HappySocialJoin(props: HappySocialJoinProps) {
    return (
        <Box className="happy-social-join" data-happy-desktop-ui="happy-social-join">
            <HappySocialJoinScreen {...props} />
        </Box>
    );
}

function HappySocialJoinScreen(props: HappySocialJoinProps) {
    const state = props.state;
    switch (state.step) {
        case "checking":
            return (
                <Box className="happy-social-join__pending">
                    <SetupProgress
                        label="Checking this account…"
                        progress={{ kind: "waiting" }}
                        tone="inverse"
                    />
                </Box>
            );
        case "unavailable":
            return (
                <Banner tone="warning" title="Happy Social is unavailable">
                    {state.error ?? "This Happy Agent does not support Happy Social."}
                </Banner>
            );
        case "account":
            return (
                <>
                    {/* The deck is the pitch, and a failed sign-in replaces it:
                        the surface has one stage, and a 66px banner stacked
                        under the deck does not fit it at the smallest window
                        the app opens at. See `happySocialJoinPresentation`,
                        which hands the heading chrome back for this case. */}
                    {state.error === undefined ? (
                        <WelcomeDeck
                            className="happy-social-join__deck"
                            label="What Happy Social is"
                            slides={HAPPY_SOCIAL_SLIDES}
                            tint="sky"
                        />
                    ) : (
                        <Banner tone="danger" title="Sign-in did not finish">
                            {state.error}
                        </Banner>
                    )}
                    <Button
                        className="happy-social-join__action"
                        loading={state.starting}
                        onClick={props.onAccountConnect}
                        size="large"
                    >
                        Join Happy Social
                    </Button>
                </>
            );
        case "username":
            return (
                <form
                    className="happy-social-join__form"
                    data-happy-desktop-ui="happy-social-join-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.onUsernameSubmit();
                    }}
                >
                    <TextField
                        autoComplete="username"
                        autoFocus
                        disabled={state.submitting}
                        fullWidth
                        leadingIcon="users"
                        name="happy-social-username"
                        onValueChange={props.onUsernameChange}
                        placeholder="steve"
                        required
                        size="large"
                        value={state.username}
                        {...(state.error ? { error: state.error } : {})}
                    />
                    <Button
                        disabled={state.username.trim() === ""}
                        fullWidth
                        loading={state.submitting}
                        size="large"
                        type="submit"
                    >
                        Claim username
                    </Button>
                </form>
            );
        case "password":
            return (
                <form
                    className="happy-social-join__form"
                    data-happy-desktop-ui="happy-social-join-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.onPasswordSubmit();
                    }}
                >
                    <TextField
                        autoComplete="new-password"
                        autoFocus
                        fullWidth
                        leadingIcon="lock"
                        name="happy-social-password"
                        onValueChange={props.onPasswordChange}
                        placeholder="Account password"
                        required
                        size="large"
                        type="password"
                        value={state.password}
                    />
                    <ul
                        className="happy-social-join__rules"
                        data-happy-desktop-ui="happy-social-join-rules"
                    >
                        {state.rules.map((rule) => (
                            <li data-satisfied={rule.satisfied ? "" : undefined} key={rule.id}>
                                <Icon name={rule.satisfied ? "check" : "dot"} size={14} />
                                <span>{PASSWORD_RULE_LABELS[rule.id]}</span>
                            </li>
                        ))}
                    </ul>
                    <Button disabled={!state.satisfied} fullWidth size="large" type="submit">
                        Continue
                    </Button>
                </form>
            );
        case "confirmation":
            return (
                <form
                    className="happy-social-join__form"
                    data-happy-desktop-ui="happy-social-join-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.onConfirmationSubmit();
                    }}
                >
                    <TextField
                        autoComplete="new-password"
                        autoFocus
                        fullWidth
                        leadingIcon="lock"
                        name="happy-social-password-confirmation"
                        onValueChange={props.onConfirmationChange}
                        placeholder="Account password again"
                        required
                        size="large"
                        type="password"
                        value={state.confirmation}
                        {...(state.error ? { error: state.error } : {})}
                    />
                    <Button
                        disabled={state.confirmation === ""}
                        fullWidth
                        size="large"
                        type="submit"
                    >
                        Continue
                    </Button>
                </form>
            );
        case "secret":
            return (
                <>
                    <Box
                        className="happy-social-join__secret"
                        data-happy-desktop-ui="happy-social-join-secret"
                    >
                        <code>{state.secret}</code>
                        <CopyButton label="Copy secret key" text={state.secret} />
                    </Box>
                    {state.error ? (
                        <Banner tone="danger" title="Those keys could not be created">
                            {state.error}
                        </Banner>
                    ) : null}
                    <Checkbox
                        checked={state.acknowledged}
                        disabled={state.saving}
                        label="I have saved my secret key somewhere safe"
                        onChange={props.onAcknowledgementChange}
                    />
                    <Button
                        disabled={!state.acknowledged}
                        fullWidth
                        loading={state.saving}
                        onClick={props.onSecretSubmit}
                        size="large"
                    >
                        Create my keys
                    </Button>
                </>
            );
        case "restore":
            return (
                <form
                    className="happy-social-join__form"
                    data-happy-desktop-ui="happy-social-join-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.onRestoreSubmit();
                    }}
                >
                    <TextField
                        autoFocus
                        className="happy-social-join__secret-field"
                        disabled={state.submitting}
                        fullWidth
                        leadingIcon="shield"
                        name="happy-social-secret"
                        onValueChange={props.onRestoreSecretChange}
                        placeholder="H1-XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX"
                        required
                        size="large"
                        value={state.secret}
                    />
                    <TextField
                        autoComplete="current-password"
                        disabled={state.submitting}
                        fullWidth
                        leadingIcon="lock"
                        name="happy-social-password"
                        onValueChange={props.onRestorePasswordChange}
                        placeholder="Account password"
                        required
                        size="large"
                        type="password"
                        value={state.password}
                        {...(state.error ? { error: state.error } : {})}
                    />
                    <Button
                        disabled={!state.valid || state.password === ""}
                        fullWidth
                        loading={state.submitting}
                        size="large"
                        type="submit"
                    >
                        Unlock this machine
                    </Button>
                    {/* The way out for someone who cannot unlock at all. It is
                        written as a quiet link rather than a second button:
                        losing the vault is the last resort, never the choice
                        offered beside the one that keeps the data. */}
                    <Button
                        disabled={state.submitting}
                        onClick={props.onVaultDeleteOpen}
                        size="small"
                        variant="ghost"
                    >
                        I lost my secret key
                    </Button>
                </form>
            );
        case "vault-delete":
            return (
                <form
                    className="happy-social-join__form"
                    data-happy-desktop-ui="happy-social-join-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        props.onVaultDeleteSubmit();
                    }}
                >
                    <Banner tone="danger" title="This cannot be undone">
                        Everything already synced to this account stays encrypted with the keys you
                        lost, so deleting the vault discards it permanently. Your account, username,
                        and devices are untouched.
                    </Banner>
                    <TextField
                        autoFocus
                        disabled={state.submitting}
                        fullWidth
                        leadingIcon="alert"
                        name="happy-social-vault-delete"
                        onValueChange={props.onVaultDeleteConfirmationChange}
                        placeholder={HAPPY_SOCIAL_VAULT_DELETE_PHRASE}
                        required
                        size="large"
                        value={state.confirmation}
                        {...(state.error ? { error: state.error } : {})}
                    />
                    <Button
                        disabled={!state.valid}
                        fullWidth
                        loading={state.submitting}
                        size="large"
                        type="submit"
                        variant="danger"
                    >
                        Delete my vault
                    </Button>
                    <Button
                        disabled={state.submitting}
                        onClick={props.onVaultDeleteCancel}
                        size="small"
                        variant="ghost"
                    >
                        Go back
                    </Button>
                </form>
            );
        case "connecting":
            return (
                <ul
                    className="happy-social-join__stages"
                    data-happy-desktop-ui="happy-social-join-stages"
                >
                    {state.stages.map((stage) => (
                        <li data-state={stage.state} key={stage.id}>
                            {stage.state === "active" ? (
                                <Spinner size={16} />
                            ) : (
                                <Icon name={stage.state === "done" ? "check" : "dot"} size={16} />
                            )}
                            <span>{STAGE_LABELS[stage.id]}</span>
                        </li>
                    ))}
                </ul>
            );
    }
}

/**
 * How much of the setup stage this step wants. Every step but the first is a
 * heading, a sentence, and a short lane of controls; the first brings its own
 * words as a slide deck and takes the whole stage. It lives here with the
 * heading and the sentence so one file decides everything the surrounding
 * surface draws for a step.
 *
 * A failed sign-in takes the ordinary presentation back. The stage is one fixed
 * height, and the deck already fills it — an error banner stacked underneath
 * would push the action off the bottom at the smallest window the app opens at,
 * so the step reports the problem the way every other step does instead.
 */
export function happySocialJoinPresentation(state: HappySocialJoinState): "copy" | "full" {
    return state.step === "account" && state.error === undefined ? "full" : "copy";
}

/** The heading the surrounding surface shows above this step. */
export function happySocialJoinTitle(state: HappySocialJoinState): string {
    switch (state.step) {
        case "checking":
            return "Happy Social";
        case "unavailable":
            return "Happy Social is unavailable";
        case "account":
            return "Join Happy Social";
        case "username":
            return "Choose your username";
        case "password":
            return "Create an account password";
        case "confirmation":
            return "Type that password again";
        case "secret":
            return "Save your secret key";
        case "restore":
            return "Unlock this machine";
        case "vault-delete":
            return "Delete your vault";
        case "connecting":
            return "Setting up your account";
    }
}

/** The sentence under the heading. It explains the step, not the product. */
export function happySocialJoinDescription(state: HappySocialJoinState): string {
    switch (state.step) {
        case "checking":
            return "Reading what this account still needs.";
        case "unavailable":
            return "This Happy Agent cannot carry a Happy Social account.";
        case "account":
            return state.awaitingBrowser
                ? "Finish signing in through the browser window that opened."
                : "Sign in so this Happy Agent can carry your identity and encrypted data.";
        case "username":
            return "This is how people find you. It cannot be changed later.";
        case "password":
            return "Together with a secret key, this password protects everything you sync. Nobody can reset it for you.";
        case "confirmation":
            return "Your password is never sent anywhere, so there is no way to recover a typo.";
        case "secret":
            return "This key is the other half of your encryption. Store it in a password manager: without it and your password, your synced data cannot be read on a new machine.";
        case "restore":
            return "Enter the secret key and password you saved when this account was created.";
        case "vault-delete":
            return `Without your secret key this vault cannot be opened by anyone, including us. Type ${HAPPY_SOCIAL_VAULT_DELETE_PHRASE} to discard it and start over.`;
        case "connecting":
            return "Almost there.";
    }
}
