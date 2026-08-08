import { useState, type CSSProperties } from "react";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { EmojiPicker, type EmojiItem } from "./EmojiPicker";
import { Modal } from "./Modal";
import { ModalOverlay } from "./ModalOverlay";
import { TextField } from "./TextField";

/**
 * The mark a folder wears when its owner has not chosen one.
 *
 * It is a character rather than a house glyph because it stands in the same slot
 * the reader's own emoji will occupy: a folder that gains an emoji must not also
 * change what kind of thing is drawn there, or every folder would sit in one of
 * two visual families depending on whether anyone had got round to it.
 */
export const RIG_FOLDER_DEFAULT_EMOJI = "\u{1F4C1}";

/**
 * The emoji a folder may be marked with.
 *
 * Deliberately a curated few dozen rather than the whole Unicode set: this is a
 * mark on a row 16 pixels tall, and the ones that read at that size are the
 * solid, high-contrast pictograms below. A grid of thousands would also make the
 * search field the only way through it, which is a worse control for picking
 * something you are choosing rather than looking up.
 */
export const RIG_FOLDER_EMOJI: readonly EmojiItem[] = [
    { char: "\u{1F4C1}", id: "folder", name: "folder" },
    { char: "\u{1F4C2}", id: "folder-open", name: "open folder" },
    { char: "\u{1F5C2}\u{FE0F}", id: "dividers", name: "card index dividers" },
    { char: "\u{1F4C5}", id: "calendar", name: "calendar" },
    { char: "\u{1F4CB}", id: "clipboard", name: "clipboard" },
    { char: "\u{1F4DD}", id: "memo", name: "memo" },
    { char: "\u{1F4D2}", id: "ledger", name: "ledger" },
    { char: "\u{1F4DA}", id: "books", name: "books" },
    { char: "\u{1F4B0}", id: "money", name: "money bag" },
    { char: "\u{1F4C8}", id: "chart-up", name: "chart increasing" },
    { char: "\u{1F4CA}", id: "bar-chart", name: "bar chart" },
    { char: "\u{1F5C3}\u{FE0F}", id: "file-box", name: "card file box" },
    { char: "\u{1F680}", id: "rocket", name: "rocket" },
    { char: "\u{2728}", id: "sparkles", name: "sparkles" },
    { char: "\u{1F525}", id: "fire", name: "fire" },
    { char: "\u{26A1}", id: "zap", name: "high voltage" },
    { char: "\u{1F4A1}", id: "bulb", name: "light bulb" },
    { char: "\u{1F9EA}", id: "experiment", name: "test tube" },
    { char: "\u{1F52C}", id: "microscope", name: "microscope" },
    { char: "\u{1F9E0}", id: "brain", name: "brain" },
    { char: "\u{1F6E0}\u{FE0F}", id: "tools", name: "hammer and wrench" },
    { char: "\u{1F527}", id: "wrench", name: "wrench" },
    { char: "\u{2699}\u{FE0F}", id: "gear", name: "gear" },
    { char: "\u{1F5A5}\u{FE0F}", id: "desktop", name: "desktop computer" },
    { char: "\u{1F4BB}", id: "laptop", name: "laptop" },
    { char: "\u{1F4F1}", id: "phone", name: "mobile phone" },
    { char: "\u{1F310}", id: "globe", name: "globe with meridians" },
    { char: "\u{1F5FA}\u{FE0F}", id: "map", name: "world map" },
    { char: "\u{1F9ED}", id: "compass", name: "compass" },
    { char: "\u{1F3AF}", id: "target", name: "direct hit" },
    { char: "\u{1F3C1}", id: "finish", name: "chequered flag" },
    { char: "\u{1F6A6}", id: "signal", name: "vertical traffic light" },
    { char: "\u{1F41B}", id: "bug", name: "bug" },
    { char: "\u{1F512}", id: "lock", name: "locked" },
    { char: "\u{1F6E1}\u{FE0F}", id: "shield", name: "shield" },
    { char: "\u{1F511}", id: "key", name: "key" },
    { char: "\u{1F4E6}", id: "package", name: "package" },
    { char: "\u{1F5C4}\u{FE0F}", id: "cabinet", name: "file cabinet" },
    { char: "\u{1F5D3}\u{FE0F}", id: "spiral-calendar", name: "spiral calendar" },
    { char: "\u{1F4CC}", id: "pushpin", name: "pushpin" },
    { char: "\u{1F517}", id: "link", name: "link" },
    { char: "\u{1F9F0}", id: "toolbox", name: "toolbox" },
    { char: "\u{1F3D7}\u{FE0F}", id: "construction", name: "building construction" },
    { char: "\u{1F3E0}", id: "house", name: "house" },
    { char: "\u{1F3E2}", id: "office", name: "office building" },
    { char: "\u{1F3AA}", id: "circus", name: "circus tent" },
    { char: "\u{1F3A8}", id: "art", name: "artist palette" },
    { char: "\u{1F3AC}", id: "clapper", name: "clapper board" },
    { char: "\u{1F3B5}", id: "music", name: "musical note" },
    { char: "\u{1F4F7}", id: "camera", name: "camera" },
    { char: "\u{2709}\u{FE0F}", id: "envelope", name: "envelope" },
    { char: "\u{1F514}", id: "bell", name: "bell" },
    { char: "\u{1F4AC}", id: "speech", name: "speech balloon" },
    { char: "\u{1F465}", id: "people", name: "busts in silhouette" },
    { char: "\u{1F91D}", id: "handshake", name: "handshake" },
    { char: "\u{2764}\u{FE0F}", id: "heart", name: "red heart" },
    { char: "\u{2B50}", id: "star", name: "star" },
    { char: "\u{1F31F}", id: "glowing-star", name: "glowing star" },
    { char: "\u{1F308}", id: "rainbow", name: "rainbow" },
    { char: "\u{1F331}", id: "seedling", name: "seedling" },
    { char: "\u{1F333}", id: "tree", name: "deciduous tree" },
    { char: "\u{1F30A}", id: "wave", name: "water wave" },
    { char: "\u{2615}", id: "coffee", name: "hot beverage" },
    { char: "\u{1F355}", id: "pizza", name: "pizza" },
];

