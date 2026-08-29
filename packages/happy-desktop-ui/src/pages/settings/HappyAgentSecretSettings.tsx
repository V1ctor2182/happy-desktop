import { useState } from "react";
import { Badge } from "../../Badge";
import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { Button } from "../../Button";
import { EmptyState } from "../../EmptyState";
import { FormRow } from "../../FormRow";
import { Icon } from "../../Icon";
import { Spinner } from "../../Spinner";
import {
    HappyAgentSecretCreateDialog,
    happyAgentSecretCreateDraftValid,
    type HappyAgentSecretCreateDraft,
} from "./HappyAgentSecretCreateDialog";
import { HappyAgentSettingsSection } from "./HappyAgentSettingsShell";

export interface HappyAgentSecretRow {
    readonly availableToAgents: boolean;
    readonly description: string;
    readonly environmentVariables: readonly string[];
    readonly id: string;
    readonly managed: boolean;
    /** Already localized by the application boundary. */
    readonly updatedAt: string;
}

export interface HappyAgentSecretCreateInput {
    readonly availableToAgents: boolean;
    readonly description: string;
    readonly environmentVariables: readonly {
        readonly name: string;
        readonly value: string;
    }[];
}

export interface HappyAgentSecretSettingsProps {
    readonly error?: string;
    /** Opens the transient create form on first render, for restored/fixture state. */
    readonly initialCreateOpen?: boolean;
    readonly loading?: boolean;
    readonly secrets: readonly HappyAgentSecretRow[];
    readonly unavailable?: string;
    onSecretCreate(input: HappyAgentSecretCreateInput): Promise<void>;
}

const createDraft = (): HappyAgentSecretCreateDraft => ({
    availableToAgents: false,
    description: "",
    nextVariableId: 2,
    variables: [{ id: 1, name: "", value: "" }],
});

