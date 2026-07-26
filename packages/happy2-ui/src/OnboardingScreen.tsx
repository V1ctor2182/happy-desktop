import { partitionComponentProps } from "./componentProps";
import { type CSSProperties, type Key, type ReactNode } from "react";
import { Icon } from "./Icon";
export type OnboardingStepState = "complete" | "current" | "upcoming";
export type OnboardingStep = {
    readonly label: string;
    readonly state: OnboardingStepState;
};
export type OnboardingScreenState = "form" | "loading";
export type OnboardingBrand = {
    name: string;
    mark?: ReactNode;
};
export type OnboardingScreenProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    brand?: OnboardingBrand;
    steps?: readonly OnboardingStep[];
    kicker?: string;
    title: string;
    copy?: string;
    width?: "medium" | "large";
    /**
     * Lifetime of the scrolling body. A changed key remounts only this
     * scrollport, resetting its scroll position without replacing the card.
     */
    bodyKey?: Key;
    children: ReactNode;
    footer?: ReactNode;
    state?: OnboardingScreenState;
    loadingLabel?: string;
};
/**
 * C-061 OnboardingScreen — the full-window desktop setup surface for onboarding
 * flows in Happy's system theme.
 *
 * There is no card, overlay, or dialog: the screen *is* the window. The root
 * paints the workspace surface edge to edge and stacks three flex-none/flex-auto
 * bands — a brand mast, a scrolling body, and an optional footer — each aligned
 * to one shared measure column so the brand mark, the step rail, the title, and
 * the footer action all sit on a single left edge. Inside the body the step rail,
 * the content block (kicker, display-size Figtree title, secondary copy), and the
 * app's step content stack in one column that is vertically centered while it
 * fits and scrolls from the top once it does not (`justify-content: safe center`).
 *
 * The body is a zero-margin, zero-padding scrollport; all spacing lives on the
 * inner content wrapper, whose generous 40px side gutter keeps every external
 * focus ring clear of a scroll edge. The app's children flatten into one 12px
 * gap flow in the content slot. When `state="loading"` that slot is replaced by
 * a deterministic, non-animated loader row (static ring + label) so the screen
 * stays screenshot-safe.
 *
 * Props only: the app passes its step form / content as `children`; this
 * component owns no onboarding state.
 */
export function OnboardingScreen(props: OnboardingScreenProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "brand",
        "steps",
        "kicker",
        "title",
        "copy",
        "width",
        "bodyKey",
        "children",
        "footer",
        "state",
        "loadingLabel",
    ]);
    const state = () => local.state ?? "form";
    const width = () => local.width ?? "medium";
    const steps = () => local.steps ?? [];
    return (
        <div
            className={["happy2-onboarding-screen", local.className].filter(Boolean).join(" ")}
            data-happy2-ui="onboarding-screen"
            data-state={state()}
            data-testid={local["data-testid"]}
            data-width={width()}
            style={local.style}
        >
            {local.brand
                ? ((brand) => (
                      <div
                          className="happy2-onboarding-screen__mast"
                          data-happy2-ui="onboarding-mast"
                      >
                          <div
                              className="happy2-onboarding-screen__brand"
                              data-happy2-ui="onboarding-brand"
                          >
                              <span
                                  className="happy2-onboarding-screen__mark"
                                  data-happy2-ui="onboarding-mark"
                              >
                                  {brand.mark ?? <Icon name="spark" size={16} />}
                              </span>
                              <span
                                  className="happy2-onboarding-screen__brand-name"
                                  data-happy2-ui="onboarding-brand-name"
                              >
                                  {brand.name}
                              </span>
                          </div>
                      </div>
                  ))(local.brand)
                : null}

            <div
                key={local.bodyKey}
                className="happy2-onboarding-screen__body"
                data-happy2-ui="onboarding-body"
            >
                <div
                    className="happy2-onboarding-screen__body-content"
                    data-happy2-ui="onboarding-body-content"
                >
                    {steps().length > 0 ? (
                        <div
                            className="happy2-onboarding-screen__steps"
                            data-happy2-ui="onboarding-steps"
                        >
                            {steps().map((step) => (
                                <div
                                    key={step.label}
                                    className="happy2-onboarding-screen__step"
                                    data-happy2-ui="onboarding-step"
                                    data-state={step.state}
                                >
                                    <span
                                        className="happy2-onboarding-screen__step-bar"
                                        data-happy2-ui="onboarding-step-bar"
                                        data-state={step.state}
                                    />
                                    <span
                                        className="happy2-onboarding-screen__step-label"
                                        data-happy2-ui="onboarding-step-label"
                                        data-state={step.state}
                                    >
                                        {step.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    <div
                        className="happy2-onboarding-screen__content"
                        data-happy2-ui="onboarding-content"
                    >
                        {local.kicker ? (
                            <p
                                className="happy2-onboarding-screen__kicker"
                                data-happy2-ui="onboarding-kicker"
                            >
                                {local.kicker}
                            </p>
                        ) : null}
                        <h1
                            className="happy2-onboarding-screen__title"
                            data-happy2-ui="onboarding-title"
                        >
                            {local.title}
                        </h1>
                        {local.copy ? (
                            <p
                                className="happy2-onboarding-screen__copy"
                                data-happy2-ui="onboarding-copy"
                            >
                                {local.copy}
                            </p>
                        ) : null}
                    </div>

                    <div
                        className="happy2-onboarding-screen__slot"
                        data-happy2-ui="onboarding-slot"
                    >
                        {state() === "loading" ? (
                            <div
                                className="happy2-onboarding-screen__loader"
                                data-happy2-ui="onboarding-loader"
                                role="status"
                            >
                                <span
                                    className="happy2-onboarding-screen__spinner"
                                    data-happy2-ui="onboarding-spinner"
                                />
                                <span
                                    className="happy2-onboarding-screen__loading-label"
                                    data-happy2-ui="onboarding-loading-label"
                                >
                                    {local.loadingLabel ?? "Loading…"}
                                </span>
                            </div>
                        ) : (
                            local.children
                        )}
                    </div>
                </div>
            </div>

            {local.footer ? (
                <div
                    className="happy2-onboarding-screen__footer"
                    data-happy2-ui="onboarding-footer"
                >
                    <div
                        className="happy2-onboarding-screen__footer-content"
                        data-happy2-ui="onboarding-footer-content"
                    >
                        {local.footer}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
