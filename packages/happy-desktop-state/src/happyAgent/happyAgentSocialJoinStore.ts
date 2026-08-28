import {
    CLOUD_GENERATED_SECRET_SEED_BYTES,
    CLOUD_VAULT_DELETE_CONFIRMATION,
    deriveCloudKeys,
    normalizeCloudPassword,
    parseCloudGeneratedSecret,
    stringifyCloudGeneratedSecret,
    type CloudDerivedKeys,
    type CloudGeneratedSecret,
    type HappyAgentClient,
} from "@slopus/happy-agent-client";
import { createStore } from "zustand/vanilla";
import type { UserError } from "../types.js";
import type { HappyAgentCloudSnapshot, HappyAgentCloudStore } from "./happyAgentCloudStore.js";
import { deepEqual, happyAgentUserError } from "./happyAgentSupport.js";

/** The shortest account password Happy Social accepts, matching 1Password's account minimum. */
export const HAPPY_AGENT_SOCIAL_JOIN_PASSWORD_MINIMUM = 10;

/** How many different characters a password must use before it is accepted. */
const PASSWORD_DISTINCT_MINIMUM = 4;

/**
 * One checkable condition on the account password. The rule carries whether it
 * currently holds; the words shown beside it belong to the surface.
 */
export interface HappyAgentSocialJoinPasswordRule {
    readonly id: "length" | "variety";
    readonly satisfied: boolean;
}

/** One step of the work that runs after the account has everything it needs. */
export interface HappyAgentSocialJoinStage {
    readonly id: "account" | "username" | "keys" | "network";
    readonly state: "pending" | "active" | "done";
}

/**
 * Everything the join surface renders, narrowed by `step`. One value describes
 * the whole flow: the surface chooses no screen of its own.
 */
export type HappyAgentSocialJoinFlow =
    /** The daemon has not said yet what this account still needs. */
    | { readonly step: "checking" }
    | { readonly step: "unavailable"; readonly error?: UserError }
    | {
          readonly awaitingBrowser: boolean;
          readonly error?: UserError;
          readonly starting: boolean;
          readonly step: "account";
      }
    | {
          readonly error?: UserError;
          readonly step: "username";
          readonly submitting: boolean;
          readonly username: string;
      }
    | {
          readonly password: string;
          readonly rules: readonly HappyAgentSocialJoinPasswordRule[];
          readonly satisfied: boolean;
          readonly step: "password";
      }
    | {
          readonly confirmation: string;
          readonly error?: UserError;
          readonly step: "confirmation";
      }
    | {
          readonly acknowledged: boolean;
          readonly error?: UserError;
          readonly saving: boolean;
          readonly secret: CloudGeneratedSecret;
          readonly step: "secret";
      }
    | {
          readonly error?: UserError;
          readonly password: string;
          readonly secret: string;
          readonly step: "restore";
          readonly submitting: boolean;
          readonly valid: boolean;
      }
    | {
          /** What has been typed against {@link HAPPY_AGENT_SOCIAL_VAULT_DELETE_PHRASE}. */
          readonly confirmation: string;
          readonly error?: UserError;
          readonly step: "vault-delete";
          readonly submitting: boolean;
          readonly valid: boolean;
      }
    | { readonly stages: readonly HappyAgentSocialJoinStage[]; readonly step: "connecting" };

/**
 * The exact words that authorize destroying a vault.
 *
 * Happy Agent refuses the deletion unless this phrase arrives verbatim, and the
 * surface shows the same constant it sends. Typing a sentence is the point: it
 * is the one action in the flow that permanently discards data nobody — not
 * this machine, not the service — can reconstruct afterwards.
 */
export const HAPPY_AGENT_SOCIAL_VAULT_DELETE_PHRASE = CLOUD_VAULT_DELETE_CONFIRMATION;

export interface HappyAgentSocialJoinSnapshot {
    readonly flow: HappyAgentSocialJoinFlow;
    /** Whether the join surface is on screen. The store closes it once the account is live. */
    readonly open: boolean;
}

