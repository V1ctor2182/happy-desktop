import type { CSSProperties } from "react";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { Box } from "./Box";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";

/** One Murmur contact available to a folder-sharing choice. */
export interface RigFolderShareContactView {
    readonly identity: string;
    readonly name: string;
    readonly email?: string;
    readonly imageUrl?: string;
}

export interface RigFolderShareDialogProps {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    readonly folderName: string;
    readonly contacts: readonly RigFolderShareContactView[];
    readonly selectedContactIdentities: readonly string[];
    /** Existing shares show their membership and live state without editable controls. */
    readonly shared: boolean;
    readonly status?: "syncing" | "synced" | "error";
    readonly lastSyncedAt?: number;
    readonly error?: string;
    readonly submitting?: boolean;
    onSelectionChange(identity: string, selected: boolean): void;
    onSubmit(): void;
    onClose(): void;
}

/**
 * C-262 RigFolderShareDialog — selecting a folder's Murmur contacts, then
 * following that shared root's live sync state.
 *
 * The component holds no selection or transport state. Existing groups are
 * deliberately read-only because Rig currently exposes creation and sync
 * status, but no truthful membership-edit or unshare action.
 */
export function RigFolderShareDialog(props: RigFolderShareDialogProps) {
    const selected = new Set(props.selectedContactIdentities);
    const canSubmit = !props.shared && props.submitting !== true && selected.size > 0;
    const syncMessage =
        props.status === "syncing"
            ? {
                  tone: "info" as const,
                  icon: "link" as const,
                  title: "Syncing folder",
                  detail: "The sharing group is ready. Rig is sending the folder to its members.",
              }
            : props.status === "synced"
              ? {
                    tone: "success" as const,
                    icon: "check-circle" as const,
                    title: "Shared and synced",
                    detail:
                        props.lastSyncedAt === undefined
                            ? "Everyone in this group has the latest shared folder."
                            : `Last synced ${new Date(props.lastSyncedAt).toLocaleString()}.`,
                }
              : props.status === "error"
                ? {
                      tone: "danger" as const,
                      icon: "alert" as const,
                      title: "Sync needs attention",
                      detail: props.error ?? "Rig could not finish syncing this folder.",
                  }
                : props.shared
                  ? {
                        tone: "neutral" as const,
                        icon: "link" as const,
                        title: "Shared folder",
                        detail: "Waiting for the latest sync status from Rig.",
                    }
                  : undefined;

    return (
        <ModalOverlay onDismiss={() => props.onClose()}>
            <Modal
                className={props.className}
                data-testid={props["data-testid"]}
                footer={
                    <>
                        <Button onClick={() => props.onClose()} size="small" variant="secondary">
                            {props.shared ? "Done" : "Cancel"}
                        </Button>
                        {!props.shared ? (
                            <Button
                                disabled={!canSubmit}
                                icon="link"
                                loading={props.submitting === true}
                                onClick={() => props.onSubmit()}
                                size="small"
                                variant="primary"
                            >
                                {props.submitting === true ? "Sharing…" : "Share folder"}
                            </Button>
                        ) : null}
                    </>
                }
                icon="link"
                onClose={() => props.onClose()}
                size="medium"
                style={props.style}
                title={
                    props.shared ? `Sharing “${props.folderName}”` : `Share “${props.folderName}”`
                }
            >
                <Box
                    className="happy2-rig-folder-share-dialog"
                    data-happy-desktop-ui="rig-folder-share-dialog"
                >
                    {props.error && props.status !== "error" ? (
                        <Banner tone="danger">{props.error}</Banner>
                    ) : null}
                    {syncMessage ? (
                        <Banner
                            icon={syncMessage.icon}
                            title={syncMessage.title}
                            tone={syncMessage.tone}
                        >
                            {syncMessage.detail}
                        </Banner>
                    ) : (
                        <span className="happy2-rig-folder-share-dialog__intro">
                            Choose the Murmur contacts who should receive this folder. Shared roots
                            contain folders only, keeping chats and linked work private.
                        </span>
                    )}
                    <Box className="happy2-rig-folder-share-dialog__section">
                        <span className="happy2-rig-folder-share-dialog__section-title">
                            {props.shared ? "Sharing with" : "Contacts"}
                        </span>
                        {props.contacts.length > 0 ? (
                            <Box className="happy2-rig-folder-share-dialog__contacts">
                                {props.contacts.map((contact) => (
                                    <Box
                                        className="happy2-rig-folder-share-dialog__contact"
                                        data-happy-desktop-ui="rig-folder-share-contact"
                                        key={contact.identity}
                                    >
                                        <Checkbox
                                            aria-label={`Share with ${contact.name}`}
                                            checked={selected.has(contact.identity)}
                                            disabled={props.shared || props.submitting === true}
                                            onChange={(checked) =>
                                                props.onSelectionChange(contact.identity, checked)
                                            }
                                        />
                                        <Avatar
                                            initials={initialsOf(contact.name)}
                                            size="sm"
                                            {...(contact.imageUrl === undefined
                                                ? {}
                                                : { imageUrl: contact.imageUrl })}
                                        />
                                        <Box className="happy2-rig-folder-share-dialog__contact-who">
                                            <span className="happy2-rig-folder-share-dialog__contact-name">
                                                {contact.name}
                                            </span>
                                            <span className="happy2-rig-folder-share-dialog__contact-detail">
                                                {contact.email ?? contact.identity}
                                            </span>
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        ) : (
                            <Box className="happy2-rig-folder-share-dialog__empty">
                                <span>
                                    {props.shared
                                        ? "Waiting for membership details."
                                        : "No contacts are available."}
                                </span>
                                <span>
                                    {props.shared
                                        ? "Rig will update this group when its sharing feed arrives."
                                        : "Add a Murmur contact before sharing a folder."}
                                </span>
                            </Box>
                        )}
                    </Box>
                </Box>
            </Modal>
        </ModalOverlay>
    );
}

function initialsOf(name: string): string {
    const words = name.trim().split(/\s+/u).filter(Boolean);
    if (words.length === 0) return "?";
    return words
        .slice(0, 2)
        .map((word) => word.slice(0, 1).toUpperCase())
        .join("");
}
