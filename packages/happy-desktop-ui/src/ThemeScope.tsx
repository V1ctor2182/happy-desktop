import { type ReactNode } from "react";

export type ThemeMode = "dark" | "light" | "system";
export type ScrollbarVisibility = "always" | "automatic";

export type ThemeScopeProps = {
    children: ReactNode;
    mode: ThemeMode;
    scrollbarVisibility?: ScrollbarVisibility;
};

/**
 * Applies one user-selected appearance to a stable product subtree while
 * retaining the system palette when no explicit override is selected.
 */
export function ThemeScope(props: ThemeScopeProps) {
    return (
        <div
            className={
                props.mode === "system"
                    ? "happy-theme-scope"
                    : `happy-theme-scope happy-theme-${props.mode}`
            }
            data-happy-desktop-ui="theme-scope"
            data-scrollbar-visibility={props.scrollbarVisibility ?? "automatic"}
        >
            {props.children}
        </div>
    );
}
