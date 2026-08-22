import { expect, it, vi } from "vitest";
import type { HappyAgentUserInputRequest } from "happy-desktop-state";
import "./theme.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/button.css";
import "./styles/checkbox.css";
import "./styles/happy-agent-chat.css";
import {
    HappyAgentUserInputPrompt,
    type HappyAgentUserInputAnswerMap,
} from "./HappyAgentUserInputPrompt";
import { createRenderer } from "./testing";

const request: HappyAgentUserInputRequest = {
    requestId: "req-1",
    questions: [
        {
            id: "approach",
            header: "Approach",
            question: "How?",
            multiSelect: false,
            required: true,
            options: [
                { label: "One transaction", description: "atomic" },
                { label: "Batches", description: "slower" },
            ],
        },
        {
            id: "notify",
            header: "Notify",
            question: "Who?",
            multiSelect: true,
            required: false,
            options: [
                { label: "On-call", description: "page" },
                { label: "Channel", description: "post" },
            ],
        },
    ],
};

function control(view: ReturnType<typeof createRenderer>, questionId: string, index: number) {
    const options = view.container.querySelectorAll(
        `[data-question-id="${questionId}"] [data-happy-desktop-ui="happy-agent-user-input-option"] .happy2-checkbox__control`,
    );
    return options[index] as HTMLInputElement;
}

it("gates submit on required questions and reports single/multi select answers", async () => {
    const answers: { requestId: string; answers: HappyAgentUserInputAnswerMap }[] = [];
    const view = createRenderer();
    view.render(
        () => (
            <HappyAgentUserInputPrompt
                data-testid="input"
                onAnswer={(requestId, map) => answers.push({ requestId, answers: map })}
                request={request}
            />
        ),
        { width: 560, height: 440, padding: 16 },
    );
    await view.ready();

    const submit = view.$('[data-testid="input"] [data-action="submit"]')
        .element as HTMLButtonElement;
    expect(submit.disabled, "submit blocked until required answered").toBe(true);

    // Multi-select: accumulate both notify options.
    control(view, "notify", 0).click();
    control(view, "notify", 1).click();
    // Single-select: choose the second, then switch to the first (clears the second).
    control(view, "approach", 1).click();
    control(view, "approach", 0).click();

    await vi.waitFor(() => expect(submit.disabled).toBe(false));

    submit.click();
    await vi.waitFor(() => expect(answers.length).toBe(1));
    expect(answers[0]!.requestId).toBe("req-1");
    expect(answers[0]!.answers.approach).toEqual(["One transaction"]);
    expect(answers[0]!.answers.notify).toEqual(["On-call", "Channel"]);

    await view.screenshot("HappyAgentUserInputPrompt.test");

    view.render(
        () => (
            <HappyAgentUserInputPrompt
                data-testid="answered-input"
                request={request}
                resolvedAnswers={{
                    approach: ["One transaction"],
                }}
            />
        ),
        { width: 560, height: 440, padding: 16 },
    );
    await view.ready();

    const answered = view.$('[data-testid="answered-input"]');
    expect(answered.element.getAttribute("data-state")).toBe("answered");
    expect(answered.element.querySelector('[data-action="submit"]')).toBeNull();
    expect(answered.element.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(
        answered.element.querySelector('[data-happy-desktop-ui="happy-agent-user-input-answers"]')
            ?.textContent,
    ).toContain("One transaction");
    expect(answered.element.querySelector('[data-question-id="notify"]')?.textContent).toContain(
        "Skipped",
    );
    await view.screenshot("HappyAgentUserInputPrompt.answered.test");
}, 120_000);
