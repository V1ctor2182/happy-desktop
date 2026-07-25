import { RigCommandPalette, type RigCommandId } from "../../src/RigCommandPalette";
import { ComponentPage, Specimen } from "../kit";

const commands: RigCommandId[] = [
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
];

export function RigCommandPalettePage() {
    return (
        <ComponentPage
            number="C-152"
            summary="Rig slash-command palette built on CommandPalette: lists only commands wired to real session actions and filters by query."
            title="RigCommandPalette"
        >
            <Specimen
                detail="all wired commands (model/effort/permissions/fast/new/compact/abort/fork)"
                label="Command list"
                number="01"
                stage="surface"
            >
                <div style={{ width: "520px" }}>
                    <RigCommandPalette
                        autoFocus={false}
                        commands={commands}
                        onClose={() => undefined}
                        onCommand={() => undefined}
                        onQueryChange={() => undefined}
                        query=""
                    />
                </div>
            </Specimen>

            <Specimen
                detail="filtered by a typed query"
                label="Filtered"
                number="02"
                stage="surface"
            >
                <div style={{ width: "520px" }}>
                    <RigCommandPalette
                        autoFocus={false}
                        commands={commands}
                        onClose={() => undefined}
                        onCommand={() => undefined}
                        onQueryChange={() => undefined}
                        query="mo"
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
