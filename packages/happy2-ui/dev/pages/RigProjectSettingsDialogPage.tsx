import type { ReactNode } from "react";
import { RigProjectSettingsDialog } from "../../src/RigProjectSettingsDialog";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/**
 * The dialog is fixed to the window it is in, so a specimen gives it one. The
 * archive specimens ask for a taller one: the block is below the fields, and a
 * window too short to hold it would only show the modal's own body scrolling.
 */
function frame(children: ReactNode, height = 560) {
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
                width: "800px",
            }}
        >
            {children}
        </div>
    );
}

const happy2 = {
    contents: { sessions: 7, worktrees: 2 },
    location: { displayPath: "~/Developer/happy2", path: "/Users/steve/Developer/happy2" },
    name: "happy2",
} as const;

export function RigProjectSettingsDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-178"
            summary="What one project of the local workspace is, and the one field the daemon takes a new value for."
            title="RigProjectSettingsDialog"
        >
            <Specimen
                detail="480px · identity · editable name · read-only location"
                label="Open"
                number="01"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        {...happy2}
                        draft="happy2"
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                )}
                <DimensionRule label="modal medium 480px" />
            </Specimen>
            <Specimen detail="draft edited · commit enabled" label="Edited" number="02" stage="app">
                {frame(
                    <RigProjectSettingsDialog
                        {...happy2}
                        draft="Happy Desktop"
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                )}
            </Specimen>
            <Specimen
                detail="host being told · the field and the commit go inert together"
                label="Saving"
                number="03"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        {...happy2}
                        draft="Happy Desktop"
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                        submitting
                    />,
                )}
            </Specimen>
            <Specimen
                detail="no worktrees, nothing run yet, long path"
                label="Empty project"
                number="04"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        contents={{ sessions: 0, worktrees: 0 }}
                        draft="renderer-benchmarks"
                        location={{
                            displayPath:
                                "~/Developer/experiments/2026/renderer-benchmarks-and-traces",
                            path: "/Users/steve/Developer/experiments/2026/renderer-benchmarks-and-traces",
                        }}
                        name="renderer-benchmarks"
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                )}
            </Specimen>
            <Specimen
                detail="the act that ends the project, below everything the reader came to look at"
                label="Archive offered"
                number="05"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        {...happy2}
                        archive={{}}
                        draft="happy2"
                        onArchiveRequest={() => {}}
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                    860,
                )}
            </Specimen>
            <Specimen
                detail="the question names the project and says what leaves with it"
                label="Archive confirming"
                number="06"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        {...happy2}
                        archive={{ confirming: true }}
                        draft="happy2"
                        onArchiveCancel={() => {}}
                        onArchiveConfirm={() => {}}
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                    860,
                )}
            </Specimen>
            <Specimen
                detail="the host is being told and cannot be recalled: the whole dialog goes inert, dismissal included"
                label="Archiving"
                number="07"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        {...happy2}
                        archive={{ confirming: true, submitting: true }}
                        draft="happy2"
                        onArchiveCancel={() => {}}
                        onArchiveConfirm={() => {}}
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                    860,
                )}
            </Specimen>
            <Specimen
                detail="the host refused and the project came back: the reason and the same button"
                label="Archive failed"
                number="08"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        {...happy2}
                        archive={{
                            confirming: true,
                            error: "The project changed before it could be archived.",
                        }}
                        draft="happy2"
                        onArchiveCancel={() => {}}
                        onArchiveConfirm={() => {}}
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                    860,
                )}
            </Specimen>
            <Specimen
                detail="the checkout was archived from elsewhere while this was open: the edit stays and the section it can no longer state is dropped"
                label="Project gone"
                number="09"
                stage="app"
            >
                {frame(
                    <RigProjectSettingsDialog
                        draft="happy2"
                        name="happy2"
                        onClose={() => {}}
                        onDraftChange={() => {}}
                        onSubmit={() => {}}
                    />,
                )}
            </Specimen>
        </ComponentPage>
    );
}
