import type {
    RigMenusSnapshot,
    RigSessionId,
    RigSessionSummary,
    RigToolEntry,
    RigTranscriptEntry,
    RigUserInputRequest,
} from "happy2-state";

const id = (value: string) => value as RigSessionId;

export const rigFileDiffTool: RigToolEntry = {
    toolCallId: "tool-diff",
    toolName: "edit",
    arguments: { path: "src/auth/refresh.ts" },
    status: "success",
    failed: false,
    display: "Edited src/auth/refresh.ts",
    presentation: {
        type: "fileDiff",
        files: [
            {
                path: "src/auth/refresh.ts",
                kind: "update",
                added: 2,
                deleted: 1,
                omittedLines: 4,
                hunks: [
                    {
                        oldStart: 41,
                        newStart: 41,
                        lines: [
                            { kind: "context", text: "async refresh(token: Token) {" },
                            { kind: "delete", text: "  const lock = await mutex.tryLock()" },
                            {
                                kind: "add",
                                text: "  const lock = await mutex.lock({ timeout: 5_000 })",
                            },
                            { kind: "add", text: "  if (!lock) return queue.enqueue(token)" },
                            { kind: "context", text: "  try {" },
                        ],
                    },
                ],
            },
        ],
        omittedFiles: 2,
    },
};

export const rigExecTool: RigToolEntry = {
    toolCallId: "tool-exec",
    toolName: "bash",
    arguments: { command: "pnpm test" },
    status: "success",
    failed: false,
    display: "Ran pnpm test",
    presentation: {
        type: "execCommand",
        command: "pnpm test",
        output: Array.from({ length: 18 }, (_, index) => `line ${index + 1} of test output`).join(
            "\n",
        ),
    },
};

export const rigTerminalTool: RigToolEntry = {
    toolCallId: "tool-terminal",
    toolName: "TaskOutput",
    arguments: null,
    status: "running",
    failed: false,
    presentation: {
        type: "backgroundTerminalInteraction",
        command: "npm run dev",
        input: "rs\ny",
    },
};

export const rigGenericTool: RigToolEntry = {
    toolCallId: "tool-generic",
    toolName: "TaskList",
    arguments: { filter: "in_progress", limit: 20 },
    status: "success",
    failed: false,
    display: "3 tasks in progress",
};

export const rigRunningTool: RigToolEntry = {
    toolCallId: "tool-running",
    toolName: "grep",
    arguments: { pattern: "TODO" },
    status: "running",
    failed: false,
    display: "Searching…",
};

export const rigAwaitingTool: RigToolEntry = {
    toolCallId: "tool-await",
    toolName: "write",
    arguments: { path: "config/releases.json" },
    status: "awaiting_approval",
    failed: false,
    permissionReview: {
        action: "write config/releases.json",
        reason: "This file is outside the workspace write allowlist.",
        decision: "ask",
        risk: "high",
        userAuthorization: "low",
    },
};

export const rigFailedTool: RigToolEntry = {
    toolCallId: "tool-failed",
    toolName: "bash",
    arguments: { command: "pnpm build" },
    status: "failed",
    failed: true,
    failure: { kind: "execution_failed", message: "exit code 1" },
    display: "Command failed with exit code 1",
    presentation: {
        type: "execCommand",
        command: "pnpm build",
        output: "error TS2322: Type mismatch\n  at src/index.ts:12",
    },
};

export const rigStoppedTool: RigToolEntry = {
    toolCallId: "tool-stopped",
    toolName: "bash",
    arguments: { command: "sleep 100" },
    status: "stopped",
    failed: false,
    display: "Stopped by user",
};

export const rigMcpTool: RigToolEntry = {
    toolCallId: "tool-mcp",
    toolName: "mcp__linear__create_issue",
    arguments: { title: "Fix token rotation race", team: "core", priority: 2 },
    status: "success",
    failed: false,
    display: [
        "Created issue CORE-4821",
        "Title: Fix token rotation race",
        "Assignee: unassigned",
        "URL: https://linear.app/core/issue/CORE-4821",
        "State: Todo",
        "Labels: bug, backend",
        "Estimate: 3",
    ].join("\n"),
};

export const rigMcpInterruptedTool: RigToolEntry = {
    toolCallId: "tool-mcp-interrupted",
    toolName: "mcp__github__search_code",
    arguments: { query: "withTransaction retry" },
    status: "stopped",
    failed: true,
    failure: { kind: "interrupted" },
};

