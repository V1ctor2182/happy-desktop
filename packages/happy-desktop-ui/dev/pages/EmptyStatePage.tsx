import { EmptyState } from "../../src/EmptyState";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-024";

const noop = () => {};

const panelStage: Record<string, string> = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    width: "440px",
};

export function EmptyStatePage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="Centered icon medallion + title + description + action. Panel fills and vertically centers its host region; inline is a compact content-sized block. Replaces the app's raw .feature-empty."
            title="Empty state"
        >
            <div className="specimen-grid">
                <Specimen
                    detail="panel · 48px medallion · title 15/20 · description 13/18 · medium action"
                    label="Panel — full"
                    number="E-01"
                    stage="app"
                >
                    <div style={panelStage}>
                        <div style={{ width: "440px", height: "320px" }}>
                            <EmptyState
                                action={{
                                    icon: "edit",
                                    label: "Start a conversation",
                                    onClick: noop,
                                }}
                                description="Messages you send and receive will show up here."
                                icon="inbox"
                                size="panel"
                                title="No messages yet"
                            />
                        </div>
                        <DimensionRule label="440 × 320 host · content vertically centered" />
                    </div>
                </Specimen>

                <Specimen
                    detail="panel · icon + title only (no description, no action)"
                    label="Panel — minimal"
                    number="E-02"
                    stage="app"
                >
                    <div style={panelStage}>
                        <div style={{ width: "440px", height: "320px" }}>
                            <EmptyState icon="search" size="panel" title="No results found" />
                        </div>
                        <DimensionRule label="medallion 48 · title only" />
                    </div>
                </Specimen>

                <Specimen
                    detail="panel · animated scene · secondary action + ghost second action, 8px apart"
                    label="Panel — two actions"
                    number="E-05"
                    stage="app"
                >
                    <div style={panelStage}>
                        <div style={{ width: "440px", height: "400px" }}>
                            <EmptyState
                                action={{ icon: "plus", label: "New session", onClick: noop }}
                                animation="robot"
                                animationPlay="on-demand"
                                description="Hosted release signing is a workspace of nomi: its own branch, checked out at ~/Happy/Workspaces/nomi/hosted-release-signing. It has no uncommitted changes. Send a message below to start working here."
                                icon="chat"
                                secondaryAction={{
                                    icon: "archive",
                                    label: "Archive workspace",
                                    onClick: noop,
                                }}
                                size="panel"
                                title="No sessions in this workspace yet"
                            />
                        </div>
                        <DimensionRule label="440 × 400 host · scene 128 · two 36px actions with 8px gap" />
                    </div>
                </Specimen>
            </div>

            <div className="specimen-grid">
                <Specimen
                    detail="inline · 40px medallion · title 14/18 · small action"
                    label="Inline — full"
                    number="E-03"
                    stage="surface"
                >
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <EmptyState
                            action={{ icon: "plus", label: "New subchannel", onClick: noop }}
                            description="Create a subchannel to keep focused work here."
                            icon="branch"
                            size="inline"
                            title="No subchannels"
                        />
                        <DimensionRule label="content-sized · 24px padding" />
                    </div>
                </Specimen>

                <Specimen
                    detail="inline · description, no action"
                    label="Inline — no action"
                    number="E-04"
                    stage="surface"
                >
                    <EmptyState
                        description="Files shared in this channel will appear here."
                        icon="files"
                        size="inline"
                        title="No files shared"
                    />
                </Specimen>
            </div>
        </ComponentPage>
    );
}
