import {
    PLUGIN_STORE_FIXTURE_BARE,
    PLUGIN_STORE_FIXTURE_CATALOG,
    PLUGIN_STORE_FIXTURE_FAILURES,
} from "../../src/pages/plugins/RigPluginCatalogPage.fixtures";
import { RigPluginCatalogPage } from "../../src/pages/plugins/RigPluginCatalogPage";
import { ComponentPage, FullScreenSpecimen, Specimen } from "../kit";

/*
 * Fixture packages, not a machine. The running screen shows exactly what its Rig
 * reported and nothing else; these specimens exist so every state the page
 * supports can be reviewed, including the ones a working machine rarely reaches.
 */
const entries = PLUGIN_STORE_FIXTURE_CATALOG;

/** What the minimum Electron window leaves this page beside the Rig sidebar. */
const NARROW = { width: 470, height: 424 };

export function RigPluginCatalogBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-017"
            summary="This machine's plugin packages, offered as a catalog rather than tabulated as settings. A card carries a coloured mark, the name, one line of what the package is for, and the small print under it; cards wrap into as many columns as the surface holds and are shelved by what each package is doing. Choosing one gives it the whole surface. Every card keeps a declared action lane, empty until installing and removing exist."
            title="RigPluginCatalogPage"
        >
            <FullScreenSpecimen
                detail="Five packages across three shelves — one that failed to start, three running, one turned off — and one folder the machine could not read as a package at all."
                label="Catalog"
                number="01"
            >
                <RigPluginCatalogPage entries={entries} failures={PLUGIN_STORE_FIXTURE_FAILURES} />
            </FullScreenSpecimen>

            <Specimen
                detail="The same page in the space the minimum 720×480 window leaves beside the sidebar. Search and the filter wrap onto two rows and the cards fall to one column; nothing else changes."
                label="Minimum window"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flex: "none", overflow: "hidden", ...NARROW }}>
                    <RigPluginCatalogPage
                        entries={entries}
                        failures={PLUGIN_STORE_FIXTURE_FAILURES}
                    />
                </div>
            </Specimen>

            <FullScreenSpecimen
                detail="Before the first catalog arrives, so neither an empty machine nor a full one is claimed early."
                label="Loading"
                number="03"
            >
                <RigPluginCatalogPage entries={[]} loading />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A machine with no plugins installed, which is what a machine that has never installed one actually shows."
                label="Nothing here"
                number="04"
            >
                <RigPluginCatalogPage entries={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The catalog itself could not be read; the reason replaces the shelves rather than sitting above an empty one."
                label="Unreadable"
                number="05"
            >
                <RigPluginCatalogPage
                    entries={[]}
                    error="This machine's Rig stopped answering when asked which plugins it has."
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="One package carrying only what Rig reports today: a name, a version, a description, and where it lives. No publisher and no category, because the manifest has nowhere to put either."
                label="One package"
                number="06"
            >
                <RigPluginCatalogPage entries={[PLUGIN_STORE_FIXTURE_BARE]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Nothing installed and nothing readable — the reading a fresh machine with one broken plugin folder actually gives."
                label="Only a failure"
                number="07"
            >
                <RigPluginCatalogPage entries={[]} failures={PLUGIN_STORE_FIXTURE_FAILURES} />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
