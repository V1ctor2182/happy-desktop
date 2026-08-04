import { partitionComponentProps } from "./componentProps";
import { type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";
export type ToolbarSearch = {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
};
export type ToolbarProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    title?: string;
    subtitle?: string;
    leading?: ReactNode;
    trailing?: ReactNode;
    search?: ToolbarSearch;
    height?: number;
    /**
     * Names the title as a heading at this level. A toolbar over a section is
     * usually a label rather than a heading, which is why the default stays a
     * span; when the toolbar heads a whole screen it is that screen's heading,
     * and the headings below it need something to sit under.
     */
    titleLevel?: 1 | 2 | 3;
};
/**
 * C-026 Toolbar — panel/section header bar. A default 48px strip that sits at
 * the top of a panel (admin tables, settings sections): a title with an
 * optional subtitle on the left, an optional leading slot, and a right-pinned
 * actions cluster holding an optional inset search well and a trailing slot.
 * Composes on Happy's surface without a visual separator.
 */
export function Toolbar(props: ToolbarProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "title",
        "subtitle",
        "leading",
        "trailing",
        "search",
        "height",
        "titleLevel",
    ]);
    const hasHeading = () => local.title !== undefined || local.subtitle !== undefined;
    const hasActions = () => local.search !== undefined || local.trailing !== undefined;
    return (
        <header
            className={["happy2-toolbar", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="toolbar"
            data-testid={local["data-testid"]}
            style={{
                ...local.style,
                ...(local.height === undefined
                    ? {}
                    : { "--happy2-toolbar-height": `${local.height}px` }),
            }}
        >
            {local.leading ? (
                <div className="happy2-toolbar__leading" data-happy-desktop-ui="toolbar-leading">
                    {local.leading}
                </div>
            ) : null}
            {hasHeading() ? (
                <div className="happy2-toolbar__heading" data-happy-desktop-ui="toolbar-heading">
                    {local.title !== undefined
                        ? ((
                              Title = local.titleLevel === undefined
                                  ? ("span" as const)
                                  : (`h${String(local.titleLevel)}` as "h1" | "h2" | "h3"),
                          ) => (
                              <Title
                                  className="happy2-toolbar__title"
                                  data-happy-desktop-ui="toolbar-title"
                              >
                                  <span className="happy2-toolbar__title-ink">{local.title}</span>
                              </Title>
                          ))()
                        : null}
                    {local.subtitle !== undefined ? (
                        <span
                            className="happy2-toolbar__subtitle"
                            data-happy-desktop-ui="toolbar-subtitle"
                        >
                            <span className="happy2-toolbar__subtitle-ink">{local.subtitle}</span>
                        </span>
                    ) : null}
                </div>
            ) : null}
            {hasActions() ? (
                <div className="happy2-toolbar__actions" data-happy-desktop-ui="toolbar-actions">
                    {local.search
                        ? ((search) => (
                              <div
                                  className="happy2-toolbar__search"
                                  data-happy-desktop-ui="toolbar-search"
                              >
                                  <span
                                      aria-hidden="true"
                                      className="happy2-toolbar__search-icon"
                                      data-happy-desktop-ui="toolbar-search-icon"
                                  >
                                      <Icon name="search" size={14} />
                                  </span>
                                  <input
                                      aria-label={search.placeholder ?? "Search"}
                                      className="happy2-toolbar__search-input"
                                      data-happy-desktop-ui="toolbar-search-input"
                                      onInput={(event) =>
                                          search.onChange(event.currentTarget.value)
                                      }
                                      placeholder={search.placeholder ?? "Search"}
                                      type="text"
                                      value={search.value}
                                  />
                              </div>
                          ))(local.search)
                        : null}
                    {local.trailing ? (
                        <div
                            className="happy2-toolbar__trailing"
                            data-happy-desktop-ui="toolbar-trailing"
                        >
                            {local.trailing}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </header>
    );
}
