import { Button } from "../../src/Button";
import { EmptyState } from "../../src/EmptyState";
import { TabbedPane } from "../../src/TabbedPane";
import { type TabItem } from "../../src/Tabs";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const sessionTabs: TabItem[] = [
    { id: "one", label: "Refactor the router" },
    { id: "two", label: "Fix the flaky upload test", busy: true },
    { id: "three", label: "Untitled session" },
];

const longTabs: TabItem[] = [
    { id: "one", label: "Collapse the session list into one screen per folder" },
    { id: "two", label: "Address local sessions by URL through a cloud-shaped router" },
    { id: "three", label: "Rebuild the composer model control" },
    { id: "four", label: "Untitled session" },
];

function Body(props: { title: string }) {
    return (
        <EmptyState
            description="The active tab's content fills the rest of the pane."
            icon="chat"
            size="panel"
            title={props.title}
        />
    );
}

function Pane(props: {
    active: string;
    tabs: TabItem[];
    withAction?: boolean;
    withClose?: boolean;
    withReorder?: boolean;
}) {
    return (
        <div
            style={{
                border: "1px solid var(--divider)",
                display: "flex",
                height: "260px",
                width: "560px",
            }}
        >
            <TabbedPane
                actions={
                    props.withAction ? (
                        <Button
                            aria-label="New tab"
                            icon="plus"
                            iconOnly
                            onClick={() => {}}
                            size="small"
                            variant="ghost"
                        />
                    ) : undefined
                }
                activeId={props.active}
                closeLabel="Close session"
                onClose={props.withClose ? () => {} : undefined}
                onReorder={props.withReorder ? () => {} : undefined}
                onSelect={() => {}}
                tabs={props.tabs}
            >
                <Body title="Active tab body" />
            </TabbedPane>
        </div>
    );
}

export function TabbedPanePage() {
    return (
        <ComponentPage
            number="C-160"
            summary="A Tabs bar over a body that takes the remaining height — peer documents inside one surface, with optional trailing bar actions and truncating tab labels."
            title="Tabbed pane"
        >
            <div className="specimen-grid">
                <Specimen
                    detail="32px bar · body fills the rest"
                    label="Tabs over a body"
                    number="T-01"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Pane active="one" tabs={sessionTabs} />
                        <DimensionRule label="bar 32 · body flex 1 · min-height 0" />
                    </div>
                </Specimen>
                <Specimen
                    detail="trailing add-tab control on the bar hairline"
                    label="Bar actions"
                    number="T-02"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Pane active="two" tabs={sessionTabs} withAction />
                        <DimensionRule label="actions pad 0 8 · gap 4" />
                    </div>
                </Specimen>
                <Specimen
                    detail="the strip scrolls; actions stay pinned"
                    label="Many long tabs"
                    number="T-03"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Pane active="one" tabs={longTabs} withAction />
                        <DimensionRule label="tab max-width 200 · label ellipsis · strip scrolls" />
                    </div>
                </Specimen>
                <Specimen
                    detail="close shows on the active tab and on hover of any other"
                    label="Closable tabs"
                    number="T-04"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Pane active="two" tabs={sessionTabs} withAction withClose />
                        <DimensionRule label="close 16 × 16 · reserved box · opacity only" />
                    </div>
                </Specimen>
                <Specimen
                    detail="drag a tab to rearrange; neighbours slide, the drag reports once"
                    label="Draggable tabs"
                    number="T-05"
                    stage="app"
                >
                    <div style={{ padding: "24px" }}>
                        <Pane active="one" tabs={sessionTabs} withAction withClose withReorder />
                        <DimensionRule label="threshold 4 · shift = dragged width · ease 140ms" />
                    </div>
                </Specimen>
            </div>
        </ComponentPage>
    );
}
