import { type CSSProperties } from "react";
import { ComposerAttachmentRemoveButton } from "./ComposerAttachmentRemoveButton";
import { Icon } from "./Icon";

export type ComposerAttachmentPreviewKind = "file" | "image" | "video";

export type ComposerAttachmentPreview = {
    detail?: string;
    id: string;
    kind: ComposerAttachmentPreviewKind;
    name: string;
    url?: string;
};

export type ComposerAttachmentPreviewsProps = {
    className?: string;
    "data-testid"?: string;
    items: readonly ComposerAttachmentPreview[];
    /** Opens image or video media in the draft's full-window viewer. */
    onOpen?: (id: string) => void;
    onRemove?: (id: string) => void;
    readOnly?: boolean;
    style?: CSSProperties;
};

/**
 * Compact draft attachments shown above the composer's text. Media owns the
 * square when a preview URL exists; other files use the same footprint with a
 * document glyph and a bounded name.
 */
export function ComposerAttachmentPreviews(props: ComposerAttachmentPreviewsProps) {
    return (
        <div
            className={["happy-composer-attachments", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="composer-attachments"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {props.items.map((item) => (
                <div
                    aria-label={item.detail ? `${item.name}, ${item.detail}` : item.name}
                    className="happy-composer-attachments__item"
                    data-happy-desktop-ui="composer-attachment"
                    data-kind={item.kind}
                    key={item.id}
                    role="group"
                    title={item.detail ? `${item.name} · ${item.detail}` : item.name}
                >
                    {item.kind === "image" && item.url ? (
                        <img
                            alt=""
                            className="happy-composer-attachments__media"
                            data-happy-desktop-ui="composer-attachment-image"
                            draggable={false}
                            src={item.url}
                        />
                    ) : item.kind === "video" && item.url ? (
                        <video
                            aria-hidden="true"
                            className="happy-composer-attachments__media"
                            data-happy-desktop-ui="composer-attachment-video"
                            muted
                            playsInline
                            preload="metadata"
                            src={item.url}
                        />
                    ) : (
                        <span
                            className="happy-composer-attachments__file"
                            data-happy-desktop-ui="composer-attachment-file"
                        >
                            <Icon name="doc" size={20} />
                            <span className="happy-composer-attachments__name">{item.name}</span>
                        </span>
                    )}
                    {item.kind === "video" ? (
                        <span
                            aria-hidden="true"
                            className="happy-composer-attachments__play"
                            data-happy-desktop-ui="composer-attachment-play"
                        >
                            <Icon name="play" size={12} />
                        </span>
                    ) : null}
                    {(item.kind === "image" || item.kind === "video") &&
                    item.url &&
                    props.onOpen ? (
                        <button
                            aria-label={`Preview ${item.name}`}
                            className="happy-composer-attachments__open"
                            data-happy-desktop-ui="composer-attachment-open"
                            onClick={() => props.onOpen?.(item.id)}
                            type="button"
                        />
                    ) : null}
                    {!props.readOnly && props.onRemove ? (
                        <ComposerAttachmentRemoveButton
                            name={item.name}
                            onRemove={() => props.onRemove?.(item.id)}
                        />
                    ) : null}
                </div>
            ))}
        </div>
    );
}
