import type { CSSProperties } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { TextField } from "./TextField";

export type HappyAgentProjectCloneDialogProps = {
    /**
     * The GitHub repository to clone. The caller owns this draft so it remains
     * intact while its Happy Agent publishes project changes around the dialog.
     */
    repository: string;
    /** True while the Happy Agent is creating the checkout. */
    submitting?: boolean;
    /** Why the last clone attempt failed, in the Happy Agent's own words. */
    error?: string;
    /** Why this Happy Agent cannot currently accept a clone request. */
    submitDisabledReason?: string;
    onRepositoryChange: (repository: string) => void;
    onSubmit: () => void;
    onClose: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * C-256 HappyAgentProjectCloneDialog — clone a GitHub project onto one Happy Agent.
 *
 * This is deliberately one field: GitHub's usual `owner/repository` spelling
 * is shortest to type, while a pasted GitHub URL remains equally clear. Where
 * the checkout lands is a decision for the addressed Happy Agent, not another local
 * path form that the reader must understand. The caller owns all durable state and
 * request lifecycle, making default, offline, failure, and in-flight states
 * directly renderable without an application dependency.
 */
export function HappyAgentProjectCloneDialog(props: HappyAgentProjectCloneDialogProps) {
    const submitting = props.submitting === true;
    const submittable =
        props.repository.trim().length > 0 &&
        !submitting &&
        props.submitDisabledReason === undefined;
    return (
        <ModalOverlay
            onDismiss={() => {
                if (!submitting) props.onClose();
            }}
        >
            <Modal
                className={props.className}
                data-testid={props["data-testid"]}
                footer={
                    <>
                        <Button disabled={submitting} onClick={props.onClose} variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={!submittable}
                            onClick={props.onSubmit}
                            title={props.submitDisabledReason}
                            variant="primary"
                        >
                            {submitting ? "Cloning…" : "Clone project"}
                        </Button>
                    </>
                }
                icon="branch"
                onClose={submitting ? undefined : props.onClose}
                size="medium"
                style={props.style}
                title="Clone GitHub project"
            >
                <div
                    className="happy2-happy-agent-project-clone-dialog"
                    data-happy-desktop-ui="happy-agent-project-clone-dialog"
                >
                    {props.submitDisabledReason ? (
                        <Banner tone="neutral" title="Happy Agent unavailable">
                            {props.submitDisabledReason}
                        </Banner>
                    ) : null}
                    {props.error ? (
                        <Banner tone="danger" title="Couldn’t clone project">
                            {props.error}
                        </Banner>
                    ) : null}
                    <TextField
                        autoFocus
                        disabled={submitting}
                        fullWidth
                        label="GitHub repository"
                        onSubmit={() => {
                            if (submittable) props.onSubmit();
                        }}
                        onValueChange={props.onRepositoryChange}
                        placeholder="owner/repository or https://github.com/owner/repository"
                        value={props.repository}
                    />
                    <p
                        className="happy2-happy-agent-project-clone-dialog__hint"
                        data-happy-desktop-ui="happy-agent-project-clone-dialog-hint"
                    >
                        Clone a repository this HappyAgent can access.
                    </p>
                </div>
            </Modal>
        </ModalOverlay>
    );
}
