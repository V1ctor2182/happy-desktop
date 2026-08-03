import { Component, createElement } from "react";
import type { HtmlPreviewProps } from "happy2-ui";
import { happyHtmlPreviewPartition, type DesktopGuestStatus } from "../shared/desktopContract";

interface HtmlPreviewWebViewEvent extends Event {
    readonly errorCode?: number;
    readonly errorDescription?: string;
    readonly isMainFrame?: boolean;
    readonly reason?: string;
    readonly validatedURL?: string;
}

interface HtmlPreviewWebViewElement extends HTMLElement {
    getURL(): string;
    getWebContentsId(): number;
    reload(): void;
}

/**
 * What the guest has to say about whether the page is there. A load that never
 * commits arrives as `did-fail-load`; a process that ends arrives as one of the
 * two crash events; and a committed error response is only visible through the
 * status the main process observes, because Electron hands the renderer no
 * response code of its own.
 */
const previewEvents = [
    "crashed",
    "did-fail-load",
    "did-finish-load",
    "did-start-loading",
    "render-process-gone",
] as const;

/**
 * Electron adapter for a rendered HTML file: one Chromium guest showing the
 * document exactly as a browser would, over the loopback site the main process
 * serves the file's own directory as.
 *
 * The guest carries no preload, no Node privilege, and a session of its own
 * whose only reachable network is that server, so a workspace page runs its
 * scripts without being able to reach the daemon, the app, or the internet.
 *
 * The class lifecycle is the imperative boundary the guest needs: the page is
 * reloaded when the file behind it changes, which is what keeps a document
 * someone is editing current without a control that asks for it. It reports
 * failures as the engine states them and writes no copy of its own — the words
 * a reader sees belong to `happy2-ui`.
 */
export class DesktopHtmlPreviewView extends Component<HtmlPreviewProps> {
    private element?: HtmlPreviewWebViewElement;
    private statusUnsubscribe?: () => void;
    /**
     * Response of the navigation that has committed, when it was an error. The
     * main process reports it over IPC, which may land on either side of the
     * guest's own `did-finish-load`, so both orders are handled: the status
     * fails the page whenever it arrives, and a finished load only clears a
     * failure when no error status stands against the address it is on.
     */
    private status?: DesktopGuestStatus;

    componentDidMount(): void {
        this.statusUnsubscribe = window.happyDesktop?.guestStatusSubscribe((status) => {
            if (status.guestId !== this.element?.getWebContentsId()) return;
            this.statusReceive(status);
        });
    }

    componentDidUpdate(before: HtmlPreviewProps): void {
        // A new address remounts the guest through its key; only a new revision
        // of the same file is a reload.
        if (before.revision !== this.props.revision && before.source === this.props.source)
            this.element?.reload();
    }

    componentWillUnmount(): void {
        this.statusUnsubscribe?.();
        this.statusUnsubscribe = undefined;
        this.elementApply(null);
    }

    /**
     * A committed response the preview server refused with. Everything this
     * server publishes is a local file, so any error status means there is no
     * page — there is no such thing here as an error document worth reading.
     */
    private readonly statusReceive = (status: DesktopGuestStatus): void => {
        if (status.status < 400) {
            this.status = undefined;
            return;
        }
        this.status = status;
        this.props.previewFailed({
            kind: "load-failed",
            source: status.url,
            status: status.status,
            ...(status.statusText ? { description: status.statusText } : {}),
        });
    };

    private readonly receive = (raw: Event): void => {
        const event = raw as HtmlPreviewWebViewEvent;
        const view = this.element;
        if (!view) return;
        if (event.type === "did-start-loading") {
            this.status = undefined;
            return;
        }
        if (event.type === "did-finish-load") {
            // A refused response finishes loading like any other document; it is
            // the status, not the finish, that says whether there is a page.
            if (this.status && this.status.status >= 400) return;
            this.props.previewLoaded();
            return;
        }
        if (event.type === "did-fail-load") {
            // Chromium reports an intentional stop or replacement as ERR_ABORTED,
            // and a subframe's failure is the page's business, not the frame's.
            if (event.errorCode === -3 || event.isMainFrame === false) return;
            this.props.previewFailed({
                kind: "load-failed",
                source: event.validatedURL || view.getURL() || this.props.source,
                ...(event.errorCode === undefined ? {} : { code: event.errorCode }),
                ...(event.errorDescription ? { description: event.errorDescription } : {}),
            });
            return;
        }
        this.props.previewFailed({
            kind: "renderer-gone",
            source: view.getURL() || this.props.source,
            ...(event.reason ? { detail: event.reason } : {}),
        });
    };

    private readonly elementApply = (view: HtmlPreviewWebViewElement | null): void => {
        if (view === this.element) return;
        if (this.element)
            for (const event of previewEvents)
                this.element.removeEventListener(event, this.receive);
        this.element = view ?? undefined;
        if (this.element)
            for (const event of previewEvents) this.element.addEventListener(event, this.receive);
    };

    render() {
        return createElement("webview", {
            "data-happy2-html-preview-guest": "",
            key: this.props.source,
            partition: happyHtmlPreviewPartition,
            ref: this.elementApply,
            src: this.props.source,
            webpreferences: "contextIsolation=yes,nodeIntegration=no,sandbox=yes",
        });
    }
}