export const rigTranscriptEntries: readonly RigTranscriptEntry[] = [
    {
        id: "u1",
        kind: "user",
        text: "Refresh the token rotation to avoid the race condition.",
        images: [],
    },
    {
        id: "u2",
        kind: "user",
        text: "Here is the failing screenshot.",
        images: [{ mediaType: "image/png", data: "" }],
    },
    {
        id: "t1",
        kind: "thinking",
        text: "The mutex is being acquired non-atomically.",
        streaming: false,
    },
    {
        id: "a1",
        kind: "agentText",
        text: "I'll switch to a blocking lock and enqueue on contention.\n\n```ts\nawait mutex.lock()\n```",
        streaming: false,
    },
    { id: rigFileDiffTool.toolCallId, kind: "tool", tool: rigFileDiffTool },
    { id: rigExecTool.toolCallId, kind: "tool", tool: rigExecTool },
    { id: rigGenericTool.toolCallId, kind: "tool", tool: rigGenericTool },
    {
        id: "turn-1",
        kind: "turnSeparator",
        elapsedMs: 84_000,
        toolCount: 3,
        fileCount: 1,
        additions: 18,
        deletions: 5,
    },
    { id: "sys1", kind: "system", text: "Context reset for this session." },
    {
        id: "n1",
        kind: "notice",
        level: "warning",
        title: "Retrying",
        text: "Attempt 2/3 (connection lost).",
    },
    {
        id: "n2",
        kind: "notice",
        level: "error",
        title: "Run error",
        text: "The provider returned an error.",
    },
    {
        id: "shell:c1",
        kind: "shell",
        command: "git status --short",
        output: " M packages/happy2-state/src/rig/rigChatStore.ts\n M packages/happy2-ui/src/RigTranscript.tsx\n",
        exitCode: 0,
        running: false,
        timedOut: false,
    },
    { id: "a2", kind: "agentText", text: "The change is applied and tests pass.", streaming: true },
];

export const rigMenus: RigMenusSnapshot = {
    modelOptions: [
        {
            providerId: "codex",
            modelId: "gpt-5.6-sol",
            name: "GPT-5.6 Sol",
            disabled: false,
            current: true,
        },
        {
            providerId: "codex",
            modelId: "gpt-5.6-terra",
            name: "GPT-5.6 Terra",
            disabled: false,
            current: false,
        },
        {
            providerId: "claude",
            modelId: "opus-4-8",
            name: "Opus 4.8",
            disabled: false,
            current: false,
        },
        {
            providerId: "grok",
            modelId: "grok-4.5",
            name: "Grok 4.5",
            disabled: true,
            current: false,
        },
    ],
    effortOptions: [
        { level: "low", label: "Low", current: false, isDefault: false },
        { level: "medium", label: "Medium", current: true, isDefault: true },
        { level: "high", label: "High", current: false, isDefault: false },
    ],
    permissionModeOptions: [
        { mode: "auto", label: "Auto", current: true },
        { mode: "workspace_write", label: "Workspace write", current: false },
        { mode: "read_only", label: "Read only", current: false },
        { mode: "full_access", label: "Full access", current: false },
    ],
    serviceTierOptions: [
        { tier: null, label: "Standard", current: true },
        { tier: "fast", label: "Fast", current: false },
    ],
    currentProviderId: "codex",
    currentModelId: "gpt-5.6-sol",
    currentEffort: "medium",
    currentPermissionMode: "auto",
    currentServiceTier: undefined,
};

export const rigUserInput: RigUserInputRequest = {
    requestId: "req-1",
    questions: [
        {
            id: "approach",
            header: "Approach",
            question: "How should the migration run?",
            multiSelect: false,
            required: true,
            options: [
                { label: "In one transaction", description: "Atomic but locks the table longer." },
                { label: "In batches", description: "Lower lock contention, slower overall." },
            ],
        },
        {
            id: "notify",
            header: "Notify",
            question: "Who should be notified when it completes?",
            multiSelect: true,
            required: false,
            options: [
                { label: "On-call", description: "Page the current on-call engineer." },
                { label: "Channel", description: "Post to the team channel." },
            ],
        },
    ],
};

const now = 1_700_000_000_000;

export const rigSessions: readonly RigSessionSummary[] = [
    {
        id: id("ses_alpha01234567"),
        cwd: "/Users/dev/happy2",
        displayCwd: "~/happy2",
        providerId: "codex",
        modelId: "gpt-5.6-sol",
        permissionMode: "auto",
        status: "running",
        title: "Fix token rotation race",
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now - 30_000,
    },
    {
        id: id("ses_beta012345678"),
        cwd: "/Users/dev/happy2-server",
        displayCwd: "~/happy2-server",
        providerId: "claude",
        modelId: "opus-4-8",
        permissionMode: "workspace_write",
        status: "completed",
        recap: "Added the sessions gym coverage.",
        createdAt: now - 3_600_000,
        updatedAt: now - 3_600_000,
        lastMessageAt: now - 3_600_000,
    },
    {
        id: id("ses_gamma01234567"),
        cwd: "/Users/dev/scratch",
        displayCwd: "~/scratch",
        providerId: "grok",
        modelId: "grok-4.5",
        permissionMode: "read_only",
        status: "error",
        createdAt: now - 90_000_000,
        updatedAt: now - 90_000_000,
    },
];

export const rigSessionsNow = now;
