import { type CSSProperties, type ReactNode } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { PluginStoreIcon } from "./PluginStoreIcon";
import { PLUGIN_STORE_STATE_LABELS, type PluginStoreEntry } from "./PluginStoreCard";

/** One labelled fact about the copy of a package on this machine. */
export interface PluginStoreFact {
    readonly label: string;
    /** Already formatted: this surface holds no clock and no formatter. */
    readonly value: string;
    /** Long, unwrappable values such as a path are set in the code family. */
    readonly monospace?: boolean;
}

export interface PluginStoreDetailProps {
    entry: PluginStoreEntry;
    /**
     * What this package puts into Happy, named as the reader will meet it —
     * the label of each sidebar destination it contributes.
     */
    contributions?: readonly string[];
    /** The ledger of facts about the copy that is here. */
    facts?: readonly PluginStoreFact[];
    /**
     * The controls for this package. The detail page performs nothing itself,
     * so what a package can have done to it arrives from above and lands in one
     * declared place under its name.
     */
    actions?: ReactNode;
    /** The way back to the catalog, present only when there is one to go back to. */
    onBack?: () => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

const STATE_VARIANT = {
    running: "neutral",
    stopped: "neutral",
    failed: "warning",
} as const satisfies Record<PluginStoreEntry["state"], "neutral" | "warning">;

/**
 * PluginStoreDetail — one package read in full.
 *
 * It is the store's product page: the mark at hero size, the name, who made it
 * and what shelf it is on, the state it is in, then the actions, then the
 * paragraph, then what it adds to Happy and the ledger of facts about the copy
 * on this machine.
 *
 * The actions sit directly under the identity because that is the one place a
 * decision about this package is made. Everything below them is reading. The
 * component itself decides nothing and fetches nothing; it renders what it is
 * handed and calls back.
 */
export function PluginStoreDetail(props: PluginStoreDetailProps) {
    const { entry } = props;
    const attribution = [entry.author, entry.category, entry.version].filter(
        (value): value is string => value !== undefined && value.length > 0,
    );
    return (
        <div
            className={["happy2-plugin-store-detail", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="plugin-store-detail"
            data-plugin={entry.id}
            data-testid={props["data-testid"]}
            data-state={entry.state}
            style={props.style}
        >
            {props.onBack ? (
                <Button
                    className="happy2-plugin-store-detail__back"
                    icon="arrow-right"
                    onClick={props.onBack}
                    size="small"
                    variant="ghost"
                >
                    All plugins
                </Button>
            ) : null}

            <div className="happy2-plugin-store-detail__hero">
                <PluginStoreIcon
                    glyph={entry.glyph}
                    size="lg"
                    tone={entry.tone}
                    {...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl })}
                />
                <div className="happy2-plugin-store-detail__identity">
                    <h2
                        className="happy2-plugin-store-detail__name"
                        data-happy2-ui="plugin-store-detail-name"
                    >
                        {entry.name}
                    </h2>
                    {attribution.length > 0 ? (
                        <p
                            className="happy2-plugin-store-detail__attribution"
                            data-happy2-ui="plugin-store-detail-attribution"
                        >
                            {attribution.join(" · ")}
                        </p>
                    ) : null}
                </div>
                <Badge
                    label={PLUGIN_STORE_STATE_LABELS[entry.state]}
                    variant={STATE_VARIANT[entry.state]}
                />
            </div>

            {props.actions ? (
                <div
                    className="happy2-plugin-store-detail__actions"
                    data-happy2-ui="plugin-store-detail-actions"
                >
                    {props.actions}
                </div>
            ) : null}

            {entry.note !== undefined && entry.note.length > 0 ? (
                <p
                    className="happy2-plugin-store-detail__note"
                    data-happy2-ui="plugin-store-detail-note"
                >
                    <Icon name={entry.state === "failed" ? "close" : "dot"} size={14} />
                    <span>{entry.note}</span>
                </p>
            ) : null}

            <p
                className="happy2-plugin-store-detail__description"
                data-happy2-ui="plugin-store-detail-description"
            >
                {entry.description}
            </p>

            {props.contributions?.length ? (
                <DetailSection title="What it adds to Happy">
                    <ul
                        className="happy2-plugin-store-detail__contributions"
                        data-happy2-ui="plugin-store-detail-contributions"
                    >
                        {props.contributions.map((label) => (
                            <li key={label}>
                                <Icon name="plugin" size={14} />
                                <span>{label}</span>
                            </li>
                        ))}
                    </ul>
                </DetailSection>
            ) : null}

            {props.facts?.length ? (
                <DetailSection title="This copy">
                    <dl
                        className="happy2-plugin-store-detail__facts"
                        data-happy2-ui="plugin-store-detail-facts"
                    >
                        {props.facts.map((fact) => (
                            <div className="happy2-plugin-store-detail__fact" key={fact.label}>
                                <dt>{fact.label}</dt>
                                <dd data-monospace={fact.monospace ? "true" : undefined}>
                                    {fact.value}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </DetailSection>
            ) : null}
        </div>
    );
}

function DetailSection(props: { children: ReactNode; title: string }) {
    return (
        <section
            className="happy2-plugin-store-detail__section"
            data-happy2-ui="plugin-store-detail-section"
        >
            <h3 className="happy2-plugin-store-detail__section-title">{props.title}</h3>
            {props.children}
        </section>
    );
}
