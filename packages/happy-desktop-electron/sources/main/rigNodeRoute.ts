/**
 * Where a machine the host Rig is peered with is addressed, for every bridge in
 * this process that serves the renderer.
 *
 * A node's work is reached over the same port and the same projected routes as
 * the host's, with only the base URL differing: `…/nodes/<id>` in front of an
 * otherwise ordinary path. Every bridge has to agree on that exactly — the
 * packaged loopback proxy, the Vite development bridge, and the terminal
 * bridge's own upgrade route — because the renderer builds one base URL and uses
 * it for requests and attachments alike, against whichever is running. Splitting
 * the rule out is what keeps a node reachable in `dev:web` and packaged alike
 * instead of only where someone remembered to implement it.
 */

/**
 * The identity Rig itself accepts for a peer, matched exactly as its daemon
 * does. A path segment that is not one of these names no machine, so it is
 * refused here rather than forwarded to the daemon to be refused there.
 */
export const RIG_NODE_ID = /^[a-z][a-z0-9]{1,31}$/u;

export interface RigNodeRoute {
    /** The peer the request is for, as the host published it. */
    readonly nodeId: string;
    /** The ordinary daemon path beneath the node's base, always rooted at `/`. */
    readonly path: string;
}

/** Splits `/nodes/<id>/rest` into the node it addresses and the path beneath it. */
export function rigNodeRouteMatch(path: string): RigNodeRoute | undefined {
    const prefix = "/nodes/";
    if (!path.startsWith(prefix)) return undefined;
    const remainder = path.slice(prefix.length);
    const separator = remainder.indexOf("/");
    const nodeId = separator < 0 ? remainder : remainder.slice(0, separator);
    if (!RIG_NODE_ID.test(nodeId)) return undefined;
    return { nodeId, path: separator < 0 ? "/" : remainder.slice(separator) };
}
