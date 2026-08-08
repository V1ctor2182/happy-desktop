import type { ReactNode } from "react";
import { RigFolderDialog } from "../../src/RigFolderDialog";
import { ComponentPage, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-255";

/**
 * The dialog fixes itself to the window it is in, so a specimen gives it one.
 * The open-picker specimen asks for a taller window: the grid drops below the
 * name row, and a window too short to hold it would only show the modal's own
 * body scrolling.
 */
function frame(children: ReactNode, height = 420) {
    return (
        <div
            style={{
                background: "var(--groupped-background)",
                border: "1px solid var(--surface-pressed-overlay)",
                borderRadius: "8px",
                height: `${String(height)}px`,
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

const handlers = {
    onClose: () => undefined,
    onEmojiChange: () => undefined,
    onNameChange: () => undefined,
    onSubmit: () => undefined,
};

export function RigFolderDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="Naming a folder and choosing the mark it wears: a square emoji tile that opens the picker in place, beside the name the reader came to write."
            title="RigFolderDialog"
        >
            <Specimen
                detail="360px · empty name · default mark shown muted · Create disabled"
                label="New folder"
                number="01"
                stage="app"
            >
                {frame(<RigFolderDialog {...handlers} mode="create" name="" />)}
            </Specimen>

            <Specimen
                detail="360px · named · mark chosen, at full strength"
                label="New folder, marked"
                number="02"
                stage="app"
            >
                {frame(
                    <RigFolderDialog
                        {...handlers}
                        emoji={"\u{1F680}"}
                        mode="create"
                        name="Ship it"
                    />,
                )}
            </Specimen>

            <Specimen
                detail="360px · started from a folder row's menu · the title says where it lands"
                label="New folder inside another"
                number="02b"
                stage="app"
            >
                {frame(
                    <RigFolderDialog
                        {...handlers}
                        mode="create"
                        name=""
                        parentName="Bug reports"
                    />,
                )}
            </Specimen>

            <Specimen
                detail="360px · existing folder · Save"
                label="Editing"
                number="03"
                stage="app"
            >
                {frame(
                    <RigFolderDialog
                        {...handlers}
                        emoji={"\u{1F41B}"}
                        mode="edit"
                        name="Bug reports"
                    />,
                )}
            </Specimen>

            <Specimen
                detail="360px · host being told · every control inert"
                label="Submitting"
                number="04"
                stage="app"
            >
                {frame(
                    <RigFolderDialog
                        {...handlers}
                        emoji={"\u{1F4DA}"}
                        mode="edit"
                        name="Reading list"
                        submitting
                    />,
                )}
            </Specimen>

            <Specimen
                detail="360px · the host's own sentence, above the fields"
                label="Refused"
                number="05"
                stage="app"
            >
                {frame(
                    <RigFolderDialog
                        {...handlers}
                        error="Rig could not create this folder: its storage is unavailable."
                        mode="create"
                        name="Archive"
                    />,
                    500,
                )}
            </Specimen>

            <Specimen
                detail="360px · picker open below the row · 8 columns · 36px slots"
                label="Choosing a mark"
                number="06"
                stage="app"
            >
                {frame(
                    <RigFolderDialog
                        {...handlers}
                        defaultPickerOpen
                        emojiChoices={[
                            { char: "\u{1F4C1}", id: "folder", name: "folder" },
                            { char: "\u{1F680}", id: "rocket", name: "rocket" },
                            { char: "\u{1F41B}", id: "bug", name: "bug" },
                            { char: "\u{1F4DA}", id: "books", name: "books" },
                            { char: "\u{2728}", id: "sparkles", name: "sparkles" },
                            { char: "\u{1F525}", id: "fire", name: "fire" },
                            { char: "\u{1F9EA}", id: "experiment", name: "test tube" },
                            { char: "\u{1F512}", id: "lock", name: "locked" },
                        ]}
                        mode="create"
                        name="Experiments"
                    />,
                    700,
                )}
            </Specimen>
        </ComponentPage>
    );
}
