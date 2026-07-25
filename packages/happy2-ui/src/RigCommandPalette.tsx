import { type CSSProperties } from "react";
import type { ComposerCommand } from "happy2-state";
import { CommandPalette } from "./CommandPalette";
import { Icon, type IconName } from "./Icon";

export type RigCommandId =
    | "model"
    | "effort"
    | "permissions"
    | "fast"
    | "usage"
    | "tasks"
    | "agents"
    | "goal"
    | "ps"
    | "new"
    | "compact"
    | "abort"
    | "fork"
    | "rewind"
    | "clear";

export type RigCommandPaletteProps = {
    query: string;
    onQueryChange: (value: string) => void;
    onClose: () => void;
    /** Invoked with the chosen command id; the palette then closes. */
    onCommand: (id: string) => void;
    /**
     * Commands to offer, in order — the composer capability list. Only commands
     * wired to a real action appear, so an offered command always does something.
     */
    commands: readonly ComposerCommand[];
    autoFocus?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

type CommandMeta = { label: string; slash: string; description: string; icon: IconName };

const COMMAND_META: Record<RigCommandId, CommandMeta> = {
    model: {
        label: "Model",
        slash: "/model",
        description: "Choose the model and provider.",
        icon: "spark",
    },
    effort: {
        label: "Effort",
        slash: "/effort",
        description: "Change the reasoning level.",
        icon: "zap",
    },
    permissions: {
        label: "Permissions",
        slash: "/permissions",
        description: "Choose filesystem and shell access.",
        icon: "shield",
    },
    fast: { label: "Fast", slash: "/fast", description: "Toggle fastest inference.", icon: "zap" },
    usage: {
        label: "Usage",
        slash: "/usage",
        description: "Token usage for the session.",
        icon: "clock",
    },
    tasks: {
        label: "Tasks",
        slash: "/tasks",
        description: "Show the session task list.",
        icon: "tasks",
    },
    agents: {
        label: "Agents",
        slash: "/agents",
        description: "Monitor delegated subagents.",
        icon: "users",
    },
    goal: {
        label: "Goal",
        slash: "/goal",
        description: "Show the persistent goal.",
        icon: "star",
    },
    ps: {
        label: "Processes",
        slash: "/ps",
        description: "List running background terminals.",
        icon: "terminal",
    },
    new: {
        label: "New session",
        slash: "/new",
        description: "Reset and start fresh.",
        icon: "plus",
    },
    compact: {
        label: "Compact",
        slash: "/compact",
        description: "Summarize older messages to free context.",
        icon: "filter",
    },
    abort: {
        label: "Abort",
        slash: "/abort",
        description: "Stop the current response.",
        icon: "close",
    },
    fork: {
        label: "Fork",
        slash: "/fork",
        description: "Start a new session from this one.",
        icon: "branch",
    },
    rewind: {
        label: "Rewind",
        slash: "/rewind",
        description: "Truncate back to a message.",
        icon: "reply",
    },
    clear: {
        label: "Clear",
        slash: "/clear",
        description: "Clear the visible conversation.",
        icon: "trash",
    },
};

/** Presentation for a known command id, falling back to the supplied labels. */
function metaOf(command: ComposerCommand): CommandMeta {
    const known = COMMAND_META[command.id as RigCommandId] as CommandMeta | undefined;
    return (
        known ?? {
            label: command.label,
            slash: command.label.startsWith("/") ? command.label : `/${command.id}`,
            description: command.description ?? "",
            icon: "spark",
        }
    );
}

function matches(meta: CommandMeta, query: string): boolean {
    const needle = query.trim().replace(/^\//, "").toLowerCase();
    if (!needle) return true;
    return (
        meta.label.toLowerCase().includes(needle) ||
        meta.slash.toLowerCase().includes(needle) ||
        meta.description.toLowerCase().includes(needle)
    );
}

/**
 * RigCommandPalette — a `/` command palette for Rig session actions, built on the
 * shared `CommandPalette`. It lists only the `commands` the owner wires to real
 * store actions (model/effort/permissions/fast/new/compact/abort/fork/rewind/clear)
 * and filters them by the typed query; choosing one calls `onCommand` and closes.
 */
export function RigCommandPalette(props: RigCommandPaletteProps) {
    const visible = props.commands
        .map((command) => ({ id: command.id, meta: metaOf(command) }))
        .filter((command) => matches(command.meta, props.query));
    return (
        <CommandPalette
            autoFocus={props.autoFocus}
            className={["happy2-rig-command-palette", props.className].filter(Boolean).join(" ")}
            data-testid={props["data-testid"]}
            onClose={props.onClose}
            onQueryChange={props.onQueryChange}
            placeholder="Run a command"
            query={props.query}
            style={props.style}
        >
            <div className="happy2-rig-command-palette__list" data-happy2-ui="rig-command-list">
                {visible.length === 0 ? (
                    <p
                        className="happy2-rig-command-palette__empty"
                        data-happy2-ui="rig-command-empty"
                    >
                        No matching commands
                    </p>
                ) : (
                    visible.map(({ id, meta }) => (
                        <button
                            className="happy2-rig-command-palette__item"
                            data-command-id={id}
                            data-happy2-ui="rig-command-item"
                            key={id}
                            onClick={() => {
                                props.onCommand(id);
                                props.onClose();
                            }}
                            type="button"
                        >
                            <span className="happy2-rig-command-palette__icon" aria-hidden="true">
                                <Icon name={meta.icon} size={16} />
                            </span>
                            <span className="happy2-rig-command-palette__item-body">
                                <span className="happy2-rig-command-palette__item-label">
                                    {meta.label}
                                </span>
                                <span className="happy2-rig-command-palette__item-description">
                                    {meta.description}
                                </span>
                            </span>
                            <span className="happy2-rig-command-palette__slash">{meta.slash}</span>
                        </button>
                    ))
                )}
            </div>
        </CommandPalette>
    );
}
