import { Component, createElement } from "react";
import type { HtmlPreviewProps } from "happy2-ui";
import { happyHtmlPreviewPartition } from "../shared/desktopContract";

interface HtmlPreviewWebViewElement extends HTMLElement {
    reload(): void;
}

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
 * someone is editing current without a control that asks for it.
 */
export class DesktopHtmlPreviewView extends Component<HtmlPreviewProps> {
    private element?: HtmlPreviewWebViewElement;

    componentDidUpdate(before: HtmlPreviewProps): void {
        // A new address remounts the guest through its key; only a new revision
        // of the same file is a reload.
        if (before.revision !== this.props.revision && before.source === this.props.source)
            this.element?.reload();
    }

    private readonly elementApply = (view: HtmlPreviewWebViewElement | null): void => {
        this.element = view ?? undefined;
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
