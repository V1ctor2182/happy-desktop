import { type CSSProperties, type ReactNode } from "react";

export interface PluginStoreSectionProps {
    /** The shelf's name, which is the only heading a reader scans for. */
    title: string;
    /** One line under it saying what is on this shelf and why. */
    subtitle?: string;
    /** How many packages the shelf holds, when the count is worth stating. */
    count?: number;
    /** A control belonging to the whole shelf, kept out of the cards. */
    accessory?: ReactNode;
    children: ReactNode;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * PluginStoreSection — one shelf of the catalog.
 *
 * A store is read shelf by shelf, so the catalog's structure is a run of these
 * rather than one undifferentiated list: what is installed, what stopped, what
 * could not be read. The heading carries the name and a count; the cards below
 * it wrap into as many columns as the surface can hold, which is the whole of
 * this component's responsive behaviour.
 *
 * It knows nothing about packages. It takes a title and children, so the same
 * shelf holds cards today and whatever a shelf holds later.
 */
export function PluginStoreSection(props: PluginStoreSectionProps) {
    return (
        <section
            className={["happy2-plugin-store-section", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="plugin-store-section"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <header className="happy2-plugin-store-section__header">
                <h2
                    className="happy2-plugin-store-section__title"
                    data-happy2-ui="plugin-store-section-title"
                >
                    {props.title}
                </h2>
                {props.count === undefined ? null : (
                    <span
                        className="happy2-plugin-store-section__count"
                        data-happy2-ui="plugin-store-section-count"
                    >
                        {props.count}
                    </span>
                )}
                {props.accessory ? (
                    <div className="happy2-plugin-store-section__accessory">{props.accessory}</div>
                ) : null}
            </header>
            {props.subtitle === undefined ? null : (
                <p
                    className="happy2-plugin-store-section__subtitle"
                    data-happy2-ui="plugin-store-section-subtitle"
                >
                    {props.subtitle}
                </p>
            )}
            <div className="happy2-plugin-store-section__items">{props.children}</div>
        </section>
    );
}
