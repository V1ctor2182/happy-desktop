import { RigFileMention } from "../../src/RigFileMention";
import { ComponentPage, Specimen } from "../kit";

const files = [
    { fileName: "rigChatStore.ts", path: "packages/happy2-state/src/rig/rigChatStore.ts" },
    { fileName: "RigChatView.tsx", path: "packages/happy2-ui/src/RigChatView.tsx" },
    { fileName: "AppRigView.tsx", path: "packages/happy2-app/src/AppRigView.tsx" },
];

export function RigFileMentionPage() {
    return (
        <ComponentPage
            number="C-155"
            summary="Rig composer @-mention autocomplete: a pure list of workspace file candidates; choosing one inserts @path into the draft."
            title="RigFileMention"
        >
            <Specimen
                detail="candidate files for an active @-mention query"
                label="Candidates"
                number="01"
                stage="surface"
            >
                <div style={{ width: "520px" }}>
                    <RigFileMention files={files} onSelect={() => undefined} query="rig" />
                </div>
            </Specimen>

            <Specimen detail="no files match the query" label="Empty" number="02" stage="surface">
                <div style={{ width: "520px" }}>
                    <RigFileMention files={[]} onSelect={() => undefined} query="zzz" />
                </div>
            </Specimen>
        </ComponentPage>
    );
}
