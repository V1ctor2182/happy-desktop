import { Button } from "../../src/Button";
import { HappySocialSetupModal } from "../../src/pages/settings/HappySocialSetupModal";
import { ComponentPage, FullScreenSpecimen } from "../kit";

export const componentNumber = "C-268";

function ModalFrame(props: { mode: "join" | "enrollment" }) {
    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                transform: "translateZ(0)",
            }}
        >
            <HappySocialSetupModal
                appearance="system"
                description={
                    props.mode === "join"
                        ? "Connect this Happy Agent to carry your identity and encrypted Cloud data."
                        : "Choose the public username people will use to find you."
                }
                motion="settled"
                onClose={() => {}}
                status={props.mode === "join" ? "disconnected" : "required"}
                title={props.mode === "join" ? "Join Happy Social" : "Continue enrollment"}
            >
                <Button size="large">{props.mode === "join" ? "Connect" : "Continue"}</Button>
            </HappySocialSetupModal>
        </div>
    );
}

export function HappySocialSetupModalPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="A full-window Happy Social setup surface launched from Settings: onboarding sky, centred flow content, and one explicit close control. The live surface enters and exits through the bottom edge."
            title="Happy Social setup modal"
        >
            <FullScreenSpecimen
                detail="1024 × 704 · onboarding sky · top-right close · settled motion"
                label="Join Happy Social"
                number="HS-01"
            >
                <ModalFrame mode="join" />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · connected account needs a public username"
                label="Continue enrollment"
                number="HS-02"
            >
                <ModalFrame mode="enrollment" />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
