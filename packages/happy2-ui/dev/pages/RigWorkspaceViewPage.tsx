import { RigWorkspaceView } from "../../src/RigWorkspaceView";
import { ComponentPage, FullScreenSpecimen } from "../kit";
import { rigMenus, rigSessions, rigSessionsNow, rigTranscriptEntries } from "./rigChatFixtures";

const noop = () => undefined;

export function RigWorkspaceViewPage() {
    return (
        <ComponentPage
            number="C-155"
            summary="Top-level Rig workspace: AppShell with the session list as sidebar and the selected session's chat as the main surface (empty state when none)."
            title="RigWorkspaceView"
        >
            <FullScreenSpecimen
                detail="session selected → chat surface"
                label="Selected session"
                number="01"
            >
                <RigWorkspaceView
                    chat={{
                        elapsedMs: 42_000,
                        entries: rigTranscriptEntries,
                        menus: rigMenus,
                        onAbort: noop,
                        onAnswerInput: noop,
                        onEffortChange: noop,
                        onModelChange: noop,
                        onPermissionModeChange: noop,
                        onSend: noop,
                        onServiceTierChange: noop,
                        pendingUserInputs: [],
                        running: true,
                        subtitle: "~/happy2",
                        title: "Fix token rotation race",
                    }}
                    sessionList={{
                        now: rigSessionsNow,
                        onCreate: noop,
                        onSelect: noop,
                        selectedId: rigSessions[0]!.id,
                        sessions: rigSessions,
                    }}
                />
            </FullScreenSpecimen>

            <FullScreenSpecimen
                detail="nothing selected → empty state"
                label="No selection"
                number="02"
            >
                <RigWorkspaceView
                    sessionList={{
                        now: rigSessionsNow,
                        onCreate: noop,
                        onSelect: noop,
                        sessions: rigSessions,
                    }}
                />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
