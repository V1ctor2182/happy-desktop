import { useId, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Ionicon } from "./vectorIcons/VectorIcon";
import { renderMessageMarkdown } from "./MessageMarkdown";

export type SlotEntriesPlacement = "status-line" | "above-composer" | "title" | "sidebar";

/**
 * What pressing a contribution's button is going to do. The component never
 * performs the act — it only says which of the four kinds it is, so a reader can
 * tell a message being sent from a webapp being opened before pressing it.
 */
export type SlotActionIntent = "send" | "open" | "draft" | "new-chat";

export interface SlotVisualEntry {
    readonly id: string;
    /** The agent that wrote this contribution. Absent when it cannot be named. */
    readonly author?: string;
    readonly description: string;
    readonly purpose: string;
    readonly disabled?: boolean;
    /** Why the action cannot run here, shown wherever the disabled state is explained. */
    readonly disabledReason?: string;
    readonly content:
        | { readonly type: "text"; readonly markdown: string }
        | {
              readonly type: "button";
              readonly label: string;
              readonly intent?: SlotActionIntent;
          };
}

export interface SlotEntriesProps {
    readonly className?: string;
    readonly entries: readonly SlotVisualEntry[];
    readonly onAction?: (entryId: string) => void;
    readonly placement: SlotEntriesPlacement;
    readonly style?: CSSProperties;
}

/**
 * The four action kinds wear four glyphs, so the row says what the button does
 * before its author-written label is even read: a paper plane sends, a globe
 * opens a webapp the way the web preview does, a pencil writes a draft someone
 * still has to send, and a bubble starts a conversation that does not exist yet.
 */
const INTENT_GLYPH: Record<SlotActionIntent, IconName> = {
    send: "send",
    open: "globe",
    draft: "edit",
    "new-chat": "chat",
};

const INTENT_SUMMARY: Record<SlotActionIntent, string> = {
    send: "Sends a message to a chat",
    open: "Opens a webapp in this window",
    draft: "Writes a draft into a chat, unsent",
    "new-chat": "Starts a new chat",
};

/** The roomy placements expand details in place; the compact ones float them. */
function floats(placement: SlotEntriesPlacement): boolean {
    return placement === "status-line" || placement === "title";
}

/** One contribution at a time, with an explicit switch, where the chrome is narrow. */
function switches(placement: SlotEntriesPlacement): boolean {
    return placement === "status-line" || placement === "title";
}

/**
 * WebKit leaves focus on the document when a button is pressed with a pointer.
 * A control that is worked through — opened, then dismissed with Escape; stepped
 * once, then stepped again from the keyboard — has to hold the focus the press
 * already implied, in every engine.
 */
function keepFocus(event: MouseEvent<HTMLButtonElement>): void {
    event.currentTarget.focus();
}

function authorName(entry: SlotVisualEntry): string {
    const author = entry.author?.trim();
    return author && author.length > 0 ? author : "Unknown agent";
}

/** What this contribution is, in one line, for a label or a spoken announcement. */
function entrySummary(entry: SlotVisualEntry): string {
    const description = entry.description.trim();
    if (description.length > 0) return description;
    return entry.content.type === "button" ? entry.content.label : entry.content.markdown;
}

/**
 * Author, what it is, and why it exists — the three things every contribution
 * records — plus what its button would do and why it cannot run here.
 *
 * This is the one details surface; a placement only decides whether it floats
 * over the chrome or opens inside the list it belongs to.
 */
function SlotDetails(props: { readonly entry: SlotVisualEntry; readonly labelledBy: string }) {
    const { entry } = props;
    const intent = entry.content.type === "button" ? entry.content.intent : undefined;
    return (
        <div
            aria-labelledby={props.labelledBy}
            className="happy2-slot-details"
            data-happy2-ui="slot-entry-details"
            role="group"
        >
            <span className="happy2-slot-details__author" id={props.labelledBy}>
                <span className="happy2-slot-details__author-glyph" aria-hidden="true">
                    <Icon name="agents" size={14} />
                </span>
                <span className="happy2-slot-details__author-name">{authorName(entry)}</span>
            </span>
            <dl className="happy2-slot-details__facts">
                <div className="happy2-slot-details__fact">
                    <dt>What</dt>
                    <dd>{entry.description.trim() || "Not described."}</dd>
                </div>
                <div className="happy2-slot-details__fact">
                    <dt>Why</dt>
                    <dd>{entry.purpose.trim() || "No purpose recorded."}</dd>
                </div>
                {intent ? (
                    <div className="happy2-slot-details__fact">
                        <dt>Action</dt>
                        <dd>{INTENT_SUMMARY[intent]}</dd>
                    </div>
                ) : null}
                {entry.disabled ? (
                    <div className="happy2-slot-details__fact">
                        <dt>Unavailable</dt>
                        <dd>{entry.disabledReason ?? "This action cannot run here."}</dd>
                    </div>
                ) : null}
            </dl>
        </div>
    );
}

