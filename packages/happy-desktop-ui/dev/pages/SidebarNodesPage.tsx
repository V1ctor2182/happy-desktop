import { Sidebar } from "../../src/Sidebar";
import { SidebarNodes, type SidebarNode } from "../../src/SidebarNodes";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-249";

const NODES: readonly SidebarNode[] = [
    { detail: "10.0.0.4:4919", id: "one", label: "workshop", state: "connected" },
    { detail: "10.0.0.9:4919", id: "two", label: "builder", state: "connecting" },
    { id: "three", label: "attic.local:4919", state: "error" },
    { id: "four", label: "shed.local:4919", state: "disconnected" },
];

export function SidebarNodesPage() {
    return (
        <ComponentPage
            contract="Props only"
            number={componentNumber}
            summary="The machines this Rig is peered with that this window has no connection to, reported in the sidebar rather than offered as navigation. The rows keep the column's 32px rhythm and 10px inset but carry no hover, no press, and no pointer: there is nothing behind them to open. A node the window did reach is a section of its own, with that machine's projects under its own name."
            title="Sidebar nodes"
        >
            <Specimen
                detail="Each row is a list item, not a button. The name leads, the address follows when the node has identified itself by a different name, and the shared peer marker closes the row."
                label="Every state"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                        style={{
                            background: "var(--groupped-background)",
                            padding: "8px",
                            width: "280px",
                        }}
                    >
                        <SidebarNodes label="Nodes" nodes={NODES} />
                    </div>
                    <DimensionRule label="row 32 px · inset 10 · glyph lane 20 · gap 8 · label 13/16" />
                </div>
            </Specimen>

            <Specimen
                detail="A node nobody can reach dims the whole row. The marker beside it already carries the fault, so the row does not restate it in words."
                label="Unreachable and idle"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                        style={{
                            background: "var(--groupped-background)",
                            padding: "8px",
                            width: "280px",
                        }}
                    >
                        <SidebarNodes
                            label="Nodes"
                            nodes={NODES.filter(
                                (node) => node.state === "error" || node.state === "disconnected",
                            )}
                        />
                    </div>
                    <DimensionRule label="opacity 0.6 · no second fault glyph" />
                </div>
            </Specimen>

            <Specimen
                detail="A window with both: one node it reached, listed as an ordinary section with that machine's own projects under its own name, and beneath it the machines it has no connection to, which are status and nothing more."
                label="Beside a node that was reached"
                number="03"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                        style={{
                            border: "1px solid var(--divider)",
                            display: "flex",
                            height: "360px",
                            overflow: "hidden",
                            width: "max-content",
                        }}
                    >
                        <Sidebar
                            activeItemId="happy2"
                            onItemSelect={() => {}}
                            sections={[
                                {
                                    id: "rig:local",
                                    items: [
                                        {
                                            id: "happy2",
                                            initials: "H",
                                            kind: "project",
                                            label: "happy2",
                                        },
                                        { id: "rig", initials: "R", kind: "project", label: "rig" },
                                    ],
                                    label: "This Mac",
                                    status: "connected",
                                },
                                {
                                    id: "rig:node-workshop",
                                    items: [
                                        {
                                            id: "renderer",
                                            initials: "R",
                                            kind: "project",
                                            label: "renderer",
                                        },
                                    ],
                                    label: "workshop",
                                    status: "connected",
                                },
                                {
                                    id: "rig-nodes",
                                    items: [],
                                    label: "Nodes",
                                    nodes: NODES.filter((node) => node.label !== "workshop"),
                                },
                            ]}
                            title="Peers"
                        />
                    </div>
                    <DimensionRule label="a reached node is an ordinary section · the rest are status only" />
                </div>
            </Specimen>

            <Specimen
                detail="A Rig peered with nothing states nothing: the section is dropped by its caller rather than shown empty, so a window on a machine that does not peer looks as it always did."
                label="Peered with nothing"
                number="04"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                        style={{
                            border: "1px solid var(--divider)",
                            display: "flex",
                            height: "220px",
                            overflow: "hidden",
                            width: "max-content",
                        }}
                    >
                        <Sidebar
                            activeItemId="happy2"
                            onItemSelect={() => {}}
                            sections={[
                                {
                                    id: "rig:local",
                                    items: [
                                        {
                                            id: "happy2",
                                            initials: "H",
                                            kind: "project",
                                            label: "happy2",
                                        },
                                    ],
                                    label: "This Mac",
                                    status: "connected",
                                },
                            ]}
                            title="Peers"
                        />
                    </div>
                    <DimensionRule label="no Nodes heading · no empty block" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
