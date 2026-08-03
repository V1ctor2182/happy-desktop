import { type CSSProperties } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface SessionShareStopDialogProps {
    /** Whether one person is being removed or the whole share is ending. */
    kind: "revoke" | "stop";
    /** The person losing access, when one person is. */
    name?: string;
    /** How many people lose access when the whole share ends. */
    watching?: number;
    onConfirm: () => void;
    onCancel: () => void;
    working?: boolean;
    error?: string;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * C-248 SessionShareStopDialog — the one confirmation in sharing that has to
 * tell the truth.
 *
 * Removing a person and ending a share both do exactly one thing: they stop
 * later content from reaching anyone. Neither reaches back into what a member
 * already read, scrolled past, or copied out, and no wording here is allowed to
 * suggest otherwise — so the sentence about what stays with them is not a
 * footnote, it is the second half of the claim. Ending additionally cannot be
 * undone, and says so before it is pressed rather than after.
 *
 * It renders the `Modal` card only. The application hosts it inside
 * `ModalOverlay`, which owns the scrim, the stacking, and dismissal.
 */
export function SessionShareStopDialog(props: SessionShareStopDialogProps) {
    const revoking = props.kind === "revoke";
    const person = props.name ?? "This person";
    const working = props.working === true;
    return (
        <Modal
            className={["happy2-session-share-stop", props.className].filter(Boolean).join(" ")}
            data-testid={props["data-testid"]}
            footer={
                <div className="happy2-session-share-stop__actions">
                    <Button disabled={working} onClick={props.onCancel} variant="ghost">
                        {revoking ? "Keep their access" : "Keep sharing"}
                    </Button>
                    <Button
                        data-testid="session-share-stop-confirm"
                        disabled={working}
                        icon={revoking ? "close" : "stop"}
                        onClick={props.onConfirm}
                        variant="danger"
                    >
                        {working
                            ? revoking
                                ? "Removing…"
                                : "Ending…"
                            : revoking
                              ? "Remove access"
                              : "Stop sharing"}
                    </Button>
                </div>
            }
            icon={revoking ? "unlink" : "stop"}
            onClose={working ? undefined : props.onCancel}
            size="small"
            style={props.style}
            title={
                revoking ? `Remove ${props.name ?? "this person"}?` : "Stop sharing this session?"
            }
            tone="danger"
        >
            <div className="happy2-session-share-stop__body">
                {props.error ? (
                    <Banner icon="alert" title="That did not happen" tone="danger">
                        {props.error}
                    </Banner>
                ) : null}

                {!revoking && props.watching !== undefined ? (
                    <p
                        className="happy2-session-share-stop__count"
                        data-happy2-ui="session-share-stop-count"
                    >
                        {props.watching === 1
                            ? "1 person is watching right now."
                            : `${String(props.watching)} people are watching right now.`}
                    </p>
                ) : null}

                <p
                    className="happy2-session-share-stop__message"
                    data-happy2-ui="session-share-stop-message"
                >
                    {revoking
                        ? `${person} will not see anything from this point on. Everything they have already seen stays with them — this cannot take it back.`
                        : "Everyone watching loses access from this point on, and this share cannot be resumed. Everything they have already seen stays with them — this cannot take it back."}
                </p>
            </div>
        </Modal>
    );
}
