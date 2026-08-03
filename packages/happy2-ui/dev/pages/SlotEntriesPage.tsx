import { useState, type ReactNode } from "react";
import type { ComposerSnapshot } from "happy2-state";
import { composerStoreFixtureCreate } from "happy2-state/testing";
import { Button } from "../../src/Button";
import { ChannelHeader } from "../../src/ChannelHeader";
import { ComposerFooterBar, ConversationDock } from "../../src/ConversationDock";
import { ContextMeter } from "../../src/ContextMeter";
import { Sidebar } from "../../src/Sidebar";
import { SlotEntries, type SlotVisualEntry } from "../../src/SlotEntries";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

const noop = () => {};

const RELEASE: SlotVisualEntry = {
    id: "release",
    author: "Release agent",
    description: "Current release posture for this workspace.",
    purpose: "Keep operational context beside the conversation that needs it.",
    content: {
        type: "text",
        markdown: "Release is **clear** · [open checklist](https://example.com/checklist)",
    },
};

const REVIEW: SlotVisualEntry = {
    id: "review",
    author: "Review agent",
    description: "Opens the review dashboard the agent imported as a webapp.",
    purpose: "Make the next useful act available without adding permanent chrome.",
    content: { type: "button", label: "Open review dashboard", intent: "open" },
};

const HANDOFF: SlotVisualEntry = {
    id: "handoff",
    author: "Release agent",
    description: "Sends the prepared handoff summary into this chat.",
    purpose: "The summary is written; sending it should not need retyping.",
    content: { type: "button", label: "Send handoff summary", intent: "send" },
};

const DRAFT: SlotVisualEntry = {
    id: "draft",
    author: "Triage agent",
    description: "Writes the incident note into the on-call chat, unsent.",
    purpose: "A human decides when an incident note goes out.",
    content: { type: "button", label: "Draft incident note", intent: "draft" },
};

const START: SlotVisualEntry = {
    id: "start",
    author: "Planning agent",
    description: "Starts a chat on the migration plan with the model it needs.",
    purpose: "The next piece of work should begin from the plan, not from an empty box.",
    content: { type: "button", label: "Start migration chat", intent: "new-chat" },
};

const UNAVAILABLE: SlotVisualEntry = {
    id: "unavailable",
    author: "Metrics agent",
    description: "Opens the throughput dashboard.",
    purpose: "Watch the queue while the fix is being written.",
    disabled: true,
    disabledReason: "This Rig is not serving a webapp named “throughput”.",
    content: { type: "button", label: "Open throughput", intent: "open" },
};

const ANONYMOUS: SlotVisualEntry = {
    id: "anonymous",
    description: "",
    purpose: "",
    content: { type: "text", markdown: "Left by a session this window can no longer name." },
};

const LONG: SlotVisualEntry = {
    id: "long",
    author: "Migration agent",
    description:
        "Progress of the long-running schema migration, restated every time the job reports.",
    purpose: "The migration outlives the conversation that started it, so it states itself here.",
    content: {
        type: "text",
        markdown:
            "Schema migration `2026-08-02-sessions` is at **step 7 of 9** — backfilling session telemetry across 4.2M rows, currently 61% complete, with the index rebuild still to come. [Watch the job](https://example.com/jobs/2026-08-02-sessions).",
    },
};

const VERBOSE: SlotVisualEntry = {
    id: "verbose",
    author: "Metrics agent",
    description: "Opens the throughput dashboard for the workspace this chat belongs to.",
    purpose: "One label an agent wrote at length, to prove the lane cuts it rather than growing.",
    content: {
        type: "button",
        label: "Open the migration throughput dashboard for the current workspace",
        intent: "open",
    },
};

const PAIR: readonly SlotVisualEntry[] = [RELEASE, REVIEW];
const MANY: readonly SlotVisualEntry[] = [RELEASE, REVIEW, HANDOFF, DRAFT, START];
const MIXED: readonly SlotVisualEntry[] = [
    RELEASE,
    HANDOFF,
    UNAVAILABLE,
    ANONYMOUS,
    LONG,
    VERBOSE,
    START,
];

