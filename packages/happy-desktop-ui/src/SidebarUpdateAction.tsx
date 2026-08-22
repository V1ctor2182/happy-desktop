import { Button } from "./Button";
import { Icon } from "./Icon";

export interface SidebarUpdateActionProps {
    /** Operation the host needs for this update source once it is ready. */
    action: "refresh" | "restart" | "install";
    /** Detail shown while the update is arriving, such as download progress. */
    detail?: string;
    /**
     * What is being updated, when it is not Happy itself. A row that names
     * nothing is about the application, which is the case the sidebar has always
     * had; anything else has to say what it is or the version means nothing.
     */
    label?: string;
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
    // The subject comes first wherever there is one, because "Install · v0.4.2"
    // in a corner of the window does not say what is being installed.
    const subject = props.label ? `${props.label} ${version}` : version;
    const actionLabel =
        props.action === "refresh" ? "Refresh" : props.action === "install" ? "Install" : "Restart";
    if (props.status === "downloaded" && props.onAction)
        return (
            <Button
                aria-label={`${actionLabel} ${subject}`}
                className="happy-sidebar-update-action happy-sidebar-update-action--ready"
                icon="arrow-up"
                onClick={props.onAction}
                size="small"
                title={`${subject} is ready`}
                variant="secondary"
            >
                {actionLabel} · {subject}
            </Button>
        );

    const label =
        props.status === "available"
            ? `${subject} available`
            : props.status === "downloading"
              ? [subject, props.detail ?? "Downloading"].join(" · ")
              : `${subject} ready`;
    return (
        <span
            aria-live="polite"
            className="happy-sidebar-update-action happy-sidebar-update-action--status"
            data-happy-desktop-ui="sidebar-update-action"
            data-status={props.status}
            role="status"
            title={label}
        >
            <span className="happy-sidebar-update-action__icon" aria-hidden="true">
                <Icon name="arrow-up" size={14} />
            </span>
            <span className="happy-sidebar-update-action__label">{label}</span>
        </span>
    );
}
