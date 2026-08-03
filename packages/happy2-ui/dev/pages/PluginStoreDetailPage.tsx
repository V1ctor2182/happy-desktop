import { Button } from "../../src/Button";
import { PluginStoreDetail } from "../../src/PluginStoreDetail";
import {
    PLUGIN_STORE_FIXTURE_BARE,
    PLUGIN_STORE_FIXTURE_COMPLETE,
    PLUGIN_STORE_FIXTURE_FAILED,
    PLUGIN_STORE_FIXTURE_OVERLONG,
    PLUGIN_STORE_FIXTURE_STOPPED,
} from "../../src/pages/plugins/RigPluginCatalogPage.fixtures";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const page: Record<string, string> = { display: "flex", width: "640px" };

export function PluginStoreDetailPage() {
    return (
        <ComponentPage
            number="C-242"
            summary="One package read in full: the hero mark, the name, who made it and what shelf it is on, the state, then the actions, the paragraph, what it adds to Happy, and the ledger of facts about the copy on this machine. It decides nothing and fetches nothing."
            title="PluginStoreDetail"
        >
            <Specimen
                detail="Hero mark 64 px, name 22/700, attribution 13 px, state badge on the trailing edge. 16 px between every part of the column."
                label="Complete"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={page}>
                        <PluginStoreDetail
                            contributions={PLUGIN_STORE_FIXTURE_COMPLETE.contributions ?? []}
                            entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                            facts={PLUGIN_STORE_FIXTURE_COMPLETE.facts ?? []}
                            onBack={() => undefined}
                        />
                    </div>
                    <DimensionRule label="64 px hero mark · 16 px column gap" />
                </div>
            </Specimen>

            <Specimen
                detail="The actions filled, which is how installing, turning off, and removing will arrive: directly under the identity, because that is the one place a decision about this package is made."
                label="Actions"
                number="02"
                stage="surface"
            >
                <div style={page}>
                    <PluginStoreDetail
                        actions={
                            <>
                                <Button variant="primary">Turn on</Button>
                                <Button variant="ghost">Remove</Button>
                            </>
                        }
                        entry={PLUGIN_STORE_FIXTURE_STOPPED}
                        facts={PLUGIN_STORE_FIXTURE_STOPPED.facts ?? []}
                        onBack={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="A package that could not start. Its note is the warning box; a package that is merely off states its note in the neutral treatment instead, which specimen 02 shows."
                label="Failed"
                number="03"
                stage="surface"
            >
                <div style={page}>
                    <PluginStoreDetail
                        entry={PLUGIN_STORE_FIXTURE_FAILED}
                        facts={PLUGIN_STORE_FIXTURE_FAILED.facts ?? []}
                        onBack={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="A page with no way back, because nothing is standing behind it — and a package with no artwork, so the hero wears its generated mark. Publisher and category are reported and shown; the absent note, action lane, and back affordance each remove a child rather than leaving a gap."
                label="No mark, no way back"
                number="04"
                stage="surface"
            >
                <div style={page}>
                    <PluginStoreDetail
                        contributions={PLUGIN_STORE_FIXTURE_BARE.contributions ?? []}
                        entry={PLUGIN_STORE_FIXTURE_BARE}
                        facts={PLUGIN_STORE_FIXTURE_BARE.facts ?? []}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="Overlong name, publisher, category, and an unbreakable path, at a narrow measure. The name wraps, the facts wrap inside their own column, and the hero mark and badge hold their places."
                label="Overlong, narrow"
                number="05"
                stage="surface"
            >
                <div style={{ display: "flex", width: "380px" }}>
                    <PluginStoreDetail
                        entry={PLUGIN_STORE_FIXTURE_OVERLONG}
                        facts={PLUGIN_STORE_FIXTURE_OVERLONG.facts ?? []}
                        onBack={() => undefined}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
