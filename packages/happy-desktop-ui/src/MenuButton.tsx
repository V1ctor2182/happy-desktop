import { useCallback, useId, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import type { IconName } from "./Icon";
import { Menu, type MenuItem } from "./Menu";

export interface MenuButtonProps {
    readonly label: string;
    readonly icon: IconName;
    readonly items: readonly MenuItem[];
    readonly onSelect: (id: string) => void;
    readonly align?: "start" | "end";
    readonly disabled?: boolean;
    readonly menuWidth?: number;
    readonly size?: ButtonSize;
    readonly variant?: ButtonVariant;
    readonly "data-testid"?: string;
}

/**
 * A compact icon action with a corner-anchored Menu. It owns only whether its
 * popover is open; the caller owns every item and what choosing one means.
 */
export function MenuButton(props: MenuButtonProps) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const expanded = open && !props.disabled;
    const triggerFocus = (): void => {
        root.current?.querySelector<HTMLElement>(":scope > button")?.focus();
    };
    const menuItems = (): HTMLElement[] =>
        root.current
            ? [...root.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')]
            : [];
    // The popover's commit is the exact lifetime boundary at which its first
    // menu item exists, so focus does not depend on React's microtask ordering.
    const popoverRef = useCallback((node: HTMLDivElement | null): void => {
        node?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, []);
    const close = (returnFocus: boolean): void => {
        setOpen(false);
        if (returnFocus) triggerFocus();
    };
    return (
        <div
            className="happy-menu-button"
            data-align={props.align === "end" ? "end" : undefined}
            data-happy-desktop-ui="menu-button"
            data-testid={props["data-testid"]}
            ref={root}
            onKeyDown={(event) => {
                if (!expanded) return;
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    close(true);
                    return;
                }
                if (event.key === "Tab") {
                    close(false);
                    return;
                }
                const items = menuItems();
                if (items.length === 0) return;
                if (event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    items[event.key === "Home" ? 0 : items.length - 1]?.focus();
                    return;
                }
                if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                event.preventDefault();
                const active = document.activeElement as HTMLElement | null;
                const at = active ? items.indexOf(active) : -1;
                const step = event.key === "ArrowDown" ? 1 : -1;
                const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : at + step;
                items[(next + items.length) % items.length]?.focus();
            }}
        >
            <Button
                aria-controls={expanded ? menuId : undefined}
                aria-expanded={expanded}
                aria-haspopup="menu"
                aria-label={props.label}
                disabled={props.disabled}
                icon={props.icon}
                iconOnly
                onClick={() => {
                    if (expanded) close(false);
                    else setOpen(true);
                }}
                size={props.size ?? "small"}
                variant={props.variant ?? "ghost"}
            />
            {expanded ? (
                <>
                    <button
                        aria-label="Close menu"
                        className="happy-menu-button__backdrop"
                        data-happy-desktop-ui="menu-button-backdrop"
                        onClick={() => close(true)}
                        tabIndex={-1}
                        type="button"
                    />
                    <div
                        className="happy-menu-button__popover"
                        data-happy-desktop-ui="menu-button-popover"
                        ref={popoverRef}
                    >
                        <Menu
                            id={menuId}
                            items={[...props.items]}
                            onSelect={(id) => {
                                close(true);
                                props.onSelect(id);
                            }}
                            width={props.menuWidth}
                        />
                    </div>
                </>
            ) : null}
        </div>
    );
}
