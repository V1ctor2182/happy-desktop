import type { ComposerCommand } from "happy-desktop-state";
import { CommandPicker, commandPickerItems } from "../../src/CommandPicker";
import { ComponentPage, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-152";

const commands: ComposerCommand[] = [
    {
        id: "compact",
        label: "/compact",
        description: "Summarize older messages to free context space.",
        hasArguments: false,
        kind: "compaction",
    },
    {
        id: "code-review",
        label: "/code-review",
        description: "Review the current changes.",
        hasArguments: true,
        kind: "skill",
    },
    {
        id: "frontend-design",
        label: "/frontend-design",
        description: "Create a polished production interface.",
        hasArguments: true,
        kind: "skill",
    },
    { id: "usage", label: "/usage" },
    { id: "tasks", label: "/tasks" },
    { id: "agents", label: "/agents" },
    { id: "goal", label: "/goal" },
    { id: "ps", label: "/ps" },
    { id: "abort", label: "/abort" },
];

const items = commandPickerItems(commands);

export function CommandPickerPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Composer slash-command popover: a quiet section heading over 32px single-line rows — glyph, command, and what it does — spanning the composer, with the highlighted row Enter commits."
            title="CommandPicker"
        >
            <Specimen
                detail="every command the host offers, first row highlighted"
                label="Command list"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", width: "420px" }}>
                    <CommandPicker
                        activeId={items[0]?.id}
                        items={items}
                        onSelect={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="narrowed to one typed query, with the highlight moved down"
                label="Filtered"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", width: "420px" }}>
                    <CommandPicker
                        activeId="frontend-design"
                        items={items.filter((item) => item.slash.startsWith("/f"))}
                        onSelect={() => undefined}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
