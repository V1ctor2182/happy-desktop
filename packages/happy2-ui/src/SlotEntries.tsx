import { useState, type CSSProperties } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { renderMessageMarkdown } from "./MessageMarkdown";

export type SlotEntriesPlacement = "status-line" | "above-composer" | "title" | "sidebar";

export interface SlotVisualEntry {
    readonly id: string;
    readonly author: string;
    readonly description: string;
    readonly purpose: string;
    readonly disabled?: boolean;
    readonly content:
        | { readonly type: "text"; readonly markdown: string }
        | { readonly type: "button"; readonly label: string };
}

export interface SlotEntriesProps {
    readonly className?: string;
    readonly entries: readonly SlotVisualEntry[];
    readonly onAction?: (entryId: string) => void;
    readonly placement: SlotEntriesPlacement;
    readonly style?: CSSProperties;
}

function SlotInspection(props: { readonly entry: SlotVisualEntry }) {
    return (
        <details className="happy2-slot-entry__inspection">
            <summary
                aria-label={`Inspect contribution by ${props.entry.author}`}
                title={`${props.entry.author}\n${props.entry.description}\n${props.entry.purpose}`}
            >
                <Icon name="eye" size={14} />
            </summary>
            <div className="happy2-slot-entry__details">
                <strong>{props.entry.author}</strong>
                <span>{props.entry.description}</span>
                <span>{props.entry.purpose}</span>
            </div>
        </details>
    );
}

function SlotEntry(props: {
    readonly entry: SlotVisualEntry;
    readonly onAction?: (entryId: string) => void;
}) {
    return (
        <div className="happy2-slot-entry" data-happy2-ui="slot-entry">
            <span className="happy2-slot-entry__spark" aria-hidden="true">
                <Icon name="spark" size={14} />
            </span>
            <div className="happy2-slot-entry__content">
                {props.entry.content.type === "text" ? (
                    <div className="happy2-slot-entry__markdown">
                        {renderMessageMarkdown(props.entry.content.markdown)}
                    </div>
                ) : (
                    <Button
                        disabled={props.entry.disabled}
                        icon="play"
                        onClick={() => props.onAction?.(props.entry.id)}
                        size="small"
                        variant="secondary"
                    >
                        {props.entry.content.label}
                    </Button>
                )}
            </div>
            <SlotInspection entry={props.entry} />
        </div>
    );
}

/**
 * Agent-authored contributions for one product slot.
 *
 * The narrow status/title placements show one contribution at a time and let
 * the reader cycle explicitly; the roomier composer/sidebar placements show
 * every contribution in durable order. Details stay attached to each item so
 * authorship and intent are always inspectable without taking over the surface.
 */
export function SlotEntries(props: SlotEntriesProps) {
    const [cursor, setCursor] = useState(0);
    if (props.entries.length === 0) return null;
    const switches = props.placement === "status-line" || props.placement === "title";
    const index = cursor % props.entries.length;
    const visible = switches ? [props.entries[index]!] : props.entries;
    return (
        <div
            className={["happy2-slot-entries", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="slot-entries"
            data-placement={props.placement}
            style={props.style}
        >
            <div className="happy2-slot-entries__items">
                {visible.map((entry) => (
                    <SlotEntry entry={entry} key={entry.id} onAction={props.onAction} />
                ))}
            </div>
            {switches && props.entries.length > 1 ? (
                <div className="happy2-slot-entries__switcher">
                    <span aria-live="polite">
                        {index + 1}/{props.entries.length}
                    </span>
                    <Button
                        aria-label="Show next contribution"
                        icon="chevron-right"
                        iconOnly
                        onClick={() => setCursor((value) => value + 1)}
                        size="small"
                        variant="ghost"
                    />
                </div>
            ) : null}
        </div>
    );
}
