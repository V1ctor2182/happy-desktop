import { useState, type CSSProperties } from "react";
import type { RigUserInputRequest, UserError } from "happy2-state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

export type RigUserInputAnswerMap = Record<string, string[]>;

export type RigUserInputPromptProps = {
    request: RigUserInputRequest;
    onAnswer: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Disables the controls while a prior submission is in flight. */
    pending?: boolean;
    /** Last failed answer submission; retry resubmits the retained selections. */
    error?: UserError;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

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
                                <span
                                    className="happy2-rig-input__header"
                                    data-happy2-ui="rig-user-input-header"
                                >
                                    {question.header}
                                </span>
                                <span className="happy2-rig-input__prompt">
                                    {question.question}
                                </span>
                            </legend>
                            <div className="happy2-rig-input__options">
                                {question.options.map((option) => (
                                    <label
                                        className="happy2-rig-input__option"
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
