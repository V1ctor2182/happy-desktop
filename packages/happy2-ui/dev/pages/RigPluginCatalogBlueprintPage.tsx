import { RIG_PLUGIN_CATALOG_PLACEHOLDER } from "../../src/pages/plugins/RigPluginCatalogPage.fixtures";
import { RigPluginCatalogPage } from "../../src/pages/plugins/RigPluginCatalogPage";
import { ComponentPage, FullScreenSpecimen, Specimen } from "../kit";

/*
 * The same placeholder catalog the running window is handed, so a specimen here
 * and the real screen show the same packages. Its last entry carries a name,
 * publisher, version, and purpose far past any reasonable length, which is what
 * proves the row keeps its margin mark, its version, and its state column where
 * every other row has them.
 */
const entries = RIG_PLUGIN_CATALOG_PLACEHOLDER;

/** What the minimum Electron window leaves this page beside the Rig sidebar. */
const NARROW = { width: 470, height: 424 };

export function RigPluginCatalogBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-017"
            summary="Every plugin package this machine knows about, read as an index rather than a storefront: a run of hairline-separated rows, a 2px mark in the left margin for the ones that want something, and a detail column carrying what a package does, what an update would change, what it adds to Happy, and where it came from. Every control reports what it would do instead of doing it — the strip under the filter says so, and says what was pressed."
            title="RigPluginCatalogPage"
        >
            <FullScreenSpecimen
                detail="Nine packages: two with an update waiting, one that stopped, two running, one turned off, and three on offer. The margin marks read down the left edge."
                label="Catalog"
                number="01"
            >
                <RigPluginCatalogPage entries={entries} />
            </FullScreenSpecimen>

            <Specimen
                detail="The same page in the space the minimum 720×480 window leaves beside the sidebar. Search and the filter wrap onto two rows, and the detail column takes the surface only once a row is chosen."
                label="Minimum window"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flex: "none", overflow: "hidden", ...NARROW }}>
                    <RigPluginCatalogPage entries={entries} />
                </div>
            </Specimen>

            <FullScreenSpecimen
                detail="Before the first catalog arrives, so neither an empty machine nor a full one is claimed early. This state and the two below it are written for the real catalog and speak of reading a machine; the running screen cannot reach them while the packages are invented, which is why the standing disclosure says otherwise."
                label="Loading"
                number="03"
            >
                <RigPluginCatalogPage entries={[]} loading />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A machine with no plugins and nothing on offer."
                label="Nothing here"
                number="04"
            >
                <RigPluginCatalogPage entries={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The catalog itself could not be read; the reason replaces the list rather than sitting above an empty one."
                label="Unreadable"
                number="05"
            >
                <RigPluginCatalogPage
                    entries={[]}
                    error="This machine's Rig stopped answering when asked which plugins it has."
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="One package, so the index is a single row and the detail column has the empty reading beside it."
                label="One package"
                number="06"
            >
                <RigPluginCatalogPage entries={[entries[3]!]} />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
