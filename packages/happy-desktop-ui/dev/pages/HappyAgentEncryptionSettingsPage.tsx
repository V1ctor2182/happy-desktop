import { HappyAgentEncryptionSettings } from "../../src/pages/settings/HappyAgentEncryptionSettings";
import { ComponentPage, Specimen } from "../kit";

/** The component plan this page documents. The selector and the page header read the same value. */
export const componentNumber = "C-279";

const IDENTITY_KEY = "TTYFvS8PBRw760IXOVgI24YAx8qiV9Zxmb9HdZ5F2Ss";
const SECRET = "H1-4K2QW-9XZTM-7NPDV-3JHRB-8CFGL2";

const noop = () => undefined;

export function HappyAgentEncryptionSettingsPage() {
    return (
        <ComponentPage
            number={componentNumber}
            summary="What an account's synced data is locked with, and the one act available from here: reading back the secret key. The key is never on screen unasked — it is fetched when the reader asks, shown with a copy control, and put away again. Unfinished setup offers the way to resume it instead."
            title="Account encryption"
        >
            <Specimen
                detail="settled · the identity key is shown because it names the vault, the secret key is not because it opens it"
                label="Ready"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", width: "720px" }}>
                    <HappyAgentEncryptionSettings
                        encryption={{
                            identityKey: IDENTITY_KEY,
                            secret: { status: "hidden" },
                            status: "ready",
                        }}
                        onSecretHide={noop}
                        onSecretReveal={noop}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="asked for · the key sits in a monospaced block with its own copy control, and the button becomes the way to put it away"
                label="Secret key shown"
                number="02"
                stage="surface"
            >
                <div style={{ display: "flex", width: "720px" }}>
                    <HappyAgentEncryptionSettings
                        encryption={{
                            identityKey: IDENTITY_KEY,
                            secret: { secret: SECRET, status: "revealed" },
                            status: "ready",
                        }}
                        onSecretHide={noop}
                        onSecretReveal={noop}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="never set up, and locked on this machine · each says which act would settle it"
                label="Unfinished"
                number="03"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "24px",
                        width: "720px",
                    }}
                >
                    <HappyAgentEncryptionSettings
                        encryption={{ status: "create_required" }}
                        onKeysContinue={noop}
                    />
                    <HappyAgentEncryptionSettings
                        encryption={{ status: "restore_required" }}
                        onKeysContinue={noop}
                    />
                </div>
            </Specimen>

            <Specimen
                detail="a wait while the account decides, a wait while an unopenable bundle is cleared, and a key the daemon would not hand over"
                label="Waits and refusals"
                number="04"
                stage="surface"
            >
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "24px",
                        width: "720px",
                    }}
                >
                    <HappyAgentEncryptionSettings encryption={{ status: "checking" }} />
                    <HappyAgentEncryptionSettings encryption={{ status: "resetting" }} />
                    <HappyAgentEncryptionSettings
                        encryption={{
                            identityKey: IDENTITY_KEY,
                            secret: {
                                error: "This account's secret key was never stored on this machine.",
                                status: "failed",
                            },
                            status: "ready",
                        }}
                        onSecretHide={noop}
                        onSecretReveal={noop}
                    />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
