import { partitionComponentProps } from "./componentProps";
import { type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
export type FileAttachmentKind = "file" | "photo" | "video" | "gif" | "audio" | "archive";
export type FileAttachmentVariant = "compact" | "chat";
export type FileAttachmentProps = {
    /** Keeps the hover affordance visible in deterministic blueprint fixtures. */
    actionsVisible?: boolean;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /** File name, shown truncated with an ellipsis when it overflows. */
    name: string;
    /** Human size string, e.g. "283 KB". */
    size?: string;
    /** Image shown in the file-kind tile instead of its generic glyph. */
    thumbnailUrl?: string;
    /** Low-resolution data URL painted behind the thumbnail until it loads. */
    thumbnailPlaceholderUrl?: string;
    kind?: FileAttachmentKind;
    /** Larger Slack-like card used for attachments in a chat message list. */
    variant?: FileAttachmentVariant;
    /** Click handler — renders a real button (download/open); never a new tab. */
    onOpen?: () => void;
    "aria-label"?: string;
};
const kindIcons: Record<FileAttachmentKind, IconName> = {
    file: "doc",
    photo: "files",
    video: "play",
    gif: "play",
    audio: "mic",
    archive: "files",
};
/**
 * C-049 FileAttachment — a non-image file rendered as either a compact control
 * or a bounded chat-list card. A single element (a real <button> when clickable)
 * keeps the entire attachment one accessible action.
 */
export function FileAttachment(props: FileAttachmentProps) {
    const [local] = partitionComponentProps(props, [
        "actionsVisible",
        "className",
        "data-testid",
        "style",
        "name",
        "size",
        "thumbnailUrl",
        "thumbnailPlaceholderUrl",
        "kind",
        "variant",
        "onOpen",
        "aria-label",
    ]);
    const kind = () => local.kind ?? "file";
    const variant = () => local.variant ?? "compact";
    const typeLabel = () => {
        const extension = local.name.match(/\.([a-z0-9]{1,8})$/i)?.[1];
        if (extension) return extension.toUpperCase();
        return {
            archive: "Archive",
            audio: "Audio",
            file: "File",
            gif: "GIF",
            photo: "Image",
            video: "Video",
        }[kind()];
    };
    const tile = (size: 16 | 20) => (
        <span className="happy-file-attachment__icon" data-happy-desktop-ui="file-attachment-icon">
            {local.thumbnailUrl ? (
                <img
                    alt=""
                    className="happy-file-attachment__thumbnail"
                    data-happy-desktop-ui="file-attachment-thumbnail"
                    draggable={false}
                    src={local.thumbnailUrl}
                    style={
                        local.thumbnailPlaceholderUrl
                            ? { backgroundImage: `url("${local.thumbnailPlaceholderUrl}")` }
                            : undefined
                    }
                />
            ) : (
                <Icon name={kindIcons[kind()]} size={size} />
            )}
        </span>
    );
    const compactInner = (
        <>
            {tile(16)}
            <span
                className="happy-file-attachment__name"
                data-happy-desktop-ui="file-attachment-name"
            >
                {local.name}
            </span>
            {local.size ? (
                <span
                    className="happy-file-attachment__size"
                    data-happy-desktop-ui="file-attachment-size"
                >
                    {local.size}
                </span>
            ) : null}
        </>
    );
    const chatInner = (
        <>
            {tile(20)}
            <span
                className="happy-file-attachment__copy"
                data-happy-desktop-ui="file-attachment-copy"
            >
                <span
                    className="happy-file-attachment__name"
                    data-happy-desktop-ui="file-attachment-name"
                >
                    {local.name}
                </span>
                <span
                    className="happy-file-attachment__meta"
                    data-happy-desktop-ui="file-attachment-meta"
                >
                    <span className="happy-file-attachment__meta-default">
                        {typeLabel()}
                        {local.size ? ((size) => <> · {size}</>)(local.size) : null}
                    </span>
                    {local.onOpen ? (
                        <span className="happy-file-attachment__meta-hover">
                            Download {typeLabel()}
                        </span>
                    ) : null}
                </span>
            </span>
            {local.onOpen ? (
                <span
                    aria-hidden="true"
                    className="happy-file-attachment__action"
                    data-happy-desktop-ui="file-attachment-action"
                >
                    <Icon name="arrow-right" size={16} />
                </span>
            ) : null}
        </>
    );
    const className = ["happy-file-attachment", local.className].filter(Boolean).join(" ");
    const inner = () => (variant() === "chat" ? chatInner : compactInner);
    return local.onOpen ? (
        ((onOpen) => (
            <button
                aria-label={local["aria-label"] ?? `Open ${local.name}`}
                className={className}
                data-actions-visible={local.actionsVisible ? "" : undefined}
                data-kind={kind()}
                data-happy-desktop-ui="file-attachment"
                data-variant={variant()}
                data-testid={local["data-testid"]}
                onClick={() => onOpen()}
                style={local.style}
                type="button"
            >
                {inner()}
            </button>
        ))(local.onOpen)
    ) : (
        <div
            className={className}
            data-actions-visible={local.actionsVisible ? "" : undefined}
            data-kind={kind()}
            data-happy-desktop-ui="file-attachment"
            data-variant={variant()}
            data-testid={local["data-testid"]}
            style={local.style}
        >
            {inner()}
        </div>
    );
}
