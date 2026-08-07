import { partitionComponentProps } from "./componentProps";
import { type CSSProperties, type ReactNode } from "react";
import { Button } from "./Button";
import { LottieScene, type LottieSceneName } from "./LottieScene";
import { WindowDragRegion } from "./TitleBar";

/** The one thing this page is asking for, if it is asking for anything. */
export interface SetupPageAction {
    readonly label: string;
    readonly disabled?: boolean;
    /**
     * This action is running. The spinner goes on the button and the page keeps
     * everything else exactly where it was: an attempt started from here is not
     * a new step, and swapping the page for a waiting screen would take away the
     * error the person is still reading.
     */
    readonly busy?: boolean;
    onSelect(): void;
}

export interface SetupPageProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /**
     * The animation that says what is happening. Omitted by a page whose body is
     * already its own picture — the install terminal, or the two-panel fork.
     */
    readonly scene?: LottieSceneName;
    readonly title: string;
    readonly copy?: string;
    /**
     * A command the reader is meant to run themselves, shown selectable in the
     * monospace face. Present only when there is genuinely something to type: a
     * page that offers a command it does not need is a page that looks broken.
     */
    readonly command?: string;
    /** This page's own body, when it has one: a fork, a terminal, a notice. */
    readonly children?: ReactNode;
    readonly action?: SetupPageAction;
}

/**
 * C-252 SetupPage — one step of setup, as one centred page.
 *
 * Every state of first-run setup is the same shape: a picture that says what is
 * happening, a sentence naming it, a line explaining it, and at most one thing
 * to do. So they are all this component, and the only thing that changes
 * between them is which of those four are filled in.
 *
 * It replaced a wrapper that carried a step rail, a kicker, a measure column, a
 * scrollport and a footer slot. The rail tracked two steps across eight states
 * and so tracked nothing; the kicker restated the title in capitals; and the
 * remaining chrome was empty on every screen that used it. What was left after
 * removing them was a worse `WelcomeScreen`, which is why this is deliberately
 * the same centred column that screen opens the product with — arriving at
 * setup should change the words on the surface, not the surface.
 *
 * The scene is illustration and never information. `LottieScene` renders
 * nothing until its worker runtime arrives, and nothing at all in an engine that
 * cannot have one, so the title and copy carry the whole meaning of every page
 * and its stage keeps a fixed square whether the art comes or not.
 *
 * It fills the window of an Electron app that draws no native title bar, so it
 * owns the drag lane across its own top edge, out of the flow, the way every
 * other full-window state does.
 *
 * Props only: what a step means and what its action does belong to the flow.
 */
export function SetupPage(props: SetupPageProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "scene",
        "title",
        "copy",
        "command",
        "children",
        "action",
    ]);
    return (
        <div
            className={["happy2-setup-page", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="setup-page"
            data-testid={local["data-testid"]}
            style={local.style}
        >
            <WindowDragRegion />
            <div className="happy2-setup-page__body" data-happy-desktop-ui="setup-page-body">
                {local.scene ? (
                    <span
                        className="happy2-setup-page__stage"
                        data-happy-desktop-ui="setup-page-stage"
                    >
                        <LottieScene
                            name={local.scene}
                            // The picture repeats what the title already says, so
                            // the only thing worth offering is one more play.
                            replayLabel={local.title}
                            size={120}
                        />
                    </span>
                ) : null}
                <h1 className="happy2-setup-page__title" data-happy-desktop-ui="setup-page-title">
                    {local.title}
                </h1>
                {local.copy === undefined ? null : (
                    <p className="happy2-setup-page__copy" data-happy-desktop-ui="setup-page-copy">
                        {local.copy}
                    </p>
                )}
                {local.command === undefined ? null : (
                    <code
                        className="happy2-setup-page__command"
                        data-happy-desktop-ui="setup-page-command"
                    >
                        {local.command}
                    </code>
                )}
                {local.children === undefined ? null : (
                    <div
                        className="happy2-setup-page__slot"
                        data-happy-desktop-ui="setup-page-slot"
                    >
                        {local.children}
                    </div>
                )}
                {local.action
                    ? ((action) => (
                          <Button
                              disabled={action.disabled}
                              fullWidth
                              loading={action.busy}
                              onClick={action.onSelect}
                              size="large"
                          >
                              {action.label}
                          </Button>
                      ))(local.action)
                    : null}
            </div>
        </div>
    );
}
