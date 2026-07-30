import type { FileTreeGitStatus, FileTreeNode } from "./FileTree";

export interface FileTreeBuildEntry {
    readonly path: string;
    readonly gitStatus?: FileTreeGitStatus;
    readonly addedLines?: number;
    readonly deletedLines?: number;
}

/** The per-entry facts a node carries verbatim, whichever shape it is built into. */
function entryFacts(entry: FileTreeBuildEntry) {
    return {
        ...(entry.gitStatus ? { gitStatus: entry.gitStatus } : {}),
        ...(entry.addedLines === undefined ? {} : { addedLines: entry.addedLines }),
        ...(entry.deletedLines === undefined ? {} : { deletedLines: entry.deletedLines }),
    };
}

/**
 * Turns a flat list of repository-relative paths into `FileTree` nodes.
 *
 * Directories keep their full path as their id, matching the files beneath
 * them, so expansion state and selection are addressed the same way everywhere
 * — the panel never has to invent a second naming scheme for folders.
 *
 * A directory chain with nothing in it but one more directory is joined into a
 * single `a/b/c` row. A repository whose sources sit four levels down otherwise
 * opens as four rows of scaffolding before anything worth reading, and every one
 * of them has to be expanded by hand.
 */
export function fileTreeBuild(
    entries: readonly FileTreeBuildEntry[],
    expanded: ReadonlySet<string>,
): FileTreeNode[] {
    interface Directory {
        readonly children: Map<string, Directory>;
        readonly files: (FileTreeBuildEntry & { name: string })[];
    }
    const directoryCreate = (): Directory => ({ children: new Map(), files: [] });
    const root = directoryCreate();

    for (const entry of entries) {
        const segments = entry.path.split("/").filter((segment) => segment.length > 0);
        const name = segments.pop();
        if (name === undefined) continue;
        let directory = root;
        for (const segment of segments) {
            let child = directory.children.get(segment);
            if (!child) {
                child = directoryCreate();
                directory.children.set(segment, child);
            }
            directory = child;
        }
        directory.files.push({ ...entry, name });
    }

    const nodesOf = (directory: Directory, prefix: string): FileTreeNode[] => {
        const directories: FileTreeNode[] = [];
        for (const [segment, child] of directory.children) {
            let label = segment;
            let path = prefix ? `${prefix}/${segment}` : segment;
            let node = child;
            // Collapse the chain while this level holds exactly one directory
            // and no files of its own — there is nothing to choose between here.
            while (node.files.length === 0 && node.children.size === 1) {
                const [nextSegment, nextChild] = [...node.children][0]!;
                label = `${label}/${nextSegment}`;
                path = `${path}/${nextSegment}`;
                node = nextChild;
            }
            const open = expanded.has(path);
            directories.push({
                id: path,
                name: label,
                kind: "directory",
                expanded: open,
                // Children are built only for an open directory: the whole tree
                // is already in memory, but handing every unopened branch to the
                // renderer would build a repository's worth of rows nobody asked
                // to see.
                ...(open ? { children: nodesOf(node, path) } : {}),
            });
        }
        // Directories first, each group alphabetical — the shape people expect
        // from a file tree, and stable regardless of what order paths arrived in.
        directories.sort((left, right) => left.name.localeCompare(right.name));
        const files = [...directory.files]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((file) => ({
                id: file.path,
                name: file.name,
                kind: "file" as const,
                ...entryFacts(file),
            }));
        return [...directories, ...files];
    };

    return nodesOf(root, "");
}

/**
 * The same entries as one row per file.
 *
 * A flat listing is read by file name, so the name is the last segment and the
 * directory that holds it travels beside it as secondary text. Labelling the row
 * with the whole path instead put the only word being looked for at the far end
 * of the line, where it is the first thing an ellipsis eats.
 */
export function fileTreeFlatten(entries: readonly FileTreeBuildEntry[]): FileTreeNode[] {
    return entries.map((entry) => {
        const cut = entry.path.lastIndexOf("/");
        return {
            id: entry.path,
            name: cut === -1 ? entry.path : entry.path.slice(cut + 1),
            kind: "file" as const,
            ...(cut === -1 ? {} : { directory: entry.path.slice(0, cut) }),
            ...entryFacts(entry),
        };
    });
}
