import { expect, it } from "vitest";
import { server } from "vitest/browser";
import { useState } from "react";
import { flushSync } from "react-dom";
import "./theme.css";
import "./styles/onboarding-screen.css";
import "./styles/icon.css";
import "./styles/vector-icon.css";
import "./styles/setup-option-card.css";
import "./styles/text-field.css";
import "./styles/banner.css";
import "./styles/badge.css";
import { OnboardingScreen, type OnboardingStep } from "./OnboardingScreen";
import { Icon } from "./Icon";
import { SetupOptionCard } from "./SetupOptionCard";
import { TextField } from "./TextField";
import { Banner } from "./Banner";
import { createRenderer, type Bounds, type RenderedElement } from "./testing";

/*
 * External focus-ring painted extent beyond an interactive child's border box.
 * These are the component contracts the body scrollport must never clip:
 * SetupOptionCard `:focus-visible` is `2px` outline + `2px` outline-offset, and
 * TextField's control `:focus-within` is `2px` outline + `1px` outline-offset.
 */
const OPTION_RING_EXTENT = 4;
const FIELD_RING_EXTENT = 3;

/*
 * Asserts an interactive child sits far enough inside the scrollport that its
 * external focus ring cannot be clipped on the requested edges. Insets are read
 * from border boxes, so the right inset conservatively includes the scrollbar
 * gutter; every reported inset must still clear the ring's painted extent.
 */
function assertRingClearance(
    scrollport: Bounds,
    child: Bounds,
    extent: number,
    edges: readonly string[],
    name: string,
) {
    expect(child.x - scrollport.x, `${name}: left ring clearance`).toBeGreaterThanOrEqual(extent);
    expect(
        scrollport.x + scrollport.width - (child.x + child.width),
        `${name}: right ring clearance`,
    ).toBeGreaterThanOrEqual(extent);
    if (edges.includes("top"))
        expect(child.y - scrollport.y, `${name}: top ring clearance`).toBeGreaterThanOrEqual(
            extent,
        );
    if (edges.includes("bottom"))
        expect(
            scrollport.y + scrollport.height - (child.y + child.height),
            `${name}: bottom ring clearance`,
        ).toBeGreaterThanOrEqual(extent);
}

const fontFamily = () =>
    server.browser === "webkit"
        ? "happy2 Figtree, system-ui, sans-serif"
        : '"happy2 Figtree", system-ui, sans-serif';

const steps: readonly OnboardingStep[] = [
    { label: "Account", state: "complete" },
    { label: "Server", state: "current" },
    { label: "Finish", state: "upcoming" },
];

/* Asserts a text part paints and its ink stays inside its own line box. */
async function paints(part: RenderedElement<Element>, name: string) {
    const vis = await part.visibleMetrics();
    expect(vis.pixelCount, `${name} paints no pixels`).toBeGreaterThan(0);
    const box = part.bounds();
    expect(vis.bounds.y, `${name} ink clipped at top`).toBeGreaterThan(0);
    expect(vis.bounds.y + vis.bounds.height, `${name} ink clipped at bottom`).toBeLessThanOrEqual(
        box.height,
    );
    return vis;
}

/* Asserts a painted part fills unclipped within its own box on every edge. */
async function paintsUnclipped(part: RenderedElement<Element>, name: string) {
    const vis = await part.visibleMetrics();
    expect(vis.pixelCount, `${name} paints no pixels`).toBeGreaterThan(0);
    const box = part.bounds();
    expect(vis.bounds.x, `${name} ink clipped left`).toBeGreaterThanOrEqual(0);
    expect(vis.bounds.y, `${name} ink clipped top`).toBeGreaterThanOrEqual(0);
    expect(vis.bounds.x + vis.bounds.width, `${name} ink clipped right`).toBeLessThanOrEqual(
        box.width,
    );
    expect(vis.bounds.y + vis.bounds.height, `${name} ink clipped bottom`).toBeLessThanOrEqual(
        box.height,
    );
    return vis;
}

/*
 * The measure column at the reference window: `medium` is 640px wide, centered
 * in 1024px, with a 40px gutter inside it. Every band (brand mast, step rail,
 * headline, body children, footer action) must resolve to this same left edge —
 * that shared edge is what replaced the card as the thing holding the screen
 * together, so it is asserted rather than inferred.
 */
const MEASURE_MEDIUM = 640;
const MEASURE_LEFT_1024 = (1024 - MEASURE_MEDIUM) / 2 + 40;

