/*
 * The host-context vocabulary both MCP Apps hosts speak: the resolved theme, the
 * standard `styles.variables` mapped onto Happy's live design tokens, and the
 * locale fields. Two surfaces host apps — a durable cloud app inside the double
 * iframe sandbox proxy, and a locally installed Rig plugin's application served
 * on its own isolated origin — and a View must see the same appearance contract
 * from either. Keeping the mapping here means `theme.css` stays the single
 * source of color truth for both.
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
    ["--color-background-info", "--surface-high"],
    ["--color-background-danger", "--box-error-background"],
    ["--color-background-success", "--surface-high"],
    ["--color-background-warning", "--box-warning-background"],
    ["--color-background-disabled", "--surface-pressed"],
    // Text: primary/secondary/tertiary, text on inverse fills, and the semantics.
    ["--color-text-primary", "--text"],
    ["--color-text-secondary", "--text-secondary"],
    ["--color-text-tertiary", "--text-secondary"],
    ["--color-text-inverse", "--button-primary-tint"],
    ["--color-text-ghost", "--text-secondary"],
    ["--color-text-info", "--radio-active"],
    ["--color-text-danger", "--text-destructive"],
    ["--color-text-success", "--success"],
    ["--color-text-warning", "--box-warning-text"],
    ["--color-text-disabled", "--text-secondary"],
    // Borders: primary/secondary hairlines, inverse, and the semantics.
    ["--color-border-primary", "--divider"],
    ["--color-border-secondary", "--surface-pressed-overlay"],
    ["--color-border-tertiary", "--divider"],
    ["--color-border-inverse", "--button-primary-background"],
    ["--color-border-info", "--radio-active"],
    ["--color-border-danger", "--text-destructive"],
    ["--color-border-success", "--success"],
    ["--color-border-warning", "--box-warning-border"],
    ["--color-border-disabled", "--divider"],
    // Ring / accent: primary is the system blue used for focus and selection.
    ["--color-ring-primary", "--radio-active"],
    ["--color-ring-secondary", "--surface-pressed-overlay"],
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

/**
 * The remaining standard variables (ext-apps 1.7.4) that have no Happy token
 * equivalent, set to sensible fixed literals so `styles.variables` covers the
 * complete supported key set. These are non-palette values — a transparent ghost
 * border, the type scale weights/sizes/line heights, the hairline border width,
 * and neutral elevation shadows — so they do not duplicate a color the theme
 * owns. Actual colors always come from `HOST_STYLE_VARIABLE_TOKENS`.
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
    // Neutral elevation shadows.
    ["--shadow-hairline", "0 0 0 1px rgb(0 0 0 / 0.06)"],
    ["--shadow-sm", "0 1px 2px rgb(0 0 0 / 0.08)"],
    ["--shadow-md", "0 4px 12px rgb(0 0 0 / 0.12)"],
    ["--shadow-lg", "0 12px 32px rgb(0 0 0 / 0.18)"],
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
    if (!frame) return undefined;
    try {
        const computed = window.getComputedStyle(frame);
        const variables: Record<string, string> = {};
        for (const [standard, token] of HOST_STYLE_VARIABLE_TOKENS) {
            const value = computed.getPropertyValue(token).trim();
            if (value) variables[standard] = value;
        }
        for (const [standard, literal] of HOST_STYLE_VARIABLE_LITERALS)
            variables[standard] = literal;
        return Object.keys(variables).length > 0 ? variables : undefined;
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