export interface HappyAgentSocialJoinStore {
    get(): HappyAgentSocialJoinSnapshot;
    subscribe(listener: () => void): () => void;
    joinOpen(): void;
    joinClose(): void;
    accountConnect(): void;
    usernameUpdate(value: string): void;
    usernameSubmit(): void;
    passwordUpdate(value: string): void;
    passwordSubmit(): void;
    confirmationUpdate(value: string): void;
    confirmationSubmit(): void;
    acknowledgementUpdate(value: boolean): void;
    secretSubmit(): void;
    restoreSecretUpdate(value: string): void;
    restorePasswordUpdate(value: string): void;
    restoreSubmit(): void;
    /** Leaves the unlock screen for the one that destroys the vault instead. */
    vaultDeleteOpen(): void;
    /** Returns to the unlock screen, discarding what was typed. */
    vaultDeleteCancel(): void;
    vaultDeleteConfirmationUpdate(value: string): void;
    vaultDeleteSubmit(): void;
    [Symbol.dispose](): void;
}

export interface HappyAgentSocialJoinStoreDeps {
    readonly client: Pick<
        HappyAgentClient,
        "createCloudKeys" | "deleteCloudKeys" | "restoreCloudKeys"
    >;
    /**
     * The authoritative account surface. The join flow owns no account state of
     * its own: it reads this one and asks it to perform the account actions it
     * already owns, so both surfaces always agree about what is outstanding.
     */
    readonly cloud: HappyAgentCloudStore;
}

/** The wizard's own drafts. None of it is authoritative and none of it is persisted. */
interface JoinDraft {
    acknowledged: boolean;
    confirmation: string;
    /**
     * The 650k-iteration derivation, started while the reader retypes their
     * password so the wait is spent on a screen they are busy with.
     */
    derivation?: Promise<CloudDerivedKeys>;
    error?: UserError;
    /** One idempotency key for every attempt at the same key mutation. */
    mutationId: string;
    password: string;
    restorePassword: string;
    restoreSecret: string;
    saving: boolean;
    secret?: CloudGeneratedSecret;
    stage: "password" | "confirmation" | "secret";
    /** What has been typed toward destroying the vault. */
    vaultDeleteConfirmation: string;
    /**
     * Whether the reader has left the unlock screen for the deletion one. The
     * daemon reports the same `restore_required` either way — which of the two
     * screens is showing is a choice made here, not an account fact.
     */
    vaultDeleteOpen: boolean;
}

const CLOSED: HappyAgentSocialJoinSnapshot = { flow: { step: "checking" }, open: false };

function draftEmpty(): JoinDraft {
    return {
        acknowledged: false,
        confirmation: "",
        mutationId: globalThis.crypto.randomUUID(),
        password: "",
        restorePassword: "",
        restoreSecret: "",
        saving: false,
        stage: "password",
        vaultDeleteConfirmation: "",
        vaultDeleteOpen: false,
    };
}

/**
 * The Happy Social join flow: one modal-lifetime surface that carries an
 * account from signed out to live.
 *
 * It exists because the four things a new account needs — an authenticated
 * user, a public username, an encrypted key bundle, and a running connection —
 * are reported independently by the daemon but are one ordered errand to the
 * person doing them. Projecting them into a single `flow` value is what lets
 * the surface render exactly one screen at a time and lets the flow advance on
 * its own as the daemon confirms each part.
 */