it("holds the full-window onboarding surface, its measure column, step rail, and typography", async () => {
    const view = createRenderer();

    view.render(
        () => (
            <OnboardingScreen
                brand={{ name: "Relay" }}
                copy="Point Relay at the workspace server that will run your agents."
                data-testid="onboarding"
                footer={<span data-testid="onboarding-foot">Need help connecting?</span>}
                kicker="Step 2 of 3"
                steps={steps}
                title="Connect your server"
            >
                <div data-testid="onboarding-body-child" style={{ height: "44px" }}>
                    body
                </div>
            </OnboardingScreen>
        ),
        { width: 1024, height: 704 },
    );
    await view.ready();

    /* ---- Root: the window itself, not a card on top of one -------------- */

    const root = view.$('[data-testid="onboarding"]');
    expect(root.element.tagName).toBe("DIV");
    expect(root.bounds()).toMatchObject({ x: 0, y: 0, width: 1024, height: 704 });
    expect(root.element.getAttribute("data-state")).toBe("form");
    expect(root.element.getAttribute("data-width")).toBe("medium");
    expect(
        root.computedStyles([
            "align-items",
            "background-color",
            "box-sizing",
            "color",
            "display",
            "flex-direction",
            "font-family",
            "overflow-x",
            "overflow-y",
        ]),
    ).toEqual({
        "align-items": "stretch",
        "background-color": "rgb(255, 255, 255)",
        "box-sizing": "border-box",
        color: "rgb(0, 0, 0)",
        display: "flex",
        "flex-direction": "column",
        "font-family": fontFamily(),
        "overflow-x": "hidden",
        "overflow-y": "hidden",
    });

    /* There is no card, dialog, or overlay layer left in the tree, and the
     * screen paints the flat workspace surface with no image behind it. */
    expect(
        view.container.querySelector('[data-happy-desktop-ui="onboarding-card"]'),
        "no card frame",
    ).toBeNull();
    const screen = view.$('[data-happy-desktop-ui="onboarding-screen"]');
    expect(screen.computedStyle("background-image")).toBe("none");
    expect(screen.computedStyle("border-top-width")).toBe("0px");

    /* ---- Brand mast ---------------------------------------------------- */

    const brand = view.$('[data-happy-desktop-ui="onboarding-brand"]');
    const mark = view.$('[data-happy-desktop-ui="onboarding-mark"]');
    const brandName = view.$('[data-happy-desktop-ui="onboarding-brand-name"]');
    /* The mast is the top band; its inner box is the measure column, so the
     * mark lands on the shared left edge and 32px below the window top. */
    expect(brand.bounds()).toMatchObject({ width: MEASURE_MEDIUM, height: 28 });
    expect(mark.bounds().x).toBe(MEASURE_LEFT_1024);
    expect(mark.bounds().y).toBe(32);
    expect(mark.bounds()).toMatchObject({ width: 28, height: 28 });
    expect(
        mark.computedStyles([
            "align-items",
            "border-radius",
            "box-sizing",
            "color",
            "display",
            "justify-content",
        ]),
    ).toEqual({
        "align-items": "center",
        "border-radius": "8px",
        "box-sizing": "border-box",
        color: "rgb(0, 0, 0)",
        display: "flex",
        "justify-content": "center",
    });
    /* No filled chip: the mark sits directly on the surface like the splash. */
    expect(mark.computedStyle("background-color")).toBe("rgba(0, 0, 0, 0)");
    /* 40 gutter + 28 mark + 12 gap, relative to the measure column's border box */
    expect(brandName.offsets().left).toBe(80);
    expect(brandName.computedStyle("color")).toBe("rgb(0, 0, 0)");
    const nameMetrics = brandName.textMetrics();
    expect(nameMetrics.text).toBe("Relay");
    expect(nameMetrics.font).toMatchObject({
        family: "happy2 Figtree, system-ui, sans-serif",
        letterSpacing: -0.15,
        lineHeight: 20,
        size: 15,
        weight: "700",
    });
    await paints(brandName, "brand name");

    /* Default mark: the Happy logo image itself, contained in the 28px box so
     * the launch splash and this mast show the same mark on the same surface. */
    const markImage = view.$('[data-happy-desktop-ui="onboarding-mark-image"]');
    expect(markImage.element.tagName).toBe("IMG");
    expect(markImage.bounds()).toMatchObject({ width: 28, height: 28 });
    expect(markImage.computedStyle("object-fit")).toBe("contain");
    expect(markImage.element.getAttribute("src")).toMatch(/happy-logo/);

    /* ---- Step rail ----------------------------------------------------- */

    const rail = view.$('[data-happy-desktop-ui="onboarding-steps"]');
    const stepEls = rail.element.querySelectorAll('[data-happy-desktop-ui="onboarding-step"]');
    expect(stepEls.length).toBe(3);
    /* The rail starts on the measure's left edge and spans it, gutter to gutter. */
    expect(rail.bounds().x).toBe(MEASURE_LEFT_1024);
    expect(rail.bounds().width).toBe(MEASURE_MEDIUM - 80);

    const bar = (state: string) =>
        view.$(
            `[data-happy-desktop-ui="onboarding-step"][data-state="${state}"] [data-happy-desktop-ui="onboarding-step-bar"]`,
        );
    const completeBar = bar("complete");
    const currentBar = bar("current");
    const upcomingBar = bar("upcoming");
    /* Segments are equal shares of the measure, so the labels keep one rhythm
     * regardless of their own text width. */
    expect(completeBar.bounds().width).toBeCloseTo(currentBar.bounds().width, 0);
    expect(currentBar.bounds().width).toBeCloseTo(upcomingBar.bounds().width, 0);
    expect(completeBar.bounds().height).toBe(3);
    /* The fill runs continuously from the first step through the current one,
     * in neutral ink on the hairline track. */
    expect(completeBar.computedStyle("background-color")).toBe("rgb(0, 0, 0)");
    expect(currentBar.computedStyle("background-color")).toBe("rgb(0, 0, 0)");
    expect(upcomingBar.computedStyle("background-color")).toBe("rgb(234, 234, 234)");

    const label = (state: string) =>
        view.$(
            `[data-happy-desktop-ui="onboarding-step"][data-state="${state}"] [data-happy-desktop-ui="onboarding-step-label"]`,
        );
    const completeLabel = label("complete");
    const currentLabel = label("current");
    const upcomingLabel = label("upcoming");
    expect(completeLabel.computedStyle("color")).toBe("rgb(73, 69, 79)");
    expect(currentLabel.computedStyle("color")).toBe("rgb(0, 0, 0)");
    expect(upcomingLabel.computedStyle("color")).toBe("rgb(73, 69, 79)");
    /* Only the current step is emphasized; the bar carries the progress. */
    expect(currentLabel.computedStyle("font-weight")).toBe("600");
    expect(upcomingLabel.computedStyle("font-weight")).toBe("500");
    /* Label sits 10px under its own segment and shares its left edge. */
    expect(currentLabel.bounds().y - (currentBar.bounds().y + currentBar.bounds().height)).toBe(10);
    expect(completeLabel.bounds().x).toBeCloseTo(completeBar.bounds().x, 0);
    await paints(currentLabel, "current step label");

    /* ---- Content block ------------------------------------------------- */

    const kicker = view.$('[data-happy-desktop-ui="onboarding-kicker"]');
    const title = view.$('[data-happy-desktop-ui="onboarding-title"]');
    const copy = view.$('[data-happy-desktop-ui="onboarding-copy"]');

    expect(
        kicker.computedStyles([
            "color",
            "font-size",
            "font-weight",
            "letter-spacing",
            "line-height",
            "text-transform",
        ]),
    ).toEqual({
        color: "rgb(73, 69, 79)",
        "font-size": "11px",
        "font-weight": "700",
        "letter-spacing": "1.1px",
        "line-height": "14px",
        "text-transform": "uppercase",
    });
    await paints(kicker, "kicker");

    expect(title.element.tagName).toBe("H1");
    expect(title.height()).toBe(38);
    expect(title.computedStyle("color")).toBe("rgb(0, 0, 0)");
    const titleMetrics = title.textMetrics();
    expect(titleMetrics.text).toBe("Connect your server");
    expect(titleMetrics.font).toMatchObject({
        family: "happy2 Figtree, system-ui, sans-serif",
        letterSpacing: -0.96,
        lineHeight: 38,
        size: 32,
        weight: "700",
    });
    expect(titleMetrics.baseline.fromElementTop).toBeGreaterThan(0);
    expect(titleMetrics.baseline.fromElementTop).toBeLessThan(38);
    await paints(title, "title");

    expect(copy.computedStyles(["color", "font-size", "font-weight", "line-height"])).toEqual({
        color: "rgb(73, 69, 79)",
        "font-size": "16px",
        "font-weight": "400",
        "line-height": "24px",
    });
    await paints(copy, "copy");

    /* Content vertical rhythm: rail→kicker 48px, kicker→title 14px,
     * title→copy 16px, all on one left edge. */
    expect(kicker.bounds().y - (rail.bounds().y + rail.bounds().height)).toBe(48);
    expect(title.offsets().top - (kicker.offsets().top + kicker.height())).toBe(14);
    expect(copy.offsets().top - (title.offsets().top + title.height())).toBe(16);
    expect(title.bounds().x).toBe(MEASURE_LEFT_1024);

    /* ---- Body scrollport + measure column + step slot ------------------- */

    const body = view.$('[data-happy-desktop-ui="onboarding-body"]');
    const bodyContent = view.$('[data-happy-desktop-ui="onboarding-body-content"]');
    const slot = view.$('[data-happy-desktop-ui="onboarding-slot"]');
    const bodyChild = view.$('[data-testid="onboarding-body-child"]');
    expect(bodyChild.height()).toBe(44);

    /* The scrollport owns scrolling and fills its allocated region with zero
     * margin and zero padding, edge to edge on both axes. */
    expect(
        body.computedStyles([
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "overflow-y",
        ]),
    ).toEqual({
        "margin-top": "0px",
        "margin-right": "0px",
        "margin-bottom": "0px",
        "margin-left": "0px",
        "padding-top": "0px",
        "padding-right": "0px",
        "padding-bottom": "0px",
        "padding-left": "0px",
        "overflow-y": "auto",
    });
    /* Full bleed: the scrollport runs to both window edges. */
    expect(body.bounds().width).toBe(1024);
    expect(body.bounds().x).toBe(0);

    /* Measure, spacing, and the focus-safe gutter live on the inner wrapper. */
    expect(
        bodyContent.computedStyles([
            "display",
            "flex-direction",
            "max-width",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
        ]),
    ).toEqual({
        display: "flex",
        "flex-direction": "column",
        "max-width": `${MEASURE_MEDIUM}px`,
        "padding-top": "40px",
        "padding-right": "40px",
        "padding-bottom": "40px",
        "padding-left": "40px",
    });
    expect(bodyContent.bounds().width).toBe(MEASURE_MEDIUM);

    /* One 12px gap flow for everything the app hands over, 32px below the copy
     * and on the same left edge as the headline. */
    expect(slot.computedStyles(["display", "flex-direction", "gap"])).toEqual({
        display: "flex",
        "flex-direction": "column",
        gap: "12px",
    });
    expect(bodyChild.bounds().y - (copy.bounds().y + copy.height())).toBe(32);
    expect(bodyChild.bounds().x).toBe(MEASURE_LEFT_1024);

    /* ---- Footer -------------------------------------------------------- */

    const footer = view.$('[data-happy-desktop-ui="onboarding-footer"]');
    const footerContent = view.$('[data-happy-desktop-ui="onboarding-footer-content"]');
    expect(
        footer.computedStyles([
            "background-color",
            "border-top-color",
            "border-top-width",
            "padding-top",
            "padding-bottom",
        ]),
    ).toEqual({
        "background-color": "rgb(255, 255, 255)",
        "border-top-color": "rgb(234, 234, 234)",
        "border-top-width": "1px",
        "padding-top": "24px",
        "padding-bottom": "24px",
    });
    /* Pinned to the window bottom, spanning it, with its content on the same
     * measure edge as everything above it. */
    expect(footer.offsets().bottom).toBe(0);
    expect(footer.bounds().width).toBe(1024);
    expect(footerContent.bounds().width).toBe(MEASURE_MEDIUM);
    expect(view.$('[data-testid="onboarding-foot"]').bounds().x).toBe(MEASURE_LEFT_1024);
    await paints(footerContent, "footer");

    await view.screenshot("OnboardingScreen.test");
}, 120_000);

