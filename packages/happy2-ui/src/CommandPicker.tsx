import { type CSSProperties } from "react";
import type { ComposerCommand } from "happy2-state";
import { Icon, type IconName } from "./Icon";

export type CommandPickerItem = {
    id: string;
    /** How the command is typed, e.g. `/model`. */
    slash: string;
    /** What it does, in a few words. */
    description: string;
    icon: IconName;
};

export type CommandPickerProps = {
    items: readonly CommandPickerItem[];
    /** The highlighted row; the owner moves it with the arrow keys. */
    activeId?: string;
    onSelect: (id: string) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * C-152 CommandPicker — the slash-command popover for the composer. It is the
 * same kind of surface as the mention picker beside it, not a ⌘K palette: no
 * search field of its own (the draft is the query), no scrim, and a 28px row per
 * command so a dozen of them read as a short list rather than a page of cards.
 * Props only — the owner filters, highlights, and commits.
 */
export function CommandPicker(props: CommandPickerProps) {
    return (
        <div
            aria-label="Commands"
            className={["happy2-command-picker", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="command-picker"
            data-testid={props["data-testid"]}
            role="listbox"
            style={props.style}
        >
            {/* The card holds the frame; this scrollport owns scrolling with no
                spacing of its own, and the list inside it owns the padding. */}
            <div className="happy2-command-picker__scroll" data-happy2-ui="command-picker-scroll">
                <div className="happy2-command-picker__list" data-happy2-ui="command-picker-list">
                    {props.items.map((item) => (
                        <button
                            aria-selected={item.id === props.activeId ? "true" : "false"}
                            className="happy2-command-picker__row"
                            data-active={item.id === props.activeId ? "" : undefined}
                            data-command-id={item.id}
                            data-happy2-ui="command-picker-row"
                            key={item.id}
                            onClick={() => props.onSelect(item.id)}
                            role="option"
                            type="button"
                        >
                            <span
                                aria-hidden="true"
                                className="happy2-command-picker__icon"
                                data-happy2-ui="command-picker-icon"
                            >
                                <Icon name={item.icon} size={14} />
                            </span>
                            <span
                                className="happy2-command-picker__slash"
                                data-happy2-ui="command-picker-slash"
                            >
                                {item.slash}
                            </span>
                            <span
                                className="happy2-command-picker__description"
                                data-happy2-ui="command-picker-description"
                            >
                                {item.description}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

type CommandMeta = { description: string; icon: IconName };

/**
 * How each Rig session command reads in the picker. A command the host offers
 * but this table does not know still appears, wearing its own label.
 */
const COMMAND_META: Record<string, CommandMeta> = {
    model: { description: "Choose the model and provider", icon: "spark" },
    effort: { description: "Change the reasoning level", icon: "zap" },
    permissions: { description: "Choose filesystem and shell access", icon: "shield" },
    fast: { description: "Toggle fastest inference", icon: "zap" },
    usage: { description: "Token usage for the session", icon: "clock" },
    tasks: { description: "Show the session task list", icon: "tasks" },
    agents: { description: "Monitor delegated subagents", icon: "users" },
    goal: { description: "Show the persistent goal", icon: "star" },
    ps: { description: "List running background terminals", icon: "terminal" },
    new: { description: "Reset and start fresh", icon: "plus" },
    compact: { description: "Summarize older messages to free context", icon: "filter" },
    abort: { description: "Stop the current response", icon: "close" },
    fork: { description: "Start a new session from this one", icon: "branch" },
    rewind: { description: "Truncate back to a message", icon: "reply" },
    clear: { description: "Clear the visible conversation", icon: "trash" },
};

/** Presents the host's offered commands as picker rows, in the order given. */
export function commandPickerItems(
    commands: readonly ComposerCommand[],
): readonly CommandPickerItem[] {
    return commands.map((command) => {
        const meta = COMMAND_META[command.id];
        return {
            id: command.id,
            slash: command.label.startsWith("/") ? command.label : `/${command.id}`,
            description: meta?.description ?? command.description ?? "",
            icon: meta?.icon ?? "spark",
        };
    });
}
