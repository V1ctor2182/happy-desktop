import type { ClientWorkspace } from "happy2-state";
import type { FileTreeNode } from "./ChatPageComponents.js";
import { fileNameCompare } from "../../fileTreeSort.js";

/**
 * A node while it is still being assembled. A drawn node is readonly, because
 * the tree caches the row model it builds from one and a node that changes
 * underneath that cache is a listing that disagrees with itself; this builder
 * is the one writer, and it hands the finished tree over as readonly.
 */
type WorkspaceNodeDraft = {
    -readonly [Key in keyof FileTreeNode as Key extends "children"
        ? never
        : Key]: FileTreeNode[Key];
} & { children?: WorkspaceNodeDraft[] };

export function workspaceNodes(
    workspace: ClientWorkspace,
    expanded: ReadonlySet<string>,
    loading: ReadonlySet<string>,
): readonly FileTreeNode[] {
    const statusByPath = new Map(workspace.gitStatus.map((entry) => [entry.path, entry.status]));
    const incomplete = new Set(
        workspace.directories
            .filter((directory) => !directory.complete)
            .map((directory) => directory.directory),
    );
    const roots: WorkspaceNodeDraft[] = [];
    const directories = new Map<string, WorkspaceNodeDraft>();
    for (const path of workspace.paths) {
        const directory = path.endsWith("/");
        const segments = (directory ? path.slice(0, -1) : path).split("/");
        let siblings = roots;
        let prefix = "";
        segments.forEach((segment, index) => {
            if (index === segments.length - 1 && !directory) {
                const filePath = prefix + segment;
                siblings.push({
                    id: filePath,
                    name: segment,
                    kind: "file",
                    gitStatus: statusByPath.get(filePath),
                });
                return;
            }
            const directoryPath = `${prefix}${segment}/`;
            let node = directories.get(directoryPath);
            if (!node) {
                node = { id: directoryPath, name: segment, kind: "directory", children: [] };
                directories.set(directoryPath, node);
                siblings.push(node);
            }
            siblings = node.children!;
            prefix = directoryPath;
        });
    }
    for (const [path, node] of directories) {
        node.gitStatus = statusByPath.get(path);
        node.expanded = expanded.has(path);
        node.loading = loading.has(path);
        node.hasMore = incomplete.has(path);
    }
    const sort = (nodes: WorkspaceNodeDraft[]) => {
        // The same ordering the file browser lists a checkout in: directories
        // first, then names compared the way a person reads them, so `v2` comes
        // before `v10` and one listing never disagrees with the other.
        nodes.sort((left, right) =>
            left.kind === right.kind
                ? fileNameCompare(left.name, right.name)
                : left.kind === "directory"
                  ? -1
                  : 1,
        );
        for (const node of nodes) if (node.children) sort(node.children);
        return nodes;
    };
    return sort(roots);
}