/** Global secret metadata and the write-only flow for creating one. */
export function HappyAgentSecretSettings(props: HappyAgentSecretSettingsProps) {
    const [draft, setDraft] = useState<HappyAgentSecretCreateDraft | undefined>(() =>
        props.initialCreateOpen ? createDraft() : undefined,
    );
    const [attempted, setAttempted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string>();
    const close = () => {
        if (submitting) return;
        setDraft(undefined);
        setAttempted(false);
        setSubmitError(undefined);
    };
    const change = (
        update: (current: HappyAgentSecretCreateDraft) => HappyAgentSecretCreateDraft,
    ) => {
        setDraft((current) => (current === undefined ? current : update(current)));
        setSubmitError(undefined);
    };
    const submit = () => {
        if (draft === undefined || submitting) return;
        setAttempted(true);
        if (!happyAgentSecretCreateDraftValid(draft) || props.unavailable !== undefined) return;
        setSubmitting(true);
        setSubmitError(undefined);
        void Promise.resolve()
            .then(() =>
                props.onSecretCreate({
                    availableToAgents: draft.availableToAgents,
                    description: draft.description.trim(),
                    environmentVariables: draft.variables.map(({ name, value }) => ({
                        name,
                        value,
                    })),
                }),
            )
            .then(
                () => {
                    setSubmitting(false);
                    setDraft(undefined);
                    setAttempted(false);
                },
                (error: unknown) => {
                    setSubmitting(false);
                    setSubmitError(error instanceof Error ? error.message : String(error));
                },
            );
    };
    return (
        <>
            {props.unavailable ? (
                <Banner tone="neutral" title="Happy Agent reconnecting">
                    {props.unavailable}
                </Banner>
            ) : null}
            <HappyAgentSettingsSection>
                <FormRow
                    control={
                        <Button
                            disabled={props.unavailable !== undefined}
                            icon="plus"
                            onClick={() => {
                                setDraft(createDraft());
                                setAttempted(false);
                                setSubmitError(undefined);
                            }}
                            title={props.unavailable}
                        >
                            New secret
                        </Button>
                    }
                    description="Bundle one or more environment variables. Values are write-only; Happy Agent returns metadata, never the stored values."
                    label="Saved secrets"
                />
            </HappyAgentSettingsSection>
            {props.error ? (
                <Banner tone="danger" title="Secrets unavailable">
                    {props.error}
                </Banner>
            ) : props.loading ? (
                <Box className="happy-agent-settings__pending">
                    <Spinner size={16} />
                    <span>Reading secrets…</span>
                </Box>
            ) : props.secrets.length === 0 ? (
                <EmptyState
                    description="Create a write-only environment bundle for agents on this Happy Agent."
                    icon="lock"
                    size="inline"
                    title="No secrets yet"
                />
            ) : (
                <HappyAgentSettingsSection rows="cards" title="Environment bundles">
                    {props.secrets.map((secret) => (
                        <article
                            className="happy-agent-secret"
                            data-happy-desktop-ui="happy-agent-secret"
                            key={secret.id}
                        >
                            <header className="happy-agent-secret__header">
                                <span
                                    className="happy-agent-secret__glyph"
                                    data-happy-desktop-ui="happy-agent-secret-glyph"
                                >
                                    <Icon name="lock" size={16} />
                                </span>
                                <Box className="happy-agent-secret__identity">
                                    <span
                                        className="happy-agent-secret__description"
                                        data-happy-desktop-ui="happy-agent-secret-description"
                                    >
                                        {secret.description}
                                    </span>
                                    <span
                                        className="happy-agent-secret__updated"
                                        data-happy-desktop-ui="happy-agent-secret-updated"
                                    >
                                        Updated {secret.updatedAt}
                                    </span>
                                </Box>
                                <Box className="happy-agent-secret__badges">
                                    {secret.managed ? (
                                        <Badge label="Managed" variant="neutral" />
                                    ) : null}
                                    <Badge
                                        label={secret.availableToAgents ? "All agents" : "Scoped"}
                                        variant={secret.availableToAgents ? "success" : "outline"}
                                    />
                                </Box>
                            </header>
                            <Box
                                aria-label="Environment variables"
                                className="happy-agent-secret__variables"
                            >
                                {secret.environmentVariables.map((name) => (
                                    <code
                                        className="happy-agent-secret__variable"
                                        data-happy-desktop-ui="happy-agent-secret-variable"
                                        key={name}
                                    >
                                        {name}
                                    </code>
                                ))}
                            </Box>
                        </article>
                    ))}
                </HappyAgentSettingsSection>
            )}
            {draft === undefined ? null : (
                <HappyAgentSecretCreateDialog
                    attempted={attempted}
                    draft={draft}
                    error={submitError}
                    onAvailableToAgentsChange={(availableToAgents) =>
                        change((current) => ({ ...current, availableToAgents }))
                    }
                    onClose={close}
                    onDescriptionChange={(description) =>
                        change((current) => ({ ...current, description }))
                    }
                    onSubmit={submit}
                    onVariableAdd={() =>
                        change((current) => ({
                            ...current,
                            nextVariableId: current.nextVariableId + 1,
                            variables: [
                                ...current.variables,
                                { id: current.nextVariableId, name: "", value: "" },
                            ],
                        }))
                    }
                    onVariableNameChange={(id, name) =>
                        change((current) => ({
                            ...current,
                            variables: current.variables.map((variable) =>
                                variable.id === id ? { ...variable, name } : variable,
                            ),
                        }))
                    }
                    onVariableRemove={(id) =>
                        change((current) => ({
                            ...current,
                            variables: current.variables.filter((variable) => variable.id !== id),
                        }))
                    }
                    onVariableValueChange={(id, value) =>
                        change((current) => ({
                            ...current,
                            variables: current.variables.map((variable) =>
                                variable.id === id ? { ...variable, value } : variable,
                            ),
                        }))
                    }
                    submitting={submitting}
                    unavailable={props.unavailable}
                />
            )}
        </>
    );
}
