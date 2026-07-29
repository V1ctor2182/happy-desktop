import { Button } from "./Button";
import { Icon } from "./Icon";

export interface SidebarUpdateActionProps {
    /** Operation the host needs for this update source once it is ready. */
    action: "refresh" | "restart";
    /** Detail shown while the update is arriving, such as download progress. */
    detail?: string;
    /** Applies the ready update through the operation named by `action`. */
    onAction?: () => void;
    status: "available" | "downloading" | "downloaded";
    /** Human-readable identity of the incoming version or build. */
    version?: string;
}

function versionLabel(version: string | undefined): string {
    if (!version) return "New version";
    return /^\d/u.test(version) ? `v${version}` : version;
}

/**
 * SidebarUpdateAction — a compact update readout for a sidebar footer. Discovery
 * and download states remain passive status text; once ready, the same footprint
 * becomes an explicit refresh or restart action carrying the incoming version
 * identity.
 */
export function SidebarUpdateAction(props: SidebarUpdateActionProps) {
    const version = versionLabel(props.version);
    const actionLabel = props.action === "refresh" ? "Refresh" : "Restart";
    if (props.status === "downloaded" && props.onAction)
        return (
            <Button
                aria-label={`${actionLabel} to update to ${version}`}
                className="happy2-sidebar-update-action happy2-sidebar-update-action--ready"
                icon="arrow-up"
                onClick={props.onAction}
                size="small"
                title={`${version} is ready`}
                variant="secondary"
            >
                {actionLabel} · {version}
            </Button>
        );

    const label =
        props.status === "available"
            ? `${version} available`
            : props.status === "downloading"
              ? [version, props.detail ?? "Downloading"].join(" · ")
              : `${version} ready`;
    return (
        <span
            aria-live="polite"
            className="happy2-sidebar-update-action happy2-sidebar-update-action--status"
            data-happy2-ui="sidebar-update-action"
            data-status={props.status}
            role="status"
            title={label}
        >
            <span className="happy2-sidebar-update-action__icon" aria-hidden="true">
                <Icon name="arrow-up" size={14} />
            </span>
            <span className="happy2-sidebar-update-action__label">{label}</span>
        </span>
    );
}
