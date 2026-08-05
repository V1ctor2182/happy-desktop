import { RigPeerStatus, type RigPeerState } from "../../src/RigPeerStatus";
import { Sidebar, type SidebarSection } from "../../src/Sidebar";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const STATES: readonly RigPeerState[] = [
    "connected",
    "connecting",
    "restricted",
    "disconnected",
    "error",
];

/** A heading per state, so the marker is compared in the place it actually sits. */
const HEADING_SECTIONS: readonly SidebarSection[] = STATES.map((state) => ({
    id: `rig:${state}`,
    items: [
        { id: `${state}-happy2`, initials: "H", kind: "project", label: "happy2" },
        { id: `${state}-rig`, initials: "R", kind: "project", label: "rig" },
    ],
    label: state === "error" ? "desk.local" : "This Mac",
    status: state,
}));

const NODE_SECTION: SidebarSection = {
    id: "rig-nodes",
    items: [],
    label: "Nodes",
    nodes: [
        { detail: "10.0.0.4:4919", id: "one", label: "workshop", state: "connected" },
        { detail: "10.0.0.9:4919", id: "two", label: "builder", state: "connecting" },
        { id: "three", label: "attic.local:4919", state: "error" },
    ],
};

export function RigPeerStatusPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-214"
            summary="One Rig's connection as the same marker everywhere it is shown: an 8px dot in the shared status colours, with the state's word beside it when the surface is about the connection itself. Static in every state, so a window holding several machines is still while they are being reached."
            title="Rig peer status"
        >
            <Specimen
                detail="dot 8px · connected fills green, connecting fills blue, restricted keeps the connected fill inside a ring because the link is genuinely up, disconnected is a hollow ring, error fills red"
                label="Marker — every state"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "24px" }}>
                        {STATES.map((state) => (
                            <RigPeerStatus key={state} name="desk.local" state={state} />
                        ))}
                    </div>
                    <DimensionRule label="dot 8px · radius pill · no motion in any state" />
                </div>
            </Specimen>

            <Specimen
                detail="The inline variant adds the state's own word, for a surface about the connection rather than the work in it. An unreachable machine is the only one whose word carries destructive ink."
                label="Inline — dot and word"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {STATES.map((state) => (
                            <RigPeerStatus
                                key={state}
                                name="desk.local"
                                state={state}
                                variant="inline"
                            />
                        ))}
                    </div>
                    <DimensionRule label="gap 6 · label 12/16 · 500" />
                </div>
            </Specimen>

            <Specimen
                detail="In a sidebar heading the marker sits immediately after the section name and never grows, so a heading that gains a status does not move the control at its trailing edge."
                label="In a sidebar section heading"
                number="03"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                        style={{
                            border: "1px solid var(--divider)",
                            display: "flex",
                            height: "460px",
                            overflow: "hidden",
                            width: "max-content",
                        }}
                    >
                        <Sidebar
                            activeItemId=""
                            onItemSelect={() => {}}
                            sections={[...HEADING_SECTIONS]}
                            title="Peers"
                        />
                    </div>
                    <DimensionRule label="heading 24 px · marker after the label · rows unchanged" />
                </div>
            </Specimen>

            <Specimen
                detail="The nodes this Rig is peered with, listed under the projects as a report rather than as navigation — see C-249. The block carries no project rows: a node's projects arrive on this Rig's own connection and are already listed above."
                label="Nodes block in the sidebar"
                number="04"
                stage="app"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div
                        style={{
                            border: "1px solid var(--divider)",
                            display: "flex",
                            height: "320px",
                            overflow: "hidden",
                            width: "max-content",
                        }}
                    >
                        <Sidebar
                            activeItemId=""
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
                                NODE_SECTION,
                            ]}
                            title="Peers"
                        />
                    </div>
                    <DimensionRule label="node rows 32 px · same marker as the headings above" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