export type RigFolderDialogProps = {
    /** `create` names a folder that does not exist yet; `edit` changes one that does. */
    mode: "create" | "edit";
    /** The name being written. The caller owns it, so an edit survives the tree being republished. */
    name: string;
    /**
     * The folder this new one lands inside, named in the title. Absent means the
     * top level. A nested folder is started from a row's menu rather than from
     * the heading, so the dialog says which row it came from: there is otherwise
     * nothing on screen to distinguish the two acts once the menu has closed.
     */
    parentName?: string;
    /**
     * The emoji chosen so far. Absent means the folder carries none of its own
     * and wears the default, which is what the tile shows — muted, so the reader
     * can tell a mark they picked from one they were given.
     */
    emoji?: string;
    /** True while the host is being told; the whole dialog stays up and inert. */
    submitting?: boolean;
    /** Why the last attempt was refused, in the host's own words. */
    error?: string;
    /** The emoji on offer. Defaults to the curated folder set above. */
    emojiChoices?: readonly EmojiItem[];
    /**
     * Whether the picker starts open. It seeds this dialog's own passing state
     * rather than controlling it — the host has no interest in whether a grid is
     * showing — and exists so the open state is renderable by a fixture.
     */
    defaultPickerOpen?: boolean;
    onNameChange: (value: string) => void;
    onEmojiChange: (value: string) => void;
    onSubmit: () => void;
    onClose: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * C-255 RigFolderDialog — naming a folder and choosing the mark it wears.
 *
 * A folder has almost nothing to it: a name, and an emoji standing in for it in
 * a list of rows. So the dialog is those two controls side by side rather than a
 * form — the tile opens the picker in place beneath it, and the name field takes
 * the caret on mount, because naming is what the reader came to do and the mark
 * is the optional part.
 *
 * The tile always shows a mark. A folder with none of its own shows the default
 * one muted, which says both what it will look like in the sidebar and that
 * nobody has chosen yet; picking any emoji brings it to full strength. That is
 * the whole of "or use the default one": not choosing is a real answer, and the
 * dialog shows what it looks like instead of leaving an empty square.
 *
 * Props only, apart from the picker being open and what has been typed into its
 * search — both are this dialog's own passing UI state and mean nothing to the
 * host.
 */
export function RigFolderDialog(props: RigFolderDialogProps) {
    const [pickerOpen, setPickerOpen] = useState(props.defaultPickerOpen ?? false);
    const [query, setQuery] = useState("");
    const submitting = props.submitting === true;
    const choices = props.emojiChoices ?? RIG_FOLDER_EMOJI;
    const needle = query.trim().toLowerCase();
    const shown = needle
        ? choices.filter((item) => item.name.toLowerCase().includes(needle))
        : choices;
    // A folder with no name is not a folder, so there is nothing to commit until
    // one is written. Whitespace is not a name either.
    const committable = props.name.trim().length > 0;
    const chosen = props.emoji !== undefined;
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
                        <Button onClick={() => props.onClose()} variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            disabled={submitting || !committable}
                            onClick={() => props.onSubmit()}
                            variant="primary"
                        >
                            {submitting
                                ? props.mode === "create"
                                    ? "Creating…"
                                    : "Saving…"
                                : props.mode === "create"
                                  ? "Create"
                                  : "Save"}
                        </Button>
                    </>
                }
                onClose={submitting ? undefined : () => props.onClose()}
                size="small"
                style={props.style}
                title={
                    props.mode === "create"
                        ? props.parentName === undefined
                            ? "New folder"
                            : `New folder in ${props.parentName}`
                        : "Folder"
                }
            >
                <div className="happy2-rig-folder-dialog" data-happy-desktop-ui="rig-folder-dialog">
                    {props.error ? <Banner tone="danger">{props.error}</Banner> : null}
                    <div
                        className="happy2-rig-folder-dialog__identity"
                        data-happy-desktop-ui="rig-folder-dialog-identity"
                    >
                        <button
                            aria-expanded={pickerOpen ? "true" : "false"}
                            aria-label="Choose folder emoji"
                            className="happy2-rig-folder-dialog__mark"
                            data-chosen={chosen ? "" : undefined}
                            data-happy-desktop-ui="rig-folder-dialog-mark"
                            disabled={submitting}
                            onClick={() => setPickerOpen(!pickerOpen)}
                            type="button"
                        >
                            <span
                                className="happy2-rig-folder-dialog__mark-glyph"
                                data-happy-desktop-ui="rig-folder-dialog-mark-glyph"
                            >
                                {props.emoji ?? RIG_FOLDER_DEFAULT_EMOJI}
                            </span>
                        </button>
                        <TextField
                            autoFocus
                            disabled={submitting}
                            fullWidth
                            label="Name"
                            onSubmit={() => {
                                if (committable && !submitting) props.onSubmit();
                            }}
                            onValueChange={props.onNameChange}
                            placeholder="Untitled folder"
                            value={props.name}
                        />
                    </div>
                    {pickerOpen ? (
                        <div
                            className="happy2-rig-folder-dialog__picker"
                            data-happy-desktop-ui="rig-folder-dialog-picker"
                        >
                            <EmojiPicker
                                allLabel="Folder emoji"
                                columns={8}
                                emoji={[...shown]}
                                emptyLabel="No emoji found"
                                onQueryChange={setQuery}
                                onSelect={(id) => {
                                    const item = choices.find((candidate) => candidate.id === id);
                                    if (item?.char === undefined) return;
                                    props.onEmojiChange(item.char);
                                    setPickerOpen(false);
                                    setQuery("");
                                }}
                                query={query}
                                searchPlaceholder="Search emoji"
                            />
                            {/* The way back. Not choosing is the default, so the
                                only reader who needs this is one who chose and
                                changed their mind — which is exactly who is
                                looking at the grid. */}
                            {chosen ? (
                                <Button
                                    className="happy2-rig-folder-dialog__reset"
                                    onClick={() => {
                                        props.onEmojiChange("");
                                        setPickerOpen(false);
                                        setQuery("");
                                    }}
                                    size="small"
                                    variant="ghost"
                                >
                                    Use the default
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </Modal>
        </ModalOverlay>
    );
}