export function happyAgentSocialJoinStoreCreate(
    deps: HappyAgentSocialJoinStoreDeps,
): HappyAgentSocialJoinStore {
    const store = createStore<HappyAgentSocialJoinSnapshot>()(() => CLOSED);
    const listeners = new Set<() => void>();
    let cloudUnsubscribe: (() => void) | undefined;
    let disposed = false;
    let draft = draftEmpty();
    /**
     * Whether a browser authorization was already completing the last time the
     * account was read, so only the moment one starts resumes the flow.
     *
     * It starts false rather than reading the account, because a store built
     * while a callback is already in flight — the flow's own document having
     * been replaced by the trip to the browser — must still see that callback as
     * the thing it has to come back to.
     */
    let authorizationCompleting = false;

    /** Recomputes the projection and publishes it only when it actually differs. */
    const publish = (): void => {
        if (disposed) return;
        const current = store.getState();
        if (!current.open) return;
        const flow = flowProject(deps.cloud.get(), draft);
        if (deepEqual(current.flow, flow)) return;
        store.setState({ flow, open: true }, true);
    };

    const cloudChanged = (): void => {
        if (disposed) return;
        const cloud = deps.cloud.get();
        const resuming = cloud.authorizationCompleting && !authorizationCompleting;
        authorizationCompleting = cloud.authorizationCompleting;
        // The errand is finished the moment the account's own connection is
        // under way; watching it settle is the app's job, not a wizard's.
        if (cloud.keys.status === "ready" && cloud.socialConnection !== undefined) {
            close();
            return;
        }
        // Joining, signing in, and setting up encryption are one errand, and the
        // part of it that happens in a browser is not a reason to disturb it.
        // A flow already on screen is left exactly where it is and merely told
        // what the account now says; only a flow that is *not* on screen — one
        // whose window was replaced by the trip — is put back.
        if (!store.getState().open) {
            if (!resuming) return;
            open(cloud);
            return;
        }
        secretEnsure(cloud);
        publish();
    };

    /**
     * Puts the flow on screen at whatever step the account currently calls for,
     * keeping every draft already typed into it.
     */
    const open = (cloud: HappyAgentCloudSnapshot): void => {
        secretEnsure(cloud);
        const next = { flow: flowProject(cloud, draft), open: true };
        if (deepEqual(store.getState(), next)) return;
        store.setState(next, true);
    };

    /**
     * Follows the account for as long as anything is watching this surface, not
     * merely while the flow is on screen. A closed flow still has to hear the
     * callback that reopens it.
     *
     * The account is read once on the way in, because a callback that landed
     * before this surface existed has no change left to announce.
     */
    const cloudWatchEnsure = (): void => {
        if (disposed || listeners.size === 0 || cloudUnsubscribe !== undefined) return;
        cloudUnsubscribe = deps.cloud.subscribe(cloudChanged);
        cloudChanged();
    };

    const cloudWatchStop = (): void => {
        cloudUnsubscribe?.();
        cloudUnsubscribe = undefined;
    };

    /**
     * The generated factor exists before the password screen: it is half of the
     * derivation and must be the same secret the reader is later shown.
     */
    const secretEnsure = (cloud: HappyAgentCloudSnapshot): void => {
        if (draft.secret !== undefined) return;
        if (cloud.keys.status !== "create_required") return;
        const seed = globalThis.crypto.getRandomValues(
            new Uint8Array(CLOUD_GENERATED_SECRET_SEED_BYTES),
        );
        draft.secret = stringifyCloudGeneratedSecret(seed);
        seed.fill(0);
    };

    /**
     * Takes the flow off screen and forgets its drafts. The account subscription
     * outlives it: it belongs to the surface being watched, not to the flow
     * being visible.
     */
    const close = (): void => {
        draft = draftEmpty();
        if (!deepEqual(store.getState(), CLOSED)) store.setState(CLOSED, true);
    };

    /**
     * Runs a key mutation from the derived pair. Both mutations answer with the
     * account's new authoritative snapshot, which arrives through the account
     * surface and moves the flow on by itself.
     *
     * The H1 secret goes with them. Only the derived pair is needed to open the
     * vault, but the secret itself cannot be recovered from the root, so a
     * daemon that never receives it can never show the reader their own recovery
     * key again. Sending it is what makes that key readable afterwards.
     */
    const keysSubmit = async (
        derivation: Promise<CloudDerivedKeys>,
        generatedSecret: CloudGeneratedSecret,
        restore: boolean,
    ): Promise<void> => {
        try {
            const keys = await derivation;
            if (disposed) return;
            const request = {
                authHash: keys.authHash,
                encryptionKey: keys.encryptionKey,
                generatedSecret,
                mutationId: draft.mutationId,
            };
            if (restore) await deps.client.restoreCloudKeys(request);
            else await deps.client.createCloudKeys(request);
            // The control stays busy until the account itself reports the keys
            // as ready: the mutation succeeding is not the same fact as the
            // flow having moved on, and only one of them is authoritative.
        } catch (error: unknown) {
            if (disposed) return;
            draft.derivation = undefined;
            draft.error = happyAgentUserError(error);
            draft.saving = false;
            publish();
        }
    };

    /**
     * Destroys the account's remote vault so a new one can be created.
     *
     * This is the way out of a machine that cannot be unlocked: without the
     * secret key the existing vault is unopenable by anyone, so keeping it only
     * blocks the account forever. Nothing is decided here about what comes
     * next — the daemon reports `create_required` once the vault is gone, and
     * the flow follows that the same way it follows every other account fact.
     */
    const vaultDelete = async (): Promise<void> => {
        try {
            await deps.client.deleteCloudKeys({
                confirmation: HAPPY_AGENT_SOCIAL_VAULT_DELETE_PHRASE,
                mutationId: draft.mutationId,
            });
            if (disposed) return;
            // The create flow that follows must not inherit anything typed
            // against the vault that no longer exists.
            const mutationId = globalThis.crypto.randomUUID();
            draft = draftEmpty();
            draft.mutationId = mutationId;
            publish();
        } catch (error: unknown) {
            if (disposed) return;
            draft.error = happyAgentUserError(error);
            draft.saving = false;
            publish();
        }
    };

    return {
        get: () => store.getState(),
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            const unsubscribe = store.subscribe(listener);
            if (listeners.size === 1) cloudWatchEnsure();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                unsubscribe();
                listeners.delete(listener);
                if (listeners.size === 0) cloudWatchStop();
            };
        },
        joinOpen() {
            if (disposed || store.getState().open) return;
            const cloud = deps.cloud.get();
            // Nothing to carry: this account is already live.
            if (cloud.keys.status === "ready" && cloud.socialConnection !== undefined) return;
            draft = draftEmpty();
            open(cloud);
            cloudWatchEnsure();
        },
        joinClose() {
            if (disposed || !store.getState().open) return;
            close();
        },
        accountConnect() {
            if (disposed) return;
            deps.cloud.cloudAccountConnect();
        },
        usernameUpdate(value) {
            if (disposed) return;
            deps.cloud.cloudProfileUsernameUpdate(value);
        },
        usernameSubmit() {
            if (disposed) return;
            deps.cloud.cloudProfileEnroll();
        },
        passwordUpdate(value) {
            if (disposed || draft.stage !== "password") return;
            draft.password = value;
            publish();
        },
        passwordSubmit() {
            if (disposed || draft.stage !== "password") return;
            if (!passwordRules(draft.password).every((rule) => rule.satisfied)) return;
            const secret = draft.secret;
            if (secret === undefined) return;
            draft.stage = "confirmation";
            draft.confirmation = "";
            draft.error = undefined;
            // Started here rather than at submission: the reader is about to
            // spend several seconds retyping, and the derivation costs about
            // one of them.
            const derivation = deriveCloudKeys(secret, draft.password);
            derivation.catch(() => undefined);
            draft.derivation = derivation;
            publish();
        },
        confirmationUpdate(value) {
            if (disposed || draft.stage !== "confirmation") return;
            draft.confirmation = value;
            draft.error = undefined;
            publish();
        },
        confirmationSubmit() {
            if (disposed || draft.stage !== "confirmation") return;
            if (!passwordsMatch(draft.password, draft.confirmation)) {
                draft.error = happyAgentUserError(new Error("Those passwords are not the same."));
                publish();
                return;
            }
            draft.stage = "secret";
            draft.error = undefined;
            publish();
        },
        acknowledgementUpdate(value) {
            if (disposed || draft.stage !== "secret") return;
            draft.acknowledged = value;
            publish();
        },
        secretSubmit() {
            if (disposed || draft.stage !== "secret" || draft.saving || !draft.acknowledged) return;
            const secret = draft.secret;
            if (secret === undefined) return;
            // A failed attempt clears the cached derivation so the retry derives
            // again from the same secret and password.
            const derivation = draft.derivation ?? deriveCloudKeys(secret, draft.password);
            derivation.catch(() => undefined);
            draft.derivation = derivation;
            draft.error = undefined;
            draft.saving = true;
            publish();
            void keysSubmit(derivation, secret, false);
        },
        restoreSecretUpdate(value) {
            if (disposed) return;
            draft.restoreSecret = value;
            draft.error = undefined;
            publish();
        },
        restorePasswordUpdate(value) {
            if (disposed) return;
            draft.restorePassword = value;
            draft.error = undefined;
            publish();
        },
        restoreSubmit() {
            if (disposed || draft.saving) return;
            const secret = secretParse(draft.restoreSecret);
            if (secret === undefined || draft.restorePassword === "") return;
            const derivation = deriveCloudKeys(secret, draft.restorePassword);
            derivation.catch(() => undefined);
            draft.derivation = derivation;
            draft.error = undefined;
            draft.saving = true;
            publish();
            void keysSubmit(derivation, secret, true);
        },
        vaultDeleteOpen() {
            if (disposed || draft.saving) return;
            draft.vaultDeleteOpen = true;
            draft.vaultDeleteConfirmation = "";
            draft.error = undefined;
            publish();
        },
        vaultDeleteCancel() {
            if (disposed || draft.saving) return;
            draft.vaultDeleteOpen = false;
            draft.vaultDeleteConfirmation = "";
            draft.error = undefined;
            publish();
        },
        vaultDeleteConfirmationUpdate(value) {
            if (disposed) return;
            draft.vaultDeleteConfirmation = value;
            draft.error = undefined;
            publish();
        },
        vaultDeleteSubmit() {
            if (disposed || draft.saving) return;
            if (draft.vaultDeleteConfirmation !== HAPPY_AGENT_SOCIAL_VAULT_DELETE_PHRASE) return;
            draft.error = undefined;
            draft.saving = true;
            publish();
            void vaultDelete();
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            cloudUnsubscribe?.();
            cloudUnsubscribe = undefined;
            listeners.clear();
        },
    };
}

