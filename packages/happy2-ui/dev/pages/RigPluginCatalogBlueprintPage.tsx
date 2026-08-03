import { useRef, useState } from "react";
import {
    PLUGIN_STORE_FIXTURE_BARE,
    PLUGIN_STORE_FIXTURE_CATALOG,
    PLUGIN_STORE_FIXTURE_COMPLETE,
    PLUGIN_STORE_FIXTURE_FAILURES,
    PLUGIN_STORE_FIXTURE_REGENERATED,
    PLUGIN_STORE_FIXTURE_UNBROKEN,
    PLUGIN_STORE_FIXTURE_UNDRAWABLE,
} from "../../src/pages/plugins/RigPluginCatalogPage.fixtures";
import {
    RigPluginCatalogPage,
    type RigPluginCatalogEntry,
    type RigPluginCatalogInstall,
    type RigPluginCatalogManagement,
} from "../../src/pages/plugins/RigPluginCatalogPage";
import { ComponentPage, FullScreenSpecimen, Specimen } from "../kit";

/*
 * Fixture packages, not a machine. The running screen shows exactly what its Rig
 * reported and nothing else; these specimens exist so every state the page
 * supports can be reviewed, including the ones a working machine rarely reaches.
 */
const entries = PLUGIN_STORE_FIXTURE_CATALOG;

/** What the minimum Electron window leaves this page beside the Rig sidebar. */
const NARROW = { width: 470, height: 424 };

/**
 * The page with a package already open.
 *
 * Which package is open is the page's own view state and nothing outside it can
 * set it, so the workbench opens one the only way a reader can: by pressing the
 * first card. It is pressed once, as the specimen mounts, which is why this is a
 * harness and not a prop invented for the workbench.
 */
function OpenedCatalog(props: {
    connection?: "connecting" | "live" | "reconnecting" | "closed";
    entries?: readonly RigPluginCatalogEntry[];
    error?: string;
    manage?: boolean;
    width?: number;
}) {
    const opened = useRef(false);
    return (
        <div
            ref={(node) => {
                if (!node || opened.current) return;
                const card = node.querySelector<HTMLButtonElement>(
                    '[data-happy2-ui="plugin-store-card-open"]',
                );
                if (!card) return;
                opened.current = true;
                card.click();
            }}
            style={{
                display: "flex",
                flex: props.width === undefined ? "1 1 auto" : "none",
                overflow: "hidden",
                ...(props.width === undefined ? {} : { width: props.width, height: 424 }),
            }}
        >
            <RigPluginCatalogPage
                entries={props.entries ?? entries}
                {...(props.connection ? { connection: props.connection } : {})}
                {...(props.error === undefined ? {} : { error: props.error })}
                {...(props.manage ? { manage: management() } : {})}
            />
        </div>
    );
}

/**
 * A surface that can change what is installed, standing in for one.
 *
 * The machine is the only thing that can actually install or remove anything, so
 * this reports every press and answers nothing: the specimens below are here to
 * be looked at in each state, and each state is handed in directly rather than
 * arrived at.
 */
function management(
    install: RigPluginCatalogInstall = { kind: "idle" },
): RigPluginCatalogManagement {
    return {
        install,
        onInstall: (source) => console.info(`[blueprint] catalog install ${source}`),
        onInstallDismiss: () => console.info("[blueprint] catalog install dismissed"),
        onRemove: (id) => console.info(`[blueprint] catalog remove ${id}`),
        onRemoveDismiss: (id) => console.info(`[blueprint] catalog remove dismissed ${id}`),
    };
}

/**
 * The whole flow, driven for real: pressing a control moves this harness the way
 * the store would, so the dialogs, the inert states, and the answers can be
 * walked through rather than only looked at. It is a fake machine — it always
 * agrees, and after a beat.
 */
function LiveCatalog() {
    const [install, setInstall] = useState<RigPluginCatalogInstall>({ kind: "idle" });
    const [entries, setEntries] = useState<readonly RigPluginCatalogEntry[]>(
        PLUGIN_STORE_FIXTURE_CATALOG,
    );
    const removalSet = (id: string, removal: RigPluginCatalogEntry["removal"]): void => {
        setEntries((held) =>
            held.map((entry) => {
                if (entry.id !== id) return entry;
                const { removal: _dropped, ...rest } = entry;
                return removal === undefined ? rest : { ...rest, removal };
            }),
        );
    };
    return (
        <RigPluginCatalogPage
            entries={entries}
            manage={{
                install,
                onInstall: (source) => {
                    setInstall({ kind: "working" });
                    window.setTimeout(() => {
                        setInstall({
                            kind: "installed",
                            message: `Rig installed the plugin in ${source} and it is running.`,
                            title: "Installed Weather 1.4.0",
                        });
                    }, 900);
                },
                onInstallDismiss: () => setInstall({ kind: "idle" }),
                onRemove: (id) => {
                    removalSet(id, { kind: "working" });
                    window.setTimeout(() => {
                        removalSet(id, {
                            kind: "removed",
                            message: "Rig kept what this plugin had written.",
                        });
                        window.setTimeout(
                            () => setEntries((held) => held.filter((entry) => entry.id !== id)),
                            900,
                        );
                    }, 900);
                },
                onRemoveDismiss: (id) => removalSet(id, undefined),
            }}
        />
    );
}

export function RigPluginCatalogBlueprintPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="P-017"
            summary="This machine's plugin packages, offered as a catalog rather than tabulated as settings. A card carries a coloured mark, the name, one line of what the package is for, and the small print under it; cards wrap into as many columns as the surface holds and are shelved by what each package is doing. Choosing one gives it the whole surface. Installing, updating, and removing fill the action lanes the card and the package page declare, and appear only on a surface that was given a way to perform them."
            title="RigPluginCatalogPage"
        >
            <FullScreenSpecimen
                detail="Six packages across three shelves — two that failed to start, three running, one turned off — and one folder the machine could not read as a package at all."
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
                detail="The catalog itself could not be read and nothing had been read before it, so the reason replaces the shelves rather than sitting above an empty one."
                label="Unreadable"
                number="05"
            >
                <RigPluginCatalogPage
                    entries={[]}
                    error="This machine's Rig stopped answering when asked which plugins it has."
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The same failure with packages already read. They stay exactly where they are — a dropped subscription uninstalls nothing — and the reason is said above them instead of standing in for them."
                label="Unreadable, with a reading held"
                number="06"
            >
                <RigPluginCatalogPage
                    connection="reconnecting"
                    entries={entries}
                    error="This machine's Rig stopped answering when asked which plugins it has."
                    failures={PLUGIN_STORE_FIXTURE_FAILURES}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Reconnecting. Nothing failed outright, so the counts are still shown — with the header and the notice both saying plainly that they are the last reading rather than the current one."
                label="Reconnecting"
                number="07"
            >
                <RigPluginCatalogPage connection="reconnecting" entries={entries} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The subscription is closed. The same packages, and no claim that any of it is current."
                label="Not connected"
                number="08"
            >
                <RigPluginCatalogPage connection="closed" entries={entries} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A machine that has never been reachable: nothing was ever read, so this is not an empty machine and does not say it is."
                label="Never reached"
                number="09"
            >
                <RigPluginCatalogPage connection="closed" entries={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A single package, fully described — name, publisher, category, version, description, and where it lives — but with no artwork of its own, so its mark is the generated one. One card is also the narrowest the shelf ever gets."
                label="One package, no mark"
                number="10"
            >
                <RigPluginCatalogPage entries={[PLUGIN_STORE_FIXTURE_BARE]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="Nothing installed and nothing readable — the reading a fresh machine with one broken plugin folder actually gives."
                label="Only a failure"
                number="11"
            >
                <RigPluginCatalogPage entries={[]} failures={PLUGIN_STORE_FIXTURE_FAILURES} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A package's own page. It is read from the same subscription the catalog is, and this one is live, so nothing qualifies it."
                label="One package's page"
                number="12"
            >
                <OpenedCatalog />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The same page while the subscription is down. A reader who has opened a package is owed the same warning the shelves get — said above the page rather than instead of it, and without disturbing the page they are on."
                label="One package's page, reconnecting"
                number="13"
            >
                <OpenedCatalog connection="reconnecting" />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A package's page while the feed itself answered with a failure. The package stays — nothing was uninstalled — and the header says the counts are the last reading even though the connection still reports live."
                label="One package's page, unreadable feed"
                number="14"
            >
                <OpenedCatalog error="This machine's Rig stopped answering when asked which plugins it has." />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="An open connection nobody has answered on yet, with an earlier reading still on screen. Being connected to is neither being connected nor being empty, and the page says which it is."
                label="Connecting, with a reading held"
                number="15"
            >
                <RigPluginCatalogPage connection="connecting" entries={entries} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The same connection with nothing ever read from it. It is not an empty machine and does not claim to be one."
                label="Connecting, nothing read"
                number="16"
            >
                <RigPluginCatalogPage connection="connecting" entries={[]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The package whose every string is one unbroken token, on its own page at full width. Its description is a single path with nowhere to break, and it wraps mid-token rather than setting the width of the column."
                label="Unbroken package's page"
                number="17"
            >
                <OpenedCatalog entries={[PLUGIN_STORE_FIXTURE_UNBROKEN]} />
            </FullScreenSpecimen>

            <Specimen
                detail="The same page in the space the minimum window leaves, where the measure is 470px wide and the text column inside it 422px. The description, the name, the note, and the contribution all still wrap inside it."
                label="Unbroken package's page, minimum window"
                number="18"
                stage="surface"
            >
                <OpenedCatalog entries={[PLUGIN_STORE_FIXTURE_UNBROKEN]} width={NARROW.width} />
            </Specimen>
            <FullScreenSpecimen
                detail="Marks as they really arrive. One package carries its own PNG, one has not had its bytes read yet, and one is addressable but will not decode — the last two both fall back to a generated mark, which is what a package with no icon of its own always wears."
                label="Marks, present and absent"
                number="19"
            >
                <RigPluginCatalogPage
                    entries={[
                        PLUGIN_STORE_FIXTURE_COMPLETE,
                        PLUGIN_STORE_FIXTURE_BARE,
                        PLUGIN_STORE_FIXTURE_UNDRAWABLE,
                    ]}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The same package before and after its mark changed. Rig names a mark by the hash of its bytes, so a new icon is a new address and nothing else about the package moves; side by side these are the two readings a generation update produces."
                label="A mark replaced"
                number="20"
            >
                <div style={{ display: "flex", flex: "1 1 auto", minWidth: 0 }}>
                    <RigPluginCatalogPage entries={[PLUGIN_STORE_FIXTURE_COMPLETE]} />
                    <RigPluginCatalogPage entries={[PLUGIN_STORE_FIXTURE_REGENERATED]} />
                </div>
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A package's page with its own mark at hero size and its publisher and shelf under the name. Each of these is something Rig reported about the package rather than something derived from its folder name."
                label="A described package's page"
                number="21"
            >
                <OpenedCatalog entries={[PLUGIN_STORE_FIXTURE_COMPLETE]} />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The same catalog on a surface that can change what is installed. Installing sits at the far end of the control lane, away from the two controls that only choose what is shown, and every card gains the one thing that can be done to it from here."
                label="Can be changed"
                number="22"
            >
                <RigPluginCatalogPage
                    entries={entries}
                    failures={PLUGIN_STORE_FIXTURE_FAILURES}
                    manage={management()}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="One package being removed and one the machine has said is gone. The removed card stays until the reading stops listing it, because what is installed is the machine's to report and not this screen's to assume."
                label="Removing, and removed"
                number="23"
            >
                <RigPluginCatalogPage
                    entries={entries.map((entry, index) =>
                        index === 0
                            ? { ...entry, removal: { kind: "working" as const } }
                            : index === 1
                              ? {
                                    ...entry,
                                    removal: {
                                        kind: "removed" as const,
                                        message: "Rig kept what this plugin had written.",
                                    },
                                }
                              : entry,
                    )}
                    manage={management()}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The machine refused to remove one package. It is still installed, still says so, and the card carries the refusal without any other card moving."
                label="Not removed"
                number="24"
            >
                <RigPluginCatalogPage
                    entries={entries.map((entry, index) =>
                        index === 0
                            ? {
                                  ...entry,
                                  removal: {
                                      kind: "failed" as const,
                                      message:
                                          "Rig could not stop this plugin's process, so it left the installation exactly as it was.",
                                      title: "This machine did not remove it",
                                  },
                              }
                            : entry,
                    )}
                    manage={management()}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="What the machine said about the last install, reported on the catalog it is about rather than in the dialog that asked for it. Rig names the outcome after the fact — installed, replaced by a newer version, put back to an older one — because nothing here can know it in advance."
                label="Installed"
                number="25"
            >
                <RigPluginCatalogPage
                    entries={entries}
                    manage={management({
                        kind: "installed",
                        message:
                            "Rig replaced the copy on this machine with version 2.4.0 from /Users/steve/plugins/cartographer.",
                        title: "Updated Cartographer",
                    })}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="A package's own page on a surface that can change it. Updating is offered as installing the folder it came from — the only truthful way to put it, because nothing reports that an update exists — and removing is the one destructive control, kept apart from it."
                label="A package's page, changeable"
                number="26"
            >
                <OpenedCatalog manage />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="The flow driven end to end against a machine that always agrees, after a beat. Install, watch the dialog go inert while the request is out, read the answer on the catalog; remove a package, watch its card mark itself and then leave when the reading drops it."
                label="Driven"
                number="27"
            >
                <LiveCatalog />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
