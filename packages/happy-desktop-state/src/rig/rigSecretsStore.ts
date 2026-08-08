import type { UserError } from "../types.js";
import type { RigTransport } from "./rigTransport.js";
import { rigUserError } from "./rigSupport.js";

/**
 * One secret bundle a Rig holds: an id, what it is for, and the environment
 * variables it binds.
 *
 * The values are absent by design. Rig gives them to the commands it runs and
 * never reads them back out, so this surface can say a bundle binds
 * `GITHUB_TOKEN` but never what that token is — including to the person who
 * registered it.
 */
export interface RigSecret {
    readonly id: string;
    readonly description: string;
    readonly environmentVariables: readonly string[];
}

/**
 * One variable line in the editor. `key` is a local identity for the row and
 * has nothing to do with the variable's name: a row keeps its identity while
 * its name is being typed, which is what stops a field from being replaced
 * under the caret on every keystroke.
 */
export interface RigSecretVariableDraft {
    readonly key: string;
    readonly name: string;
    readonly value: string;
}

/**
 * The bundle being written, as the form holds it.
 *
 * `create` and `update` differ in one thing only: an existing bundle's id is
 * settled and cannot be typed over, because writing a different id would
 * register a second bundle rather than change this one. Everything else is
 * entered the same way, values included — Rig replaces a bundle wholesale, so
 * an update states the complete environment rather than a patch of it.
 */
export interface RigSecretEditorSnapshot {
    readonly mode: "create" | "update";
    readonly secretId: string;
    readonly description: string;
    readonly variables: readonly RigSecretVariableDraft[];
    /** A registration is in flight. */
    readonly saving: boolean;
    /** Why the last registration was refused — the daemon's own reason. */
    readonly saveError?: UserError;
}

export interface RigSecretsSnapshot {
    /** Every bundle this Rig holds, in the order it reports them. */
    readonly secrets: readonly RigSecret[];
    /** True until the first read answers, so "no secrets" is not claimed early. */
    readonly loading: boolean;
    /** Why the list could not be read at all. */
    readonly error?: UserError;
    /** The bundle being added or replaced, while a form is open. */
    readonly editor?: RigSecretEditorSnapshot;
    /** The bundle whose removal is waiting to be confirmed. */
    readonly removingId?: string;
    /** A removal is in flight. */
    readonly removing: boolean;
    /** Why the last removal was refused. */
    readonly removeError?: UserError;
}

export interface RigSecretsStore {
    get(): RigSecretsSnapshot;
    subscribe(listener: () => void): () => void;
    /** Opens an empty form for a bundle this Rig does not hold yet. */
    secretCreateStart(): void;
    /**
     * Opens the form over an existing bundle. Its variable names are carried in
     * with empty values, because Rig never gave them back and a replacement has
     * to state them again.
     */
    secretEditStart(secretId: string): void;
    /** Abandons the form, unsaved. */
    secretEditCancel(): void;
    secretIdUpdate(value: string): void;
    secretDescriptionUpdate(value: string): void;
    secretVariableAdd(): void;
    secretVariableNameUpdate(key: string, value: string): void;
    secretVariableValueUpdate(key: string, value: string): void;
    secretVariableRemove(key: string): void;
    /** Registers what the form holds; the daemon decides whether it is acceptable. */
    secretSave(): void;
    /** Asks for a bundle's removal, which is confirmed before anything happens. */
    secretRemoveStart(secretId: string): void;
    secretRemoveCancel(): void;
    secretRemoveConfirm(): void;
    [Symbol.dispose](): void;
}

export interface RigSecretsStoreDeps {
    readonly transport: Pick<RigTransport, "secretsRead" | "secretWrite" | "secretRemove">;
}

/** How often the list is re-read while a surface is watching it. */
const SECRETS_POLL_INTERVAL_MS = 4_000;

const NO_SECRETS: readonly RigSecret[] = [];
const EMPTY: RigSecretsSnapshot = { secrets: NO_SECRETS, loading: true, removing: false };
const SETTLED: RigSecretsSnapshot = { ...EMPTY, loading: false };

/**
 * The secret bundles of one Rig, as a page that lists them and a form that
 * writes one.
 *
 * Rig publishes no event when its registry changes, so the list keeps itself
 * current by re-reading while something is subscribed and stopping the moment
 * nothing is: a settings window that is never opened never asks, and one that
 * is closed stops asking. A write goes straight to the daemon and the answer it
 * gives is what lands in the list — nothing here invents a bundle the daemon
 * has not confirmed.
 */
