/*
 * The host-context vocabulary both MCP Apps hosts speak: the resolved theme, the
 * standard `styles.variables` mapped onto Happy's live design tokens, the small
 * namespaced `happy2/styles` extension that carries the Happy-specific roles the
 * standard vocabulary cannot express, and the locale fields. Two surfaces host
 * apps — a durable cloud app inside the double iframe sandbox proxy, and a
 * locally installed Rig plugin's application served on its own isolated origin —
 * and a View must see the same appearance contract from either. Keeping the
 * mapping here means `theme.css` stays the single source of color truth for both.
 *
 * `packages/happy2-plugin-sdk/PLUGIN-DESIGN.md` documents every variable below
 * as the authored contract plugin apps consume; change the two together.
 */

/**
 * The color, font-family, and radius subset of the standard MCP Apps style
 * variables (the names `@modelcontextprotocol/ext-apps` 1.7.4 applies via
 * `useHostStyles`), each mapped to the inherited Happy design token it mirrors.
 * The bridge reads every mapped `--*` custom property as a live computed
 * value on the hosting frame, so `theme.css` stays the single source of color
 * truth and no raw palette value is duplicated here. The remaining standard keys
 * (weights, sizes, line heights, border width, shadows) have no Happy token and
 * are supplied as fixed literals below. A plugin app receives the resolved values
 * as `styles.variables` and consumes them as `var(--color-*, fallback)`.
 */
const HOST_STYLE_VARIABLE_TOKENS: ReadonlyArray<readonly [standard: string, token: string]> = [
    // Backgrounds: primary/secondary/tertiary surfaces, inverse fill, ghost hover,
    // and the semantic soft fills.
    ["--color-background-primary", "--surface"],
    ["--color-background-secondary", "--surface-high"],
    ["--color-background-tertiary", "--surface-pressed"],
    ["--color-background-inverse", "--button-primary-background"],
    ["--color-background-ghost", "--surface-ripple"],
    ["--color-background-danger", "--box-error-background"],
    ["--color-background-warning", "--box-warning-background"],
    ["--color-background-disabled", "--surface-pressed"],
    // Text: primary/secondary, text on inverse fills, and the semantics.
    ["--color-text-primary", "--text"],
    ["--color-text-secondary", "--text-secondary"],
    ["--color-text-inverse", "--button-primary-tint"],
    ["--color-text-ghost", "--text-secondary"],
    ["--color-text-info", "--radio-active"],
    ["--color-text-danger", "--text-destructive"],
    ["--color-text-success", "--success"],
    ["--color-text-warning", "--box-warning-text"],
    // Borders: the hairline, inverse, and the semantics.
    ["--color-border-primary", "--divider"],
    ["--color-border-tertiary", "--divider"],
    ["--color-border-inverse", "--button-primary-background"],
    ["--color-border-info", "--radio-active"],
    ["--color-border-danger", "--text-destructive"],
    ["--color-border-success", "--success"],
    ["--color-border-warning", "--box-warning-border"],
    ["--color-border-disabled", "--divider"],
    // Ring / accent: primary is the system blue used for focus and selection.
    ["--color-ring-primary", "--radio-active"],
    ["--color-ring-secondary", "--text-secondary"],
    ["--color-ring-inverse", "--button-primary-background"],
    ["--color-ring-info", "--radio-active"],
    ["--color-ring-danger", "--text-destructive"],
    ["--color-ring-success", "--success"],
    ["--color-ring-warning", "--box-warning-border"],
    // Typography families.
    ["--font-sans", "--happy2-font-ui"],
    ["--font-mono", "--happy2-font-mono"],
    // Radii: map the standard scale onto Happy's control/window/card/shell/pill radii.
    ["--border-radius-xs", "--happy2-radius-sm"],
    ["--border-radius-sm", "--happy2-radius-sm"],
    ["--border-radius-md", "--happy2-radius-window"],
    ["--border-radius-lg", "--happy2-radius-md"],
    ["--border-radius-xl", "--happy2-radius-shell"],
    ["--border-radius-full", "--happy2-radius-pill"],
];

/** Reads one Happy design token off the hosting frame; "" when it is not set. */
type TokenReader = (token: string) => string;

/**
 * Mixes `share` percent of `color` into `into`, both already resolved to real
 * computed colors. Returns "" when either input is missing so the caller omits
 * the variable rather than emitting an unparsable value.
 */
function blend(color: string, share: number, into: string): string {
    if (!color || !into) return "";
    return `color-mix(in srgb, ${color} ${share}%, ${into})`;
}

/** Composes one shadow layer from a resolved Happy shadow tint. */
function elevation(geometry: string, tint: string): string {
    return tint ? `${geometry} ${tint}` : "";
}

