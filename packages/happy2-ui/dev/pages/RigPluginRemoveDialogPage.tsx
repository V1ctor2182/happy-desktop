import { type ReactNode } from "react";
import { RigPluginRemoveDialog } from "../../src/RigPluginRemoveDialog";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

function log(message: string) {
    console.info(`[blueprint] RigPluginRemoveDialog: ${message}`);
}

/* The overlay is `position: fixed`; a transformed wrapper bounds it to the
   specimen instead of letting it escape to the viewport. */
function WindowFrame(props: { children: ReactNode; height?: number }) {
    return (
        <div
            style={{
                position: "relative",
                width: "720px",
                height: `${String(props.height ?? 380)}px`,
                overflow: "hidden",
                transform: "translateZ(0)",
                borderRadius: "8px",
                border: "1px solid var(--surface-pressed-overlay)",
                background: "var(--groupped-background)",
            }}
        >
            {props.children}
        </div>
    );
}

const LONG_FOLDER =
    "/Users/steve/Library/Application Support/Happy/rig/plugins/experimental-inventory-surface-with-a-very-long-folder-name";

export function RigPluginRemoveDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-244"
            summary="Confirming that one installed package is to go. It names exactly one package, by the name a reader knows it under and the folder the machine knows it by, and it says the part a person bracing for a destructive confirmation would get wrong: Rig deletes the code it manages and keeps whatever the plugin wrote."
            title="RigPluginRemoveDialog"
        >
            <Specimen
                detail="small 360px danger modal · the package named twice, once each way · the data folder called out as kept"
                label="Confirmation"
                number="01"
                stage="app"
            >
                <WindowFrame>
                    <RigPluginRemoveDialog
                        folder="weather"
                        name="Weather"
                        onCancel={() => log("cancel")}
                        onConfirm={() => log("confirm")}
                        version="1.4.0"
                    />
                </WindowFrame>
                <DimensionRule label="modal small 360px" />
            </Specimen>

            <Specimen
                detail="a package the machine reported no version for, which changes only the sentence and never the target"
                label="No version"
                number="02"
                stage="app"
            >
                <WindowFrame>
                    <RigPluginRemoveDialog
                        folder="linked-tools"
                        name="Linked Tools"
                        onCancel={() => log("cancel")}
                        onConfirm={() => log("confirm")}
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="the request is with the machine: no cancel, no close, no dismissal — stopping an uninstall halfway is not something anything can offer"
                label="Working"
                number="03"
                stage="app"
            >
                <WindowFrame>
                    <RigPluginRemoveDialog
                        folder="weather"
                        name="Weather"
                        onConfirm={() => log("confirm")}
                        version="1.4.0"
                        working
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="the machine refused. The package is still installed, the confirmation is still about it, and pressing again asks again."
                label="Refused"
                number="04"
                stage="app"
            >
                <WindowFrame height={500}>
                    <RigPluginRemoveDialog
                        failure={{
                            message:
                                "Rig could not stop this plugin's process, so it left the installation exactly as it was.",
                            title: "This machine did not remove it",
                        }}
                        folder="weather"
                        name="Weather"
                        onCancel={() => log("cancel")}
                        onConfirm={() => log("confirm")}
                        version="1.4.0"
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="a folder long enough to have no break in it, wrapped inside the 360px card rather than widening it"
                label="Unbroken folder"
                number="05"
                stage="app"
            >
                <WindowFrame height={500}>
                    <RigPluginRemoveDialog
                        folder={LONG_FOLDER}
                        name="Experimental inventory surface"
                        onCancel={() => log("cancel")}
                        onConfirm={() => log("confirm")}
                        version="0.0.1-canary.20260731"
                    />
                </WindowFrame>
            </Specimen>
        </ComponentPage>
    );
}
