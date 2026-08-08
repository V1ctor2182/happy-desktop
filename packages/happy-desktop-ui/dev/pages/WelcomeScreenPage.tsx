import { useState, type ReactNode } from "react";
import type { RigAppearanceChoice } from "../../src/pages/settings/RigGeneralSettings";
import { ThemeScope } from "../../src/ThemeScope";
import { WelcomeScreen, type WelcomeSlide } from "../../src/WelcomeScreen";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-250";

/*
 * Placeholder deck. The words belong to the app; these exist so the page shows a
 * logo slide, a scene slide, and a slide whose copy is long enough to prove the
 * button below it does not move.
 */
const brand: WelcomeSlide = {
    id: "happy",
    art: { kind: "logo" },
    title: "Happy",
    copy: "The desktop where your agents work beside you.",
};
const agents: WelcomeSlide = {
    id: "agents",
    art: { kind: "scene", name: "robot" },
    title: "Agents that stay",
    copy: "Start a session, close the lid, come back to finished work.",
};
const build: WelcomeSlide = {
    id: "build",
    art: { kind: "scene", name: "wand" },
    title: "Build it here",
    copy: "The screen you wish existed is one you can make from inside the app.",
};
const clear: WelcomeSlide = {
    id: "clear",
    art: { kind: "scene", name: "sparkles" },
    title: "Nothing left over",
    copy: "Finished work closes itself.",
};
/* Deliberately three wrapped lines against the one-line slide above it. */
const long: WelcomeSlide = {
    id: "long",
    art: { kind: "scene", name: "owl" },
    title: "Everything you left running",
    copy: "Sessions on this machine and on every machine your Rig is peered with come back to the same window, in the same order you left them, whether they finished while you were watching or overnight.",
};

const shortFirst = [clear, brand, agents, build] as const;
const longFirst = [long, brand, agents, build] as const;

function WindowFrame(props: { children: ReactNode; height?: number; width?: number }) {
    const width = props.width ?? 1024;
    const height = props.height ?? 704;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: `${width}px` }}>
            <div style={{ height: `${height}px`, width: `${width}px` }}>{props.children}</div>
            <DimensionRule label={`${width}px × ${height}px desktop window`} />
        </div>
    );
}

const noop = () => {};

/*
 * The switcher only means anything if pressing it changes something, so this
 * specimen owns the appearance itself and pins it to its own ThemeScope — the
 * app wires the same two props to the real window setting.
 */
function AppearanceSpecimen() {
    const [appearance, setAppearance] = useState<RigAppearanceChoice>("system");
    return (
        <ThemeScope mode={appearance}>
            <WelcomeScreen
                appearance={appearance}
                onAction={noop}
                onAppearanceChange={setAppearance}
                slides={[brand, agents, build, clear]}
            />
        </ThemeScope>
    );
}

export function WelcomeScreenPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="First-run welcome deck: a 160px hero, a title, a short slogan, a row of dot controls and one primary action, centred on the workspace surface. It advances itself every 15s and wraps; a dot or an arrow key restarts the clock, and a reader who asked for reduced motion never sees it move. Two overlays sit outside that column and cannot move it: the transparent 56px window-drag lane along the top, invisible here, and the appearance switcher 24px in from the bottom-right corner."
            title="Welcome screen"
        >
            <Specimen
                detail="opens on the logo slide · 160px mark, 32px title, 400px slogan measure, 20px dot controls, 44px action · the deck advances by itself, so this specimen is a moment rather than a still"
                label="First slide"
                number="01"
                stage="surface"
            >
                <WindowFrame>
                    <WelcomeScreen
                        appearance="system"
                        onAction={noop}
                        onAppearanceChange={noop}
                        slides={[brand, agents, build, clear]}
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="the same deck rotated so it opens mid-slideshow on a Lottie slide · the scene occupies the same 160px stage the mark does, so the words start at the same y"
                label="Mid-slideshow scene"
                number="02"
                stage="surface"
            >
                <WindowFrame>
                    <WelcomeScreen
                        appearance="light"
                        onAction={noop}
                        onAppearanceChange={noop}
                        slides={[agents, build, clear, brand]}
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="one-line slogan against a three-line one, in identical frames · the words are a one-cell stack sized to the deck's longest slide, so the dots and the button hold the same y in both"
                label="Long copy does not move the action"
                number="03"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                    <WindowFrame height={560}>
                        <WelcomeScreen
                            actionLabel="Go Happy"
                            appearance="system"
                            onAction={noop}
                            onAppearanceChange={noop}
                            slides={shortFirst}
                        />
                    </WindowFrame>
                    <WindowFrame height={560}>
                        <WelcomeScreen
                            actionLabel="Go Happy"
                            appearance="system"
                            onAction={noop}
                            onAppearanceChange={noop}
                            slides={longFirst}
                        />
                    </WindowFrame>
                </div>
            </Specimen>

            <Specimen
                detail="Electron minimum window · the column keeps its rhythm and the screen scrolls from the top rather than clipping the hero"
                label="720 × 480 short window"
                number="04"
                stage="surface"
            >
                <WindowFrame height={480} width={720}>
                    <WelcomeScreen
                        appearance="dark"
                        onAction={noop}
                        onAppearanceChange={noop}
                        slides={longFirst}
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="a single-slide deck drops the dot row entirely — one dot is not a position, and a control that cannot choose anything is noise"
                label="One slide"
                number="05"
                stage="surface"
            >
                <WindowFrame height={560}>
                    <WelcomeScreen
                        actionLabel="Start"
                        appearance="system"
                        onAction={noop}
                        onAppearanceChange={noop}
                        slides={[brand]}
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="live · one 28px ghost button in the bottom-right corner cycles system → light → dark → system, and says which state it is on and where it goes next · half-disc, sun, moon"
                label="Appearance switcher"
                number="06"
                stage="surface"
            >
                <WindowFrame height={560}>
                    <AppearanceSpecimen />
                </WindowFrame>
            </Specimen>
        </ComponentPage>
    );
}
