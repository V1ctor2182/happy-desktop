import { expect, it } from "vitest";
import { UserError, type ConversationRequest } from "happy2-state";
import "./styles.css";
import { ConversationRequestView } from "./ConversationRequestView";
import { createRenderer } from "./testing";

const permissionReview: ConversationRequest = {
    kind: "permissionReview",
    requestId: "req-perm",
    tool: {
        toolCallId: "call-1",
        toolName: "bash",
        arguments: { command: "rm -rf build" },
        status: "awaitingApproval",
        display: "rm -rf build",
        failed: false,
    },
    review: {
        action: "Remove the build directory",
        reason: "This deletes files that are not tracked by git.",
        decision: "ask",
        risk: "high",
        userAuthorization: "low",
    },
};

const pluginManagement: ConversationRequest = {
    kind: "pluginManagement",
    requestId: "req-plugin",
    action: "install",
    status: "pending",
    displayName: "Movie Catalog",
    shortName: "movie-catalog",
    description: "Browses a catalog of films.",
    reason: "The agent needs it to answer this question.",
};

const documentWrite: ConversationRequest = {
    kind: "documentWrite",
    requestId: "req-doc",
    status: "pending",
    documentId: "doc-1",
    documentTitle: "Launch plan",
    expiresAt: "2026-07-25T12:00:00.000Z",
};

const userInput: ConversationRequest = {
    kind: "userInput",
    requestId: "req-input",
    questions: [
        {
            id: "q1",
            header: "Scope",
            question: "Which package should this land in?",
            multiSelect: false,
            required: true,
            options: [
                { label: "happy2-ui", description: "Reusable visuals." },
                { label: "happy2-state", description: "Product state." },
            ],
        },
    ],
};

function renderRequest(request: ConversationRequest, decisions: string[]) {
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "560px" }}>
                <ConversationRequestView
                    defaultExpanded
                    onDecide={(requestId, decision) => decisions.push(`${requestId}/${decision}`)}
                    request={request}
                />
            </div>
        ),
        { width: 600, height: 460, padding: 12 },
    );
    return view;
}

it("renders a paused tool as an approval gate and reports the decision", async () => {
    const decisions: string[] = [];
    const view = renderRequest(permissionReview, decisions);
    await view.ready();

    expect(view.$('[data-happy2-ui="approval-card"]').element.getAttribute("data-resolution")).toBe(
        "pending",
    );
    expect(view.$('[data-happy2-ui="approval-card-title"]').element.textContent).toBe(
        "Remove the build directory",
    );
    expect(view.$('[data-happy2-ui="approval-card-reason"]').element.textContent).toContain(
        "not tracked by git",
    );
    expect(view.$('[data-happy2-ui="badge-label"]').element.textContent).toContain("Permission");

    (view.$('[data-action="approve"]').element as HTMLButtonElement).click();
    expect(decisions).toEqual(["req-perm/approve"]);

    await view.screenshot("ConversationRequestView.permissionReview");
}, 120_000);

it("renders a cloud plugin management request through the same gate", async () => {
    const decisions: string[] = [];
    const view = renderRequest(pluginManagement, decisions);
    await view.ready();

    expect(view.$('[data-happy2-ui="badge-label"]').element.textContent).toContain("Plugin");
    expect(view.$('[data-happy2-ui="approval-card-title"]').element.textContent).toBe(
        "Movie Catalog",
    );
    expect(view.$('[data-happy2-ui="approval-card-action-text"]').element.textContent).toContain(
        "install movie-catalog",
    );

    (view.$('[data-action="deny"]').element as HTMLButtonElement).click();
    expect(decisions).toEqual(["req-plugin/deny"]);

    await view.screenshot("ConversationRequestView.pluginManagement");
}, 120_000);

it("renders a cloud document write request through the same gate", async () => {
    const decisions: string[] = [];
    const view = renderRequest(documentWrite, decisions);
    await view.ready();

    expect(view.$('[data-happy2-ui="badge-label"]').element.textContent).toContain(
        "Document write",
    );
    expect(view.$('[data-happy2-ui="approval-card-title"]').element.textContent).toBe(
        "Launch plan",
    );

    (view.$('[data-action="approve"]').element as HTMLButtonElement).click();
    expect(decisions).toEqual(["req-doc/approve"]);
}, 120_000);

it("shows a resolved request as decided, with no pending controls", async () => {
    const decisions: string[] = [];
    const view = renderRequest({ ...pluginManagement, status: "approved" }, decisions);
    await view.ready();

    expect(view.$('[data-happy2-ui="approval-card"]').element.getAttribute("data-resolution")).toBe(
        "approved",
    );
    expect(view.container.querySelector('[data-action="approve"]')).toBeNull();
}, 120_000);

it("shows a failed request as decided rather than still awaiting the reader", async () => {
    const decisions: string[] = [];
    const view = renderRequest(
        { ...documentWrite, status: "failed", lastError: "Document was deleted." },
        decisions,
    );
    await view.ready();

    // Failed and expired are not pending: offering Approve would be a lie.
    expect(view.$('[data-happy2-ui="approval-card"]').element.getAttribute("data-resolution")).toBe(
        "denied",
    );
    expect(view.container.querySelector('[data-action="approve"]')).toBeNull();
}, 120_000);

it("ignores decisions while a prior submission is in flight", async () => {
    const decisions: string[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "560px" }}>
                <ConversationRequestView
                    onDecide={(requestId, decision) => decisions.push(`${requestId}/${decision}`)}
                    pending
                    request={permissionReview}
                />
            </div>
        ),
        { width: 600, height: 460, padding: 12 },
    );
    await view.ready();

    expect((view.$('[data-action="approve"]').element as HTMLButtonElement).disabled).toBe(true);
    (view.$('[data-action="approve"]').element as HTMLButtonElement).click();
    expect(decisions).toEqual([]);
}, 120_000);

it("keeps a processing cloud plugin request pending but disables another decision", async () => {
    const view = renderRequest({ ...pluginManagement, status: "processing" }, []);
    await view.ready();

    expect(view.$('[data-happy2-ui="approval-card"]').element.getAttribute("data-resolution")).toBe(
        "pending",
    );
    expect((view.$('[data-action="approve"]').element as HTMLButtonElement).disabled).toBe(true);
}, 120_000);

it("still renders structured questions through the input prompt", async () => {
    const view = renderRequest(userInput, []);
    await view.ready();

    // The question variant keeps its own surface; only gates share the card.
    expect(view.container.querySelector('[data-happy2-ui="approval-card"]')).toBeNull();
    expect(view.container.querySelector('[data-happy2-ui="rig-user-input"]')).not.toBeNull();
}, 120_000);

it("renders a displayable input failure and retries the retained answer", async () => {
    const answers: unknown[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <div style={{ width: "560px" }}>
                <ConversationRequestView
                    error={new UserError("Rig rejected the answer.")}
                    onAnswer={(requestId, value) => answers.push({ requestId, value })}
                    request={userInput}
                />
            </div>
        ),
        { width: 600, height: 500, padding: 12 },
    );
    await view.ready();

    (view.$('[aria-label="happy2-ui"]').element as HTMLInputElement).click();
    const error = view.$('[data-testid="rig-user-input-error"]');
    expect(error.element.textContent).toContain("Rig rejected the answer.");
    (error.element.querySelector("button") as HTMLButtonElement).click();
    expect(answers).toEqual([
        {
            requestId: "req-input",
            value: { q1: ["happy2-ui"] },
        },
    ]);

    await view.screenshot("ConversationRequestView.userInputError");
}, 120_000);
