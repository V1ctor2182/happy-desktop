import { useState, type CSSProperties } from "react";
import type {
    RigMenusSnapshot,
    RigModelSelection,
    RigPermissionMode,
    RigServiceTier,
    RigThinkingLevel,
} from "happy2-state";
import { Icon } from "./Icon";
import { Menu, type MenuItem } from "./Menu";

/**
 * Separator between provider and model in a menu option id. A space is safe: it is
 * a valid DOM attribute/CSS-selector character (unlike U+0000, which browsers
 * mangle) and neither provider nor model identifiers contain spaces.
 */
const MODEL_ID_SEP = " ";
const SERVICE_TIER_OFF = "__rig_service_tier_off__";

export type RigControlMenuProps = {
    /** Short field caption (e.g. "Model"). */
    label: string;
    /**
     * Current value shown on the trigger. A control with no value is an action
     * rather than a picker — its label alone names what the menu does — and the
     * trigger renders as one.
     */
    value?: string;
    items: MenuItem[];
    onSelect: (id: string) => void;
    menuWidth?: number;
    /** Direction the popover opens from its trigger. Defaults to below. */
    menuPlacement?: "above" | "below";
    /** Edge of the trigger the popover aligns to. Defaults to its start edge. */
    menuAlign?: "start" | "end";
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

/**
 * RigControlMenu — a labeled trigger that opens a `Menu` popover beneath it. The
 * open flag is the only local state; the popover closes on selection, outside
 * pointer-down, or Escape. Built directly on the shared `Menu` primitive so its
 * geometry, rows, and current-item check marks stay consistent with the system.
 */
export function RigControlMenu(props: RigControlMenuProps) {
    const [open, setOpen] = useState(false);

    return (
        <div
            className={["happy2-rig-control", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-control"
            data-open={open ? "" : undefined}
            data-testid={props["data-testid"]}
            onKeyDown={(event) => {
                if (event.key === "Escape" && open) {
                    event.stopPropagation();
                    setOpen(false);
                }
            }}
            style={props.style}
        >
            <button
                aria-expanded={open ? "true" : "false"}
                aria-haspopup="menu"
                className="happy2-rig-control__trigger"
                data-happy2-ui="rig-control-trigger"
                onClick={() => setOpen((value) => !value)}
                type="button"
            >
                <span className="happy2-rig-control__label" data-happy2-ui="rig-control-label">
                    {props.label}
                </span>
                {props.value === undefined ? null : (
                    <span className="happy2-rig-control__value" data-happy2-ui="rig-control-value">
                        {props.value}
                    </span>
                )}
                <span aria-hidden="true" className="happy2-rig-control__chevron">
                    <Icon name="chevron-down" size={12} />
                </span>
            </button>
            {open ? (
                <>
                    {/* Transparent full-window backdrop closes the popover on an
                        outside pointer-down without an imperative document listener. */}
                    <button
                        aria-hidden="true"
                        className="happy2-rig-control__backdrop"
                        data-happy2-ui="rig-control-backdrop"
                        onClick={() => setOpen(false)}
                        tabIndex={-1}
                        type="button"
                    />
                    <div
                        className="happy2-rig-control__popover"
                        data-happy2-ui="rig-control-popover"
                        data-align={props.menuAlign === "end" ? "end" : undefined}
                        data-placement={props.menuPlacement === "above" ? "above" : undefined}
                    >
                        <Menu
                            items={props.items}
                            onSelect={(id) => {
                                setOpen(false);
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

/** One control in the session bar; `fields` selects which of them render. */
export type RigSessionControlField = "model" | "effort" | "permission" | "tier";

const ALL_FIELDS: readonly RigSessionControlField[] = ["model", "effort", "permission", "tier"];

export type RigSessionControlsProps = {
    menus: RigMenusSnapshot;
    /**
     * Which controls to render, in this order. Defaults to all four. A surface
     * that has already placed the model picker elsewhere (the composer toolbar)
     * asks for only the controls it still owns, instead of rendering a second
     * copy of one it already shows.
     */
    fields?: readonly RigSessionControlField[];
    /** Direction each selected control's menu opens. Defaults to below. */
    menuPlacement?: "above" | "below";
    onModelChange: (selection: RigModelSelection) => void;
    onEffortChange: (effort?: RigThinkingLevel) => void;
    onPermissionModeChange: (mode: RigPermissionMode) => void;
    onServiceTierChange: (tier?: RigServiceTier) => void;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
};

const PERMISSION_LABELS: Record<RigPermissionMode, string> = {
    auto: "Auto",
    workspace_write: "Workspace write",
    read_only: "Read only",
    full_access: "Full access",
};

function currentModelName(menus: RigMenusSnapshot): string {
    const current = menus.modelOptions.find((option) => option.current);
    return current?.name ?? menus.currentModelId;
}

function currentEffortLabel(menus: RigMenusSnapshot): string {
    const current = menus.effortOptions.find((option) => option.current);
    return current?.label ?? menus.currentEffort ?? "Default";
}

/**
 * RigSessionControls — the model / effort / permission / service-tier control bar
 * for a Rig session, driven entirely by a `RigMenusSnapshot`. Each control is a
 * `RigControlMenu` whose current option carries a check mark; selecting an option
 * calls the matching handler. Pure props + handlers, so the app layer supplies one
 * derived snapshot and the store mutation callbacks.
 */
export function RigSessionControls(props: RigSessionControlsProps) {
    const { menus } = props;

    const modelItems: MenuItem[] = menus.modelOptions.map((option) => ({
        kind: "item",
        id: `${option.providerId}${MODEL_ID_SEP}${option.modelId}`,
        label: option.name,
        disabled: option.disabled,
        icon: option.current ? "check" : undefined,
    }));

    const effortItems: MenuItem[] = menus.effortOptions.map((option) => ({
        kind: "item",
        id: option.level,
        label: option.isDefault ? `${option.label} (default)` : option.label,
        icon: option.current ? "check" : undefined,
    }));

    const permissionItems: MenuItem[] = menus.permissionModeOptions.map((option) => ({
        kind: "item",
        id: option.mode,
        label: option.label,
        icon: option.current ? "check" : undefined,
    }));

    const serviceTierItems: MenuItem[] = menus.serviceTierOptions.map((option) => ({
        kind: "item",
        id: option.tier ?? SERVICE_TIER_OFF,
        label: option.label,
        icon: option.current ? "check" : undefined,
    }));

    const currentTierLabel =
        menus.serviceTierOptions.find((option) => option.current)?.label ??
        (menus.currentServiceTier ? "Fast" : "Standard");

    const control = (field: RigSessionControlField) => {
        if (field === "model")
            return (
                <RigControlMenu
                    data-testid="rig-control-model"
                    items={modelItems}
                    key={field}
                    label="Model"
                    menuPlacement={props.menuPlacement}
                    menuWidth={240}
                    onSelect={(id) => {
                        const [providerId, modelId] = id.split(MODEL_ID_SEP);
                        if (modelId) props.onModelChange({ providerId, modelId });
                    }}
                    value={currentModelName(menus)}
                />
            );
        if (field === "effort")
            return (
                <RigControlMenu
                    data-testid="rig-control-effort"
                    items={effortItems}
                    key={field}
                    label="Effort"
                    menuPlacement={props.menuPlacement}
                    onSelect={(id) => props.onEffortChange(id as RigThinkingLevel)}
                    value={currentEffortLabel(menus)}
                />
            );
        if (field === "permission")
            return (
                <RigControlMenu
                    data-testid="rig-control-permission"
                    items={permissionItems}
                    key={field}
                    label="Access"
                    menuPlacement={props.menuPlacement}
                    menuWidth={200}
                    onSelect={(id) => props.onPermissionModeChange(id as RigPermissionMode)}
                    value={PERMISSION_LABELS[menus.currentPermissionMode]}
                />
            );
        return (
            <RigControlMenu
                data-testid="rig-control-tier"
                items={serviceTierItems}
                key={field}
                label="Speed"
                menuPlacement={props.menuPlacement}
                onSelect={(id) =>
                    props.onServiceTierChange(
                        id === SERVICE_TIER_OFF ? undefined : (id as RigServiceTier),
                    )
                }
                value={currentTierLabel}
            />
        );
    };

    return (
        <div
            className={["happy2-rig-controls", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-session-controls"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {(props.fields ?? ALL_FIELDS).map(control)}
        </div>
    );
}
