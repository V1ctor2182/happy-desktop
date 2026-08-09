import type { ReactNode } from "react";
import { RigFolderShareDialog } from "../../src/RigFolderShareDialog";
import { ComponentPage, Specimen } from "../kit";

export const componentNumber = "C-262";

function frame(children: ReactNode) {
    return (
        <div
            style={{
                background: "var(--groupped-background)",
                border: "1px solid var(--surface-pressed-overlay)",
                borderRadius: "8px",
                height: "520px",
                overflow: "hidden",
                position: "relative",
                transform: "translateZ(0)",
                width: "760px",
            }}
        >
            {children}
        </div>
    );
}

const contacts = [
    { identity: "z6Mkf5rMv1n8QhTb", name: "Kate Dorset", email: "kate@dorset.dev" },
    { identity: "z6MkpW7yTc4aHn2L", name: "Noah Patel", email: "noah@patel.dev" },
];

const handlers = {
    onClose: () => undefined,
    onSelectionChange: () => undefined,
    onSubmit: () => undefined,
};

export function RigFolderShareDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="Select active Murmur contacts for a folder-only shared root, then follow the group’s live syncing, synced, or error state without inventing membership controls Rig does not provide."
            title="RigFolderShareDialog"
        >
            <Specimen
                detail="480px · active contacts · one selected"
                label="Choose contacts"
                number="01"
                stage="app"
            >
                {frame(
                    <RigFolderShareDialog
                        {...handlers}
                        contacts={contacts}
                        folderName="Design system"
                        selectedContactIdentities={[contacts[0]!.identity]}
                        shared={false}
                    />,
                )}
            </Specimen>
            <Specimen
                detail="Membership fixed after creation · successful live status"
                label="Synced"
                number="02"
                stage="app"
            >
                {frame(
                    <RigFolderShareDialog
                        {...handlers}
                        contacts={contacts}
                        folderName="Design system"
                        selectedContactIdentities={contacts.map((contact) => contact.identity)}
                        shared
                        status="synced"
                    />,
                )}
            </Specimen>
            <Specimen
                detail="The group exists while its first transfer is under way"
                label="Syncing"
                number="03"
                stage="app"
            >
                {frame(
                    <RigFolderShareDialog
                        {...handlers}
                        contacts={contacts}
                        folderName="Design system"
                        selectedContactIdentities={contacts.map((contact) => contact.identity)}
                        shared
                        status="syncing"
                    />,
                )}
            </Specimen>
            <Specimen
                detail="Rig’s own sync error remains attached to this folder"
                label="Sync error"
                number="04"
                stage="app"
            >
                {frame(
                    <RigFolderShareDialog
                        {...handlers}
                        contacts={contacts}
                        error="The remote member could not accept this folder."
                        folderName="Design system"
                        selectedContactIdentities={contacts.map((contact) => contact.identity)}
                        shared
                        status="error"
                    />,
                )}
            </Specimen>
        </ComponentPage>
    );
}
