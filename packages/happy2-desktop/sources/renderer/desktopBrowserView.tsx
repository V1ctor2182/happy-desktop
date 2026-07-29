import { Component, createElement } from "react";
import type { BrowserContentProps, BrowserController } from "happy2-ui";
import { happyBrowserPartition } from "../shared/desktopContract";

interface BrowserWebViewEvent extends Event {
    readonly canGoBack?: boolean;
    readonly canGoForward?: boolean;
    readonly errorCode?: number;
    readonly errorDescription?: string;
    readonly isMainFrame?: boolean;
    readonly title?: string;
    readonly url?: string;
    readonly validatedURL?: string;
}

interface BrowserWebViewElement extends HTMLElement {
    canGoBack(): boolean;
    canGoForward(): boolean;
    getTitle(): string;
    getURL(): string;
    goBack(): void;
    goForward(): void;
    loadURL(url: string): Promise<void>;
    reload(): void;
    stop(): void;
}

const browserEvents = [
    "did-fail-load",
    "did-navigate",
    "did-navigate-in-page",
    "did-start-loading",
    "did-stop-loading",
    "dom-ready",
    "page-title-updated",
] as const;

/**
 * Electron-only adapter for BrowserPanel. The class lifecycle is the imperative
 * boundary that attaches to one `<webview>` guest and cleans every listener up;
 * it owns no visual state or styling.
 */
export class DesktopBrowserView extends Component<BrowserContentProps> {
    state = { ready: false };
    private element?: BrowserWebViewElement;
    private proxyGeneration = 0;

    private readonly controller: BrowserController = {
        browserBack: () => {
            const view = this.element;
            if (view?.canGoBack()) view.goBack();
        },
        browserForward: () => {
            const view = this.element;
            if (view?.canGoForward()) view.goForward();
        },
        browserLoad: (url) => {
            void this.element?.loadURL(url).catch((error: unknown) => {
                this.props.browserFailed(
                    error instanceof Error ? error.message : "The page could not be loaded.",
                );
            });
        },
        browserReload: () => this.element?.reload(),
        browserStop: () => this.element?.stop(),
    };

    private readonly receive = (raw: Event): void => {
        const event = raw as BrowserWebViewEvent;
        const view = this.element;
        if (!view) return;
        if (event.type === "did-start-loading") {
            this.props.browserLoadingChanged(true);
            return;
        }
        if (event.type === "did-stop-loading") {
            this.props.browserLoadingChanged(false);
            this.locationPublish();
            return;
        }
        if (event.type === "did-fail-load") {
            // Chromium reports an intentional stop/replacement as ERR_ABORTED.
            if (event.errorCode !== -3 && event.isMainFrame !== false)
                this.props.browserFailed(event.errorDescription || "The page could not be loaded.");
            return;
        }
        if (event.type === "page-title-updated") {
            this.props.browserTitleChanged(event.title ?? view.getTitle());
            return;
        }
        if (event.type === "dom-ready") {
            this.locationPublish();
            const title = view.getTitle();
            if (title) this.props.browserTitleChanged(title);
            return;
        }
        this.locationPublish(event.url ?? event.validatedURL);
    };

    componentDidMount(): void {
        this.proxyApply();
    }

    componentDidUpdate(before: BrowserContentProps): void {
        if (before.sessionId !== this.props.sessionId) this.proxyApply();
    }

    componentWillUnmount(): void {
        this.proxyGeneration += 1;
        this.elementApply(undefined);
    }

    private readonly elementApply = (view: BrowserWebViewElement | null | undefined): void => {
        if (view === this.element) return;
        if (this.element)
            for (const event of browserEvents)
                this.element.removeEventListener(event, this.receive);
        this.element = view ?? undefined;
        if (this.element) {
            for (const event of browserEvents) this.element.addEventListener(event, this.receive);
            this.props.browserControllerReady(this.controller);
        } else {
            this.props.browserControllerReady(undefined);
        }
    };

    private proxyApply(): void {
        const sessionId = this.props.sessionId;
        const desktop = window.happyDesktop;
        const generation = (this.proxyGeneration += 1);
        this.elementApply(undefined);
        if (this.state.ready) this.setState({ ready: false });
        if (!sessionId || !desktop) {
            this.props.browserFailed("The browser has no Rig session.");
            return;
        }
        void desktop.browserProxyApply(sessionId).then(
            () => {
                if (generation === this.proxyGeneration) this.setState({ ready: true });
            },
            (error: unknown) => {
                if (generation !== this.proxyGeneration) return;
                this.props.browserFailed(
                    error instanceof Error
                        ? error.message
                        : "The Rig browser proxy could not be opened.",
                );
            },
        );
    }

    private locationPublish(candidate?: string): void {
        const view = this.element;
        if (!view) return;
        const url = candidate || view.getURL();
        if (!url) return;
        this.props.browserLocationChanged(url, view.canGoBack(), view.canGoForward());
    }

    render() {
        if (!this.state.ready)
            return createElement("div", {
                "data-happy2-browser-proxy-loading": "",
            });
        return createElement("webview", {
            allowpopups: "",
            "data-happy2-browser-guest": "",
            partition: happyBrowserPartition,
            ref: this.elementApply,
            src: this.props.source,
            webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes",
        });
    }
}
