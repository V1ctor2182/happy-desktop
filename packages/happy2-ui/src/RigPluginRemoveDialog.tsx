import { type CSSProperties } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { Spinner } from "./Spinner";

export interface RigPluginRemoveDialogProps {
    /** The package's name, as the machine reports it. */
    name: string;
    /** The folder the machine knows it by, shown so the target is unmistakable. */
    folder: string;
    version?: string;
    /** The request is with the machine. Nothing here can be pressed or closed. */
    working?: boolean;
    /** Why the last attempt did not happen, in words already chosen for a reader. */
    failure?: { readonly title: string; readonly message: string };
    onConfirm: () => void;
    /** Absent while the request is running, which is what makes the dialog inert. */
    onCancel?: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * RigPluginRemoveDialog — confirming that one installed package is to go.
 *
 * It names exactly one package, by the name a reader knows it under and by the
 * folder the machine knows it by, because those are the two ways to be sure this
 * is the one meant. Nothing else on the screen is affected and the dialog says
 * so implicitly by naming only this.
 *
 * It also says what removing does not do. Rig deletes the code it manages and
 * keeps the folder the plugin writes to, so the honest sentence is that the
 * plugin goes and what it wrote stays — the opposite of what a person bracing
 * for a destructive confirmation would assume, and therefore the sentence worth
 * putting in front of them.
 *
 * While the request is with the machine there is no cancel, no close, and no
 * dismissal: stopping an uninstall halfway is not something anything can offer.
 */
export function RigPluginRemoveDialog(props: RigPluginRemoveDialogProps) {
    const working = props.working === true;
    return (
        <ModalOverlay
            onDismiss={
                working
                    ? undefined
                    : () => {
                          props.onCancel?.();
                      }
            }
        >
            <Modal
                className={["happy2-rig-plugin-remove-dialog", props.className]
                    .filter(Boolean)
                    .join(" ")}
                data-testid={props["data-testid"]}
                footer={
                    <div className="happy2-rig-plugin-remove-dialog__actions">
                        <Button disabled={working} onClick={props.onCancel} variant="ghost">
                            Keep it
                        </Button>
                        <Button
                            data-testid="rig-plugin-remove-confirm"
                            disabled={working}
                            icon="trash"
                            onClick={props.onConfirm}
                            variant="danger"
                        >
                            {working ? "Removing…" : "Remove plugin"}
                        </Button>
                    </div>
                }
                icon="trash"
                {...(working ? {} : { onClose: props.onCancel })}
                size="small"
                style={props.style}
                title={`Remove ${props.name}?`}
                tone="danger"
            >
                <div className="happy2-rig-plugin-remove-dialog__body">
                    {props.failure ? (
                        <Banner
                            data-testid="rig-plugin-remove-failure"
                            icon="alert"
                            title={props.failure.title}
                            tone="danger"
                        >
                            {props.failure.message}
                        </Banner>
                    ) : null}

                    <p
                        className="happy2-rig-plugin-remove-dialog__message"
                        data-happy2-ui="rig-plugin-remove-message"
                    >
                        Rig stops {props.name}
                        {props.version === undefined || props.version.length === 0
                            ? ""
                            : ` ${props.version}`}{" "}
                        and deletes the code it installed under{" "}
                        <span className="happy2-rig-plugin-remove-dialog__folder">
                            {props.folder}
                        </span>
                        . Whatever this plugin has written is kept, so installing it again finds its
                        own data where it left it.
                    </p>

                    {working ? (
                        <p
                            className="happy2-rig-plugin-remove-dialog__working"
                            data-happy2-ui="rig-plugin-remove-working"
                        >
                            <Spinner tone="muted" variant="arc" />
                            <span>Rig is stopping it and removing its code.</span>
                        </p>
                    ) : null}
                </div>
            </Modal>
        </ModalOverlay>
    );
}