it("keeps loading and form layout identical while holding width variants", async () => {
    const view = createRenderer();

    view.render(
        () => (
            <OnboardingScreen
                brand={{ name: "Relay" }}
                copy="We are provisioning the base image and starting your first agent."
                data-testid="loading"
                kicker="Almost there"
                loadingLabel="Provisioning workspace…"
                state="loading"
                steps={steps}
                title="Building your workspace"
            >
                <div data-testid="loading-body-child">body</div>
            </OnboardingScreen>
        ),
        { width: 1024, height: 704 },
    );
    view.render(
        () => (
            <OnboardingScreen
                brand={{ name: "Relay" }}
                copy="We are provisioning the base image and starting your first agent."
                data-testid="resolved"
                kicker="Almost there"
                steps={steps}
                title="Building your workspace"
            >
                <div data-testid="resolved-body-child" style={{ height: "44px" }}>
                    body
                </div>
            </OnboardingScreen>
        ),
        { width: 1024, height: 704 },
    );
    view.render(
        () => (
            <OnboardingScreen
                brand={{
                    mark: <Icon color="var(--button-primary-tint)" name="zap" size={16} />,
                    name: "Relay",
                }}
                copy="Choose the base image and defaults new agents inherit."
                data-testid="large"
                kicker="Step 3 of 3"
                steps={steps}
                title="Set up your workspace"
                width="large"
            >
                <div data-testid="large-body-child" style={{ height: "40px" }}>
                    body
                </div>
            </OnboardingScreen>
        ),
        { width: 1024, height: 704 },
    );
    view.render(
        () => (
            <OnboardingScreen data-testid="minimal" title="Enter your invite code">
                <div data-testid="minimal-body-child" style={{ height: "40px" }}>
                    body
                </div>
            </OnboardingScreen>
        ),
        { width: 1024, height: 704 },
    );
    await view.ready();

    /* ---- Loading: deterministic static ring + label replaces the body -- */

    const loadingRoot = view.$('[data-testid="loading"]');
    expect(loadingRoot.element.getAttribute("data-state")).toBe("loading");
    expect(
        view.container.querySelector('[data-testid="loading-body-child"]'),
        "body children hidden while loading",
    ).toBeNull();

    const loader = view.$('[data-testid="loading"] [data-happy-desktop-ui="onboarding-loader"]');
    expect(loader.computedStyles(["align-items", "display"])).toEqual({
        "align-items": "center",
        display: "flex",
    });

    const spinner = view.$('[data-testid="loading"] [data-happy-desktop-ui="onboarding-spinner"]');
    expect(spinner.bounds()).toMatchObject({ width: 20, height: 20 });
    expect(
        spinner.computedStyles([
            "border-radius",
            "border-top-color",
            "border-top-width",
            "border-left-color",
            "box-sizing",
        ]),
    ).toEqual({
        "border-radius": "999px",
        "border-top-color": "rgb(0, 0, 0)",
        "border-top-width": "2px",
        "border-left-color": "rgb(234, 234, 234)",
        "box-sizing": "border-box",
    });
    const ring = await spinner.visibleMetrics();
    expect(ring.pixelCount, "spinner paints no pixels").toBeGreaterThan(0);
    const sb = spinner.bounds();
    expect(ring.bounds.x, "ring clipped left").toBeGreaterThanOrEqual(0);
    expect(ring.bounds.y, "ring clipped top").toBeGreaterThanOrEqual(0);
    expect(ring.bounds.x + ring.bounds.width, "ring clipped right").toBeLessThanOrEqual(sb.width);
    expect(ring.bounds.y + ring.bounds.height, "ring clipped bottom").toBeLessThanOrEqual(
        sb.height,
    );
    expect(
        Math.abs(ring.bounds.x + ring.bounds.width / 2 - sb.width / 2),
        "ring x center",
    ).toBeLessThanOrEqual(0.75);
    expect(
        Math.abs(ring.bounds.y + ring.bounds.height / 2 - sb.height / 2),
        "ring y center",
    ).toBeLessThanOrEqual(0.75);

    const loadingLabel = view.$(
        '[data-testid="loading"] [data-happy-desktop-ui="onboarding-loading-label"]',
    );
    expect(loadingLabel.offsets().left).toBe(32); /* 20px ring + 12px gap */
    expect(
        loadingLabel.computedStyles(["color", "font-size", "font-weight", "line-height"]),
    ).toEqual({
        color: "rgb(73, 69, 79)",
        "font-size": "14px",
        "font-weight": "500",
        "line-height": "20px",
    });
    expect(loadingLabel.textMetrics().text).toBe("Provisioning workspace…");
    await paints(loadingLabel, "loading label");

    /* Probe resolution changes the step slot without moving the mast, the
     * measure column, or the headline that frame it. */
    const loadingMark = view.$('[data-testid="loading"] [data-happy-desktop-ui="onboarding-mark"]');
    const resolvedMark = view.$(
        '[data-testid="resolved"] [data-happy-desktop-ui="onboarding-mark"]',
    );
    const loadingTitle = view.$(
        '[data-testid="loading"] [data-happy-desktop-ui="onboarding-title"]',
    );
    const resolvedTitle = view.$(
        '[data-testid="resolved"] [data-happy-desktop-ui="onboarding-title"]',
    );
    expect(loadingMark.offsets()).toEqual(resolvedMark.offsets());
    expect(loadingTitle.offsets()).toEqual(resolvedTitle.offsets());
    expect(
        view.$('[data-testid="loading"] [data-happy-desktop-ui="onboarding-body-content"]').bounds()
            .width,
    ).toBe(MEASURE_MEDIUM);
    expect(
        view
            .$('[data-testid="resolved"] [data-happy-desktop-ui="onboarding-body-content"]')
            .bounds().width,
    ).toBe(MEASURE_MEDIUM);

    /* ---- Large width variant: 800px measure, display title, custom mark -- */

    const largeRoot = view.$('[data-testid="large"]');
    expect(largeRoot.element.getAttribute("data-width")).toBe("large");
    expect(
        view.$('[data-testid="large"] [data-happy-desktop-ui="onboarding-body-content"]').bounds()
            .width,
    ).toBe(800);
    const largeTitle = view.$('[data-testid="large"] [data-happy-desktop-ui="onboarding-title"]');
    expect(largeTitle.computedStyles(["font-size", "line-height"])).toEqual({
        "font-size": "40px",
        "line-height": "46px",
    });

    const customMark = view.$('[data-testid="large"] [data-happy-desktop-ui="onboarding-mark"]');
    expect(customMark.bounds()).toMatchObject({ width: 28, height: 28 });
    expect(
        customMark.element
            .querySelector('[data-happy-desktop-ui="icon"]')
            ?.getAttribute("data-name"),
    ).toBe("zap");

    /* ---- Minimal: title + body slot only ------------------------------- */

    const minimal = view.$('[data-testid="minimal"]');
    expect(
        minimal.element.querySelector('[data-happy-desktop-ui="onboarding-brand"]'),
        "no brand",
    ).toBeNull();
    expect(
        minimal.element.querySelector('[data-happy-desktop-ui="onboarding-steps"]'),
        "no steps",
    ).toBeNull();
    expect(
        minimal.element.querySelector('[data-happy-desktop-ui="onboarding-kicker"]'),
        "no kicker",
    ).toBeNull();
    expect(
        minimal.element.querySelector('[data-happy-desktop-ui="onboarding-copy"]'),
        "no copy",
    ).toBeNull();
    expect(
        minimal.element.querySelector('[data-happy-desktop-ui="onboarding-footer"]'),
        "no footer",
    ).toBeNull();
    const minimalTitle = view.$(
        '[data-testid="minimal"] [data-happy-desktop-ui="onboarding-title"]',
    );
    expect(minimalTitle.textMetrics().text).toBe("Enter your invite code");
    await paints(minimalTitle, "minimal title");
    expect(
        view.$('[data-testid="minimal"] [data-happy-desktop-ui="onboarding-body-content"]').bounds()
            .width,
    ).toBe(MEASURE_MEDIUM);
    /* Without a rail the headline is the top of the column, with no orphan gap. */
    expect(
        view
            .$('[data-testid="minimal"] [data-happy-desktop-ui="onboarding-content"]')
            .computedStyle("margin-top"),
    ).toBe("0px");

    await view.screenshot("OnboardingScreen.variants.test");
}, 120_000);

