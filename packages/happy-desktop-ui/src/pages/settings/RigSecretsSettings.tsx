import { Badge } from "../../Badge";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { Icon } from "../../Icon";
import { Spinner } from "../../Spinner";
import { TextField } from "../../TextField";
import { RigSettingsSection } from "./RigSettingsShell";

/** One secret bundle a machine holds, as this page lists it. */
export interface RigSecretRow {
    readonly id: string;
    readonly description: string;
    /** The environment variables the bundle binds. Never their values. */
    readonly variables: readonly string[];
    /** This row asked to be removed and is waiting for that to be confirmed. */
    readonly confirmingRemove?: boolean;
    /** The removal is in flight. */
    readonly removing?: boolean;
}

/** One variable line in the form. `key` identifies the line, not the variable. */
export interface RigSecretVariableField {
    readonly key: string;
    readonly name: string;
    readonly value: string;
}

/**
 * The bundle being written.
 *
 * `update` differs from `create` in one thing: the id is settled, because
 * writing a different one would register a second bundle instead of changing
 * this one. Values are entered in both, since a machine keeps them to itself
 * and a replacement therefore states the whole bundle again.
 */
export interface RigSecretEditor {
    readonly mode: "create" | "update";
    readonly secretId: string;
    readonly description: string;
    readonly variables: readonly RigSecretVariableField[];
    readonly saving?: boolean;
    /** Why the machine refused the last registration, in its own words. */
    readonly error?: string;
    onIdChange: (value: string) => void;
    onDescriptionChange: (value: string) => void;
    onVariableNameChange: (key: string, value: string) => void;
    onVariableValueChange: (key: string, value: string) => void;
    onVariableRemove: (key: string) => void;
    onVariableAdd: () => void;
    onSave: () => void;
    onCancel: () => void;
}

export type RigSecretsSettingsProps = {
    secrets: readonly RigSecretRow[];
    /** True until the first listing arrives, so "no secrets" is not claimed early. */
    loading?: boolean;
    /** Why the list could not be read at all. */
    error?: string;
    /** Why the last removal was refused. */
    removeError?: string;
    /** The form, while one is open. Absent leaves the page a list. */
    editor?: RigSecretEditor;
    onSecretCreate: () => void;
    onSecretEdit: (id: string) => void;
    onSecretRemoveStart: (id: string) => void;
    onSecretRemoveCancel: () => void;
    onSecretRemoveConfirm: () => void;
    /** Why nothing here can be changed right now — an unreachable machine. */
    unavailable?: string;
};

/**
 * The Secrets category: the bundles of environment values this machine hands to
 * the commands its agents run.
 *
 * A bundle is listed by what it binds rather than by what it holds. The machine
 * never gives a value back — that is the point of keeping it there — so this
 * page can say a bundle sets `GITHUB_TOKEN` and never what the token is, and
 * changing one means stating the whole bundle again rather than editing a value
 * that was never on screen.
 */
