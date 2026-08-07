import { partitionComponentProps } from "./componentProps";
import {
    useId,
    useLayoutEffect,
    useState,
    useSyncExternalStore,
    type CSSProperties,
    type KeyboardEvent,
} from "react";
import { happyLogoUrl } from "./assets";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { LottieScene, type LottieSceneName } from "./LottieScene";
import { reducedMotionGet, reducedMotionSubscribe } from "./lottie/dotLottieRuntime";
/*
 * The same triple the settings surface offers, deliberately reused rather than
 * respelled here: an appearance chosen on this screen and one chosen in Settings
 * are the same window setting, and two declarations of it would eventually
 * disagree about what the third option is called.
 */
import type { RigAppearanceChoice } from "./pages/settings/RigGeneralSettings";
import { WindowDragRegion } from "./TitleBar";
import { Ionicon } from "./vectorIcons/VectorIcon";

/** What one slide shows above its words. */
export type WelcomeSlideArt =
    | { readonly kind: "logo" }
    | { readonly kind: "scene"; readonly name: LottieSceneName };

export interface WelcomeSlide {
    /** Stable identity for this slide; also the React key. */
    readonly id: string;
    readonly art: WelcomeSlideArt;
    readonly title: string;
    readonly copy: string;
}

export interface WelcomeScreenProps {
    readonly className?: string;
    readonly "data-testid"?: string;
    readonly style?: CSSProperties;
    /** At least one. The first is shown first. */
    readonly slides: readonly WelcomeSlide[];
    /** Primary action label. Defaults to "Go Happy". */
    readonly actionLabel?: string;
    onAction(): void;
    /** Which appearance this window is on. */
    readonly appearance: RigAppearanceChoice;
    onAppearanceChange(appearance: RigAppearanceChoice): void;
}

/**
 * How long one slide holds before the deck moves on. Fifteen seconds, because
 * five was measured against how long a slogan takes to *see* rather than how
 * long it takes to read one, notice the art, and look back — a reader who is
 * still on a slide when it changes has been interrupted, not paced. It is long
 * enough that the deck is something a reader can sit with, and still short
 * enough that anyone who stays on this screen learns it is a deck.
 */
const ADVANCE_MS = 15000;

/**
 * The art box, in CSS pixels. It is the same square for both slide kinds, and
 * the same number as the `width`/`height` of `__stage` in the stylesheet: the
 * stage is what keeps a logo slide and a scene slide from putting the words at
 * two different heights, so the two values must not be able to disagree.
 */
const ART_SIZE = 160;

/**
 * The appearance cycle, and what the one button that drives it is called.
 *
 * A single control has to say two things a segmented group says by showing
 * them: which appearance the window is on, and which one pressing it produces.
 * A reader who cannot see the glyph gets both from the name; a reader who can
 * still gets the promise of what happens next, which "Theme" never gave them.
 */
const APPEARANCE_CYCLE: Record<
    RigAppearanceChoice,
    { readonly next: RigAppearanceChoice; readonly label: string }
> = {
    system: { next: "light", label: "Appearance follows the system. Switch to light." },
    light: { next: "dark", label: "Appearance is light. Switch to dark." },
    dark: { next: "system", label: "Appearance is dark. Switch to following the system." },
};

/**
 * C-250 WelcomeScreen — the first thing a new reader sees: one centred column of
 * big art, a title, a slogan, a row of dots, and the single button that leaves.
 *
 * The deck advances on its own every fifteen seconds and wraps, which is the
 * whole argument for the layout below. Two things must not move while it does.
 * The art sits in a fixed square stage, so a logo slide and a Lottie slide put
 * their titles at exactly the same y. And every slide's words are stacked in one cell
 * — see `welcome-screen.css` — so the block is as tall as the longest copy in
 * the deck and the dots and the button underneath it never shift: a reader whose
 * pointer is already resting on "Go Happy" cannot have it slide away mid-read.
 * Only the active slide's words are visible, and `visibility: hidden` plus
 * `aria-hidden` keep the rest out of the accessibility tree, so the stack is one
 * screen of words rather than four read one after another.
 *
 * The dots are the real control: a tablist of buttons over the panels they
 * select, with a roving tab stop and Left/Right arrow keys. Choosing a slide
 * restarts the clock rather than letting the pending tick fire a moment later,
 * because being yanked off the slide you just asked for is worse than no
 * slideshow at all.
 *
 * A reader who asked for reduced motion never sees it advance by itself. The
 * deck holds the slide it is on, the dots stay usable, and the crossfade is off
 * — the preference is read from the same store `LottieScene` plays from, so a
 * scene slide and the deck carrying it always agree about it.
 *
 * It fills the window of an Electron app that draws no native title bar, so it
 * owns the drag lane across its own top 56px the way every other full-window
 * state does. The lane is an absolutely positioned overlay outside the flex
 * flow: the centred column is laid out as if it were not there, and it stays
 * pinned to the window's top edge rather than scrolling away with the content
 * at the minimum window height.
 *
 * The appearance switcher in the opposite corner is out of that flow for the
 * same reason and one more: it exists on a screen whose whole argument is that
 * nothing moves under the pointer, so it must not be able to take a pixel from
 * the column no matter which of the three glyphs it is showing. It is the
 * bottom-right corner precisely because the drag lane owns the top, and the two
 * can never contend for the same 56px.
 *
 * Props only: the words are the app's, the layout and the timing are ours.
 */
