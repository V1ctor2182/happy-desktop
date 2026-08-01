import type { CSSProperties, ReactNode } from "react";
import { EmptyState } from "../../EmptyState";
import { Toolbar } from "../../Toolbar";

/** What the host has managed to do with this application's own code so far. */
export type RigPluginApplicationPageStatus = "loading" | "ready" | "error" | "missing";

export interface RigPluginApplicationContentProps {
    /** Navigation identity of the application being mounted. */
    readonly applicationId: string;
    /** Exact code behind it; a change is a replacement, never an update. */
    readonly generation: string;
    /** Address of the isolated origin the host already filled with this bundle. */
    readonly source: string;
    /** The application's own name, for assistive technology on its frame. */
    readonly title: string;
}

/**
 * Native plugin-view adapter supplied by the host. Isolating a plugin's code is
 * something only the desktop shell can do, so the reusable page renders whatever
 * the host hands back and nothing about it is known here.
 */
export type RigPluginApplicationContentRenderer = (
    props: RigPluginApplicationContentProps,
) => ReactNode;

export interface RigPluginApplicationPageProps {
    /** Full name of the application, as its plugin declared it. */
    title: string;
    /** Which plugin contributed it, shown beside the name so the source is never guessed. */
    pluginLabel?: string;
    status: RigPluginApplicationPageStatus;
    /** Why the application's code could not be prepared, when it could not. */
    error?: string;
    /**
     * The application's own running view. It is a slot rather than a component
     * because only the host that isolated the code can render it; this page owns
     * where it sits and how large it is, and nothing about what is inside it.
     */
    content?: ReactNode;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/**
 * RigPluginApplicationPage — the frame a locally installed plugin's own
 * application is shown inside.
 *
 * The plugin owns everything below the heading, so this page owns as little as
 * possible: a 56px surface header naming the application and the plugin behind
 * it, and one flush region beneath that the application fills edge to edge. It
 * draws no border, inset, or card around that region, because a plugin's screen
 * should look like a screen in this window rather than a picture of one.
 *
 * The states are deliberate and the geometry does not move between them. While
 * the code is being prepared, and when it could not be, the same region holds a
 * centred explanation instead of the application; the header stays put, so the
 * window never reflows around a plugin starting or failing to.
 */
export function RigPluginApplicationPage(props: RigPluginApplicationPageProps) {
    return (
        <div
            className={["happy2-rig-plugin-page", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="rig-plugin-page"
            data-status={props.status}
            data-testid={props["data-testid"]}
            style={props.style}
        >
            <div className="happy2-rig-plugin-page__header" data-happy2-ui="rig-plugin-page-header">
                <Toolbar
                    height={56}
                    title={props.title}
                    {...(props.pluginLabel ? { subtitle: props.pluginLabel } : {})}
                />
            </div>
            <div className="happy2-rig-plugin-page__body" data-happy2-ui="rig-plugin-page-body">
                {props.status === "ready" ? (
                    props.content
                ) : (
                    <EmptyState
                        description={statusDescription(props)}
                        icon={props.status === "loading" ? "clock" : "shield"}
                        size="panel"
                        title={statusTitle(props.status)}
                    />
                )}
            </div>
        </div>
    );
}

function statusTitle(status: RigPluginApplicationPageStatus): string {
    if (status === "loading") return "Opening…";
    if (status === "missing") return "No longer installed";
    return "This application could not be opened";
}

function statusDescription(props: RigPluginApplicationPageProps): string {
    if (props.status === "loading") return "Preparing this plugin's application.";
    if (props.status === "missing")
        return "The plugin that contributed this application is no longer running on this machine.";
    return props.error ?? "Its plugin did not provide everything this application needs.";
}
