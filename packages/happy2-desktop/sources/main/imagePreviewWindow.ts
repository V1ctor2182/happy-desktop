import type { DesktopImagePreview } from "../shared/desktopContract";

/** The one route a picture window may ever be pointed at. */
const MEDIA_ROUTE = "/workspace-file-media";
/** Longer than any workspace path worth putting in a window title. */
const PATH_MAX = 1024;

/**
 * Whether an address is one this process is allowed to point a privileged window
 * at.
 *
 * The renderer names the picture, and the renderer is where a page could one day
 * name something else, so the address is checked against the Rig proxies this
 * process is actually running rather than trusted. It must be the media route on
 * one of those proxies exactly — not merely something under the capability
 * prefix, because everything else under it is an API this window has no reason
 * to load and no business authenticating to. Credentials in the address are
 * refused outright: an address that carries a login is not one of ours.
 */
export function imagePreviewAddressAllowed(
    candidate: string,
    bases: readonly (string | undefined)[],
): boolean {
    let address: URL;
    try {
        address = new URL(candidate);
    } catch {
        return false;
    }
    if (address.protocol !== "http:") return false;
    if (address.username !== "" || address.password !== "") return false;
    return bases.some((base) => {
        if (!base) return false;
        let root: URL;
        try {
            root = new URL(base);
        } catch {
            return false;
        }
        if (root.origin !== address.origin) return false;
        const prefix = root.pathname.replace(/\/$/, "");
        return prefix !== "" && address.pathname === `${prefix}${MEDIA_ROUTE}`;
    });
}

/**
 * The picture a request is for, or nothing when it is not one this process will
 * open a window onto.
 *
 * A request is only the address, and the file it names is read back out of that
 * address rather than accepted alongside it. The window's title is then the
 * picture it is actually showing by construction, instead of a second, separately
 * supplied claim about it that could disagree.
 */
export function imagePreviewResolve(
    raw: unknown,
    bases: readonly (string | undefined)[],
): DesktopImagePreview | undefined {
    if (typeof raw !== "string" || raw === "") return undefined;
    if (!imagePreviewAddressAllowed(raw, bases)) return undefined;
    const path = new URL(raw).searchParams.get("path");
    if (path === null || path === "" || path.length > PATH_MAX) return undefined;
    // A control character in a window title is exactly the sort of thing a title
    // taken from a file name has to refuse.
    if (/[\p{Cc}\p{Cf}]/u.test(path)) return undefined;
    return { url: raw, path };
}

/** What the preview window calls itself: the file's own name. */
export function imagePreviewTitle(path: string): string {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return name === "" ? path : name;
}

/**
 * Whether the picture window may go to an address. It may go exactly one place:
 * the document it was opened with. A picture has no links in it, so any
 * navigation at all is something other than looking at the picture — and this
 * window carries a preload, so where it may go is a security question rather
 * than a question of behaviour.
 */
export function imagePreviewNavigationAllowed(candidate: string, document: string): boolean {
    try {
        const to = new URL(candidate);
        const here = new URL(document);
        return (
            to.protocol === here.protocol &&
            to.host === here.host &&
            to.pathname === here.pathname &&
            to.search === here.search
        );
    } catch {
        return false;
    }
}
