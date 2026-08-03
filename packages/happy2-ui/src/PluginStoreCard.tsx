import { type CSSProperties, type ReactNode } from "react";
import { type ToneName } from "./Avatar";
import { Badge } from "./Badge";
import { Icon, type IconName } from "./Icon";
import { PluginStoreIcon } from "./PluginStoreIcon";

/**
 * What a package on this machine is doing. These are the three answers a machine
 * can give about a package it has: its code is up, it is deliberately off, or it
 * tried to start and could not.
 */
export type PluginStoreState = "running" | "stopped" | "failed";

/** The word each state is shown as. Short enough to sit inside a card's heading. */
export const PLUGIN_STORE_STATE_LABELS: Record<PluginStoreState, string> = {
    running: "Running",
    stopped: "Off",
    failed: "Failed",
};

/**
 * Everything a card and a detail page draw about one package, without any of
 * where it came from. Every string arrives ready to render, so this surface
 * holds no clock, no formatter, and no opinion about what a version looks like.
 */
export interface PluginStoreEntry {
    /** The machine's identity for the package, used as the React key. */
    readonly id: string;
    readonly name: string;
    /** One short paragraph: what the package is for. */
    readonly description: string;
    readonly state: PluginStoreState;
    /** The glyph the mark carries when there is no artwork for the package. */
    readonly glyph: IconName;
    /** The mark's colour. Derive it from the identity with `pluginStoreTone`. */
    readonly tone: ToneName;
    /** The package's own artwork, when the catalog has an address for it. */
    readonly artworkUrl?: string;
    /** Who publishes it, exactly as they are known. */
    readonly author?: string;
    /** The one shelf it belongs on, in the product's own words. */
    readonly category?: string;
    readonly version?: string;
    /**
     * One line about the state it is in — why it stopped, or what it says about
     * itself. Shown only when the package offered one.
     */
    readonly note?: string;
}

export interface PluginStoreCardProps {
    entry: PluginStoreEntry;
    /**
     * Opens the package. A card with no way to open it is a still card rather
     * than a disabled one: nothing about it suggests a press that does nothing.
     */
    onOpen?: () => void;
    /** Marks the package this surface is already showing in full. */
    selected?: boolean;
    /**
     * The trailing control lane. It is where installing, updating, and removing
     * belong; the card itself performs none of them and only gives them a place
     * that keeps its own layout.
     */
    action?: ReactNode;
    /**
     * Takes the focus as the card mounts. It exists so a surface can return the
     * focus to the card a reader just came back from; it is declared rather than
     * done through a handle, so the card exposes no element of its own.
     */
    autoFocus?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** The badge tone each state wears. Only a failure earns a colour. */
const STATE_VARIANT = {
    running: "neutral",
    stopped: "neutral",
    failed: "warning",
} as const satisfies Record<PluginStoreState, "neutral" | "warning">;

/**
 * PluginStoreCard — one plugin package, offered rather than listed.
 *
 * The card is the whole unit of the catalog: a mark big enough to recognize,
 * the name in the bright weight, one line of what it is for, and the small
 * metadata that says who made it, what shelf it is on, and which version is
 * here. That is the order a person reads a thing they might want, and it is why
 * this is a card rather than a row — a row sorts, a card is chosen.
 *
 * Colour appears only in the mark, which carries identity, and in the state
 * badge when the state is a failure. A running package and a package that is
 * off are both ordinary, so neither is green and neither is red.
 *
 * The card performs nothing. Opening it is the one thing it does, and `action`
 * is an empty lane the surface above fills with whatever a package can have done
 * to it, so installing and removing can arrive without the card changing shape.
 */
export function PluginStoreCard(props: PluginStoreCardProps) {
    const { entry } = props;
    const meta = [entry.author, entry.category, entry.version].filter(
        (value): value is string => value !== undefined && value.length > 0,
    );
    return (
        <article
            aria-current={props.selected ? "true" : undefined}
            className={["happy2-plugin-store-card", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="plugin-store-card"
            data-plugin={entry.id}
            data-selected={props.selected ? "true" : undefined}
            data-state={entry.state}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <PluginStoreIcon
                glyph={entry.glyph}
                size="md"
                tone={entry.tone}
                {...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl })}
            />
            <div className="happy2-plugin-store-card__body">
                <div className="happy2-plugin-store-card__heading">
                    <h3
                        className="happy2-plugin-store-card__name"
                        data-happy2-ui="plugin-store-card-name"
                    >
                        {props.onOpen ? (
                            <button
                                className="happy2-plugin-store-card__open"
                                data-happy2-ui="plugin-store-card-open"
                                autoFocus={props.autoFocus}
                                onClick={props.onOpen}
                                type="button"
                            >
                                {entry.name}
                            </button>
                        ) : (
                            entry.name
                        )}
                    </h3>
                    <Badge
                        label={PLUGIN_STORE_STATE_LABELS[entry.state]}
                        variant={STATE_VARIANT[entry.state]}
                    />
                </div>
                <p
                    className="happy2-plugin-store-card__description"
                    data-happy2-ui="plugin-store-card-description"
                >
                    {entry.description}
                </p>
                {meta.length > 0 ? (
                    <p
                        className="happy2-plugin-store-card__meta"
                        data-happy2-ui="plugin-store-card-meta"
                    >
                        {meta.join(" · ")}
                    </p>
                ) : null}
                {entry.note !== undefined && entry.note.length > 0 ? (
                    <p
                        className="happy2-plugin-store-card__note"
                        data-happy2-ui="plugin-store-card-note"
                    >
                        <Icon name={entry.state === "failed" ? "shield" : "dot"} size={12} />
                        <span>{entry.note}</span>
                    </p>
                ) : null}
                {props.action ? (
                    <div
                        className="happy2-plugin-store-card__actions"
                        data-happy2-ui="plugin-store-card-actions"
                    >
                        {props.action}
                    </div>
                ) : null}
            </div>
        </article>
    );
}
