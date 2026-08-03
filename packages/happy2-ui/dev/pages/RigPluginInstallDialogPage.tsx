import { type ReactNode } from "react";
import { RigPluginInstallDialog } from "../../src/RigPluginInstallDialog";
import { ComponentPage, DimensionRule, Specimen } from "../kit";

function log(message: string) {
    console.info(`[blueprint] RigPluginInstallDialog: ${message}`);
}

/*
 * The overlay is `position: fixed`; a transformed wrapper establishes a
 * containing block so the specimen renders it inside a bounded, screenshot-safe
 * window frame instead of escaping to the viewport.
 */
function WindowFrame(props: { children: ReactNode; height?: number }) {
    return (
        <div
            style={{
                position: "relative",
                width: "720px",
                height: `${String(props.height ?? 420)}px`,
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
    "/Users/steve/Library/Application Support/Happy/workspaces/very-long-workspace-name/packages/happy2-plugin-experimental-inventory-surface";

export function RigPluginInstallDialogPage() {
    return (
        <ComponentPage
            contract="Props only"
            number="C-243"
            summary="Asking the machine running Rig to install the plugin in one folder on it. A folder is the whole request because it is the whole of what Rig accepts, and nothing here inspects what is typed: the machine holds the disk and the rule, and a folder that is wrong comes back as the machine's own sentence about it. The same dialog updates a package by installing the folder it came from; nothing claims an update is available, because nothing reports one."
            title="RigPluginInstallDialog"
        >
            <Specimen
                detail="medium 480px modal · one folder field, focused on open · the field's hint says what Rig does with the folder"
                label="Install"
                number="01"
                stage="app"
            >
                <WindowFrame>
                    <RigPluginInstallDialog
                        onClose={() => log("close")}
                        onSubmit={(source) => log(`submit ${source}`)}
                    />
                </WindowFrame>
                <DimensionRule label="modal medium 480px" />
            </Specimen>

            <Specimen
                detail="the machine offers its own folder chooser, so the field gains a second way in and stays the first"
                label="Install, with a chooser"
                number="02"
                stage="app"
            >
                <WindowFrame>
                    <RigPluginInstallDialog
                        onClose={() => log("close")}
                        onFolderPick={() => {
                            log("pick");
                            return Promise.resolve(LONG_FOLDER);
                        }}
                        onSubmit={(source) => log(`submit ${source}`)}
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="opened from a package: the same one operation, said in terms of what installing this folder would do to the copy that is here"
                label="Update a package"
                number="03"
                stage="app"
            >
                <WindowFrame height={480}>
                    <RigPluginInstallDialog
                        onClose={() => log("close")}
                        onSubmit={(source) => log(`submit ${source}`)}
                        subject="Weather"
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="the request is with the machine: no close, no backdrop dismissal, nothing to type, and no cancel — an install that has already replaced a package cannot be un-replaced"
                label="Working"
                number="04"
                stage="app"
            >
                <WindowFrame>
                    <RigPluginInstallDialog
                        onSubmit={(source) => log(`submit ${source}`)}
                        working
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="the machine refused, in the machine's own words, under the field they are about"
                label="Refused"
                number="05"
                stage="app"
            >
                <WindowFrame height={560}>
                    <RigPluginInstallDialog
                        failure={{
                            message:
                                "Rig could not read a happy.plugin.json in that folder, so there was nothing to install.",
                            title: "This machine did not install that folder",
                        }}
                        onClose={() => log("close")}
                        onSubmit={(source) => log(`submit ${source}`)}
                    />
                </WindowFrame>
            </Specimen>

            <Specimen
                detail="a refusal about a folder long enough to have no break in it, wrapped inside the card rather than widening it"
                label="Refused, unbroken folder"
                number="06"
                stage="app"
            >
                <WindowFrame height={620}>
                    <RigPluginInstallDialog
                        failure={{
                            message: `Rig found nothing to install at ${LONG_FOLDER}/candidate-folder-with-no-manifest-in-it.`,
                            title: "This machine did not install that folder",
                        }}
                        onClose={() => log("close")}
                        onSubmit={(source) => log(`submit ${source}`)}
                        subject="Experimental inventory surface"
                    />
                </WindowFrame>
            </Specimen>
        </ComponentPage>
    );
}