/** Both factors are normalized before derivation, so both are compared that way. */
function passwordsMatch(password: string, confirmation: string): boolean {
    try {
        return normalizeCloudPassword(password) === normalizeCloudPassword(confirmation);
    } catch {
        return false;
    }
}

/** Returns the canonical secret, or nothing when the text is not one. */
function secretParse(value: string): CloudGeneratedSecret | undefined {
    const candidate = value.trim().toUpperCase();
    try {
        parseCloudGeneratedSecret(candidate).fill(0);
        return candidate;
    } catch {
        return undefined;
    }
}

function passwordRules(password: string): readonly HappyAgentSocialJoinPasswordRule[] {
    let normalized = "";
    try {
        normalized = normalizeCloudPassword(password);
    } catch {
        normalized = "";
    }
    return [
        {
            id: "length",
            satisfied: normalized.length >= HAPPY_AGENT_SOCIAL_JOIN_PASSWORD_MINIMUM,
        },
        {
            id: "variety",
            satisfied: new Set(normalized).size >= PASSWORD_DISTINCT_MINIMUM,
        },
    ];
}

/** Projects the account's authoritative state and the local drafts into one screen. */
function flowProject(cloud: HappyAgentCloudSnapshot, draft: JoinDraft): HappyAgentSocialJoinFlow {
    if (cloud.status === "loading") return { step: "checking" };
    if (cloud.status === "unavailable")
        return { step: "unavailable", ...(cloud.error ? { error: cloud.error } : {}) };
    if (cloud.status !== "connected")
        return {
            awaitingBrowser: cloud.status === "authorizing",
            starting: cloud.authorizationStarting || cloud.authorizationCompleting,
            step: "account",
            ...(cloud.error ? { error: cloud.error } : {}),
        };
    switch (cloud.enrollment.status) {
        case "inactive":
        case "checking":
            return { step: "checking" };
        case "required":
            return {
                step: "username",
                submitting: cloud.enrollment.submitting,
                username: cloud.enrollment.username,
                ...(cloud.enrollment.error ? { error: cloud.enrollment.error } : {}),
            };
        case "enrolling":
            return { step: "username", submitting: true, username: cloud.enrollment.username };
        case "enrolled":
            return keysProject(cloud, draft);
    }
}