export function WelcomeScreen(props: WelcomeScreenProps) {
    const [local] = partitionComponentProps(props, [
        "className",
        "data-testid",
        "style",
        "slides",
        "actionLabel",
        "onAction",
        "appearance",
        "onAppearanceChange",
    ]);
    /*
     * Which slide is on screen. Narrowly scoped local UI state in the exact
     * sense the package allows: nothing outside this component can observe it,
     * and no product state depends on which picture is showing.
     */
    const [index, setIndex] = useState(0);
    /*
     * Read at render time rather than mirrored into state, because it decides
     * what is rendered as well as what moves: the effect below reads the same
     * value, so turning the preference on stops the deck without remounting it.
     * The pessimistic server snapshot means nothing advances before the
     * preference can be asked for.
     */
    const reducedMotion = useSyncExternalStore(
        reducedMotionSubscribe,
        reducedMotionGet,
        () => true,
    );
    const prefix = useId();
    const count = local.slides.length;
    // A deck that shrank under a live index would otherwise point past its end.
    const activeIndex = index < count ? index : 0;
    const active = local.slides[activeIndex];

    /*
     * A timer is a browser resource, not a value a render can derive and not an
     * event any reader produces: nobody clicks "fifteen seconds passed". This
     * is the one thing here that has to be started and stopped by hand. It is
     * one timeout per slide rather than a repeating interval, so the effect's
     * own dependencies do the restarting — every advance, every dot, every arrow
     * key changes `activeIndex`, which tears the pending tick down and starts a
     * full fifteen seconds afresh. The reduced-motion subscription it answers to
     * is the `useSyncExternalStore` above, which React unsubscribes with the
     * component.
     */
    // eslint-disable-next-line happy2-react/no-layout-effect -- the auto-advance timeout is an imperative browser resource with no declarative or event-driven equivalent
    useLayoutEffect(() => {
        // Nothing to advance to, or a reader who asked for less movement.
        if (reducedMotion || count < 2) return;
        const timer = globalThis.setTimeout(() => {
            setIndex((activeIndex + 1) % count);
        }, ADVANCE_MS);
        return () => {
            globalThis.clearTimeout(timer);
        };
    }, [activeIndex, count, reducedMotion]);

    /*
     * On the dot rather than on the row: the row is a `tablist`, which is not
     * focusable and therefore never receives a key of its own — the keys arrive
     * at whichever dot holds the tab stop, and a handler on the row would only
     * be reading them as they bubble past.
     */
    const dotKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        // Arrow keys would otherwise scroll the surface the deck sits on.
        event.preventDefault();
        const next = (activeIndex + step + count) % count;
        setIndex(next);
        /*
         * The row carries one tab stop, so selection and focus move together.
         * The dot being focused still has `tabIndex={-1}` in the committed tree;
         * a programmatic focus does not care, and the render this keypress
         * schedules hands the tab stop over to it.
         */
        const dot = event.currentTarget.parentElement?.children[next];
        if (dot instanceof HTMLElement) dot.focus();
    };

    return (
        <div
            className={["happy2-welcome-screen", local.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="welcome-screen"
            data-motion={reducedMotion ? "reduced" : "full"}
            data-testid={local["data-testid"]}
            style={local.style}
        >
            {/* The window has no native title bar behind this screen, so the
                screen itself has to provide somewhere to pick the window up.
                It is rendered here rather than beside the screen because this
                root is what establishes its positioning context. */}
            <WindowDragRegion />
            <div className="happy2-welcome-screen__view" data-happy-desktop-ui="welcome-view">
                <div className="happy2-welcome-screen__body" data-happy-desktop-ui="welcome-body">
                    <div
                        className="happy2-welcome-screen__slideshow"
                        data-happy-desktop-ui="welcome-slideshow"
                    >
                        <div
                            className="happy2-welcome-screen__stage"
                            data-happy-desktop-ui="welcome-stage"
                        >
                            {active ? welcomeArt(active) : null}
                        </div>

                        <div
                            className="happy2-welcome-screen__panels"
                            data-happy-desktop-ui="welcome-panels"
                        >
                            {local.slides.map((slide, position) => {
                                const current = position === activeIndex;
                                return (
                                    <div
                                        key={slide.id}
                                        // Every slide is in the tree so the stack can
                                        // be as tall as the longest one; only the
                                        // slide on screen is readable.
                                        aria-hidden={current ? undefined : "true"}
                                        aria-labelledby={`${prefix}-tab-${slide.id}`}
                                        className="happy2-welcome-screen__panel"
                                        data-active={current ? "" : undefined}
                                        data-happy-desktop-ui="welcome-panel"
                                        id={`${prefix}-panel-${slide.id}`}
                                        role="tabpanel"
                                        // The panel holds no control of its own, so
                                        // it takes a tab stop itself and the words
                                        // stay reachable from the keyboard.
                                        tabIndex={current ? 0 : undefined}
                                    >
                                        <h1
                                            className="happy2-welcome-screen__title"
                                            data-happy-desktop-ui="welcome-title"
                                        >
                                            {slide.title}
                                        </h1>
                                        <p
                                            className="happy2-welcome-screen__copy"
                                            data-happy-desktop-ui="welcome-copy"
                                        >
                                            {slide.copy}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>

                        {count > 1 ? (
                            <div
                                // The deck has no visible heading, so the row says
                                // what it steps through.
                                aria-label="Welcome slides"
                                className="happy2-welcome-screen__dots"
                                data-happy-desktop-ui="welcome-dots"
                                role="tablist"
                            >
                                {local.slides.map((slide, position) => {
                                    const current = position === activeIndex;
                                    return (
                                        <button
                                            key={slide.id}
                                            aria-controls={`${prefix}-panel-${slide.id}`}
                                            // The dot itself is a circle with nothing
                                            // in it; the slide it selects is what it
                                            // is called.
                                            aria-label={slide.title}
                                            aria-selected={current ? "true" : "false"}
                                            className="happy2-welcome-screen__dot"
                                            data-active={current ? "" : undefined}
                                            data-happy-desktop-ui="welcome-dot"
                                            id={`${prefix}-tab-${slide.id}`}
                                            onClick={() => setIndex(position)}
                                            onKeyDown={dotKeyDown}
                                            role="tab"
                                            tabIndex={current ? 0 : -1}
                                            type="button"
                                        >
                                            <span
                                                className="happy2-welcome-screen__dot-mark"
                                                data-happy-desktop-ui="welcome-dot-mark"
                                            />
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>

                    <Button
                        className="happy2-welcome-screen__action"
                        onClick={local.onAction}
                        size="large"
                    >
                        {local.actionLabel ?? "Go Happy"}
                    </Button>
                </div>
            </div>

            {/* Outside the scrollport as well as outside the flex flow: it is a
                corner of the window rather than the last item of a column, and
                it has to stay in that corner while a short window scrolls. */}
            <Button
                aria-label={APPEARANCE_CYCLE[local.appearance].label}
                className="happy2-welcome-screen__appearance"
                data-appearance={local.appearance}
                iconOnly
                onClick={() => local.onAppearanceChange(APPEARANCE_CYCLE[local.appearance].next)}
                size="small"
                variant="ghost"
            >
                {appearanceGlyph(local.appearance)}
            </Button>
        </div>
    );
}

/**
 * The glyph for the appearance the window is on now — the state, not the
 * destination: the button's own name already says where pressing it goes, and a
 * glyph showing the next state would contradict the name beside it.
 *
 * `sun` and `moon` are the curated house names. Following the system has no
 * curated equivalent, so it addresses the upstream Ionicon directly, which is
 * what `Ionicon` is for: a half-filled disc is the conventional "whichever one
 * this machine is on" mark, and it cannot be mistaken for either of the two
 * states it sits between.
 */
function appearanceGlyph(appearance: RigAppearanceChoice) {
    if (appearance === "light") return <Icon name="sun" size={16} />;
    if (appearance === "dark") return <Icon name="moon" size={16} />;
    return <Ionicon name="contrast-outline" size={16} />;
}

/**
 * The picture above the words. The logo is drawn at full strength rather than
 * the splash screen's muted mark: this screen *is* the brand moment, where that
 * one means "still waking up". A scene keeps its `on-appear` default so it plays
 * once as its slide arrives — the deck remounts it by key on every visit, which
 * is what makes coming back to a slide show the animation again instead of a
 * held final frame.
 */
function welcomeArt(slide: WelcomeSlide) {
    if (slide.art.kind === "logo")
        return (
            <img
                alt=""
                aria-hidden="true"
                className="happy2-welcome-screen__mark"
                data-happy-desktop-ui="welcome-mark"
                src={happyLogoUrl}
            />
        );
    return (
        <LottieScene
            key={slide.id}
            name={slide.art.name}
            replayLabel={`Play the ${slide.title} animation again`}
            size={ART_SIZE}
        />
    );
}
