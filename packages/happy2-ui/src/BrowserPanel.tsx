import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { Ionicon } from "./vectorIcons/VectorIcon";
import { TextField } from "./TextField";

export interface BrowserController {
    browserBack(): void;
    browserForward(): void;
    browserLoad(url: string): void;
    browserReload(): void;
    browserStop(): void;
}

export interface BrowserContentProps {
    /** Rig session whose network boundary owns this browser guest. */
    readonly sessionId?: string;
    /** Initial location for the Chromium guest. Further navigation uses the controller. */
    readonly source: string;
    browserControllerReady(controller: BrowserController | undefined): void;
    browserLoadingChanged(loading: boolean): void;
    browserLocationChanged(url: string, canGoBack: boolean, canGoForward: boolean): void;
    browserTitleChanged(title: string): void;
    browserFailed(message: string): void;
}

/** Native browser-content adapter supplied by the host (Electron in production). */
export type BrowserContentRenderer = (props: BrowserContentProps) => ReactNode;

export interface BrowserPanelProps {
    /** Keeps inactive browser guests mounted so page/history state survives tab switches. */
    active: boolean;
    initialUrl: string;
    renderContent?: BrowserContentRenderer;
    onLocationChange?(url: string): void;
    onTitleChange?(title: string): void;
}

interface BrowserViewState {
    readonly address: string;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
    readonly error?: string;
    readonly loading: boolean;
}

/**
 * Browser panel — compact desktop browser chrome around a host-supplied page
 * renderer. The visual component knows no Electron or IPC API: the host receives
 * a narrow controller/events contract, while Blueprint can supply inert content.
 *
 * The address draft and live navigation affordances are local UI state owned by
 * this reusable surface. Cookies, storage, history, redirects, downloads, and
 * page execution remain entirely inside the host's Chromium guest.
 */
export function BrowserPanel(props: BrowserPanelProps) {
    const [controller, controllerSet] = useState<BrowserController | undefined>(undefined);
    // Keep the guest's mount source stable. Main-frame navigation is imperative;
    // rewriting `src` after every redirect would restart the page.
    const [source] = useState(props.initialUrl);
    const [view, viewSet] = useState<BrowserViewState>({
        address: props.initialUrl === "about:blank" ? "" : props.initialUrl,
        canGoBack: false,
        canGoForward: false,
        loading: props.initialUrl !== "about:blank",
    });

    const navigate = () => {
        const url = browserAddressResolve(view.address);
        if (!url) return;
        viewSet((current) => ({ ...current, address: url, error: undefined, loading: true }));
        controller?.browserLoad(url);
    };

    return (
        <section
            className="happy2-browser-panel"
            data-happy2-ui="browser-panel"
            hidden={!props.active}
        >
            <div className="happy2-browser-panel__toolbar" data-happy2-ui="browser-toolbar">
                <Button
                    aria-label="Back"
                    disabled={!view.canGoBack}
                    iconOnly
                    onClick={() => controller?.browserBack()}
                    size="small"
                    variant="ghost"
                >
                    <Ionicon name="arrow-back-outline" size={14} />
                </Button>
                <Button
                    aria-label="Forward"
                    disabled={!view.canGoForward}
                    iconOnly
                    onClick={() => controller?.browserForward()}
                    size="small"
                    variant="ghost"
                >
                    <Ionicon name="arrow-forward-outline" size={14} />
                </Button>
                <Button
                    aria-label={view.loading ? "Stop loading" : "Reload"}
                    iconOnly
                    onClick={() =>
                        view.loading ? controller?.browserStop() : controller?.browserReload()
                    }
                    size="small"
                    variant="ghost"
                >
                    <Ionicon name={view.loading ? "close-outline" : "reload-outline"} size={14} />
                </Button>
                <TextField
                    aria-label="Address and search"
                    className="happy2-browser-panel__address"
                    fullWidth
                    leadingIcon={view.address.startsWith("https://") ? "lock" : "globe"}
                    onSubmit={navigate}
                    onValueChange={(address) =>
                        viewSet((current) => ({ ...current, address, error: undefined }))
                    }
                    placeholder="Search or enter address"
                    size="small"
                    value={view.address}
                />
            </div>
            <div className="happy2-browser-panel__content" data-happy2-ui="browser-content">
                {props.renderContent ? (
                    props.renderContent({
                        source,
                        browserControllerReady(next) {
                            controllerSet(next);
                        },
                        browserLoadingChanged(loading) {
                            viewSet((current) => ({ ...current, loading }));
                        },
                        browserLocationChanged(url, canGoBack, canGoForward) {
                            viewSet((current) => ({
                                ...current,
                                address: url === "about:blank" ? "" : url,
                                canGoBack,
                                canGoForward,
                                error: undefined,
                            }));
                            props.onLocationChange?.(url);
                        },
                        browserTitleChanged(title) {
                            props.onTitleChange?.(title);
                        },
                        browserFailed(message) {
                            viewSet((current) => ({
                                ...current,
                                error: message,
                                loading: false,
                            }));
                        },
                    })
                ) : (
                    <EmptyState
                        description="Embedded browsing is available in the Happy desktop app."
                        icon="globe"
                        size="panel"
                        title="Browser unavailable"
                    />
                )}
                {view.error ? (
                    <div
                        className="happy2-browser-panel__error"
                        data-happy2-ui="browser-error"
                        role="status"
                    >
                        {view.error}
                    </div>
                ) : null}
            </div>
        </section>
    );
}

/** Chromium-like omnibox resolution: URL/host first, otherwise a web search. */
function browserAddressResolve(value: string): string | undefined {
    const candidate = value.trim();
    if (!candidate) return undefined;
    try {
        const parsed = new URL(candidate);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch {
        // A host name or search query has no scheme yet.
    }
    if (!/\s/u.test(candidate) && browserHostLike(candidate)) {
        const local = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:\/|$)/iu.test(
            candidate,
        );
        try {
            return new URL(`${local ? "http" : "https"}://${candidate}`).href;
        } catch {
            // Fall through to search for malformed host-like text.
        }
    }
    return `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
}

function browserHostLike(value: string): boolean {
    return (
        /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[?[a-f0-9:]+\]?)(?::\d+)?(?:\/|$)/iu.test(value) ||
        /^[^\s/]+\.[^\s/]+(?::\d+)?(?:\/|$)/u.test(value)
    );
}
