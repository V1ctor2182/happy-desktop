import type { ConversationToolCall } from "happy2-state";
import { ToolCallPreview } from "../../src/ToolCallPreview";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const runningCommand: ConversationToolCall = {
    toolCallId: "tool-preview-running",
    toolName: "exec_command",
    arguments: {
        cmd: "pnpm --dir packages/happy2-desktop typecheck --pretty false",
    },
    status: "running",
    failed: false,
    presentation: {
        type: "execCommand",
        command:
            "pnpm --dir packages/happy2-desktop typecheck --pretty false && rg --hidden --glob '!node_modules' extraordinarily_long_generated_identifier packages/happy2-desktop/sources",
        output:
            "Checking packages/happy2-desktop/sources/main/rigProjection.ts\n" +
            "extraordinarily_long_generated_identifier_without_natural_break_points_stays_inside_the_sidebar",
    },
};

const completedCommand: ConversationToolCall = {
    ...runningCommand,
    toolCallId: "tool-preview-completed",
    status: "success",
    display: "Command completed successfully",
    presentation: {
        type: "execCommand",
        command: "pnpm --dir packages/happy2-desktop typecheck",
        output: "TypeScript found no errors.\nFinished in 1.1s.",
    },
};

/* A patch longer and wider than the panel: the inspector has to scroll down to
   its result, and every diff line has to stay readable at 250px. */
const patch: ConversationToolCall = {
    toolCallId: "tool-preview-patch",
    toolName: "apply_patch",
    arguments: { path: "README.md" },
    status: "success",
    failed: false,
    display: "Applied patch",
    presentation: {
        type: "fileDiff",
        files: [
            {
                path: "/Users/steve/Developer/murmur/README.md",
                kind: "update",
                added: 14,
                deleted: 14,
                hunks: [
                    {
                        oldStart: 1,
                        newStart: 1,
                        lines: [
                            ...Array.from({ length: 14 }, (_unused, index) => ({
                                kind: "delete" as const,
                                text: `**Offline-First** — agents do not need to be online at the same time, line ${String(index + 1)}`,
                            })),
                            ...Array.from({ length: 14 }, (_unused, index) => ({
                                kind: "add" as const,
                                text: `Murmur ships as one public library for browsers and Node.js, line ${String(index + 1)}`,
                            })),
                        ],
                    },
                ],
            },
        ],
    },
};

function Preview(props: { tool: ConversationToolCall; width: number }) {
    return (
        <div
            style={{
                border: "1px solid var(--divider)",
                display: "flex",
                height: "420px",
                width: `${String(props.width)}px`,
            }}
        >
            <ToolCallPreview tool={props.tool} />
        </div>
    );
}

export function ToolCallPreviewPage() {
    return (
        <ComponentPage
            number="C-165"
            summary="A read-only inspector for one tool call, with its command available immediately and result output added as execution progresses."
            title="Tool call preview"
        >
            <div className="specimen-grid">
                <Specimen
                    detail="250px inspector minimum · long command and output wrap inside the panel"
                    label="Running Bash call"
                    number="T-01"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Preview tool={runningCommand} width={250} />
                        <DimensionRule label="250px · wrapped mono content" />
                    </div>
                </Specimen>
                <Specimen
                    detail="360px inspector maximum · completed output enriches the initial command preview"
                    label="Completed Bash call"
                    number="T-02"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Preview tool={completedCommand} width={360} />
                        <DimensionRule label="360px · completed result" />
                    </div>
                </Specimen>
                <Specimen
                    detail="250px inspector · a patch taller and wider than the panel scrolls down to its result, with every diff line wrapped in place"
                    label="File edit"
                    number="T-03"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Preview tool={patch} width={250} />
                        <DimensionRule label="250px · wrapped diff lines" />
                    </div>
                </Specimen>
            </div>
        </ComponentPage>
    );
}