it("keeps short-window overflow reachable without clipping a focused trailing field", async () => {
    const view = createRenderer();

    view.render(
        () => (
            <OnboardingScreen
                copy="Agent code runs inside the selected sandbox provider."
                data-testid="scroll"
                kicker="Server setup"
                title="Choose a sandbox"
                width="large"
            >
                <SetupOptionCard
                    data-testid="opt-first"
                    description="Docker 25 is ready to run agents."
                    icon="terminal"
                    title="Docker"
                />
                <TextField data-testid="field-mid" label="Image name" value="daycare" />
                <SetupOptionCard
                    description="A lean sandbox with the core agent toolchain."
                    icon="image"
                    title="Daycare Minimal"
                />
                <SetupOptionCard
                    description="A complete sandbox with the full Daycare toolchain."
                    icon="image"
                    title="Daycare Full"
                />
                <TextField
                    data-testid="field-last"
                    label="Notes"
                    value="Ship it when the build turns green."
                />
            </OnboardingScreen>
        ),
        { width: 720, height: 480 },
    );
    await view.ready();

    /* ---- The scrollport fills the window below the mast ----------------- */

    const body = view.$('[data-testid="scroll"] [data-happy-desktop-ui="onboarding-body"]');
    const bodyEl = body.element as HTMLElement;
    /* Full bleed at the Electron minimum window: the scrollport runs to both
     * window edges and down to the bottom, since this fixture has no footer. */
    expect(body.bounds()).toMatchObject({ x: 0, width: 720 });
    expect(body.offsets()).toMatchObject({ left: 0, right: 0, bottom: 0 });
    expect(
        body.computedStyles([
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
        ]),
    ).toEqual({
        "margin-top": "0px",
        "margin-right": "0px",
        "margin-bottom": "0px",
        "margin-left": "0px",
        "padding-top": "0px",
        "padding-right": "0px",
        "padding-bottom": "0px",
        "padding-left": "0px",
    });
    /* The content genuinely overflows, so both scroll edges are exercised. */
    expect(bodyEl.scrollHeight, "content overflows the scrollport").toBeGreaterThan(
        bodyEl.clientHeight,
    );

    /* ---- Scrolled to the top: first child's ring clears the top edge ----- */

    bodyEl.scrollTop = 0;
    const firstOption = view.$('[data-testid="opt-first"]');
    assertRingClearance(
        body.bounds(),
        firstOption.bounds(),
        OPTION_RING_EXTENT,
        [],
        "first option",
    );
    await paintsUnclipped(firstOption, "first option card");

    /* `safe center` centers a short step but must never push the head of an
     * overflowing one above the scroll origin: at scrollTop 0 the very first
     * thing in the column is fully inside the scrollport. */
    const scrollKicker = view.$(
        '[data-testid="scroll"] [data-happy-desktop-ui="onboarding-kicker"]',
    );
    expect(
        scrollKicker.bounds().y - body.bounds().y,
        "head of an overflowing column is reachable at scrollTop 0",
    ).toBe(40);

    /* A TextField near the top edge is likewise clear on its sides. */
    const midControl = view.$(
        '[data-testid="field-mid"] [data-happy-desktop-ui="text-field-control"]',
    );
    assertRingClearance(body.bounds(), midControl.bounds(), FIELD_RING_EXTENT, [], "mid field");

    /* ---- Scrolled to the bottom: last child's ring clears the bottom ----- */

    bodyEl.scrollTop = bodyEl.scrollHeight;
    const lastControl = view.$(
        '[data-testid="field-last"] [data-happy-desktop-ui="text-field-control"]',
    );
    const lastInput = view.$(
        '[data-testid="field-last"] [data-happy-desktop-ui="text-field-input"]',
    );
    assertRingClearance(
        body.bounds(),
        lastControl.bounds(),
        FIELD_RING_EXTENT,
        ["bottom"],
        "last field",
    );

    /* Focus the trailing field: its accent ring is really painted and stays
     * inside the scrollport at the bottom scroll edge. */
    (lastInput.element as HTMLInputElement).focus();
    (lastInput.element as HTMLInputElement).style.caretColor = "transparent";
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    expect(document.activeElement).toBe(lastInput.element);
    expect(
        lastControl.computedStyles([
            "outline-color",
            "outline-offset",
            "outline-style",
            "outline-width",
        ]),
    ).toEqual({
        "outline-color": "rgb(0, 122, 255)",
        "outline-offset": "1px",
        "outline-style": "solid",
        "outline-width": "2px",
    });
    expect((await lastInput.visibleMetrics()).pixelCount, "focused field paints").toBeGreaterThan(
        0,
    );
    /* The painted ring rectangle (border box + 3px) is inside the scrollport. */
    const sp = body.bounds();
    const ring = lastControl.bounds();
    expect(ring.y - FIELD_RING_EXTENT - sp.y, "ring top inside scrollport").toBeGreaterThanOrEqual(
        0,
    );
    expect(
        sp.y + sp.height - (ring.y + ring.height + FIELD_RING_EXTENT),
        "ring bottom inside scrollport",
    ).toBeGreaterThanOrEqual(0);
    expect(ring.x - FIELD_RING_EXTENT - sp.x, "ring left inside scrollport").toBeGreaterThanOrEqual(
        0,
    );

    await view.screenshot("OnboardingScreen.scroll.test");
}, 120_000);