function SlotItem(props: {
    readonly entry: SlotVisualEntry;
    readonly onAction?: (entryId: string) => void;
    readonly placement: SlotEntriesPlacement;
}) {
    const { entry, placement } = props;
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const detailsId = useId();
    const floating = floats(placement);
    const intent = entry.content.type === "button" ? entry.content.intent : undefined;
    const close = () => {
        setOpen(false);
        trigger.current?.focus();
    };
    const details = <SlotDetails entry={entry} labelledBy={`${detailsId}-author`} />;
    return (
        <div
            className="happy2-slot-item"
            data-happy2-ui="slot-entry"
            data-open={open ? "" : undefined}
            onKeyDown={(event) => {
                if (event.key !== "Escape" || !open) return;
                event.stopPropagation();
                close();
            }}
        >
            <div
                className="happy2-slot-row"
                data-content={entry.content.type}
                data-happy2-ui="slot-entry-row"
            >
                <span className="happy2-slot-row__glyph" aria-hidden="true">
                    <Icon name={intent ? INTENT_GLYPH[intent] : "spark"} size={14} />
                </span>
                {entry.content.type === "text" ? (
                    <div
                        className="happy2-slot-row__text"
                        data-happy2-ui="slot-entry-text"
                        // Where the line is cut, the whole of it is still one
                        // hover away; where it is shown in full, a tooltip would
                        // only repeat what is already on screen.
                        title={placement === "above-composer" ? undefined : entry.content.markdown}
                    >
                        {renderMessageMarkdown(entry.content.markdown)}
                    </div>
                ) : placement === "sidebar" ? (
                    /* In the sidebar the contribution is a menu row, so the row
                       itself is what is pressed rather than a button parked
                       inside one. */
                    <button
                        className="happy2-slot-row__row-action"
                        data-happy2-ui="slot-entry-action"
                        disabled={entry.disabled}
                        onClick={() => props.onAction?.(entry.id)}
                        title={actionTitle(entry)}
                        type="button"
                    >
                        {entry.content.label}
                    </button>
                ) : (
                    <div className="happy2-slot-row__control" data-happy2-ui="slot-entry-action">
                        <Button
                            disabled={entry.disabled}
                            onClick={() => props.onAction?.(entry.id)}
                            size="small"
                            title={actionTitle(entry)}
                            variant="secondary"
                        >
                            {entry.content.label}
                        </Button>
                    </div>
                )}
                <button
                    aria-controls={open ? detailsId : undefined}
                    aria-expanded={open}
                    aria-label={`Details of the contribution by ${authorName(entry)}`}
                    className="happy2-slot-row__inspect"
                    data-happy2-ui="slot-entry-inspect"
                    onClick={(event) => {
                        keepFocus(event);
                        if (open) close();
                        else setOpen(true);
                    }}
                    ref={trigger}
                    type="button"
                >
                    <Icon name="eye" size={14} />
                </button>
            </div>
            {open ? (
                floating ? (
                    <>
                        {/* Transparent full-window backdrop closes the card on an
                            outside press without an imperative document listener.
                            It closes through the same path as Escape, so the press
                            that dismisses the card cannot strand focus on a button
                            that is about to be unmounted. */}
                        <button
                            aria-hidden="true"
                            className="happy2-slot-backdrop"
                            onClick={close}
                            tabIndex={-1}
                            type="button"
                        />
                        <div
                            className="happy2-slot-popover"
                            data-happy2-ui="slot-entry-popover"
                            id={detailsId}
                        >
                            {details}
                        </div>
                    </>
                ) : (
                    <div className="happy2-slot-inline" id={detailsId}>
                        {details}
                    </div>
                )
            ) : null}
        </div>
    );
}

