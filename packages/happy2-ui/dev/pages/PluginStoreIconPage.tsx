import { PluginStoreIcon, pluginStoreTone } from "../../src/PluginStoreIcon";
import type { ToneName } from "../../src/Avatar";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const row: Record<string, string> = {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "16px",
};

const column: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
};

const TONES: readonly ToneName[] = [
    "violet",
    "ocean",
    "mint",
    "amber",
    "ember",
    "rose",
    "slate",
    "brand",
];

/** Identities that show the derived tone spreading across the set. */
const SEEDS = ["cartographer", "lantern", "postmark", "millstone", "quarry", "sightline"];

export function PluginStoreIconPage() {
    return (
        <ComponentPage
            number="C-239"
            summary="The rounded-square mark a plugin package is recognized by: a house glyph on the package's own colour, or its artwork when a catalog has any. Sizes 32 / 48 / 64 with the application-icon curve at each; the mark carries identity and never state."
            title="PluginStoreIcon"
        >
            <Specimen
                detail="32 / 48 / 64 px · radius 8 / 12 / 16 · glyph 18 / 24 / 32"
                label="Sizes"
                number="01"
                stage="surface"
            >
                <div style={column}>
                    <div style={row}>
                        <PluginStoreIcon glyph="package" size="sm" tone="ocean" />
                        <PluginStoreIcon glyph="package" size="md" tone="ocean" />
                        <PluginStoreIcon glyph="package" size="lg" tone="ocean" />
                    </div>
                    <DimensionRule label="32 · 48 · 64 px square" />
                </div>
            </Specimen>

            <Specimen
                detail="Every tone at the card size. The six identity tones are what `pluginStoreTone` picks from; slate and brand are available for a mark that should stand apart."
                label="Tones"
                number="02"
                stage="surface"
            >
                <div style={row}>
                    {TONES.map((tone) => (
                        <PluginStoreIcon glyph="package" key={tone} size="md" tone={tone} />
                    ))}
                </div>
            </Specimen>

            <Specimen
                detail="Tones derived from six package identities. The same identity always produces the same colour, so a package keeps its mark across restarts and machines."
                label="Derived from identity"
                number="03"
                stage="surface"
            >
                <div style={row}>
                    {SEEDS.map((seed) => (
                        <PluginStoreIcon
                            glyph="package"
                            key={seed}
                            size="md"
                            tone={pluginStoreTone(seed)}
                        />
                    ))}
                </div>
            </Specimen>

            <Specimen
                detail="Different glyphs at the card size, for a catalog that can say what kind of thing a package is."
                label="Glyphs"
                number="04"
                stage="surface"
            >
                <div style={row}>
                    <PluginStoreIcon glyph="package" size="md" tone="violet" />
                    <PluginStoreIcon glyph="plugin" size="md" tone="mint" />
                    <PluginStoreIcon glyph="terminal" size="md" tone="amber" />
                    <PluginStoreIcon glyph="globe" size="md" tone="ocean" />
                    <PluginStoreIcon glyph="doc" size="md" tone="rose" />
                </div>
            </Specimen>

            <Specimen
                detail="Artwork takes the whole tile and the tone stops showing through, so a mark with its own silhouette is not boxed inside a coloured square. The specimen uses an inline SVG data URL so the workbench loads nothing over the network."
                label="Artwork"
                number="05"
                stage="surface"
            >
                <div style={row}>
                    <PluginStoreIcon artworkUrl={ARTWORK} glyph="package" size="sm" tone="violet" />
                    <PluginStoreIcon artworkUrl={ARTWORK} glyph="package" size="md" tone="violet" />
                    <PluginStoreIcon artworkUrl={ARTWORK} glyph="package" size="lg" tone="violet" />
                </div>
            </Specimen>

            <Specimen
                detail="A named mark is announced as an image; an unnamed one is hidden from assistive technology, because the package's name is already beside it."
                label="Named and decorative"
                number="06"
                stage="surface"
            >
                <div style={row}>
                    <PluginStoreIcon aria-label="Cartographer" glyph="package" tone="ocean" />
                    <PluginStoreIcon glyph="package" tone="ocean" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}

/* A flat two-tone square, drawn inline so the specimen is deterministic and
   never waits on a fetch. It stands in for a package's own artwork. */
const ARTWORK =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2baccc"/><circle cx="32" cy="32" r="16" fill="#ffffff"/></svg>',
    );
