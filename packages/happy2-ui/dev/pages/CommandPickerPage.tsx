import type { ComposerCommand } from "happy2-state";
import { CommandPicker, commandPickerItems } from "../../src/CommandPicker";
import { ComponentPage, Specimen } from "../kit";

const commands: ComposerCommand[] = [
    "model",
    "effort",
    "permissions",
    "fast",
    "usage",
    "tasks",
    "agents",
    "goal",
    "ps",
    "new",
    "compact",
    "abort",
    "fork",
].map((id) => ({ id, label: `/${id}` }));

const items = commandPickerItems(commands);

export function CommandPickerPage() {
    return (
        <ComponentPage
            number="C-152"
            summary="Composer slash-command popover: 28px single-line rows, the command in mono beside what it does, and the highlighted row Enter commits."
            title="CommandPicker"
        >
            <Specimen
                detail="every command the host offers, first row highlighted"
                label="Command list"
                number="01"
                stage="surface"
            >
                <CommandPicker activeId={items[0]?.id} items={items} onSelect={() => undefined} />
            </Specimen>

            <Specimen
                detail="narrowed to one typed query, with the highlight moved down"
                label="Filtered"
                number="02"
                stage="surface"
            >
                <CommandPicker
                    activeId="fork"
                    items={items.filter((item) => item.slash.startsWith("/f"))}
                    onSelect={() => undefined}
                />
            </Specimen>
        </ComponentPage>
    );
}
