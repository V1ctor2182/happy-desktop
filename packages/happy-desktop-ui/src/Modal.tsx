import { partitionComponentProps } from "./componentProps";
import { type CSSProperties, type ReactNode } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { ScrollArea } from "./Scrollbar";
export type ModalSize = "small" | "medium" | "large";
export type ModalTone = "default" | "danger";
export type ModalProps = {
    className?: string;
    closeLabel?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
    onClose?: () => void;
    size?: ModalSize;
    tone?: ModalTone;
    icon?: IconName;
};
/**
 * C-028 Modal — dialog card with header / body / footer on a raised surface.
 *
 * The root `.happy-modal` is a transparent centering layer (no scrim, no fixed
 * positioning) so the dialog renders as a screenshot-safe specimen; a consuming
 * app portals it over its own backdrop. The measured card is the inner
 * `data-happy-desktop-ui="modal-dialog"`: three fixed widths (360 / 480 / 640), a 14px
 * shell radius, header (optional leading icon chip + title + close), a scrollable
 * body slot, and an optional right-aligned footer action row.
 */
export function Modal(props: ModalProps) {
    const [local, rest] = partitionComponentProps(props, [
        "className",
        "closeLabel",
        "style",
        "title",
        "children",
        "footer",
        "onClose",
        "size",
        "tone",
        "icon",
    ]);
    const size = () => local.size ?? "medium";
    const tone = () => local.tone ?? "default";
    return (
        <div
            {...rest}
            className={["happy-modal", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="modal"
            style={local.style}
        >
            <div
                aria-label={local.title}
                aria-modal="true"
                className="happy-modal__dialog"
                data-happy-desktop-ui="modal-dialog"
                data-size={size()}
                data-tone={tone()}
                role="dialog"
            >
                <header className="happy-modal__header" data-happy-desktop-ui="modal-header">
                    {local.icon
                        ? ((name) => (
                              <span
                                  className="happy-modal__icon"
                                  data-happy-desktop-ui="modal-icon"
                              >
                                  <Icon name={name} size={16} />
                              </span>
                          ))(local.icon)
                        : null}
                    <h2 className="happy-modal__title" data-happy-desktop-ui="modal-title">
                        {local.title}
                    </h2>
                    {local.onClose ? (
                        <Button
                            aria-label={local.closeLabel ?? "Close"}
                            className="happy-modal__close"
                            icon="close"
                            iconOnly
                            onClick={() => local.onClose?.()}
                            size="small"
                            variant="ghost"
                        />
                    ) : null}
                </header>
                <ScrollArea
                    axes="both"
                    className="happy-modal__body"
                    data-happy-desktop-ui="modal-body"
                    viewportClassName="happy-modal__body-viewport"
                >
                    <div
                        className="happy-modal__body-content"
                        data-happy-desktop-ui="modal-body-content"
                    >
                        {local.children}
                    </div>
                </ScrollArea>
                {local.footer ? (
                    <footer className="happy-modal__footer" data-happy-desktop-ui="modal-footer">
                        {local.footer}
                    </footer>
                ) : null}
            </div>
        </div>
    );
}
