import { BuildIdentityPill, buildIdentityTone } from "../../src/BuildIdentityPill";
import { Button } from "../../src/Button";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-177";

const row: Record<string, string> = {
    alignItems: "center",
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
};

const column: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
};

const noop = () => {};

const worktreeLabels = [
    "main",
    "escape-interrupts-session",
    "fix/auth-flake",
    "release-2026-08",
    "dev",
    "notes-panel",
];

export function BuildIdentityPillPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Quiet dev-build identity mark — a tone dot and mono label so one dev window reads apart from another: main checkout vs. a git worktree."
            title="Build identity pill"
        >
            <Specimen
                detail="24px pill · radius pill · 8px tone dot + mono 11/600 label · deterministic tone per label"
                label="Tone sweep"
                number="01"
                stage="chrome"
            >
                <div style={column}>
                    <div style={row}>
                        {worktreeLabels.map((label) => (
                            <BuildIdentityPill key={label} label={label} />
                        ))}
                    </div>
                    <DimensionRule label="24 px high · label ellipsizes at 132 px" />
                </div>
            </Specimen>

            <Specimen
                detail="Same label always resolves to the same tone (buildIdentityTone hash)"
                label="Deterministic tone"
                number="02"
                stage="chrome"
            >
                <div style={row}>
                    <BuildIdentityPill label="escape-interrupts-session" />
                    <BuildIdentityPill label="escape-interrupts-session" />
                    <BuildIdentityPill label="escape-interrupts-session" />
                </div>
            </Specimen>

            <Specimen
                detail="Explicit tone prop overrides the hashed default, across all eight Avatar tones"
                label="Explicit tone"
                number="03"
                stage="chrome"
            >
                <div style={row}>
                    <BuildIdentityPill label="dev" tone="violet" />
                    <BuildIdentityPill label="dev" tone="ember" />
                    <BuildIdentityPill label="dev" tone="mint" />
                    <BuildIdentityPill label="dev" tone="ocean" />
                    <BuildIdentityPill label="dev" tone="rose" />
                    <BuildIdentityPill label="dev" tone="amber" />
                    <BuildIdentityPill label="dev" tone="slate" />
                    <BuildIdentityPill label="dev" tone="brand" />
                </div>
            </Specimen>

            <Specimen
                detail="A long worktree name truncates with an ellipsis; the title attribute carries the full detail on hover"
                label="Truncation"
                number="04"
                stage="chrome"
            >
                <div style={column}>
                    <BuildIdentityPill
                        detail="/Users/kirilldubovitskiy/Happy/Workspaces/happy2/an-especially-long-worktree-directory-name"
                        label="an-especially-long-worktree-directory-name"
                    />
                    <DimensionRule label="132 px max label width" />
                </div>
            </Specimen>

            <Specimen
                detail="Without onSelect it renders a <span>; with onSelect it renders a clickable <button> with hover/active affordance"
                label="Static vs. clickable"
                number="05"
                stage="chrome"
            >
                <div style={row}>
                    <BuildIdentityPill label="main" />
                    <BuildIdentityPill
                        detail="Click copies the worktree path"
                        label="escape-interrupts-session"
                        onSelect={noop}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="Sits in the 28px small-control row of the sidebar footer beside a small ghost Button"
                label="In the sidebar footer"
                number="06"
                stage="surface"
            >
                <div
                    style={{
                        alignItems: "center",
                        background: "var(--surface)",
                        border: "1px solid var(--divider)",
                        borderRadius: "8px",
                        display: "flex",
                        gap: "8px",
                        height: "28px",
                        padding: "0 8px",
                        width: "320px",
                    }}
                >
                    <BuildIdentityPill
                        detail="/Users/kirilldubovitskiy/Happy/Workspaces/happy2/escape-interrupts-session"
                        label="escape-interrupts-session"
                        onSelect={noop}
                        tone={buildIdentityTone("escape-interrupts-session")}
                    />
                    <div style={{ marginLeft: "auto" }}>
                        <Button
                            icon="settings"
                            iconOnly
                            onClick={noop}
                            size="small"
                            variant="ghost"
                        >
                            Settings
                        </Button>
                    </div>
                </div>
            </Specimen>
        </ComponentPage>
    );
}
