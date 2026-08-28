import type { HappySocialJoinProps, HappySocialJoinState } from "../../src";
import { HappySocialJoin } from "../../src/pages/settings/HappySocialJoin";
import { HappySocialSetupModal } from "../../src/pages/settings/HappySocialSetupModal";
import {
    happySocialJoinDescription,
    happySocialJoinPresentation,
    happySocialJoinTitle,
} from "../../src/pages/settings/HappySocialJoin";
import { ComponentPage, FullScreenSpecimen } from "../kit";

export const componentNumber = "C-275";

const noop = () => undefined;

const actions: Omit<HappySocialJoinProps, "state"> = {
    onAccountConnect: noop,
    onAcknowledgementChange: noop,
    onConfirmationChange: noop,
    onConfirmationSubmit: noop,
    onPasswordChange: noop,
    onPasswordSubmit: noop,
    onRestorePasswordChange: noop,
    onRestoreSecretChange: noop,
    onRestoreSubmit: noop,
    onSecretSubmit: noop,
    onUsernameChange: noop,
    onUsernameSubmit: noop,
    onVaultDeleteCancel: noop,
    onVaultDeleteConfirmationChange: noop,
    onVaultDeleteOpen: noop,
    onVaultDeleteSubmit: noop,
};

/**
 * The flow is only ever seen on its own modal, so every specimen is that modal
 * with the step's state in it. Motion is settled for deterministic capture.
 */
function Step(props: { readonly state: HappySocialJoinState }) {
    return (
        <div
            style={{
                height: "100%",
                position: "relative",
                transform: "translateZ(0)",
                width: "100%",
            }}
        >
            <HappySocialSetupModal
                appearance="system"
                description={happySocialJoinDescription(props.state)}
                motion="settled"
                onClose={noop}
                presentation={happySocialJoinPresentation(props.state)}
                title={happySocialJoinTitle(props.state)}
            >
                <HappySocialJoin {...actions} state={props.state} />
            </HappySocialSetupModal>
        </div>
    );
}

export function HappySocialJoinPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="The ordered errand that takes a Happy Social account from signed out to live: sign in, claim a username, create or restore the encryption keys, then wait for the connection to open. One `state` value chooses the screen; the surface decides nothing."
            title="Happy Social join"
        >
            <FullScreenSpecimen
                detail="1024 × 704 · reading the account · one continuous indeterminate bar on the setup sky"
                label="Checking account"
                number="JN-00"
            >
                <Step state={{ step: "checking" }} />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 1 · the browser owns the sign-in"
                label="Sign in"
                number="JN-01"
            >
                <Step state={{ awaitingBrowser: false, starting: false, step: "account" }} />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 1 · the browser came back with nothing · the pitch gives the stage back and the step reports the problem the way every other step does"
                label="Sign in — did not finish"
                number="JN-02"
            >
                <Step
                    state={{
                        awaitingBrowser: true,
                        error: "The browser closed before sign-in finished.",
                        starting: false,
                        step: "account",
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 2 · the one choice that cannot be changed later"
                label="Choose a username"
                number="JN-03"
            >
                <Step state={{ step: "username", submitting: false, username: "steve" }} />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 2 · the name is taken"
                label="Choose a username — rejected"
                number="JN-04"
            >
                <Step
                    state={{
                        error: "That username is already taken.",
                        step: "username",
                        submitting: false,
                        username: "steve",
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 3a · rules answer what was typed, they do not scold"
                label="Account password — unmet rules"
                number="JN-05"
            >
                <Step
                    state={{
                        password: "abc",
                        rules: [
                            { id: "length", satisfied: false },
                            { id: "variety", satisfied: false },
                        ],
                        satisfied: false,
                        step: "password",
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 3a · every rule met"
                label="Account password — accepted"
                number="JN-06"
            >
                <Step
                    state={{
                        password: "correct horse battery",
                        rules: [
                            { id: "length", satisfied: true },
                            { id: "variety", satisfied: true },
                        ],
                        satisfied: true,
                        step: "password",
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 3b · the derivation runs while this is typed"
                label="Confirm the password"
                number="JN-07"
            >
                <Step state={{ confirmation: "correct horse batery", step: "confirmation" }} />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 3b · the two do not match"
                label="Confirm the password — mismatch"
                number="JN-08"
            >
                <Step
                    state={{
                        confirmation: "correct horse batery",
                        error: "Those passwords are not the same.",
                        step: "confirmation",
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 3c · the generated factor, shown once"
                label="Save the secret key"
                number="JN-09"
            >
                <Step
                    state={{
                        acknowledged: false,
                        saving: false,
                        secret: "H1-4K2QW-9XZTM-7NPDV-3JHRB-8CFGL2",
                        step: "secret",
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 3c · acknowledged, enrolling the bundle"
                label="Save the secret key — saving"
                number="JN-10"
            >
                <Step
                    state={{
                        acknowledged: true,
                        saving: true,
                        secret: "H1-4K2QW-9XZTM-7NPDV-3JHRB-8CFGL2",
                        step: "secret",
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 3 · the same account on a second machine"
                label="Restore on this machine"
                number="JN-11"
            >
                <Step
                    state={{
                        password: "",
                        secret: "H1-4K2QW-9XZTM-7NPDV-3JHRB-8CFGL2",
                        step: "restore",
                        submitting: false,
                        valid: true,
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · the way out of a vault nobody can open · the phrase must be typed exactly"
                label="Delete the vault"
                number="JN-11a"
            >
                <Step
                    state={{
                        confirmation: "YES DELETE MY",
                        step: "vault-delete",
                        submitting: false,
                        valid: false,
                    }}
                />
            </FullScreenSpecimen>
            <FullScreenSpecimen
                detail="1024 × 704 · step 4 · the modal closes itself once the last stage begins"
                label="Setting up"
                number="JN-12"
            >
                <Step
                    state={{
                        stages: [
                            { id: "account", state: "done" },
                            { id: "username", state: "done" },
                            { id: "keys", state: "done" },
                            { id: "network", state: "active" },
                        ],
                        step: "connecting",
                    }}
                />
            </FullScreenSpecimen>
        </ComponentPage>
    );
}
