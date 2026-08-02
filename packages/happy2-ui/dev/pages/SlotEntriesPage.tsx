import { SlotEntries, type SlotVisualEntry } from "../../src/SlotEntries";
import { ComponentPage, Specimen } from "../kit";

const entries: readonly SlotVisualEntry[] = [
    {
        id: "release",
        author: "Release agent",
        description: "Current release posture for this workspace.",
        purpose: "Keep operational context beside the conversation that needs it.",
        content: {
            type: "text",
            markdown: "Release is **clear** · [open checklist](https://example.com/checklist)",
        },
    },
    {
        id: "review",
        author: "Review agent",
        description: "Starts the review handoff prepared by the agent.",
        purpose: "Make the next useful action available without adding permanent chrome.",
        content: { type: "button", label: "Open review dashboard" },
    },
];

export function SlotEntriesPage() {
    return (
        <ComponentPage
            number="C-176"
            summary="Agent-authored context embedded in Happy's four durable contribution points. Compact placements switch one at a time; roomy placements render the full ordered set, and every item keeps its author, description, and purpose inspectable."
            title="Slot entries"
        >
            <Specimen
                detail="One compact item · explicit next control · inline markdown link · author inspection"
                label="Status line and title"
                number="01"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "20px",
                        width: "680px",
                    }}
                >
                    <SlotEntries entries={entries} placement="status-line" />
                    <SlotEntries entries={entries} placement="title" />
                </div>
            </Specimen>
            <Specimen
                detail="Full ordered set · composer-width bar · text and action content · stable per-entry inspection"
                label="Composer and sidebar"
                number="02"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "24px",
                        width: "860px",
                    }}
                >
                    <SlotEntries entries={entries} placement="above-composer" />
                    <div style={{ width: "260px", background: "var(--surface-high)" }}>
                        <SlotEntries entries={entries} placement="sidebar" />
                    </div>
                </div>
            </Specimen>
        </ComponentPage>
    );
}
