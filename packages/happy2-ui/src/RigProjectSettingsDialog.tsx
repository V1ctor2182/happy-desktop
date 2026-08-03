import type { CSSProperties } from "react";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { CopyButton } from "./CopyButton";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { TextField } from "./TextField";

export type RigProjectSettingsDialogProps = {
    /** What the project is called now — the name the host has, not the draft. */
    name: string;
    /** The name being edited. The caller owns it, so an in-flight edit survives the row list being republished underneath. */
    draft: string;
    /**
     * Presentation path of the project root, home-relative where the host said
     * so, with the canonical absolute path the clipboard gets. Absent when the
     * caller has lost sight of the project — the checkout was archived from
     * somewhere else while this was open — and the location block is then left
     * out rather than guessed at.
     */
    location?: {
        displayPath: string;
        path: string;
    };
    /** The picture the daemon derived from the repository, when it has one. */
    imageUrl?: string;
    /** How many worktrees the project holds, and how many sessions live under it, its worktrees' included. Absent with `location`. */
    contents?: {
        worktrees: number;
        sessions: number;
    };
    /** True while the host is being told; the dialog stays up and inert. */
    submitting?: boolean;
    /**
     * Archiving this project, when the caller offers it. Absent leaves the
     * section out entirely — a project the caller has lost sight of has nothing
     * left to archive.
     */
    archive?: {
        /** True once the reader has asked, and the confirmation is what they are looking at. */
        confirming?: boolean;
        /** True while the host is being told; everything in the dialog goes inert. */
        submitting?: boolean;
        /** Why the last attempt did not archive it, in the reader's words. */
        error?: string;
    };
    /** The reader asked to archive; the caller answers by confirming. Nothing is archived here. */
    onArchiveRequest?: () => void;
    /** The reader went through with it. */
    onArchiveConfirm?: () => void;
    /** The reader kept the project. */
    onArchiveCancel?: () => void;
    onDraftChange: (draft: string) => void;
    onSubmit: () => void;
    onClose: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/** "2 workspaces · 7 sessions", with the singular where it belongs and nothing where there is nothing. */
function contentsSummary(contents: { worktrees: number; sessions: number }): string {
    const parts = [
        contents.worktrees > 0
            ? `${String(contents.worktrees)} workspace${contents.worktrees === 1 ? "" : "s"}`
            : undefined,
        contents.sessions > 0
            ? `${String(contents.sessions)} session${contents.sessions === 1 ? "" : "s"}`
            : undefined,
    ].filter((part) => part !== undefined);
    return parts.length > 0 ? parts.join(" · ") : "No sessions yet";
}

/**
 * C-178 RigProjectSettingsDialog — what one project of the local workspace is,
 * and the one thing about it the reader sets.
 *
 * The identity strip answers "which project is this" before anything is
 * editable: the picture the daemon derived, the name the host has, and what is
 * filed under it. Below that is the name — the only project field the daemon
 * accepts a new value for — and then the location, read-only because the
 * checkout is where it is, with a copy for the terminal the reader is about to
 * open there. Last is archiving, which is where a project ends: it is the one
 * act here that removes something, so it sits below everything the reader came
 * to look at, and it asks before it does anything. The question names the
 * project and says what leaves with it, because "Archive" alone does not tell
 * anyone whether their code is about to be deleted.
 *
 * Props only. The draft lives with the caller so the dialog is a pure function
 * of what it is given, and `submitting` is the host being told — the field and
 * the commit go inert together rather than one of them lying about it.
 */
export function RigProjectSettingsDialog(props: RigProjectSettingsDialogProps) {
    const archiving = props.archive?.submitting === true;
    const confirming = props.archive?.confirming === true;
    // One request is in flight and there is nothing to type into or commit while
    // it lands: the whole dialog answers for it rather than the archive block alone.
    const submitting = props.submitting === true || archiving;
    // A blank name is not a name; anything else commits, and a draft equal to
    // the current name simply closes, which is what the host is told to do with it.
    const committable = props.draft.trim().length > 0;
    return (
        // Dismissal stops only while the project is being archived: that request
        // cannot be recalled, and a dialog that vanished off a stray backdrop
        // click mid-archive would leave the reader guessing.
        <ModalOverlay
            onDismiss={() => {
                if (!archiving) props.onClose();
            }}
        >
            <Modal
                className={props.className}
                data-testid={props["data-testid"]}
                footer={
                    <>
                        {/* Not disabled while saving: the close in the header and
                            the backdrop both still dismiss, and a Cancel that
                            went inert beside them would be the odd one out. */}
                        <Button
                            disabled={archiving}
                            onClick={() => props.onClose()}
                            variant="ghost"
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={submitting || !committable}
                            onClick={() => props.onSubmit()}
                            variant="primary"
                        >
                            {props.submitting === true ? "Saving…" : "Save"}
                        </Button>
                    </>
                }
                icon="settings"
                onClose={archiving ? undefined : () => props.onClose()}
                size="medium"
                style={props.style}
                title="Project settings"
            >
                <div className="happy2-rig-project-settings" data-happy2-ui="rig-project-settings">
                    <div
                        className="happy2-rig-project-settings__identity"
                        data-happy2-ui="rig-project-settings-identity"
                    >
                        <Avatar
                            imageUrl={props.imageUrl}
                            initials={props.name.slice(0, 1).toUpperCase()}
                            size="md"
                            type="agent"
                        />
                        <div className="happy2-rig-project-settings__identity-text">
                            <span className="happy2-rig-project-settings__identity-name">
                                {props.name}
                            </span>
                            {props.contents ? (
                                <span className="happy2-rig-project-settings__identity-meta">
                                    {contentsSummary(props.contents)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    <TextField
                        disabled={submitting}
                        fullWidth
                        hint="What this project is called in the sidebar and the tab strip."
                        label="Name"
                        onSubmit={() => {
                            if (committable) props.onSubmit();
                        }}
                        onValueChange={(value) => props.onDraftChange(value)}
                        value={props.draft}
                    />
                    {props.location
                        ? ((location) => (
                              <div
                                  className="happy2-rig-project-settings__field"
                                  data-happy2-ui="rig-project-settings-location"
                              >
                                  <span className="happy2-rig-project-settings__label">
                                      Location
                                  </span>
                                  <div className="happy2-rig-project-settings__path">
                                      <span
                                          className="happy2-rig-project-settings__path-text"
                                          title={location.path}
                                      >
                                          {location.displayPath}
                                      </span>
                                      <CopyButton label="Copy project path" text={location.path} />
                                  </div>
                                  <span className="happy2-rig-project-settings__hint">
                                      The checkout this project runs in. The daemon owns it, so it
                                      is shown here rather than set.
                                  </span>
                              </div>
                          ))(props.location)
                        : null}
                    {props.archive ? (
                        <div
                            className="happy2-rig-project-settings__archive"
                            data-happy2-ui="rig-project-settings-archive"
                        >
                            <span className="happy2-rig-project-settings__label">Archive</span>
                            {props.archive.error ? (
                                <Banner
                                    data-testid="rig-project-archive-error"
                                    tone="danger"
                                    title="Not archived"
                                >
                                    {props.archive.error}
                                </Banner>
                            ) : null}
                            {/* The question and the answer occupy the same block,
                                so asking does not move the dialog's other rows
                                or take the reader somewhere else to answer it. */}
                            <span className="happy2-rig-project-settings__hint">
                                {confirming
                                    ? `Archive ${props.name}? It leaves the sidebar with its sessions, and every workspace under it is archived and its worktree folder removed. The project's own checkout stays exactly where it is.`
                                    : "Takes the project out of the sidebar with its sessions, archives every workspace under it, and removes those workspaces' worktree folders. The project's own checkout is left alone."}
                            </span>
                            <div className="happy2-rig-project-settings__archive-actions">
                                {confirming ? (
                                    <>
                                        <Button
                                            disabled={archiving}
                                            onClick={() => props.onArchiveCancel?.()}
                                            size="small"
                                            variant="ghost"
                                        >
                                            Keep project
                                        </Button>
                                        <Button
                                            data-testid="rig-project-archive-confirm"
                                            disabled={archiving}
                                            icon="archive"
                                            onClick={() => props.onArchiveConfirm?.()}
                                            size="small"
                                            variant="danger"
                                        >
                                            {archiving ? "Archiving…" : `Archive ${props.name}`}
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        data-testid="rig-project-archive"
                                        disabled={submitting}
                                        icon="archive"
                                        onClick={() => props.onArchiveRequest?.()}
                                        size="small"
                                        variant="danger"
                                    >
                                        Archive project
                                    </Button>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </Modal>
        </ModalOverlay>
    );
}
