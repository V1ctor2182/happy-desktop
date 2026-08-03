import { useRef, useState, type CSSProperties } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { Spinner } from "./Spinner";
import { TextField } from "./TextField";

export interface RigPluginInstallDialogProps {
    /**
     * The package this was opened from, when it was opened from one. It changes
     * only what the dialog says: installing is one operation whichever control
     * started it, and the machine decides for itself whether the folder handed
     * to it replaces this package or brings a different one.
     */
    subject?: string;
    /** The request is with the machine. Nothing here can be typed, closed, or cancelled. */
    working?: boolean;
    /** Why the last attempt did not happen, in words already chosen for a reader. */
    failure?: { readonly title: string; readonly message: string };
    /**
     * Offers the machine's own folder chooser and answers with what was picked,
     * or nothing when the reader backed out. Absent in a window that has no such
     * chooser, where the field is the only way in and is the whole control.
     */
    onFolderPick?: () => Promise<string | undefined>;
    onSubmit: (source: string) => void;
    /** Absent while the request is running, which is what makes the dialog inert. */
    onClose?: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * RigPluginInstallDialog — asking the machine to install the plugin in a folder.
 *
 * A folder is the whole request, because it is the whole of what Rig accepts: it
 * takes a folder on its own machine, copies it somewhere private, checks the
 * manifest, the icon, and the entry point in that copy, and only then puts it in
 * place. So there is one field, and nothing in this dialog inspects what is typed
 * into it. It cannot: the folder is on the machine running Rig, this window
 * cannot see that machine's disk, and a rule invented here could only disagree
 * with the one that actually decides. A folder that is wrong comes back as the
 * machine's own sentence about it, under the field it was typed into.
 *
 * The same dialog updates a package. Rig identifies a package by its folder, so
 * installing the folder a package came from replaces the copy that is here, and
 * afterwards Rig says whether that was a newer version, an older one, or the same
 * one again. It is put that way round deliberately: nothing anywhere in this
 * surface claims an update is available, because the machine reports no such
 * thing and there is no honest way to know it from here.
 *
 * While the request is with the machine the dialog is inert: no close, no
 * backdrop dismissal, no Escape, and nothing to type. An install replaces
 * installed code and cannot be recalled, so there is no cancel that could mean
 * anything, and a dialog that vanished off a stray click mid-install would leave
 * a reader guessing about a machine that was mid-change.
 */
export function RigPluginInstallDialog(props: RigPluginInstallDialogProps) {
    const [source, setSource] = useState("");
    /*
     * The chooser is asked for by a press and answers whenever it answers. This
     * counts the asks so an answer to one the reader backed out of — or to one
     * opened before this dialog was reused for another package — cannot overwrite
     * what has been typed since.
     */
    const pick = useRef(0);
    const [picking, setPicking] = useState(false);
    const working = props.working === true;
    const submittable = source.trim().length > 0 && !working;

    const submit = (): void => {
        if (!submittable) return;
        props.onSubmit(source.trim());
    };

    const folderPick = (): void => {
        const chooser = props.onFolderPick;
        if (!chooser || working || picking) return;
        const ticket = pick.current + 1;
        pick.current = ticket;
        setPicking(true);
        void chooser().then(
            (chosen) => {
                if (pick.current !== ticket) return;
                setPicking(false);
                if (chosen !== undefined) setSource(chosen);
            },
            () => {
                if (pick.current !== ticket) return;
                setPicking(false);
            },
        );
    };

    return (
        <ModalOverlay
            onDismiss={
                working
                    ? undefined
                    : () => {
                          props.onClose?.();
                      }
            }
        >
            <Modal
                className={["happy2-rig-plugin-install-dialog", props.className]
                    .filter(Boolean)
                    .join(" ")}
                data-testid={props["data-testid"]}
                footer={
                    <div className="happy2-rig-plugin-install-dialog__actions">
                        <Button disabled={working} onClick={props.onClose} variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            data-testid="rig-plugin-install-submit"
                            disabled={!submittable}
                            icon="plus"
                            onClick={submit}
                        >
                            {working
                                ? "Installing…"
                                : props.subject === undefined
                                  ? "Install"
                                  : "Install this folder"}
                        </Button>
                    </div>
                }
                icon="package"
                {...(working ? {} : { onClose: props.onClose })}
                size="medium"
                style={props.style}
                title={props.subject === undefined ? "Install a plugin" : `Update ${props.subject}`}
            >
                <div className="happy2-rig-plugin-install-dialog__body">
                    {props.subject === undefined ? null : (
                        <p
                            className="happy2-rig-plugin-install-dialog__subject"
                            data-happy2-ui="rig-plugin-install-subject"
                        >
                            Rig installs whatever this folder holds. If it is where {props.subject}{" "}
                            came from, the copy on this machine is replaced, and Rig says whether
                            that was a newer version, an older one, or the same one again.
                        </p>
                    )}

                    {props.failure ? (
                        <Banner
                            data-testid="rig-plugin-install-failure"
                            icon="alert"
                            title={props.failure.title}
                            tone="danger"
                        >
                            {props.failure.message}
                        </Banner>
                    ) : null}

                    <TextField
                        autoFocus
                        disabled={working}
                        fullWidth
                        hint="The folder holding this plugin's happy.plugin.json, on the machine running Rig. Rig copies it, checks it, and installs the copy."
                        label="Folder on this machine"
                        onSubmit={submit}
                        onValueChange={setSource}
                        placeholder="/Users/you/plugins/my-plugin"
                        value={source}
                    />

                    {props.onFolderPick ? (
                        <div className="happy2-rig-plugin-install-dialog__pick">
                            <Button
                                data-testid="rig-plugin-install-pick"
                                disabled={working || picking}
                                icon="files"
                                onClick={folderPick}
                                size="small"
                                variant="secondary"
                            >
                                {picking ? "Choosing…" : "Choose folder…"}
                            </Button>
                        </div>
                    ) : null}

                    {working ? (
                        <p
                            className="happy2-rig-plugin-install-dialog__working"
                            data-happy2-ui="rig-plugin-install-working"
                        >
                            <Spinner tone="muted" variant="arc" />
                            <span>
                                Rig is copying this folder and checking it before anything installed
                                changes.
                            </span>
                        </p>
                    ) : null}
                </div>
            </Modal>
        </ModalOverlay>
    );
}
