import { Banner } from "../../Banner";
import { Box } from "../../Box";
import { FileEditor } from "../../FileEditor";
import { MarkdownDocument } from "../../MarkdownDocument";
import { Spinner } from "../../Spinner";
import { RigSettingsSection } from "./RigSettingsShell";

export type RigInstructionsSettingsProps = {
    /** Where the machine keeps them, shown so it is clear what is being edited. */
    path: string;
    /** The draft: what the editor holds, which is not yet what the machine holds. */
    value: string;
    /** Unsaved edits exist. */
    dirty?: boolean;
    /** A write is in flight. */
    saving?: boolean;
    /** Set until the instructions have been read; the editor waits rather than showing empty. */
    loading?: boolean;
    /** Why they could not be read at all. */
    error?: string;
    /** Why the last write was refused — the machine's own reason. */
    saveError?: string;
    /** Bytes the draft occupies, and the most the machine will keep. */
    bytes: number;
    maximumBytes: number;
    onValueChange: (value: string) => void;
    onSave: () => void;
    onRevert: () => void;
};

/**
 * The Instructions category: the one document every agent on this machine is
 * given before anything else.
 *
 * It is a file rather than a form, so it is edited as one — the same editor a
 * workspace file opens in, reading as Markdown and writing as text. The size
 * limit is the machine's own: it is stated here as room left, and a write past
 * it is refused by the machine in its own words rather than by a Save button
 * that has quietly stopped working.
 */
export function RigInstructionsSettings(props: RigInstructionsSettingsProps) {
    const oversize = props.bytes > props.maximumBytes;
    // Nothing was read, so there is nothing to edit: an editor here would be a
    // text area that saves into a machine this window cannot reach.
    if (props.error)
        return (
            <Banner tone="danger" title="Instructions unavailable">
                {props.error}
            </Banner>
        );
    return (
        <>
            <RigSettingsSection
                description="Given to every agent this machine starts, on top of whatever a project's own AGENTS.md says."
                rows="cards"
                title="Global instructions"
            >
                {props.loading ? (
                    <Box className="happy2-rig-settings__pending">
                        <Spinner size={16} />
                        <span>Reading the instructions…</span>
                    </Box>
                ) : (
                    <Box className="happy2-rig-settings__editor">
                        <FileEditor
                            banner={
                                props.saveError ? (
                                    <Banner tone="danger" title="Not saved">
                                        {props.saveError}
                                    </Banner>
                                ) : oversize ? (
                                    <Banner tone="warning" title="Too long to keep">
                                        {`These instructions are ${bytesLabel(props.bytes)}, and this machine keeps at most ${bytesLabel(props.maximumBytes)}.`}
                                    </Banner>
                                ) : undefined
                            }
                            dirty={props.dirty}
                            onRevert={props.onRevert}
                            onSave={props.onSave}
                            onValueChange={props.onValueChange}
                            // A machine with no instructions yet has nothing to
                            // read, so it opens straight into the text area
                            // rather than onto a blank page with no cursor in it.
                            initialFace={props.value.trim().length > 0 ? "rendered" : "source"}
                            path={props.path}
                            placeholder="Anything every agent on this machine should know…"
                            rendered={<MarkdownDocument text={props.value} />}
                            saving={props.saving}
                            status={`${bytesLabel(props.bytes)} of ${bytesLabel(props.maximumBytes)}`}
                            value={props.value}
                        />
                    </Box>
                )}
            </RigSettingsSection>
        </>
    );
}

function bytesLabel(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