export function rigSecretsStoreCreate(deps: RigSecretsStoreDeps): RigSecretsStore {
    const listeners = new Set<() => void>();
    let snapshot: RigSecretsSnapshot = EMPTY;
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextVariableKey = 0;

    const publish = (next: RigSecretsSnapshot): void => {
        if (snapshot === next) return;
        snapshot = next;
        for (const listener of listeners) listener();
    };

    const timerCancel = (): void => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
    };

    const schedule = (): void => {
        if (disposed || listeners.size === 0 || timer !== undefined) return;
        timer = setTimeout(() => {
            timer = undefined;
            load();
        }, SECRETS_POLL_INTERVAL_MS);
    };

    /** Private authoritative writer: a daemon answer never passes through a public action. */
    const secretsLoaded = (secrets: readonly RigSecret[]): void => {
        const { error: _cleared, ...rest } = snapshot;
        publish({ ...rest, secrets: secretsPreserve(snapshot.secrets, secrets), loading: false });
    };

    const load = (): void => {
        if (disposed || listeners.size === 0 || controller !== undefined) return;
        timerCancel();
        const current = new AbortController();
        controller = current;
        void deps.transport.secretsRead(current.signal).then(
            (secrets) => {
                if (disposed || controller !== current) return;
                controller = undefined;
                secretsLoaded(secrets);
                schedule();
            },
            (error: unknown) => {
                if (disposed || controller !== current || current.signal.aborted) return;
                controller = undefined;
                // A failed refresh never empties a list that was read once: the
                // bundles this Rig held a moment ago did not stop existing
                // because one read did not arrive.
                if (snapshot.loading)
                    publish({ ...snapshot, loading: false, error: rigUserError(error) });
                schedule();
            },
        );
    };

    const variableCreate = (name: string): RigSecretVariableDraft => {
        nextVariableKey += 1;
        return { key: `variable-${String(nextVariableKey)}`, name, value: "" };
    };

    const editorUpdate = (
        change: (editor: RigSecretEditorSnapshot) => RigSecretEditorSnapshot,
    ): void => {
        const editor = snapshot.editor;
        if (!editor || editor.saving) return;
        // Any edit answers the daemon's last refusal: it was about the bundle as
        // it stood, and it no longer stands that way.
        const { saveError: _cleared, ...rest } = change(editor);
        publish({ ...snapshot, editor: rest });
    };

    return {
        get: () => snapshot,
        subscribe(listener) {
            if (disposed) return () => undefined;
            listeners.add(listener);
            if (listeners.size === 1) load();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                listeners.delete(listener);
                if (listeners.size !== 0) return;
                timerCancel();
                controller?.abort();
                controller = undefined;
            };
        },
        secretCreateStart() {
            if (disposed) return;
            publish({
                ...snapshot,
                editor: {
                    mode: "create",
                    secretId: "",
                    description: "",
                    variables: [variableCreate("")],
                    saving: false,
                },
            });
        },
        secretEditStart(secretId) {
            if (disposed) return;
            const secret = snapshot.secrets.find((candidate) => candidate.id === secretId);
            if (!secret) return;
            publish({
                ...snapshot,
                editor: {
                    mode: "update",
                    secretId: secret.id,
                    description: secret.description,
                    variables:
                        secret.environmentVariables.length > 0
                            ? secret.environmentVariables.map((name) => variableCreate(name))
                            : [variableCreate("")],
                    saving: false,
                },
            });
        },
        secretEditCancel() {
            if (disposed || !snapshot.editor || snapshot.editor.saving) return;
            const { editor: _closed, ...rest } = snapshot;
            publish(rest);
        },
        secretIdUpdate(value) {
            // Only an unregistered bundle has an id to choose. Typing over the
            // id of one this Rig already holds would register a second bundle
            // rather than replace this one.
            editorUpdate((editor) =>
                editor.mode === "create" ? { ...editor, secretId: value } : editor,
            );
        },
        secretDescriptionUpdate(value) {
            editorUpdate((editor) => ({ ...editor, description: value }));
        },
        secretVariableAdd() {
            editorUpdate((editor) => ({
                ...editor,
                variables: [...editor.variables, variableCreate("")],
            }));
        },
        secretVariableNameUpdate(key, value) {
            editorUpdate((editor) => ({
                ...editor,
                variables: editor.variables.map((variable) =>
                    variable.key === key ? { ...variable, name: value } : variable,
                ),
            }));
        },
        secretVariableValueUpdate(key, value) {
            editorUpdate((editor) => ({
                ...editor,
                variables: editor.variables.map((variable) =>
                    variable.key === key ? { ...variable, value } : variable,
                ),
            }));
        },
        secretVariableRemove(key) {
            editorUpdate((editor) => {
                const variables = editor.variables.filter((variable) => variable.key !== key);
                // A bundle with no variables binds nothing, so the form always
                // offers one line to fill in rather than becoming empty.
                return {
                    ...editor,
                    variables: variables.length > 0 ? variables : [variableCreate("")],
                };
            });
        },
        secretSave() {
            const editor = snapshot.editor;
            if (disposed || !editor || editor.saving) return;
            // The whole registration is sent as typed. Rig is the authority on
            // what it will keep — the id's shape, a missing description, a
            // variable name it cannot bind — and its refusal says so in words
            // this form can show, which a Save button that quietly stops
            // working cannot.
            const environment: Record<string, string> = {};
            for (const variable of editor.variables) {
                const name = variable.name.trim();
                if (name.length > 0) environment[name] = variable.value;
            }
            const registration = {
                id: editor.secretId.trim(),
                description: editor.description.trim(),
                environment,
            };
            const { saveError: _cleared, ...rest } = editor;
            publish({ ...snapshot, editor: { ...rest, saving: true } });
            void deps.transport.secretWrite(registration).then(
                () => {
                    if (disposed) return;
                    const { editor: _closed, ...remaining } = snapshot;
                    publish(remaining);
                    // The daemon's own list is what the page shows, so the
                    // bundle it just confirmed arrives the way every other one
                    // does rather than being spliced in here.
                    controller?.abort();
                    controller = undefined;
                    load();
                },
                (error: unknown) => {
                    if (disposed) return;
                    const current = snapshot.editor;
                    if (!current) return;
                    publish({
                        ...snapshot,
                        editor: { ...current, saving: false, saveError: rigUserError(error) },
                    });
                },
            );
        },
        secretRemoveStart(secretId) {
            if (disposed || snapshot.removing) return;
            const { removeError: _cleared, ...rest } = snapshot;
            publish({ ...rest, removingId: secretId });
        },
        secretRemoveCancel() {
            if (disposed || snapshot.removing) return;
            const { removingId: _cleared, removeError: _alsoCleared, ...rest } = snapshot;
            publish(rest);
        },
        secretRemoveConfirm() {
            const secretId = snapshot.removingId;
            if (disposed || secretId === undefined || snapshot.removing) return;
            const { removeError: _cleared, ...rest } = snapshot;
            publish({ ...rest, removing: true });
            void deps.transport.secretRemove(secretId).then(
                () => {
                    if (disposed) return;
                    const { removingId: _done, ...remaining } = snapshot;
                    publish({ ...remaining, removing: false });
                    controller?.abort();
                    controller = undefined;
                    load();
                },
                (error: unknown) => {
                    if (disposed) return;
                    publish({
                        ...snapshot,
                        removing: false,
                        removeError: rigUserError(error),
                    });
                },
            );
        },
        [Symbol.dispose]() {
            if (disposed) return;
            disposed = true;
            timerCancel();
            controller?.abort();
            controller = undefined;
            listeners.clear();
        },
    };
}