/**
 * The standard variables whose value is composed from more than one Happy token
 * rather than mirroring a single one. The soft semantic fills and the low-contrast
 * end of the text ramp do not exist as Happy roles — Happy paints those states
 * with a `color-mix` at the point of use — so they are mixed here from the same
 * roles at the same ratios. The elevation shadows likewise take their geometry
 * from this file and their tint from the theme's own shadow roles, so no raw
 * color literal is duplicated out of `theme.css`.
 */
const HOST_STYLE_VARIABLE_COMPOSITES: ReadonlyArray<
    readonly [standard: string, compose: (read: TokenReader) => string]
> = [
    // Soft informational and success fills: the semantic hue laid over the
    // surface, matching how `--box-*-background` is built for warning and error.
    ["--color-background-info", (read) => blend(read("--radio-active"), 12, read("--surface"))],
    ["--color-background-success", (read) => blend(read("--success"), 14, read("--surface"))],
    // The one divider stronger than the hairline. Happy has a single `--divider`
    // role, so the emphatic step is the text colour laid over the surface — the
    // only mapping that stays visible in both schemes. Mapping this to
    // `--surface-pressed-overlay`, which is `transparent`, silently erased the
    // border for every app that reached for it.
    ["--color-border-secondary", (read) => blend(read("--text"), 20, read("--surface"))],
    // The quiet end of the text ramp. Happy has two solid text roles, so the
    // third step and the disabled step are the secondary role faded toward the
    // surface it sits on.
    ["--color-text-tertiary", (read) => blend(read("--text-secondary"), 70, read("--surface"))],
    ["--color-text-disabled", (read) => blend(read("--text-secondary"), 45, read("--surface"))],
    // Elevation: Happy's hairline ring is the divider, and each drop shadow uses
    // the theme tint that matches its depth.
    ["--shadow-hairline", (read) => elevation("0 0 0 1px", read("--divider"))],
    ["--shadow-sm", (read) => elevation("0 1px 2px", read("--shadow-color"))],
    ["--shadow-md", (read) => elevation("0 4px 12px", read("--shadow-subtle"))],
    ["--shadow-lg", (read) => elevation("0 12px 32px", read("--shadow-floating"))],
];

/**
 * The remaining standard variables (ext-apps 1.7.4) that have no Happy token
 * equivalent, set to sensible fixed literals so `styles.variables` covers the
 * complete supported key set. These are non-palette values — a transparent ghost
 * border, the type scale weights/sizes/line heights, and the hairline border
 * width — so they do not duplicate a color the theme owns. Actual colors always
 * come from `HOST_STYLE_VARIABLE_TOKENS` or `HOST_STYLE_VARIABLE_COMPOSITES`.
 */
const HOST_STYLE_VARIABLE_LITERALS: ReadonlyArray<readonly [standard: string, value: string]> = [
    ["--color-border-ghost", "transparent"],
    // Font weights.
    ["--font-weight-normal", "400"],
    ["--font-weight-medium", "500"],
    ["--font-weight-semibold", "600"],
    ["--font-weight-bold", "700"],
    // Body text sizes.
    ["--font-text-xs-size", "11px"],
    ["--font-text-sm-size", "12px"],
    ["--font-text-md-size", "14px"],
    ["--font-text-lg-size", "16px"],
    // Heading sizes.
    ["--font-heading-xs-size", "13px"],
    ["--font-heading-sm-size", "15px"],
    ["--font-heading-md-size", "17px"],
    ["--font-heading-lg-size", "20px"],
    ["--font-heading-xl-size", "24px"],
    ["--font-heading-2xl-size", "28px"],
    ["--font-heading-3xl-size", "34px"],
    // Body text line heights.
    ["--font-text-xs-line-height", "16px"],
    ["--font-text-sm-line-height", "18px"],
    ["--font-text-md-line-height", "20px"],
    ["--font-text-lg-line-height", "24px"],
    // Heading line heights.
    ["--font-heading-xs-line-height", "18px"],
    ["--font-heading-sm-line-height", "20px"],
    ["--font-heading-md-line-height", "22px"],
    ["--font-heading-lg-line-height", "26px"],
    ["--font-heading-xl-line-height", "30px"],
    ["--font-heading-2xl-line-height", "34px"],
    ["--font-heading-3xl-line-height", "40px"],
    // Hairline border width.
    ["--border-width-regular", "1px"],
];

/**
 * The host-context key carrying Happy's own appearance extension. The standard
 * `styles.variables` record is a closed set of 76 keys — a View validates the
 * notification against it and rejects the whole update when it carries an
 * unknown key — so Happy-specific roles travel as a separate namespaced member
 * of the host context, which the specification keeps open for exactly this.
 */
export const HAPPY_STYLE_CONTEXT_KEY = "happy2/styles";

