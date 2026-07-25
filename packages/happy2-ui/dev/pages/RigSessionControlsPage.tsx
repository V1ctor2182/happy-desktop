import { RigControlMenu, RigSessionControls } from "../../src/RigSessionControls";
import { ComponentPage, Specimen } from "../kit";
import { rigMenus } from "./rigChatFixtures";

export function RigSessionControlsPage() {
    return (
        <ComponentPage
            number="C-151"
            summary="Rig session control bar: model / effort / permission / service-tier dropdowns built on Menu, driven by a RigMenusSnapshot."
            title="RigSessionControls"
        >
            <Specimen
                detail="four control menus with the current option check-marked"
                label="Control bar"
                number="01"
                stage="surface"
            >
                <div style={{ width: "620px", padding: "12px", background: "var(--surface)" }}>
                    <RigSessionControls
                        menus={rigMenus}
                        onEffortChange={() => undefined}
                        onModelChange={() => undefined}
                        onPermissionModeChange={() => undefined}
                        onServiceTierChange={() => undefined}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="one control opened to its Menu popover"
                label="Open control menu"
                number="02"
                stage="surface"
            >
                <div
                    style={{
                        width: "320px",
                        height: "220px",
                        padding: "12px",
                        background: "var(--surface)",
                    }}
                >
                    <RigControlMenu
                        items={[
                            {
                                kind: "item",
                                id: "medium",
                                label: "Medium (default)",
                                icon: "check",
                            },
                            { kind: "item", id: "high", label: "High" },
                        ]}
                        label="Effort"
                        onSelect={() => undefined}
                        value="Medium"
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