export function RigSecretsSettings(props: RigSecretsSettingsProps) {
    const settled = props.loading !== true;
    const editor = props.editor;
    return (
        <RigSettingsSection
            description="Bundles of environment values this machine gives to the commands its agents run. Values are write-only: they are never shown again, and replacing a bundle means entering them once more."
            rows="cards"
            title="Secrets"
        >
            {props.unavailable ? <Banner tone="warning">{props.unavailable}</Banner> : null}
            {props.error ? (
                <Banner tone="danger" title="Secrets unavailable">
                    {props.error}
                </Banner>
            ) : null}
            {props.removeError ? (
                <Banner tone="danger" title="Not removed">
                    {props.removeError}
                </Banner>
            ) : null}
            {editor ? (
                <form
                    className="happy2-rig-secret-form"
                    data-happy-desktop-ui="rig-secret-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        editor.onSave();
                    }}
                >
                    <span
                        className="happy2-rig-secret-form__title"
                        data-happy-desktop-ui="rig-secret-form-title"
                    >
                        {editor.mode === "create" ? "New secret" : `Replace ${editor.secretId}`}
                    </span>
                    {editor.error ? (
                        <Banner tone="danger" title="Not saved">
                            {editor.error}
                        </Banner>
                    ) : null}
                    {editor.mode === "create" ? (
                        <TextField
                            autoFocus
                            fullWidth
                            hint="Letters, numbers, periods, underscores, colons, and hyphens."
                            label="Identifier"
                            onValueChange={editor.onIdChange}
                            placeholder="github"
                            size="medium"
                            value={editor.secretId}
                        />
                    ) : null}
                    <TextField
                        fullWidth
                        label="Description"
                        onValueChange={editor.onDescriptionChange}
                        placeholder="What this bundle is for"
                        size="medium"
                        value={editor.description}
                    />
                    <Box className="happy2-rig-secret-form__variables">
                        <span className="happy2-rig-secret-form__variables-label">
                            Environment variables
                        </span>
                        {editor.variables.map((variable) => (
                            <Box
                                className="happy2-rig-secret-form__variable"
                                data-happy-desktop-ui="rig-secret-form-variable"
                                key={variable.key}
                            >
                                <TextField
                                    aria-label="Variable name"
                                    className="happy2-rig-secret-form__variable-name"
                                    onValueChange={(value) => {
                                        editor.onVariableNameChange(variable.key, value);
                                    }}
                                    placeholder="GITHUB_TOKEN"
                                    size="medium"
                                    value={variable.name}
                                />
                                <TextField
                                    aria-label="Variable value"
                                    className="happy2-rig-secret-form__variable-value"
                                    onValueChange={(value) => {
                                        editor.onVariableValueChange(variable.key, value);
                                    }}
                                    placeholder="Value"
                                    size="medium"
                                    type="password"
                                    value={variable.value}
                                />
                                <Button
                                    aria-label={`Remove ${variable.name || "variable"}`}
                                    icon="close"
                                    iconOnly
                                    onClick={() => {
                                        editor.onVariableRemove(variable.key);
                                    }}
                                    size="medium"
                                    variant="ghost"
                                />
                            </Box>
                        ))}
                        <Box className="happy2-rig-secret-form__variables-actions">
                            <Button
                                icon="plus"
                                onClick={editor.onVariableAdd}
                                size="small"
                                variant="secondary"
                            >
                                Add variable
                            </Button>
                        </Box>
                    </Box>
                    <Box className="happy2-rig-secret-form__actions">
                        <Button onClick={editor.onCancel} size="medium" variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={props.unavailable !== undefined}
                            loading={editor.saving}
                            size="medium"
                            type="submit"
                            variant="primary"
                        >
                            {editor.mode === "create" ? "Add secret" : "Replace secret"}
                        </Button>
                    </Box>
                </form>
            ) : (
                <Box className="happy2-rig-secret__toolbar">
                    <Button
                        disabled={props.unavailable !== undefined}
                        icon="plus"
                        onClick={props.onSecretCreate}
                        size="small"
                        variant="secondary"
                    >
                        Add secret
                    </Button>
                </Box>
            )}
            {props.secrets.map((secret) => (
                <article
                    className="happy2-rig-secret"
                    data-happy-desktop-ui="rig-secret"
                    key={secret.id}
                >
                    <header className="happy2-rig-secret__header">
                        <Box className="happy2-rig-secret__identity">
                            <span
                                className="happy2-rig-secret__glyph"
                                data-happy-desktop-ui="rig-secret-glyph"
                            >
                                <Icon name="lock" size={16} />
                            </span>
                            <Box className="happy2-rig-secret__naming">
                                <span
                                    className="happy2-rig-secret__name"
                                    data-happy-desktop-ui="rig-secret-name"
                                >
                                    {secret.id}
                                </span>
                                <span
                                    className="happy2-rig-secret__meta"
                                    data-happy-desktop-ui="rig-secret-meta"
                                >
                                    {secret.description}
                                </span>
                            </Box>
                        </Box>
                        {secret.confirmingRemove === true ? null : (
                            <Box className="happy2-rig-secret__actions">
                                <Button
                                    disabled={props.unavailable !== undefined}
                                    onClick={() => {
                                        props.onSecretEdit(secret.id);
                                    }}
                                    size="small"
                                    variant="secondary"
                                >
                                    Replace
                                </Button>
                                <Button
                                    aria-label={`Remove ${secret.id}`}
                                    disabled={props.unavailable !== undefined}
                                    icon="trash"
                                    iconOnly
                                    onClick={() => {
                                        props.onSecretRemoveStart(secret.id);
                                    }}
                                    size="small"
                                    variant="ghost"
                                />
                            </Box>
                        )}
                    </header>
                    <Box
                        className="happy2-rig-secret__variables"
                        data-happy-desktop-ui="rig-secret-variables"
                    >
                        {secret.variables.length > 0 ? (
                            secret.variables.map((variable) => (
                                <Badge key={variable} label={variable} variant="outline" />
                            ))
                        ) : (
                            <span className="happy2-rig-secret__empty-variables">
                                This bundle binds no variables.
                            </span>
                        )}
                    </Box>
                    {secret.confirmingRemove === true ? (
                        <Box
                            className="happy2-rig-secret__confirm"
                            data-happy-desktop-ui="rig-secret-confirm"
                        >
                            <span className="happy2-rig-secret__confirm-text">
                                Remove this secret and every value in it? Sessions using it lose
                                those variables.
                            </span>
                            <Box className="happy2-rig-secret__actions">
                                <Button
                                    onClick={props.onSecretRemoveCancel}
                                    size="small"
                                    variant="ghost"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    loading={secret.removing}
                                    onClick={props.onSecretRemoveConfirm}
                                    size="small"
                                    variant="danger"
                                >
                                    Remove
                                </Button>
                            </Box>
                        </Box>
                    ) : null}
                </article>
            ))}
            {!settled && props.secrets.length === 0 && !props.error ? (
                <Box className="happy2-rig-settings__pending">
                    <Spinner size={16} />
                    <span>Reading this machine&apos;s secrets…</span>
                </Box>
            ) : null}
            {settled && props.secrets.length === 0 && !props.error ? (
                <EmptyState
                    description="Nothing is registered yet. A secret added here is given to the commands this machine's agents run."
                    icon="lock"
                    size="panel"
                    title="No secrets"
                />
            ) : null}
        </RigSettingsSection>
    );
}
