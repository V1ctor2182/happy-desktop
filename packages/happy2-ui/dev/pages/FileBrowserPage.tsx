import { type ReactNode } from "react";
import { FileBrowser } from "../../src/FileBrowser";
import { fileTreeBuild, fileTreeFlatten, type FileTreeBuildEntry } from "../../src/fileTreeBuild";
import { ComponentPage, DimensionRule, Specimen } from "../kit";
const changed: FileTreeBuildEntry[] = [
    {
        path: "packages/happy2-ui/src/FileTree.tsx",
        gitStatus: "modified",
        addedLines: 148,
        deletedLines: 62,
    },
    {
        path: "packages/happy2-ui/src/styles/file-tree.css",
        gitStatus: "modified",
        addedLines: 96,
        deletedLines: 41,
    },
    {
        path: "packages/happy2-ui/src/FileBrowser.tsx",
        gitStatus: "added",
        addedLines: 157,
        deletedLines: 0,
    },
    {
        path: "packages/happy2-app/sources/AppRigView.tsx",
        gitStatus: "modified",
        addedLines: 24,
        deletedLines: 38,
    },
    { path: "packages/happy2-ui/src/assets/plugin.png", gitStatus: "added" },
    {
        path: "packages/happy2-ui/src/SegmentedControl.tsx",
        gitStatus: "deleted",
        addedLines: 0,
        deletedLines: 84,
    },
    {
        path: "docs/notes/file-viewer.md",
        gitStatus: "renamed",
        addedLines: 3,
        deletedLines: 1,
    },
    { path: ".env.local", gitStatus: "untracked", addedLines: 6, deletedLines: 0 },
];
const everything: FileTreeBuildEntry[] = [
    ...changed,
    { path: "packages/happy2-ui/src/Button.tsx" },
    { path: "packages/happy2-ui/src/theme.css" },
    { path: "packages/happy2-server/sources/index.ts" },
    { path: "scripts/release.sh" },
    { path: "assets/keys/deploy.pem" },
    { path: "media/intro.mp4" },
    { path: "media/theme.mp3" },
    { path: "vendor/toolchain.tar.gz" },
    { path: "package.json" },
    { path: "README.md" },
];
const totals = changed.reduce(
    (sum, entry) => ({
        added: sum.added + (entry.addedLines ?? 0),
        deleted: sum.deleted + (entry.deletedLines ?? 0),
    }),
    { added: 0, deleted: 0 },
);
function panelFrame(children: ReactNode, height = 480, width = 320) {
    return (
        <div
            style={{
                background: "var(--surface)",
                border: "1px solid var(--divider)",
                borderRadius: "10px",
                height: `${height}px`,
                overflow: "hidden",
                width: `${width}px`,
            }}
        >
            {children}
        </div>
    );
}
export function FileBrowserPage() {
    return (
        <ComponentPage
            number="C-168"
            summary="The file listing of a workspace panel: one 32px flat control row carrying the scope switch, the listing's own totals, and the layout switch, over a full-bleed FileTree scrollport with no rule between them."
            title="FileBrowser"
        >
            <Specimen
                detail="32px control row · flat controls · per-file diff stat"
                label="Changed files, flat"
                number="01"
                stage="surface"
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {panelFrame(
                        <FileBrowser
                            addedLines={totals.added}
                            count={changed.length}
                            deletedLines={totals.deleted}
                            layout="flat"
                            nodes={fileTreeFlatten(changed)}
                            scope="changed"
                            selectedId="packages/happy2-ui/src/FileTree.tsx"
                        />,
                    )}
                    <DimensionRule label="320 px panel · 32 px control row" />
                </div>
            </Specimen>

            <Specimen
                detail="Directories nest; the path travels with the name only when flat"
                label="Changed files, tree"
                number="02"
                stage="surface"
            >
                {panelFrame(
                    <FileBrowser
                        addedLines={totals.added}
                        count={changed.length}
                        deletedLines={totals.deleted}
                        layout="tree"
                        nodes={fileTreeBuild(
                            changed,
                            new Set([
                                "packages/happy2-ui/src",
                                "packages/happy2-ui/src/styles",
                                "packages/happy2-app/sources",
                                "docs/notes",
                            ]),
                        )}
                        scope="changed"
                    />,
                )}
            </Specimen>

            <Specimen
                detail="Whole checkout — a count, and no line totals to claim"
                label="All files"
                number="03"
                stage="surface"
            >
                {panelFrame(
                    <FileBrowser
                        count={everything.length}
                        layout="flat"
                        nodes={fileTreeFlatten(everything)}
                        note="Showing the first 20,000 files."
                        scope="all"
                    />,
                )}
            </Specimen>

            <Specimen
                detail="A narrow panel: the path elides in its middle, the name never does"
                label="Narrow"
                number="04"
                stage="surface"
            >
                {panelFrame(
                    <FileBrowser
                        addedLines={totals.added}
                        count={changed.length}
                        deletedLines={totals.deleted}
                        layout="flat"
                        nodes={fileTreeFlatten(changed)}
                        scope="changed"
                    />,
                    320,
                    250,
                )}
            </Specimen>

            <Specimen detail="Loading and empty" label="States" number="05" stage="surface">
                <div style={{ display: "flex", gap: "12px" }}>
                    {panelFrame(
                        <FileBrowser count={0} layout="flat" loading nodes={[]} scope="all" />,
                        260,
                    )}
                    {panelFrame(
                        <FileBrowser
                            count={0}
                            emptyLabel="No changed files."
                            layout="flat"
                            nodes={[]}
                            scope="changed"
                        />,
                        260,
                    )}
                </div>
            </Specimen>
        </ComponentPage>
    );
}
