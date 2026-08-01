import { useState, type CSSProperties } from "react";

export interface TypedTextProps {
    readonly value: string;
    readonly "data-happy2-ui"?: string;
    readonly "data-testid"?: string;
}

/**
 * TypedText — a live label that retypes itself whenever its text changes: the
 * replacement is written out character by character in monospace, the way the
 * line it describes would have been typed by the terminal it came from.
 *
 * The text a label arrives with is never typed. Only text that replaced earlier
 * text animates, so opening or reloading a surface does not set every settled
 * label typing at once. The `key` remounts the span for each new value, which
 * restarts the animation, and the last rendered value is compared during render
 * so a label returning to an earlier word still types.
 */
export function TypedText(props: TypedTextProps) {
    const [shown, setShown] = useState({ value: props.value, typed: false });
    if (shown.value !== props.value) setShown({ value: props.value, typed: true });
    return (
        <span
            key={props.value}
            className="happy2-typed-text"
            data-happy2-ui={props["data-happy2-ui"]}
            data-testid={props["data-testid"]}
            data-typing={shown.typed ? "" : undefined}
            style={
                {
                    // A label is never typed out in less than one step.
                    "--happy2-typed-chars": Math.max(1, props.value.length),
                } as CSSProperties
            }
        >
            {props.value}
        </span>
    );
}
