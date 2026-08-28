import { useState, type ReactNode } from "react";
import { Button } from "../../Button";
import { ModalOverlay } from "../../ModalOverlay";
import { OnboardingSky } from "../../OnboardingSky";
import type { ThemeMode } from "../../ThemeScope";
import { WindowDragRegion } from "../../TitleBar";
import { WindowOverlay } from "../../WindowOverlay";

export interface HappySocialSetupModalProps {
    readonly appearance: ThemeMode;
    /** Blueprint fixtures settle the surface immediately for deterministic capture. */
    readonly motion?: "animated" | "settled";
    readonly children: ReactNode;
    readonly description: string;
    /**
     * How the stage is divided. `copy` is the default: the heading and its
     * sentence are drawn and the children take the lane beneath them. `full`
     * hands the whole stage to the children, for a step that brings its own
     * words — the slide deck that explains the product. The heading and the
     * sentence stay in the tree either way, so the dialog keeps one steady
     * accessible name and description across every step of the flow.
     */
    readonly presentation?: "copy" | "full";
    readonly title: string;
    onClose(): void;
}

/**
 * The immersive Happy Social setup surface. It uses the first-run sky as one
 * continuous window background and owns both its explicit close control and
 * its bottom-edge entrance/exit motion.
 *
 * The surface is two layers: the scenery travels, the window furniture does
 * not. The drag lane and the close control are siblings of the sliding layer
 * rather than passengers inside it, because a native drag rectangle is recorded
 * from the *transformed* position of its box and is not recollected while a
 * composited transform animation runs — furniture written inside the sliding
 * layer is registered a full window below the screen, subtracts nothing from
 * the app header underneath, and leaves the top of the close control unclickable.
 */
export function HappySocialSetupModal(props: HappySocialSetupModalProps) {
    const [closing, closingSet] = useState(false);
    const motion = props.motion ?? "animated";
    const presentation = props.presentation ?? "copy";
    const hidden = presentation === "full" ? "happy-visually-hidden" : undefined;
    const close = () => {
        if (closing) return;
        if (motion === "settled") {
            props.onClose();
            return;
        }
        closingSet(true);
    };
    return (
        <WindowOverlay>
            <ModalOverlay
                className="happy-social-setup-modal__overlay"
                onDismiss={close}
                placement="fill"
            >
                <section
                    aria-describedby="happy-social-setup-modal-description"
                    aria-labelledby="happy-social-setup-modal-title"
                    aria-modal="true"
                    className="happy-social-setup-modal"
                    data-closing={closing ? "" : undefined}
                    data-happy-desktop-ui="happy-social-setup-modal"
                    data-motion={motion}
                    role="dialog"
                >
                    <div
                        className="happy-social-setup-modal__motion"
                        onAnimationEnd={(event) => {
                            if (event.target === event.currentTarget && closing) props.onClose();
                        }}
                    >
                        <OnboardingSky appearance={props.appearance} />
                        <div
                            className="happy-social-setup-modal__content"
                            data-happy-desktop-ui="happy-social-setup-modal-content"
                            data-presentation={presentation}
                        >
                            <span
                                className={["happy-social-setup-modal__eyebrow", hidden]
                                    .filter(Boolean)
                                    .join(" ")}
                            >
                                Happy Social
                            </span>
                            <h1 className={hidden} id="happy-social-setup-modal-title">
                                {props.title}
                            </h1>
                            <p className={hidden} id="happy-social-setup-modal-description">
                                {props.description}
                            </p>
                            <div className="happy-social-setup-modal__controls">
                                {props.children}
                            </div>
                        </div>
                    </div>
                    <WindowDragRegion />
                    <Button
                        aria-label="Close Happy Social setup"
                        className="happy-social-setup-modal__close"
                        icon="close"
                        iconOnly
                        onClick={close}
                        size="medium"
                        variant="ghost"
                    />
                </section>
            </ModalOverlay>
        </WindowOverlay>
    );
}
