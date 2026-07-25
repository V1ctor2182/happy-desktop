import { RigToolCall } from "../../src/RigToolCall";
import { ComponentPage, Specimen } from "../kit";
import {
    rigAwaitingTool,
    rigExecTool,
    rigFailedTool,
    rigFileDiffTool,
    rigGenericTool,
    rigMcpInterruptedTool,
    rigMcpTool,
    rigRunningTool,
    rigStoppedTool,
    rigTerminalTool,
} from "./rigChatFixtures";

const boxStyle = { display: "flex", flexDirection: "column" as const, gap: "12px", width: "620px" };

export function RigToolCallPage() {
    return (
        <ComponentPage
            number="C-148"
            summary="Rig tool-call renderer: status dot + verb + text header, rich file-diff / exec / background-terminal bodies, generic result + args, and a pending permission review."
            title="RigToolCall"
        >
            <Specimen
                detail="fileDiff → Edited path (+N −M) with DiffSnippet and truncation notes"
                label="File diff"
                number="01"
                stage="surface"
            >
                <div style={boxStyle}>
                    <RigToolCall defaultExpanded tool={rigFileDiffTool} />
                </div>
            </Specimen>

            <Specimen
                detail="execCommand → Ran <command> with head/tail-truncated output"
                label="Exec command"
                number="02"
                stage="surface"
            >
                <div style={boxStyle}>
                    <RigToolCall defaultExpanded tool={rigExecTool} />
                </div>
            </Specimen>

            <Specimen
                detail="backgroundTerminalInteraction → input child rows (running)"
                label="Background terminal"
                number="03"
                stage="surface"
            >
                <div style={boxStyle}>
                    <RigToolCall defaultExpanded tool={rigTerminalTool} />
                </div>
            </Specimen>

            <Specimen
                detail="generic tool → result child row + bounded JSON args"
                label="Generic tool"
                number="04"
                stage="surface"
            >
                <div style={boxStyle}>
                    <RigToolCall defaultExpanded tool={rigGenericTool} />
                </div>
            </Specimen>

            <Specimen
                detail="status states: running (warning), awaiting approval, failed, stopped"
                label="Statuses"
                number="05"
                stage="surface"
            >
                <div style={boxStyle}>
                    <RigToolCall tool={rigRunningTool} />
                    <RigToolCall tool={rigAwaitingTool} />
                    <RigToolCall defaultExpanded tool={rigFailedTool} />
                    <RigToolCall tool={rigStoppedTool} />
                </div>
            </Specimen>

            <Specimen
                detail="MCP tool → `server · tool` header, ≤5 dim result rows + `… N more`, and an interrupted call"
                label="MCP tool"
                number="06"
                stage="surface"
            >
                <div style={boxStyle}>
                    <RigToolCall defaultExpanded tool={rigMcpTool} />
                    <RigToolCall tool={rigMcpInterruptedTool} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
