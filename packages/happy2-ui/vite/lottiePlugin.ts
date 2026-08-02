import type { Plugin } from "vite";

/** Any absolute http(s) URL ending in a `.wasm` file, wherever it appears. */
const remoteWasm = () => /https?:\/\/[^`"']*?\.wasm/g;

/**
 * What the CDN URLs are replaced with. It is not a URL: resolved against the
 * renderer's `blob:` worker base it fails to parse, so the load fails loudly
 * and locally instead of quietly succeeding somewhere else. The name is the
 * error message.
 */
const REFUSED = "happy2-refuses-remote-lottie-wasm";

const RENDERER = "@lottiefiles/dotlottie-web";

/**
 * Cuts every remote WASM URL out of the Lottie renderer at build time.
 *
 * `@lottiefiles/dotlottie-web` ships two hardcoded CDN URLs for its ThorVG
 * binary — jsdelivr as the primary and unpkg as a backup — and only the primary
 * is overridable, through `DotLottieWorker.setWasmUrl()`. The backup is a
 * closure constant with no setter, and it is tried automatically whenever the
 * primary fails. Happy points the primary at a bundled local asset, so on the
 * happy path nothing off-origin is ever requested; but a missing, truncated, or
 * mis-served local asset would have fallen through to unpkg and quietly
 * replaced shipped renderer code with code fetched from a third party. The
 * desktop CSP does not stop it: `connect-src` allows `https:`, `worker-src`
 * allows `blob:`, and `script-src` allows `'wasm-unsafe-eval'`.
 *
 * So the backup is removed from the bundle rather than merely avoided. After
 * this transform the only WASM URL the renderer can reach is the one Happy
 * hands it, and a broken local asset degrades to no animation — which is
 * exactly what an empty state's static glyph already covers.
 *
 * The transform is deliberately fail-closed. It matches on shape, not on the
 * current host names, and refuses to build if a module that plainly loads WASM
 * has no literal URL left to remove — an upgrade that assembles its URLs at
 * runtime breaks the build instead of shipping.
 *
 * Every Vite pipeline that bundles happy2-ui needs this: happy2-ui itself,
 * happy2-desktop, and the app's gym tests. `happy2-app`'s library build is the
 * exception — it keeps the renderer external and never inlines it at all.
 */
export function lottieLocalWasmPlugin(): Plugin {
    return {
        name: "happy2-lottie-local-wasm",
        // Prebundled dependencies bypass the plugin pipeline, so the renderer
        // has to stay unoptimized for this transform to reach it in dev.
        config() {
            return { optimizeDeps: { exclude: [RENDERER] } };
        },
        transform(code, id) {
            if (!id.includes(RENDERER)) return null;

            const patched = code.replace(remoteWasm(), REFUSED);
            if (patched !== code) {
                // No source map: this is a minified dependency nobody steps
                // through, and `null` tells Rollup that is deliberate.
                return { code: patched, map: null };
            }

            /*
             * Nothing was replaced. For a module that is plainly the WASM
             * loader that means the dependency stopped spelling its CDN URLs as
             * literals — assembling one at runtime, say — and this guard is no
             * longer looking where the URLs are. Refuse to build rather than
             * ship a renderer that can still reach the network.
             */
            if (code.includes("WASM loading failed")) {
                throw new Error(
                    `${RENDERER} loads WASM but no remote URL was found to remove in ${id}. The dependency changed shape; re-check happy2-ui/vite/lottiePlugin.ts before upgrading it.`,
                );
            }
            return null;
        },
    };
}
