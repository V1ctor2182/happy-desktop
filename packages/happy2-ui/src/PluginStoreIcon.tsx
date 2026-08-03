import { type CSSProperties } from "react";
import { type ToneName } from "./Avatar";
import { Icon, type IconName } from "./Icon";

/** Tile sizes: the card mark, the section mark, and the detail hero mark. */
export type PluginStoreIconSize = "sm" | "md" | "lg";

export interface PluginStoreIconProps {
    /**
     * The package's own artwork, when whatever owns the catalog has an address
     * for it. It takes the whole tile, so a mark with its own silhouette is not
     * boxed inside a coloured square.
     */
    artworkUrl?: string;
    /** The glyph drawn when there is no artwork, which is the usual case. */
    glyph: IconName;
    /** The tile colour. Pick it from the package's identity, not from its state. */
    tone?: ToneName;
    size?: PluginStoreIconSize;
    /** Names the mark for a reader who cannot see it; without one it is decorative. */
    "aria-label"?: string;
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
}

/** Glyph size per tile, leaving the ink inset on every size. */
const glyphSize = {
    sm: 18,
    md: 24,
    lg: 32,
} as const satisfies Record<PluginStoreIconSize, number>;

/**
 * The tones a package mark may take.
 *
 * They are the avatar's tones minus `slate` and `brand`, which are neutral and
 * would read as "this one has no identity", and minus `rose`, which sits close
 * enough to `ember` that two packages beside each other would look like the same
 * colour badly printed. Five tones a person can actually tell apart is worth
 * more here than eight that blur.
 */
const IDENTITY_TONES: readonly ToneName[] = ["violet", "ocean", "mint", "amber", "ember"];

/**
 * The tone a package wears, derived from whatever identifies it.
 *
 * A package has no colour of its own, and one picked at random would move every
 * time the catalog is read. This is FNV-1a over the identity — chosen over a
 * plain multiply-and-add because short, similar folder names spread across the
 * five tones instead of clumping onto two — so a package keeps its colour across
 * restarts, machines, and windows.
 */
export function pluginStoreTone(seed: string): ToneName {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
        hash ^= seed.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return IDENTITY_TONES[hash % IDENTITY_TONES.length]!;
}

/**
 * PluginStoreIcon — the graphic mark a plugin package is recognized by.
 *
 * It is a rounded square in the package's own colour with a glyph cut out of it,
 * the shape an application icon has everywhere else on this desktop, so a page
 * of packages reads as things you could have rather than as rows in a table.
 * Artwork replaces the whole tile when the catalog has any; until then the tone
 * carries the identity and the glyph carries the kind.
 *
 * The mark says nothing about state. A stopped package is not a grey package —
 * what it is doing is said in words beside it, and greying its mark would only
 * make a catalog of stopped packages unreadable.
 */
export function PluginStoreIcon(props: PluginStoreIconProps) {
    const size = props.size ?? "md";
    return (
        <span
            aria-hidden={props["aria-label"] ? undefined : "true"}
            aria-label={props["aria-label"]}
            className={["happy2-plugin-store-icon", props.className].filter(Boolean).join(" ")}
            data-artwork={props.artworkUrl ? "" : undefined}
            data-happy2-ui="plugin-store-icon"
            data-size={size}
            data-testid={props["data-testid"]}
            data-tone={props.tone ?? "violet"}
            role={props["aria-label"] ? "img" : undefined}
            style={props.style}
        >
            {props.artworkUrl ? (
                <img
                    alt=""
                    className="happy2-plugin-store-icon__artwork"
                    data-happy2-ui="plugin-store-icon-artwork"
                    draggable={false}
                    src={props.artworkUrl}
                />
            ) : (
                <span
                    className="happy2-plugin-store-icon__glyph"
                    data-happy2-ui="plugin-store-icon-glyph"
                >
                    <Icon name={props.glyph} size={glyphSize[size]} />
                </span>
            )}
        </span>
    );
}
