import type { ConversationToolCall } from "happy2-state";
import { AgentActivityRow } from "../../src/AgentActivityRow";
import { ComponentPage, Specimen } from "../kit";
import {
    rigAwaitingTool,
    rigExecTool,
    rigExplorationTool,
    rigFailedTool,
    rigFileDiffTool,
    rigGenericTool,
    rigMcpInterruptedTool,
    rigMcpTool,
    rigRunningTool,
    rigStoppedTool,
    rigTerminalTool,
} from "./rigChatFixtures";

export function AgentActivityRowPage() {
    return (
        <ComponentPage
            number="C-148"
            summary="One glanceable row per piece of agent activity — a tool call, a reasoning block, or a shell run — with a status dot, verb, subject, and an expandable detail body."
            title="AgentActivityRow"
        >
            <Specimen
                detail="file diff, exec command, and background terminal, expanded"
                label="Rich tool bodies"
                number="01"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        width: "720px",
                    }}
                >
                    <AgentActivityRow
                        activity={{ kind: "tool", tool: rigFileDiffTool }}
                        defaultExpanded
                    />
                    <AgentActivityRow
                        activity={{ kind: "tool", tool: rigExecTool }}
                        defaultExpanded
                    />
                    <AgentActivityRow
                        activity={{ kind: "tool", tool: rigTerminalTool }}
                        defaultExpanded
                    />
                    <AgentActivityRow activity={{ kind: "tool", tool: rigExplorationTool }} />
                </div>
            </Specimen>

            <Specimen
                detail="running, awaiting approval, failed, stopped, and generic collapsed · trailing time reveals on row hover"
                label="Status treatments"
                number="02"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        width: "720px",
                    }}
                >
                    <AgentActivityRow
                        activity={{ kind: "tool", tool: rigRunningTool }}
                        time="10:42 AM"
                    />
                    <AgentActivityRow activity={{ kind: "tool", tool: rigAwaitingTool }} />
                    <AgentActivityRow activity={{ kind: "tool", tool: rigFailedTool }} />
                    <AgentActivityRow activity={{ kind: "tool", tool: rigStoppedTool }} />
                    <AgentActivityRow activity={{ kind: "tool", tool: rigGenericTool }} />
                </div>
            </Specimen>

            <Specimen
                detail="MCP result rows and an interrupted MCP call"
                label="MCP calls"
                number="03"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        width: "720px",
                    }}
                >
                    <AgentActivityRow activity={{ kind: "tool", tool: rigMcpTool }} />
                    <AgentActivityRow activity={{ kind: "tool", tool: rigMcpInterruptedTool }} />
                </div>
            </Specimen>

            <Specimen
                detail="reasoning collapsed and expanded, plus a finished shell run"
                label="Reasoning and shell"
                number="04"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        width: "720px",
                    }}
                >
                    <AgentActivityRow
                        activity={{
                            kind: "reasoning",
                            text: "The mutex is acquired non-atomically.\n\nA blocking lock removes the window entirely.",
                            streaming: true,
                        }}
                    />
                    <AgentActivityRow
                        activity={{
                            kind: "reasoning",
                            text: "The mutex is acquired non-atomically.\n\nA blocking lock removes the window entirely.",
                            streaming: false,
                        }}
                        defaultExpanded
                    />
                    <AgentActivityRow
                        activity={{
                            kind: "shell",
                            command: "git status --short",
                            output: " M packages/happy2-ui/src/ConversationView.tsx\n",
                            exitCode: 0,
                            running: false,
                            timedOut: false,
                        }}
                    />
                    <AgentActivityRow
                        activity={{
                            kind: "shell",
                            command: "pnpm build",
                            output: "error TS2322: Type mismatch",
                            exitCode: 1,
                            running: false,
                            timedOut: false,
                        }}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="a command wider than its row scrolls sideways behind a 24px fade · the copy action reveals on row hover"
                label="Overflowing subject"
                number="05"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        width: "420px",
                    }}
                >
                    <AgentActivityRow activity={{ kind: "tool", tool: longExecTool }} />
                    <AgentActivityRow
                        activity={{ kind: "tool", tool: longExecTool }}
                        onToolSelect={() => undefined}
                        singleLine
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}

/** A command far wider than a 420px row, so the scroll and its fade are visible. */
const longExecTool: ConversationToolCall = {
    ...rigExecTool,
    toolCallId: "tool-exec-long",
    presentation: {
        type: "execCommand",
        command:
            "pnpm --dir packages/happy2-server exec drizzle-kit generate --config ./drizzle.config.ts --name add_session_request_telemetry",
        output: "Applied 1 migration.",
    },
};