it("keeps the declared body gap whether an optional leading banner is present or absent", async () => {
    const view = createRenderer();

    /* With a leading provider banner (the ServerOnboarding provider notice). */
    view.render(
        () => (
            <OnboardingScreen
                data-testid="with-banner"
                kicker="Server setup"
                title="Pick a base image"
            >
                <Banner data-testid="note" icon="shield" tone="info">
                    Agent code runs inside the Docker sandbox.
                </Banner>
                <SetupOptionCard data-testid="wb-first" icon="image" title="Daycare Minimal" />
                <SetupOptionCard data-testid="wb-second" icon="image" title="Daycare Full" />
            </OnboardingScreen>
        ),
        { width: 1024, height: 704 },
    );
    /* Without the banner: the same two option cards, nothing else. */
    view.render(
        () => (
            <OnboardingScreen
                data-testid="no-banner"
                kicker="Server setup"
                title="Pick a base image"
            >
                <SetupOptionCard data-testid="nb-first" icon="image" title="Daycare Minimal" />
                <SetupOptionCard data-testid="nb-second" icon="image" title="Daycare Full" />
            </OnboardingScreen>
        ),
        { width: 1024, height: 704 },
    );
    await view.ready();

    const gapBetween = (top: RenderedElement<Element>, bottom: RenderedElement<Element>) =>
        bottom.offsets().top - (top.offsets().top + top.height());

    /* ---- Present: banner→first card and card→card are both the 12px gap -- */

    const note = view.$('[data-testid="note"]');
    const wbFirst = view.$('[data-testid="wb-first"]');
    const wbSecond = view.$('[data-testid="wb-second"]');
    /* The banner is the first flow child of the step slot: it rests at the
     * slot's own top edge, never touching the headline, with no external margin
     * of its own. */
    expect(note.offsets().top, "banner at slot top").toBe(0);
    expect(gapBetween(note, wbFirst), "banner → first card gap").toBe(12);
    expect(gapBetween(wbFirst, wbSecond), "card → card gap (with banner)").toBe(12);
    /* The slot itself keeps its 32px separation from the headline above it. */
    const wbTitle = view.$(
        '[data-testid="with-banner"] [data-happy-desktop-ui="onboarding-title"]',
    );
    expect(note.bounds().y - (wbTitle.bounds().y + wbTitle.height())).toBe(32);

    /* ---- Absent: the first card takes the banner's place, gaps unchanged -- */

    const nbFirst = view.$('[data-testid="nb-first"]');
    const nbSecond = view.$('[data-testid="nb-second"]');
    expect(nbFirst.offsets().top, "first card at slot top").toBe(0);
    expect(gapBetween(nbFirst, nbSecond), "card → card gap (no banner)").toBe(12);

    await view.screenshot("OnboardingScreen.gaps.test");
}, 120_000);

