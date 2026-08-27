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
    readonly status?: string;
    readonly title: string;
    onClose(): void;
}

/**
 * The immersive Happy Social setup surface. It uses the first-run sky as one
 * continuous window background and owns both its explicit close control and
 * its bottom-edge entrance/exit motion.
 */
export function HappySocialSetupModal(props: HappySocialSetupModalProps) {
    const [closing, closingSet] = useState(false);
    const motion = props.motion ?? "animated";
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
            <div
                className="happy-social-setup-modal__motion"
                data-closing={closing ? "" : undefined}
                data-motion={motion}
                onAnimationEnd={(event) => {
                    if (event.target === event.currentTarget && closing) props.onClose();
                }}
            >
                <ModalOverlay onDismiss={close} placement="fill">
                    <section
                        aria-describedby="happy-social-setup-modal-description"
                        aria-labelledby="happy-social-setup-modal-title"
                        aria-modal="true"
                        className="happy-social-setup-modal"
                        data-happy-desktop-ui="happy-social-setup-modal"
                        role="dialog"
                    >
                        <OnboardingSky appearance={props.appearance} />
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
                        <div
                            className="happy-social-setup-modal__content"
                            data-happy-desktop-ui="happy-social-setup-modal-content"
                        >
                            <span className="happy-social-setup-modal__eyebrow">Happy Social</span>
                            <h1 id="happy-social-setup-modal-title">{props.title}</h1>
                            <p id="happy-social-setup-modal-description">{props.description}</p>
                            {props.status ? <code>{props.status}</code> : null}
                            <div className="happy-social-setup-modal__controls">
                                {props.children}
                            </div>
                        </div>
                    </section>
                </ModalOverlay>
            </div>
        </WindowOverlay>
    );
}
