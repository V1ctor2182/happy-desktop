import { useState, type CSSProperties } from "react";
import type { RigUserInputRequest, UserError } from "happy2-state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

export type RigUserInputAnswerMap = Record<string, string[]>;

/**
 * Whether the prompt draws its own container. `card` is the standalone form a
 * transcript needs, because a question there has to separate itself from the
 * messages around it. `flat` drops the fill, border, and padding for a host
 * that already gives the question a container — the inbox, where the asking
 * session's line and the question it asked are one block.
 */
export type RigUserInputPromptVariant = "card" | "flat";

export type RigUserInputPromptProps = {
    request: RigUserInputRequest;
    onAnswer: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Disables the controls while a prior submission is in flight. */
    pending?: boolean;
    /** Last failed answer submission; retry resubmits the retained selections. */
    error?: UserError;
    /** Defaults to `card`; see `RigUserInputPromptVariant`. */
    variant?: RigUserInputPromptVariant;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * How many of a question's options may be taken, said beside its name so the
 * rule is read before the options rather than discovered by clicking one. An
 * optional question says so too: nothing under it is holding the submit back.
 */
function selectionRule(question: { multiSelect: boolean; required: boolean }): string {
    const count = question.multiSelect ? "Choose any" : "Choose one";
    return question.required ? count : `${count} · optional`;
}

function toggleValue(current: readonly string[], value: string, multiSelect: boolean): string[] {
    if (multiSelect)
        return current.includes(value)
            ? current.filter((entry) => entry !== value)
            : [...current, value];
    return current.includes(value) ? [] : [value];
}

/**
 * RigUserInputPrompt — renders a `RigUserInputRequest` as one or more option
 * pickers. Single-select questions clear other options; multi-select questions
 * accumulate. The local selection map is the component's only state; submit calls
 * `onAnswer(requestId, { [questionId]: string[] })` with the chosen option labels.
 * Submit is blocked until every `required` question has at least one selection.
 *
 * Each question states its own selection rule beside its name, so a person can
 * tell a single choice from an accumulating one, and an optional question from
 * the one actually holding the submit, without trying an option to find out.
 */
export function RigUserInputPrompt(props: RigUserInputPromptProps) {
    const { request } = props;
    const [answers, setAnswers] = useState<RigUserInputAnswerMap>({});

    const select = (questionId: string, value: string, multiSelect: boolean) => {
        setAnswers((previous) => ({
            ...previous,
            [questionId]: toggleValue(previous[questionId] ?? [], value, multiSelect),
        }));
    };

    const complete = request.questions.every(
        (question) => !question.required || (answers[question.id]?.length ?? 0) > 0,
    );

    return (
        <section
            className={["happy2-rig-input", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-user-input"
            data-testid={props["data-testid"]}
            data-variant={props.variant ?? "card"}
            style={props.style}
        >
            <div className="happy2-rig-input__questions">
                {request.questions.map((question) => {
                    const selected = answers[question.id] ?? [];
                    return (
                        <fieldset
                            className="happy2-rig-input__question"
                            data-happy2-ui="rig-user-input-question"
                            data-question-id={question.id}
                            key={question.id}
                        >
                            <legend className="happy2-rig-input__legend">
                                <span className="happy2-rig-input__eyebrow">
                                    <span
                                        className="happy2-rig-input__header"
                                        data-happy2-ui="rig-user-input-header"
                                    >
                                        {question.header}
                                    </span>
                                    <span
                                        className="happy2-rig-input__rule"
                                        data-happy2-ui="rig-user-input-rule"
                                    >
                                        {selectionRule(question)}
                                    </span>
                                </span>
                                <span className="happy2-rig-input__prompt">
                                    {question.question}
                                </span>
                            </legend>
                            <div className="happy2-rig-input__options">
                                {question.options.map((option) => (
                                    <label
                                        className="happy2-rig-input__option"
                                        data-disabled={props.pending ? "" : undefined}
                                        data-happy2-ui="rig-user-input-option"
                                        data-selected={
                                            selected.includes(option.label) ? "" : undefined
                                        }
                                        key={option.label}
                                    >
                                        <Checkbox
                                            aria-label={option.label}
                                            checked={selected.includes(option.label)}
                                            disabled={props.pending}
                                            onChange={() =>
                                                select(
                                                    question.id,
                                                    option.label,
                                                    question.multiSelect,
                                                )
                                            }
                                        />
                                        <span className="happy2-rig-input__option-body">
                                            <span className="happy2-rig-input__option-label">
                                                {option.label}
                                            </span>
                                            {option.description ? (
                                                <span className="happy2-rig-input__option-description">
                                                    {option.description}
                                                </span>
                                            ) : null}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    );
                })}
            </div>
            {props.error ? (
                <Banner
                    action={{
                        label: "Retry",
                        onClick: () => props.onAnswer(request.requestId, answers),
                    }}
                    data-testid="rig-user-input-error"
                    tone="danger"
                    title="Answer not sent"
                >
                    {props.error.message}
                </Banner>
            ) : null}
            <div className="happy2-rig-input__footer">
                <Button
                    data-action="submit"
                    disabled={!complete || props.pending}
                    onClick={() => props.onAnswer(request.requestId, answers)}
                    size="small"
                >
                    Submit
                </Button>
            </div>
        </section>
    );
}
