// Type-only, so it costs nothing at runtime: the renderer itself is still
// reached through the lazy import inside `dotLottieRuntimeLoad`.
import type { DotLottieWorker } from "@lottiefiles/dotlottie-web";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
    LOTTIE_WORKER_ID,
    assetUrlAbsolute,
    dotLottieRuntimeLoad,
    markPixelRatio,
    reducedMotionQuery,
} from "./lottie/dotLottieRuntime";
import sparklesUrl from "./assets/animations/sparkles.json?url";

/**
 * The animations Happy ships. This is a closed list on purpose: a mark is part
 * of the design system, not a slot a product screen can point at arbitrary art,
 * and every name here has to have earned its meaning. See
 * `assets/animations/PROVENANCE.md` for what each one means and what was
 * rejected.
 */
export type LottieMarkName = "sparkles";

const SOURCES: Record<LottieMarkName, string> = { sparkles: sparklesUrl };

type Player = DotLottieWorker;

export type LottieMarkProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /** Which shipped animation to draw. */
    name: LottieMarkName;
    /** Rendered box, in CSS pixels. Square; a mark is never a hero. */
    size: number;
    /**
     * What the mark means, for anyone who cannot see it. A mark that only
     * decorates a title that already says the same thing passes `undefined` and
     * is hidden from assistive technology instead of repeating it.
     */
    label?: string;
};

/**
 * C-237 LottieMark — one small looping vector mark, drawn on a worker thread.
 *
 * Every frame is decoded, rasterised, and composited by ThorVG (WASM) inside a
 * Web Worker, against an OffscreenCanvas the main thread transfers once and
 * never touches again. There is no requestAnimationFrame loop here, no timer,
 * and no React render per frame. All marks share one worker.
 *
 * The main thread is not completely silent, and it would be dishonest to say so:
 * the renderer posts one small `frame` and one `render` notification per
 * rendered frame, which its own facade handles in constant time — a property
 * write and a dispatch to an empty listener list, since this component
 * subscribes to neither. That is a bounded message per frame, not rendering
 * work, and it is the one cost of the library that cannot be turned off. See
 * the C-237 blueprint page for what it measures at.
 *
 * The mark stops whenever no one is looking — scrolled out of view, or the
 * window hidden — and it never starts at all when the reader has asked for
 * reduced motion, showing a still first frame instead. Everything it allocates
 * (worker player, transferred canvas, observers, listeners) is released on
 * unmount, including when the unmount lands mid-construction.
 *
 * Until the runtime has loaded, and forever if it cannot load, the mark renders
 * nothing and leaves whatever its host drew underneath in place. That is the
 * cross-browser and locked-down-CSP fallback: an empty state that keeps its
 * ordinary glyph is a correct empty state, so nothing here is load-bearing.
 */