function keysProject(cloud: HappyAgentCloudSnapshot, draft: JoinDraft): HappyAgentSocialJoinFlow {
    switch (cloud.keys.status) {
        // The daemon has not decided between creating and restoring yet, or is
        // clearing an unrestorable vault before it can. Either way there is
        // nothing to ask for and nothing has gone wrong: wait.
        case "inactive":
        case "checking":
        case "resetting":
            return { step: "checking" };
        case "restore_required":
            if (draft.vaultDeleteOpen)
                return {
                    confirmation: draft.vaultDeleteConfirmation,
                    step: "vault-delete",
                    submitting: draft.saving,
                    valid: draft.vaultDeleteConfirmation === HAPPY_AGENT_SOCIAL_VAULT_DELETE_PHRASE,
                    ...(draft.error ? { error: draft.error } : {}),
                };
            return {
                password: draft.restorePassword,
                secret: draft.restoreSecret,
                step: "restore",
                submitting: draft.saving,
                valid: secretParse(draft.restoreSecret) !== undefined,
                ...(draft.error ? { error: draft.error } : {}),
            };
        case "create_required": {
            if (draft.secret === undefined) return { step: "checking" };
            if (draft.stage === "password") {
                const rules = passwordRules(draft.password);
                return {
                    password: draft.password,
                    rules,
                    satisfied: rules.every((rule) => rule.satisfied),
                    step: "password",
                };
            }
            if (draft.stage === "confirmation")
                return {
                    confirmation: draft.confirmation,
                    step: "confirmation",
                    ...(draft.error ? { error: draft.error } : {}),
                };
            return {
                acknowledged: draft.acknowledged,
                saving: draft.saving,
                secret: draft.secret,
                step: "secret",
                ...(draft.error ? { error: draft.error } : {}),
            };
        }
        case "ready":
            return { stages: stagesProject(cloud), step: "connecting" };
    }
}