it("preserves the body DOM for one lifetime and remounts only it when bodyKey changes", async () => {
    const view = createRenderer();
    let setFixture!: (next: { bodyKey: string; revision: number }) => void;
    function Fixture() {
        const [fixture, updateFixture] = useState({ bodyKey: "sandbox", revision: 0 });
        setFixture = updateFixture;
        return (
            <OnboardingScreen
                bodyKey={fixture.bodyKey}
                data-testid="keyed"
                title={`Choose a sandbox ${fixture.revision}`}
            >
                {Array.from({ length: 12 }, (_, index) => (
                    <button key={index} type="button">
                        Provider {index + 1}
                    </button>
                ))}
            </OnboardingScreen>
        );
    }

    view.render(Fixture, { width: 720, height: 480, padding: 0 });
    await view.ready();
    const root = view.container.querySelector('[data-happy-desktop-ui="onboarding-screen"]')!;
    const firstBody = view.container.querySelector<HTMLElement>(
        '[data-happy-desktop-ui="onboarding-body"]',
    )!;
    firstBody.scrollTop = firstBody.scrollHeight;
    expect(firstBody.scrollTop).toBeGreaterThan(0);

    flushSync(() => setFixture({ bodyKey: "sandbox", revision: 1 }));
    const sameBody = view.container.querySelector<HTMLElement>(
        '[data-happy-desktop-ui="onboarding-body"]',
    )!;
    expect(sameBody).toBe(firstBody);
    expect(sameBody.scrollTop).toBeGreaterThan(0);
    expect(view.container.querySelector('[data-happy-desktop-ui="onboarding-screen"]')).toBe(root);

    flushSync(() => setFixture({ bodyKey: "base-image", revision: 2 }));
    const nextBody = view.container.querySelector<HTMLElement>(
        '[data-happy-desktop-ui="onboarding-body"]',
    )!;
    expect(nextBody).not.toBe(firstBody);
    expect(nextBody.scrollTop).toBe(0);
    expect(view.container.querySelector('[data-happy-desktop-ui="onboarding-screen"]')).toBe(root);
}, 120_000);