export function LottieMark(props: LottieMarkProps) {
    const canvas = useRef<HTMLCanvasElement | null>(null);
    // Drives only the canvas's own opacity, so the still glyph underneath is not
    // crossed by a half-painted first frame. It is not product state and nothing
    // outside this component reads it.
    const [painted, setPainted] = useState(false);

    /*
     * Owning a worker player, a transferred OffscreenCanvas, an
     * IntersectionObserver, a visibilitychange listener and a media-query
     * listener is not something a render derivation or a single ref callback can
     * express. The resources arrive asynchronously, after the runtime has
     * loaded; they outlive the callback that asked for them; and every one of
     * them has to be released together. The teardown below is that one path.
     */
    // eslint-disable-next-line happy2-react/no-layout-effect -- the asynchronous worker/canvas/observer lifetime described above
    useLayoutEffect(() => {
        const element = canvas.current;
        if (element === null) return;
        const view = element.ownerDocument.defaultView;
        if (view === null) return;
        /*
         * The renderer draws into an OffscreenCanvas it takes ownership of, and
         * where an engine cannot hand one over its constructor throws from an
         * async method nobody can catch. Ask first: an engine without the
         * transfer simply keeps the host's static glyph.
         */
        if (typeof element.transferControlToOffscreen !== "function") return;

        // Everything created below is registered here, so there is exactly one
        // teardown path whether the mark unmounted, the runtime never arrived,
        // or the effect re-ran for a different animation.
        let disposed = false;
        let player: Player | undefined;
        const release: (() => void)[] = [];

        /*
         * Playing is only ever correct when all three are true: the mark is in
         * view, the window is not hidden, and no one asked for less movement.
         * Each source below flips its own flag and then asks the one question,
         * so they cannot fight each other — an offscreen mark does not resume
         * merely because the window came back to the foreground.
         *
         * The flags live out here, above the runtime promise, because a mark can
         * scroll away or a window can be hidden while the runtime is still
         * arriving. Recording those answers early and applying them once the
         * player exists is the difference between a mark that honours them and
         * one that quietly drops them.
         */
        let visible = false;
        let shown = !element.ownerDocument.hidden;
        let reduced = reducedMotionQuery(view)?.matches ?? false;

        void dotLottieRuntimeLoad()
            .then(({ DotLottieWorker }) => {
                // The reader closed the screen while the runtime was still
                // arriving. Do not transfer the canvas; there is nothing to
                // transfer it to and it would leak a worker player.
                if (disposed) return;

                const instance = new DotLottieWorker({
                    /*
                     * Nothing starts on its own. Every command to a player whose
                     * worker-side half is not built yet is silently dropped, so
                     * a mark that autoplayed here would be running by the time
                     * anyone could tell it not to. `settle` below is the only
                     * thing that ever starts or stops it, and it does not run
                     * until the animation has loaded.
                     */
                    autoplay: false,
                    canvas: element,
                    loop: false,
                    renderConfig: {
                        autoResize: false,
                        devicePixelRatio: markPixelRatio(view),
                        // The worker's own offscreen check. The observer below
                        // still runs: this one knows about the viewport, and
                        // only the observer knows about a collapsed or
                        // display:none ancestor.
                        freezeOnOffscreen: true,
                    },
                    // Absolute: the worker fetching this has a blob: base URL.
                    src: assetUrlAbsolute(SOURCES[props.name]),
                    workerId: LOTTIE_WORKER_ID,
                });
                player = instance;

                const settle = () => {
                    if (disposed) return;
                    void instance.setLoop(!reduced);
                    if (reduced) {
                        // A reader who wants less movement still gets to see
                        // what the mark is: one representative frame, held.
                        // Sparkles loops continuously, so its first frame is as
                        // complete as any other and needs no hand-picked index.
                        void instance.pause();
                        void instance.setFrame(0);
                        return;
                    }
                    void (visible && shown ? instance.play() : instance.pause());
                };

                instance.addEventListener("load", () => {
                    /*
                     * The first point at which the worker-side player certainly
                     * exists, and therefore the first point at which any of this
                     * has an effect. Loading also draws frame 0, so revealing
                     * the canvas here never uncovers an empty one.
                     */
                    if (disposed) {
                        // The mark was torn down while its player was being
                        // built, so the teardown's own destroy() found nothing
                        // to free. This is the second chance to free it.
                        void instance.destroy();
                        return;
                    }
                    setPainted(true);
                    settle();
                });

                const observer = new view.IntersectionObserver((entries) => {
                    visible = entries.some((entry) => entry.isIntersecting);
                    settle();
                });
                observer.observe(element);
                release.push(() => {
                    observer.disconnect();
                });

                const onVisibility = () => {
                    shown = !element.ownerDocument.hidden;
                    settle();
                };
                element.ownerDocument.addEventListener("visibilitychange", onVisibility);
                release.push(() => {
                    element.ownerDocument.removeEventListener("visibilitychange", onVisibility);
                });

                const motion = reducedMotionQuery(view);
                if (motion) {
                    const onMotion = (event: MediaQueryListEvent) => {
                        reduced = event.matches;
                        settle();
                    };
                    motion.addEventListener("change", onMotion);
                    release.push(() => {
                        motion.removeEventListener("change", onMotion);
                    });
                }
            })
            .catch(() => {
                // No worker, no WASM, or a policy that forbids one. The host's
                // still glyph is already on screen and stays there.
            });

        return () => {
            disposed = true;
            setPainted(false);
            for (const off of release) off();
            release.length = 0;
            /*
             * Frees the worker-side player, its ThorVG surface, and the
             * transferred canvas buffer. The worker itself is shared and
             * outlives this mark by design. If the player has not finished
             * being built this call does nothing, which is why the load handler
             * above checks `disposed` and destroys it then instead.
             */
            void player?.destroy();
        };
    }, [props.name]);

    const box = `${String(props.size)}px`;
    return (
        <canvas
            aria-hidden={props.label === undefined ? "true" : undefined}
            aria-label={props.label}
            className={["happy2-lottie-mark", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="lottie-mark"
            data-name={props.name}
            data-painted={painted ? "true" : "false"}
            data-testid={props["data-testid"]}
            /*
             * A canvas transferred to a worker can never be reclaimed by the
             * main thread, so a different animation must get a different
             * element rather than a re-used one.
             */
            key={props.name}
            ref={canvas}
            role={props.label === undefined ? undefined : "img"}
            style={{ ...props.style, height: box, width: box }}
        />
    );
}