function column(gap: number, width?: number): Record<string, string> {
    return {
        display: "flex",
        flexDirection: "column",
        gap: `${gap}px`,
        ...(width === undefined ? {} : { width: `${width}px` }),
    };
}

function sessionControls(): ReactNode {
    return (
        <>
            <Button icon="shield" size="small" variant="ghost">
                Auto
            </Button>
            <Button icon="zap" size="small" variant="ghost">
                Standard
            </Button>
        </>
    );
}

/*
 * The real write end of a conversation, so a contribution above the composer is
 * measured inside the dock that insets it — the card has to line up with the
 * composer's own edges, not with the column they both sit in.
 */
const COMPOSER: ComposerSnapshot = composerStoreFixtureCreate("blueprint-slot-entries").getState();

function ComposerHost(props: { above?: ReactNode; status?: ReactNode; width: number }) {
    return (
        <div style={{ ...column(0, props.width), background: "var(--surface)" }}>
            <ConversationDock
                composer={COMPOSER}
                composerAboveControl={props.above}
                composerFooterControl={
                    <ComposerFooterBar
                        leading={
                            <>
                                {sessionControls()}
                                {props.status}
                            </>
                        }
                        trailing={<ContextMeter totalTokens={200000} usedTokens={48000} />}
                    />
                }
                composerPlaceholder="Message the agent…"
                onComposerSend={noop}
                onComposerValueChange={noop}
            />
        </div>
    );
}

function SidebarHost(props: { entries: readonly SlotVisualEntry[]; height: number }) {
    return (
        <div
            style={{
                border: "1px solid var(--divider)",
                display: "flex",
                height: `${props.height}px`,
                overflow: "hidden",
                width: "max-content",
            }}
        >
            <Sidebar
                actions={[
                    { icon: "inbox", id: "inbox", kind: "action", label: "Inbox" },
                    { icon: "doc", id: "notes", kind: "action", label: "Notes" },
                ]}
                activeItemId="happy2"
                bodyAccessory={
                    <SlotEntries entries={props.entries} onAction={noop} placement="sidebar" />
                }
                brand
                composeLabel="Create"
                onCompose={noop}
                onItemSelect={noop}
                sections={[
                    {
                        id: "projects",
                        items: [
                            { id: "happy2", kind: "project", label: "happy2" },
                            { depth: 1, id: "slots", kind: "workspace", label: "slot-rendering" },
                        ],
                        label: "Projects",
                    },
                ]}
            />
        </div>
    );
}

/** Contributions arriving and being withdrawn while the surface stays mounted. */
function LiveSpecimen() {
    const [entries, setEntries] = useState<readonly SlotVisualEntry[]>(PAIR);
    // Arrivals land ahead of what is already there — the hard case. A compact
    // placement has to keep showing the contribution being read, at its new
    // position, instead of whatever now happens to be first.
    const add = () => {
        const next = MANY.filter((entry) => !entries.some((current) => current.id === entry.id))[0];
        if (next) setEntries([next, ...entries]);
    };
    /** Withdrawn from the front too, so the reader's place has to move to stay put. */
    const remove = () => setEntries(entries.slice(1));
    return (
        <div style={column(12, 720)}>
            <div style={{ display: "flex", gap: "8px" }}>
                <Button
                    data-blueprint="slot-add"
                    icon="plus"
                    onClick={add}
                    size="small"
                    variant="secondary"
                >
                    Contribution arrives
                </Button>
                <Button
                    data-blueprint="slot-remove"
                    icon="close"
                    onClick={remove}
                    size="small"
                    variant="secondary"
                >
                    Contribution withdrawn
                </Button>
                <span style={{ alignSelf: "center", color: "var(--text-secondary)" }}>
                    {entries.length} in scope
                </span>
            </div>
            <ChannelHeader
                icon="home"
                title="happy2"
                titleAccessory={<SlotEntries entries={entries} onAction={noop} placement="title" />}
                topic="~/Developer/happy2"
            />
            <SlotEntries entries={entries} onAction={noop} placement="above-composer" />
        </div>
    );
}

