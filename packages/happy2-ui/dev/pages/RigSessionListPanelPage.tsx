import { RigSessionListPanel } from "../../src/RigSessionListPanel";
import { ComponentPage, Specimen } from "../kit";
import { rigSessions, rigSessionsNow } from "./rigChatFixtures";

export function RigSessionListPanelPage() {
    return (
        <ComponentPage
            number="C-153"
            summary="Flat chronological Rig session list: status dot, title/recap/id, dim cwd, relative time, and a selected row highlight."
            title="RigSessionListPanel"
        >
            <Specimen
                detail="three sessions, second selected, mixed status dots"
                label="Populated"
                number="01"
                stage="surface"
            >
                <div
                    style={{ width: "320px", height: "420px", border: "1px solid var(--divider)" }}
                >
                    <RigSessionListPanel
                        now={rigSessionsNow}
                        onCreate={() => undefined}
                        onSelect={() => undefined}
                        selectedId={rigSessions[1]!.id}
                        sessions={rigSessions}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="no sessions yet → empty state"
                label="Empty"
                number="02"
                stage="surface"
            >
                <div
                    style={{ width: "320px", height: "420px", border: "1px solid var(--divider)" }}
                >
                    <RigSessionListPanel
                        now={rigSessionsNow}
                        onCreate={() => undefined}
                        onSelect={() => undefined}
                        sessions={[]}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
