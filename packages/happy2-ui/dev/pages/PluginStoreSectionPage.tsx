import { Button } from "../../src/Button";
import { PluginStoreCard } from "../../src/PluginStoreCard";
import { PluginStoreSection } from "../../src/PluginStoreSection";
import {
    PLUGIN_STORE_FIXTURE_BARE,
    PLUGIN_STORE_FIXTURE_COMPLETE,
    PLUGIN_STORE_FIXTURE_FAILED,
    PLUGIN_STORE_FIXTURE_STOPPED,
} from "../../src/pages/plugins/RigPluginCatalogPage.fixtures";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const wide: Record<string, string> = { display: "flex", width: "760px" };
const narrow: Record<string, string> = { display: "flex", width: "380px" };

export function PluginStoreSectionPage() {
    return (
        <ComponentPage
            number="C-241"
            summary="One shelf of a catalog: a heading with a count, an optional line saying what is on the shelf, and children that wrap into as many columns as the surface can hold. It knows nothing about packages — it takes a title and children."
            title="PluginStoreSection"
        >
            <Specimen
                detail="Heading 17/700 with a mono count beside it, a 13px subtitle, then the wrapping row. 12 px between the heading, the subtitle, and the items; 12 px between items."
                label="Complete"
                number="01"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={wide}>
                        <PluginStoreSection
                            count={2}
                            subtitle="Installed and up, contributing whatever it offers Happy."
                            title="Running"
                        >
                            <PluginStoreCard
                                entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                                onOpen={() => undefined}
                            />
                            <PluginStoreCard
                                entry={PLUGIN_STORE_FIXTURE_BARE}
                                onOpen={() => undefined}
                            />
                        </PluginStoreSection>
                    </div>
                    <DimensionRule label="12 px between the heading, subtitle, and items" />
                </div>
            </Specimen>

            <Specimen
                detail="No count and no subtitle. Both are absent children rather than empty boxes, so the heading sits directly above the items with the same 12 px."
                label="Heading only"
                number="02"
                stage="app"
            >
                <div style={wide}>
                    <PluginStoreSection title="Off">
                        <PluginStoreCard
                            entry={PLUGIN_STORE_FIXTURE_STOPPED}
                            onOpen={() => undefined}
                        />
                    </PluginStoreSection>
                </div>
            </Specimen>

            <Specimen
                detail="A control belonging to the whole shelf rather than to any package on it, pushed to the trailing edge of the heading row."
                label="Accessory"
                number="03"
                stage="app"
            >
                <div style={wide}>
                    <PluginStoreSection
                        accessory={
                            <Button size="small" variant="secondary">
                                Start all
                            </Button>
                        }
                        count={1}
                        subtitle="Installed, but its code could not be started."
                        title="Needs attention"
                    >
                        <PluginStoreCard
                            entry={PLUGIN_STORE_FIXTURE_FAILED}
                            onOpen={() => undefined}
                        />
                    </PluginStoreSection>
                </div>
            </Specimen>

            <Specimen
                detail="The same shelf in a column too narrow for two cards. The items fall to one column and nothing else about the shelf changes."
                label="Narrow"
                number="04"
                stage="app"
            >
                <div style={narrow}>
                    <PluginStoreSection
                        count={2}
                        subtitle="Installed and up, contributing whatever it offers Happy."
                        title="Running"
                    >
                        <PluginStoreCard
                            entry={PLUGIN_STORE_FIXTURE_COMPLETE}
                            onOpen={() => undefined}
                        />
                        <PluginStoreCard
                            entry={PLUGIN_STORE_FIXTURE_BARE}
                            onOpen={() => undefined}
                        />
                    </PluginStoreSection>
                </div>
            </Specimen>
        </ComponentPage>
    );
}
