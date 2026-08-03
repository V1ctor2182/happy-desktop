import { Button } from "../../src/Button";
import { PluginStoreCard } from "../../src/PluginStoreCard";
import {
    PLUGIN_STORE_FIXTURE_BARE,
    PLUGIN_STORE_FIXTURE_COMPLETE,
    PLUGIN_STORE_FIXTURE_FAILED,
    PLUGIN_STORE_FIXTURE_OVERLONG,
    PLUGIN_STORE_FIXTURE_STOPPED,
    PLUGIN_STORE_FIXTURE_UNBROKEN,
} from "../../src/pages/plugins/RigPluginCatalogPage.fixtures";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const shelf: Record<string, string> = {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    width: "760px",
};

const column: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
};

export function PluginStoreCardPage() {
    return (
        <ComponentPage
            number="C-240"
            summary="One plugin package offered rather than listed: the mark, the name, one line of what it is for, and the small print — publisher, category, version — under it. A trailing action lane is declared and stays empty until a surface fills it. The whole card opens the package; the lane's own controls do not."
            title="PluginStoreCard"
        >
            <Specimen
                detail="Everything a card can carry: mark, name, state, description, publisher · category · version. Card floor 320 px, ceiling 520 px, 16 px padding, 16 px between the mark and the text."
                label="Complete"
                number="01"
                stage="app"
            >
                <div style={column}>
                    <div style={{ display: "flex", width: "420px" }}>
                        <PluginStoreCard
                            entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                            onOpen={() => undefined}
                        />
                    </div>
                    <DimensionRule label="320 px floor · 520 px ceiling" />
                </div>
            </Specimen>

            <Specimen
                detail="What a real machine draws today: name, version, description. No publisher and no category, because Rig's plugin manifest has nowhere to put either — the meta line simply loses those terms rather than leaving a gap."
                label="Only what Rig reports"
                number="02"
                stage="app"
            >
                <div style={{ display: "flex", width: "420px" }}>
                    <PluginStoreCard entry={PLUGIN_STORE_FIXTURE_BARE} onOpen={() => undefined} />
                </div>
            </Specimen>

            <Specimen
                detail="The three states a package can be in. Only a failure earns a colour; running and off are both ordinary, so neither is green and neither is red."
                label="States"
                number="03"
                stage="app"
            >
                <div style={shelf}>
                    <PluginStoreCard
                        entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                        onOpen={() => undefined}
                    />
                    <PluginStoreCard
                        entry={PLUGIN_STORE_FIXTURE_STOPPED}
                        onOpen={() => undefined}
                    />
                    <PluginStoreCard entry={PLUGIN_STORE_FIXTURE_FAILED} onOpen={() => undefined} />
                </div>
            </Specimen>

            <Specimen
                detail="The action lane filled, which is how installing and removing will arrive. The lane sits above the card-wide press overlay, so its controls take their own presses."
                label="Action lane"
                number="04"
                stage="app"
            >
                <div style={{ display: "flex", width: "420px" }}>
                    <PluginStoreCard
                        action={
                            <>
                                <Button size="small" variant="secondary">
                                    Turn off
                                </Button>
                                <Button size="small" variant="ghost">
                                    Remove
                                </Button>
                            </>
                        }
                        entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                        onOpen={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="Selected, and a still card with no way to open it. A card without an opener is not a disabled card: nothing about it suggests a press."
                label="Selected and still"
                number="05"
                stage="app"
            >
                <div style={shelf}>
                    <PluginStoreCard
                        entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                        onOpen={() => undefined}
                        selected
                    />
                    <PluginStoreCard entry={PLUGIN_STORE_FIXTURE_BARE} />
                </div>
            </Specimen>

            <Specimen
                detail="A name, a publisher, and a category far past any reasonable length, at the card's floor width. The name ellipsizes, the meta line ellipsizes, the description clamps to three lines, and the mark and badge stay exactly where they are."
                label="Overlong"
                number="06"
                stage="app"
            >
                <div style={{ display: "flex", width: "320px" }}>
                    <PluginStoreCard
                        entry={PLUGIN_STORE_FIXTURE_OVERLONG}
                        onOpen={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="The harder case: a name, a description, and a loader's own error with no spaces anywhere in them, at the card's floor width. Every one of them breaks mid-token rather than widening the card, and the mark and the badge do not move."
                label="Nowhere to break"
                number="07"
                stage="app"
            >
                <div style={{ display: "flex", width: "320px" }}>
                    <PluginStoreCard
                        entry={PLUGIN_STORE_FIXTURE_UNBROKEN}
                        onOpen={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="Two cards in one wrapping shelf at 760 px, which is where the catalog puts them. They share the row's gap and neither carries a margin of its own."
                label="In a shelf"
                number="08"
                stage="app"
            >
                <div style={shelf}>
                    <PluginStoreCard
                        entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                        onOpen={() => undefined}
                    />
                    <PluginStoreCard entry={PLUGIN_STORE_FIXTURE_BARE} onOpen={() => undefined} />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
