import { ConversationSettingsModal } from "../../src/ConversationSettingsModal";
import { RigSessionControls } from "../../src/RigSessionControls";
import { ComponentPage, Specimen } from "../kit";
import { rigMenus } from "./rigChatFixtures";

export function ConversationSettingsModalPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-159"
            summary="The per-conversation settings dialog: transcript view toggles, the two replaceable panels, and an owner-supplied slot for the session's own access and speed pickers."
            title="ConversationSettingsModal"
        >
            <Specimen
                detail="every group present, with the local session access and speed pickers"
                label="Primary"
                number="01"
                stage="app"
            >
                <div style={{ width: "980px", height: "620px", display: "flex" }}>
                    <ConversationSettingsModal
                        activityOpen={false}
                        compactTurns
                        controls={
                            <RigSessionControls
                                fields={["permission", "tier"]}
                                menus={rigMenus}
                                onEffortChange={() => undefined}
                                onModelChange={() => undefined}
                                onPermissionModeChange={() => undefined}
                                onServiceTierChange={() => undefined}
                            />
                        }
                        onActivityOpenChange={() => undefined}
                        onClose={() => undefined}
                        onCompactTurnsChange={() => undefined}
                        onShowReasoningChange={() => undefined}
                        onUsageOpenChange={() => undefined}
                        showReasoning
                        usageOpen={false}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="a session with no pickers yet: only the view toggles and panels"
                label="Without session controls"
                number="02"
                stage="app"
            >
                <div style={{ width: "980px", height: "540px", display: "flex" }}>
                    <ConversationSettingsModal
                        activityOpen
                        compactTurns={false}
                        onActivityOpenChange={() => undefined}
                        onClose={() => undefined}
                        onCompactTurnsChange={() => undefined}
                        onShowReasoningChange={() => undefined}
                        onUsageOpenChange={() => undefined}
                        showReasoning={false}
                        usageOpen={false}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
