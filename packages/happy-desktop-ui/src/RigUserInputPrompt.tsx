import { useState, type CSSProperties } from "react";
import type { RigUserInputRequest, UserError } from "happy-desktop-state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

export type RigUserInputAnswerMap = Record<string, string[]>;

/**
 * Whether the prompt follows transcript or inbox spacing. `card` uses the
 * conversation's full composer measure; `flat` inherits the inbox row around it.
 */
export type RigUserInputPromptVariant = "card" | "flat";

export type RigUserInputPromptProps = {
    request: RigUserInputRequest;
    /** Authoritative settled answers turn the prompt into compact transcript history. */
    resolvedAnswers?: Readonly<Record<string, readonly string[]>>;
    /** Absent when this surface can display choices but cannot submit them. */
    onAnswer?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /**
     * What is ticked right now, for an owner that keeps the selection. Supplying
     * it with `onSelectionChange` is what lets something outside this card act on
     * a half-made choice — sending a message that answers the question has to
     * carry the options already ticked into it. Left out, the card keeps its own
     * selection and stays a self-contained prompt.
     */
    selection?: Readonly<Record<string, readonly string[]>>;
    /** Reports the whole selection after each tick, for an owner that keeps it. */
    onSelectionChange?: (requestId: string, answers: RigUserInputAnswerMap) => void;
    /** Disables the controls while a prior submission is in flight. */
    pending?: boolean;
    /** Disables only submission while keeping local option selection editable. */
    submitDisabled?: boolean;
    submitDisabledReason?: string;
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
 * pickers, or as compact read-only history when `resolvedAnswers` is present.
 * Single-select questions clear other options; multi-select questions
 * accumulate. Submit calls `onAnswer(requestId, { [questionId]: string[] })`
 * with the chosen option labels, and is blocked until every `required` question
 * has at least one selection.
 *
 * Each question states its own selection rule beside its name, so a person can
 * tell a single choice from an accumulating one, and an optional question from
 * the one actually holding the submit, without trying an option to find out.
 *
 * The selection is the card's own state unless the owner keeps it through
 * `selection`/`onSelectionChange`, which an owner does when something outside the
 * card — a composer whose message answers this question — must be able to read a
 * choice that has been made but not yet submitted.
 */
export function RigUserInputPrompt(props: RigUserInputPromptProps) {
    const { request } = props;
    const [ownAnswers, setOwnAnswers] = useState<RigUserInputAnswerMap>({});
    const resolved = props.resolvedAnswers !== undefined;
    const controlled = props.selection !== undefined || resolved;
    const answers: RigUserInputAnswerMap = controlled
        ? Object.fromEntries(
              Object.entries(props.resolvedAnswers ?? props.selection ?? {}).map(([id, values]) => [
                  id,
                  [...values],
              ]),
          )
        : ownAnswers;

    const select = (questionId: string, value: string, multiSelect: boolean) => {
        const next: RigUserInputAnswerMap = {
            ...answers,
            [questionId]: toggleValue(answers[questionId] ?? [], value, multiSelect),
        };
        if (!controlled) setOwnAnswers(next);
        props.onSelectionChange?.(request.requestId, next);
    };

    const complete = request.questions.every(
        (question) => !question.required || (answers[question.id]?.length ?? 0) > 0,
    );

    return (
        <section
            className={["happy2-rig-input", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="rig-user-input"
            data-state={resolved ? "answered" : "pending"}
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
                            data-happy-desktop-ui="rig-user-input-question"
                            data-question-id={question.id}
                            key={question.id}
                        >
                            <legend className="happy2-rig-input__legend">
                                <span className="happy2-rig-input__eyebrow">
                                    <span
                                        className="happy2-rig-input__header"
                                        data-happy-desktop-ui="rig-user-input-header"
                                    >
                                        {question.header}
                                    </span>
                                    <span
                                        className="happy2-rig-input__rule"
                                        data-happy-desktop-ui="rig-user-input-rule"
                                    >
                                        {resolved
                                            ? selected.length > 0
                                                ? "Answered"
                                                : question.required
                                                  ? "No answer"
                                                  : "Skipped"
                                            : selectionRule(question)}
                                    </span>
                                </span>
                                <span className="happy2-rig-input__prompt">
                                    {question.question}
                                </span>
                            </legend>
                            {resolved ? (
                                <div
                                    className="happy2-rig-input__answers"
                                    data-happy-desktop-ui="rig-user-input-answers"
                                >
                                    {(answers[question.id] ?? []).length > 0 ? (
                                        (answers[question.id] ?? []).map((answer) => {
                                            const option = question.options.find(
                                                (candidate) => candidate.label === answer,
                                            );
                                            return (
                                                <div
                                                    className="happy2-rig-input__answer"
                                                    key={answer}
                                                >
                                                    <span className="happy2-rig-input__answer-label">
                                                        {answer}
                                                    </span>
                                                    {option?.description ? (
                                                        <span className="happy2-rig-input__answer-description">
                                                            {option.description}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <div className="happy2-rig-input__answer">
                                            <span className="happy2-rig-input__answer-label">
                                                {question.required ? "No answer" : "Skipped"}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="happy2-rig-input__options">
                                    {question.options.map((option, optionIndex) => {
                                        const descriptionId = `${request.requestId}-${question.id}-${optionIndex}-description`;
                                        return (
                                            <label
                                                className="happy2-rig-input__option"
                                                data-disabled={props.pending ? "" : undefined}
                                                data-happy-desktop-ui="rig-user-input-option"
                                                data-selected={
                                                    selected.includes(option.label) ? "" : undefined
                                                }
                                                key={option.label}
                                                title={option.description || undefined}
                                            >
                                                <Checkbox
                                                    aria-describedby={
                                                        option.description
                                                            ? descriptionId
                                                            : undefined
                                                    }
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
                                                        <span
                                                            className="happy2-rig-input__option-description"
                                                            id={descriptionId}
                                                        >
                                                            {option.description}
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </fieldset>
                    );
                })}
            </div>
            {!resolved && props.error ? (
                <Banner
                    {...(props.submitDisabled || props.onAnswer === undefined
                        ? {}
                        : {
                              action: {
                                  label: "Retry",
                                  onClick: () => props.onAnswer?.(request.requestId, answers),
                              },
                          })}
                    data-testid="rig-user-input-error"
                    tone="danger"
                    title="Answer not sent"
                >
                    {props.error.message}
                </Banner>
            ) : null}
            {resolved ? null : (
                <div className="happy2-rig-input__footer">
                    <Button
                        data-action="submit"
                        disabled={
                            !complete ||
                            props.pending ||
                            props.submitDisabled ||
                            props.onAnswer === undefined
                        }
                        loading={props.pending}
                        onClick={() => props.onAnswer?.(request.requestId, answers)}
                        size="small"
                        title={
                            props.submitDisabledReason ??
                            (props.onAnswer === undefined ? "Answers are unavailable" : undefined)
                        }
                        variant="secondary"
                    >
                        Submit
                    </Button>
                </div>
            )}
        </section>
    );
}