/** The hover title of an action: what it does, or why it currently cannot. */
function actionTitle(entry: SlotVisualEntry): string | undefined {
    if (entry.disabled) return entry.disabledReason ?? "This action cannot run here.";
    const intent = entry.content.type === "button" ? entry.content.intent : undefined;
    return intent ? INTENT_SUMMARY[intent] : undefined;
}

/**
 * Agent-authored contributions for one product slot.
 *
 * Each placement is designed for the chrome it sits in rather than sharing one
 * pill: the status line and the title carry a single quiet line with an explicit
 * switch, the composer strip is a bounded card of full rows, and the sidebar is a
 * menu of rows in the list's own rhythm. Authorship and intent are always one
 * press away — a floating card where the chrome is narrow, an inline panel where
 * the list has room — and never dumped permanently into compact chrome.
 */
export function SlotEntries(props: SlotEntriesProps) {
    // Which contribution the reader last moved to, remembered by identity rather
    // than by index: entries arrive and are withdrawn live, and a position alone
    // would silently swap what is on screen underneath the reader.
    const [pinned, setPinned] = useState<{ id: string; index: number } | undefined>(undefined);
    const headingId = useId();
    if (props.entries.length === 0) return null;
    const count = props.entries.length;
    const switching = switches(props.placement);
    const index = pinnedIndex(props.entries, pinned);
    const anchor = props.entries[index]!;
    // Whatever is on screen becomes the held place immediately — from the first
    // render, and again the moment the held contribution is withdrawn. A position
    // that were only adopted on a press would let the next arrival slide a
    // different contribution under a reader who never asked for one.
    if (switching && pinned?.id !== anchor.id) setPinned({ id: anchor.id, index });
    const visible = switching ? [anchor] : props.entries;
    const move = (delta: number) => {
        const next = (index + delta + count) % count;
        setPinned({ id: props.entries[next]!.id, index: next });
    };
    return (
        <div
            aria-label={props.placement === "sidebar" ? undefined : "Agent contributions"}
            aria-labelledby={props.placement === "sidebar" ? headingId : undefined}
            className={["happy2-slot-entries", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="slot-entries"
            data-placement={props.placement}
            role="group"
            style={props.style}
        >
            {props.placement === "sidebar" ? (
                <div className="happy2-slot-entries__heading" id={headingId}>
                    Contributions
                </div>
            ) : null}
            <div className="happy2-slot-entries__list" data-happy2-ui="slot-entries-list">
                {visible.map((entry) => (
                    <SlotItem
                        entry={entry}
                        key={entry.id}
                        onAction={props.onAction}
                        placement={props.placement}
                    />
                ))}
            </div>
            {switching && count > 1 ? (
                <>
                    <div className="happy2-slot-switch" data-happy2-ui="slot-entries-switch">
                        <button
                            aria-label={`Previous contribution, ${index + 1} of ${count}`}
                            className="happy2-slot-switch__step"
                            onClick={(event) => {
                                keepFocus(event);
                                move(-1);
                            }}
                            type="button"
                        >
                            <Ionicon name="chevron-back-outline" size={12} />
                        </button>
                        <span aria-hidden="true" className="happy2-slot-switch__count">
                            {index + 1}/{count}
                        </span>
                        <button
                            aria-label={`Next contribution, ${index + 1} of ${count}`}
                            className="happy2-slot-switch__step"
                            onClick={(event) => {
                                keepFocus(event);
                                move(1);
                            }}
                            type="button"
                        >
                            <Ionicon name="chevron-forward-outline" size={12} />
                        </button>
                    </div>
                    {/* Out of flow and never drawn: the switch says where the
                        reader now is, and what they landed on. */}
                    <span aria-live="polite" className="happy2-slot-entries__live" role="status">
                        {`Contribution ${index + 1} of ${count}: ${entrySummary(
                            props.entries[index]!,
                        )}`}
                    </span>
                </>
            ) : null}
        </div>
    );
}

/**
 * The position currently on screen. The pinned contribution is followed by
 * identity while it exists; once it is withdrawn the reader keeps the place it
 * occupied rather than being thrown back to the first one.
 */
function pinnedIndex(
    entries: readonly SlotVisualEntry[],
    pinned: { id: string; index: number } | undefined,
): number {
    if (!pinned) return 0;
    const found = entries.findIndex((entry) => entry.id === pinned.id);
    return found >= 0 ? found : Math.min(pinned.index, entries.length - 1);
}
