import { partitionComponentProps } from "./componentProps";
import { type CSSProperties, type ReactNode } from "react";
import { Button } from "./Button";
import { ImageViewer } from "./ImageViewer";
export type LightboxProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    imageUrl: string;
    alt?: string;
    /** Primary label above the frame — usually the file name. */
    caption?: string;
    /** Secondary meta above the frame — usually size / dimensions. */
    detail?: string;
    /** Trailing controls in the header, e.g. a download button. */
    actions?: ReactNode;
    onClose?: () => void;
    closeLabel?: string;
};
/**
 * C-046 Lightbox — full image preview shown inside a web modal (never a new
 * browser tab). Like Modal, the root `.happy2-lightbox` is a transparent
 * centering layer (no scrim, no fixed positioning) so it renders as a
 * screenshot-safe specimen; a consuming app portals it over its own backdrop.
 * The measured card is the inner `data-happy-desktop-ui="lightbox-dialog"`: an optional
 * caption/detail + actions header above the shared `ImageViewer`.
 *
 * The picture inside is the same viewer the file preview and the separate
 * preview window use, so an image opened from a conversation zooms, pans, and
 * answers the keyboard exactly as one opened from Files does. The card is
 * therefore a fixed viewing room rather than a box that shrinks to each
 * picture: a frame that resized per image would move its own controls.
 */
export function Lightbox(props: LightboxProps) {
    const [local, rest] = partitionComponentProps(props, [
        "className",
        "style",
        "imageUrl",
        "alt",
        "caption",
        "detail",
        "actions",
        "onClose",
        "closeLabel",
    ]);
    const hasHeader = () =>
        Boolean(local.caption || local.detail || local.actions || local.onClose);
    return (
        <div
            {...rest}
            className={["happy2-lightbox", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="lightbox"
            style={local.style}
        >
            <div
                aria-label={local.caption ?? local.alt ?? "Image preview"}
                aria-modal="true"
                className="happy2-lightbox__dialog"
                data-happy-desktop-ui="lightbox-dialog"
                role="dialog"
            >
                {hasHeader() ? (
                    <header
                        className="happy2-lightbox__header"
                        data-happy-desktop-ui="lightbox-header"
                    >
                        <div
                            className="happy2-lightbox__caption"
                            data-happy-desktop-ui="lightbox-caption"
                        >
                            {local.caption ? (
                                <span
                                    className="happy2-lightbox__caption-title"
                                    data-happy-desktop-ui="lightbox-caption-title"
                                >
                                    {local.caption}
                                </span>
                            ) : null}
                            {local.detail ? (
                                <span
                                    className="happy2-lightbox__caption-detail"
                                    data-happy-desktop-ui="lightbox-caption-detail"
                                >
                                    {local.detail}
                                </span>
                            ) : null}
                        </div>
                        <div
                            className="happy2-lightbox__tools"
                            data-happy-desktop-ui="lightbox-tools"
                        >
                            {local.actions}
                            {local.onClose ? (
                                <Button
                                    aria-label={local.closeLabel ?? "Close"}
                                    icon="close"
                                    iconOnly
                                    onClick={() => local.onClose?.()}
                                    size="small"
                                    variant="ghost"
                                />
                            ) : null}
                        </div>
                    </header>
                ) : null}
                <div className="happy2-lightbox__frame" data-happy-desktop-ui="lightbox-frame">
                    <ImageViewer
                        content={{ type: "url", url: local.imageUrl }}
                        name={local.alt ?? local.caption ?? "Image"}
                    />
                </div>
            </div>
        </div>
    );
}