function stagesProject(cloud: HappyAgentCloudSnapshot): readonly HappyAgentSocialJoinStage[] {
    return [
        { id: "account", state: "done" },
        { id: "username", state: "done" },
        { id: "keys", state: "done" },
        { id: "network", state: cloud.socialConnection === undefined ? "active" : "done" },
    ];
}

/** A settled stand-in when this Happy Agent cannot join Happy Social. */
export const happyAgentSocialJoinStoreNoop: HappyAgentSocialJoinStore = {
    get: () => CLOSED,
    subscribe: () => () => undefined,
    joinOpen: () => undefined,
    joinClose: () => undefined,
    accountConnect: () => undefined,
    usernameUpdate: () => undefined,
    usernameSubmit: () => undefined,
    passwordUpdate: () => undefined,
    passwordSubmit: () => undefined,
    confirmationUpdate: () => undefined,
    confirmationSubmit: () => undefined,
    acknowledgementUpdate: () => undefined,
    secretSubmit: () => undefined,
    restoreSecretUpdate: () => undefined,
    restorePasswordUpdate: () => undefined,
    restoreSubmit: () => undefined,
    vaultDeleteOpen: () => undefined,
    vaultDeleteCancel: () => undefined,
    vaultDeleteConfirmationUpdate: () => undefined,
    vaultDeleteSubmit: () => undefined,
    [Symbol.dispose]: () => undefined,
};
