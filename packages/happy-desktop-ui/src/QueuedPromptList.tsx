import { type CSSProperties } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { MenuButton } from "./MenuButton";
import type { MenuItem } from "./Menu";

/** One prompt the reader sent while the agent was busy, not yet taken up. */
export interface QueuedPrompt {
    readonly id: string;
    /** The prompt's text, shown on one line. */
    readonly text: string;
    /**
     * `queue` waits for the current run to finish; `steer` is handed over at
     * the run's next inference boundary. A steering prompt has already been
     * promoted, so its row says so instead of offering to.
     */
    readonly delivery: "queue" | "steer";
}

export type QueuedPromptListProps = {
    className?: string;
    "data-testid"?: string;
    /** Keeps the rows readable while making every action inert. */
    disabled?: boolean;
    items: readonly QueuedPrompt[];
    /** Withdraws the prompt and puts its text back into the composer. */
    onEdit?: (promptId: string) => void;
    /** Withdraws the prompt for good. */
    onRemove?: (promptId: string) => void;
    /** Promotes a waiting prompt to steering: withdraw it, resend it to the current run. */
    onSteer?: (promptId: string) => void;
    style?: CSSProperties;
};

/**
 * QueuedPromptList — the prompts waiting behind the current run, docked above
 * the composer they were typed into.
 *
 * They live with the composer rather than in the transcript because they are
 * the one thing in a conversation that has not happened yet: read as history
 * they look like something the agent was already told. Down here each is
 * still the reader's to change — steer it into the running turn, take it
 * back, or pull its words into the draft again.
 */
export function QueuedPromptList(props: QueuedPromptListProps) {
    if (props.items.length === 0) return null;
    const menuItems: MenuItem[] = [
        { kind: "item", id: "edit", label: "Edit in composer", icon: "edit" },
        { kind: "item", id: "copy", label: "Copy text", icon: "copy" },
    ];
    const copy = (text: string): void => {
        // The browser owns clipboard permission; a refusal only leaves the
        // text where it already is.
        void navigator.clipboard?.writeText(text).catch(() => undefined);
    };
    return (
        <div
            aria-label="Queued prompts"
            className={["happy-queued-prompts", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="queued-prompt-list"
            data-testid={props["data-testid"]}
            role="list"
            style={props.style}
        >
            {props.items.map((item) => {
                const steering = item.delivery === "steer";
                const preview = promptPreview(item.text);
                return (
                    <div
                        className="happy-queued-prompts__row"
                        data-delivery={item.delivery}
                        data-happy-desktop-ui="queued-prompt"
                        key={item.id}
                        role="listitem"
                    >
                        <span
                            aria-hidden="true"
                            className="happy-queued-prompts__glyph"
                            data-happy-desktop-ui="queued-prompt-glyph"
                        >
                            <Icon name={steering ? "zap" : "clock"} size={14} />
                        </span>
                        <span
                            className="happy-queued-prompts__text"
                            data-happy-desktop-ui="queued-prompt-text"
                            title={item.text}
                        >
                            {preview}
                        </span>
                        <div
                            className="happy-queued-prompts__actions"
                            data-happy-desktop-ui="queued-prompt-actions"
                        >
                            {steering ? (
                                <span
                                    className="happy-queued-prompts__state"
                                    data-happy-desktop-ui="queued-prompt-state"
                                >
                                    Steering
                                </span>
                            ) : props.onSteer ? (
                                <Button
                                    aria-label="Steer the current run with this prompt"
                                    disabled={props.disabled}
                                    icon="arrow-right"
                                    onClick={() => props.onSteer?.(item.id)}
                                    size="small"
                                    variant="ghost"
                                >
                                    Steer
                                </Button>
                            ) : null}
                            {props.onRemove ? (
                                <Button
                                    aria-label="Remove this queued prompt"
                                    disabled={props.disabled}
                                    icon="trash"
                                    iconOnly
                                    onClick={() => props.onRemove?.(item.id)}
                                    size="small"
                                    variant="ghost"
                                />
                            ) : null}
                            <MenuButton
                                align="end"
                                disabled={props.disabled}
                                icon="more"
                                items={props.onEdit ? menuItems : menuItems.slice(1)}
                                label="More actions for this queued prompt"
                                menuWidth={200}
                                onSelect={(id) => {
                                    if (id === "edit") props.onEdit?.(item.id);
                                    if (id === "copy") copy(item.text);
                                }}
                                size="small"
                                variant="ghost"
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** The first line of the prompt, which is all a one-line row can show. */
function promptPreview(text: string): string {
    const firstLine = text.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? "";
    return firstLine.trim();
}