export function SlotEntriesPage() {
    return (
        <ComponentPage
            number="C-176"
            summary="Agent-authored context in Happy's four durable contribution points, each designed for the chrome it sits in. The status line and the title carry one quiet line with an explicit switch; the composer strip is a bounded card of full rows; the sidebar is a menu in the list's own rhythm. Author, what, and why are always one press away."
            title="Slot entries"
        >
            <Specimen
                detail="One line beside the session controls · 280px cap · hover/focus reveals inspection · details open upward"
                label="Status line"
                number="01"
                stage="surface"
            >
                {/* The status line lives at the bottom of a window, so its details
                    open upward; the specimen leaves that room rather than clipping
                    the card it is meant to show. */}
                <div style={{ ...column(20), paddingTop: "160px" }}>
                    <ComposerHost
                        status={
                            <SlotEntries
                                entries={[RELEASE]}
                                onAction={noop}
                                placement="status-line"
                            />
                        }
                        width={640}
                    />
                    <DimensionRule label="one contribution · markdown link · inspection hidden until hover or focus" />
                    <ComposerHost
                        status={
                            <SlotEntries entries={MANY} onAction={noop} placement="status-line" />
                        }
                        width={640}
                    />
                    <DimensionRule label="five contributions · ‹ 1/5 › switch · position announced politely" />
                    <ComposerHost
                        status={
                            <SlotEntries entries={[LONG]} onAction={noop} placement="status-line" />
                        }
                        width={480}
                    />
                    <DimensionRule label="very long text · one line, ellipsised · composer geometry unchanged" />
                    <ComposerHost
                        status={
                            <SlotEntries
                                entries={[VERBOSE]}
                                onAction={noop}
                                placement="status-line"
                            />
                        }
                        width={480}
                    />
                    <DimensionRule label="an action with a long author-written label · control cut, not grown" />
                </div>
            </Specimen>
            <Specimen
                detail="Bounded card at the composer measure · every contribution in durable order · inline details"
                label="Above the composer"
                number="02"
                stage="surface"
            >
                <div style={column(20)}>
                    <ComposerHost
                        above={
                            <SlotEntries
                                entries={MIXED}
                                onAction={noop}
                                placement="above-composer"
                            />
                        }
                        width={720}
                    />
                    <DimensionRule label="176px maximum · scrolls · 8px clear of the composer" />
                    <ComposerHost
                        above={
                            <SlotEntries
                                entries={[REVIEW]}
                                onAction={noop}
                                placement="above-composer"
                            />
                        }
                        width={720}
                    />
                    <DimensionRule label="one action · intent glyph leads · label written by its author" />
                </div>
            </Specimen>
            <Specimen
                detail="Attached to the surface title across a hairline · fills the header's fixed lane · details open downward"
                label="Workspace title"
                number="03"
                stage="app"
            >
                <div style={column(16, 860)}>
                    <ChannelHeader
                        icon="home"
                        title="happy2"
                        titleAccessory={
                            <SlotEntries entries={[RELEASE]} onAction={noop} placement="title" />
                        }
                        topic="~/Developer/happy2"
                    />
                    <ChannelHeader
                        icon="hash"
                        title="slot-rendering-refine"
                        titleAccessory={
                            <SlotEntries entries={MANY} onAction={noop} placement="title" />
                        }
                        topic="~/Happy/Workspaces/happy2/slot-rendering-refine"
                    />
                    <ChannelHeader icon="home" title="no contributions here" topic="~/Developer" />
                    <DimensionRule label="the empty slot holds no lane open · switching never moves the title" />
                </div>
            </Specimen>
            <Specimen
                detail="Menu rows in the sidebar's rhythm · 32px rows · hover-revealed inspection · inline details"
                label="Sidebar menu"
                number="04"
                stage="app"
            >
                <div style={column(16)}>
                    <SidebarHost entries={MIXED} height={460} />
                    <DimensionRule label="heading names the authorship · long labels ellipsise · rows keep the 10px inset" />
                    <SidebarHost entries={[]} height={260} />
                    <DimensionRule label="nothing contributed · the accessory holds no lane open · the first section keeps its 2px" />
                </div>
            </Specimen>
            <Specimen
                detail="Arrival and withdrawal while mounted · no refresh control anywhere"
                label="Live changes"
                number="05"
                stage="surface"
            >
                <LiveSpecimen />
            </Specimen>
        </ComponentPage>
    );
}