/** Stands in where no Rig on this machine is connected to read secrets from. */
export const rigSecretsStoreNoop: RigSecretsStore = {
    get: () => SETTLED,
    subscribe: () => () => undefined,
    secretCreateStart: () => undefined,
    secretEditStart: () => undefined,
    secretEditCancel: () => undefined,
    secretIdUpdate: () => undefined,
    secretDescriptionUpdate: () => undefined,
    secretVariableAdd: () => undefined,
    secretVariableNameUpdate: () => undefined,
    secretVariableValueUpdate: () => undefined,
    secretVariableRemove: () => undefined,
    secretSave: () => undefined,
    secretRemoveStart: () => undefined,
    secretRemoveCancel: () => undefined,
    secretRemoveConfirm: () => undefined,
    [Symbol.dispose]: () => undefined,
};

/**
 * Keeps the object an unchanged bundle already had, so a re-read leaves every
 * row a view is holding alone. Rig stamps no revision on a secret, so the whole
 * public value decides.
 */
function secretsPreserve(
    previous: readonly RigSecret[],
    incoming: readonly RigSecret[],
): readonly RigSecret[] {
    const before = new Map(previous.map((secret) => [secret.id, secret]));
    const next = incoming.map((secret) => {
        const candidate = before.get(secret.id);
        return candidate !== undefined && secretEquals(candidate, secret) ? candidate : secret;
    });
    return next.length === previous.length && next.every((item, index) => item === previous[index])
        ? previous
        : next;
}

function secretEquals(a: RigSecret, b: RigSecret): boolean {
    return (
        a.id === b.id &&
        a.description === b.description &&
        a.environmentVariables.length === b.environmentVariables.length &&
        a.environmentVariables.every((name, index) => name === b.environmentVariables[index])
    );
}