/**
 * The bounded Happy-specific appearance roles, named for the plugin document
 * rather than for Happy's internals. Every one is a live theme value the
 * standard vocabulary has no key for: the canvas behind cards, the chrome strip,
 * selection, form fields, the code surface, the scrim, the scrollbar, and the
 * elevation tint. Metrics and the type scale are deliberately absent — they do
 * not change with the theme and belong to the standard keys and the document.
 */
const HAPPY_STYLE_VARIABLE_TOKENS: ReadonlyArray<readonly [name: string, token: string]> = [
    ["--happy-canvas", "--groupped-background"],
    ["--happy-header-background", "--header-background"],
    ["--happy-header-text", "--header-tint"],
    ["--happy-selected-background", "--surface-selected"],
    ["--happy-link", "--text-link"],
    ["--happy-input-background", "--input-background"],
    ["--happy-input-text", "--input-text"],
    ["--happy-input-placeholder", "--input-placeholder"],
    ["--happy-code-background", "--diff-context-bg"],
    ["--happy-scrim", "--overlay-panel"],
    ["--happy-scrollbar-thumb", "--scrollbar-thumb"],
    ["--happy-shadow-color", "--shadow-color"],
];

/**
 * Resolves the theme the iframe actually renders under: an explicit Happy
 * `ThemeScope` override (`.happy2-theme-dark` / `.happy2-theme-light`) around the
 * frame wins; otherwise the system `prefers-color-scheme`. Returns undefined
 * when no reliable value can be derived so the optional theme is omitted rather
 * than reported wrong.
 */
export function resolveTheme(frame: HTMLElement | null): "light" | "dark" | undefined {
    try {
        const scoped = frame?.closest?.(".happy2-theme-dark, .happy2-theme-light") ?? null;
        if (scoped) return scoped.classList.contains("happy2-theme-dark") ? "dark" : "light";
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
        if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    } catch {
        // fall through to undefined
    }
    return undefined;
}

/**
 * Resolves the standard MCP Apps `styles.variables` for the frame by reading each
 * mapped `--*` custom property as an inherited computed value. This keeps
 * `theme.css` the single color source: the bridge forwards whatever the current
 * theme (system or an explicit ThemeScope) computed for the frame. Returns
 * undefined when nothing can be read so the optional field is omitted.
 */
export function resolveStyleVariables(
    frame: HTMLElement | null,
): Record<string, string> | undefined {
    const read = tokenReader(frame);
    if (!read) return undefined;
    const variables: Record<string, string> = {};
    for (const [standard, token] of HOST_STYLE_VARIABLE_TOKENS) {
        const value = read(token);
        if (value) variables[standard] = value;
    }
    for (const [standard, compose] of HOST_STYLE_VARIABLE_COMPOSITES) {
        const value = compose(read);
        if (value) variables[standard] = value;
    }
    for (const [standard, literal] of HOST_STYLE_VARIABLE_LITERALS) variables[standard] = literal;
    return Object.keys(variables).length > 0 ? variables : undefined;
}

/**
 * Resolves the `happy2/styles` extension for the frame: the Happy-specific
 * appearance roles the standard key set cannot carry, read live from the same
 * computed style so they follow the theme exactly like the standard ones.
 * Returns undefined when nothing can be read so the optional member is omitted.
 */
export function resolveHappyStyleVariables(
    frame: HTMLElement | null,
): { variables: Record<string, string> } | undefined {
    const read = tokenReader(frame);
    if (!read) return undefined;
    const variables: Record<string, string> = {};
    for (const [name, token] of HAPPY_STYLE_VARIABLE_TOKENS) {
        const value = read(token);
        if (value) variables[name] = value;
    }
    return Object.keys(variables).length > 0 ? { variables } : undefined;
}

/**
 * A reader over the frame's inherited custom properties, or undefined when the
 * frame is absent or its computed style cannot be taken.
 */
function tokenReader(frame: HTMLElement | null): TokenReader | undefined {
    if (!frame) return undefined;
    try {
        const computed = window.getComputedStyle(frame);
        return (token) => computed.getPropertyValue(token).trim();
    } catch {
        return undefined;
    }
}

/**
 * A stable string identity of the frame's resolved theme + style variables, used
 * only to decide whether an observed host mutation actually changed the
 * appearance the View should see.
 */
export function styleContextSignature(frame: HTMLElement | null): string {
    return JSON.stringify({
        theme: resolveTheme(frame) ?? null,
        styles: resolveStyleVariables(frame) ?? null,
        happyStyles: resolveHappyStyleVariables(frame) ?? null,
    });
}

export function localeContext(): { locale?: string; timeZone?: string } {
    const context: { locale?: string; timeZone?: string } = {};
    try {
        if (navigator.language) context.locale = navigator.language;
    } catch {
        // ignore
    }
    try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timeZone) context.timeZone = timeZone;
    } catch {
        // ignore
    }
    return context;
}
