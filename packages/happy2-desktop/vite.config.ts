import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";
import { appRouterPlugin } from "happy2-app/vite";
import { lottieLocalWasmPlugin } from "happy2-ui/vite";
import { browserLocalRigPlugin } from "./sources/main/browserDevServer";

const require = createRequire(import.meta.url);
const packageJson = require("./package.json") as { readonly version: string };
const localWebSite = process.env.HAPPY2_LOCAL_WEB_SITE === "1";
const localWebBuild = localWebSite
    ? {
          buildId: process.env.HAPPY2_LOCAL_WEB_BUILD_ID ?? "development",
          version: packageJson.version,
      }
    : undefined;

function localWebVersionPlugin(build: NonNullable<typeof localWebBuild>): Plugin {
    return {
        name: "happy2-local-web-version",
        generateBundle() {
            this.emitFile({
                fileName: "local-web-version.json",
                source: `${JSON.stringify(build)}\n`,
                type: "asset",
            });
        },
    };
}

export default defineConfig({
    base: localWebSite ? "/" : "./",
    define: {
        __HAPPY2_LOCAL_WEB_BUILD_ID__: JSON.stringify(localWebBuild?.buildId ?? null),
        __HAPPY2_LOCAL_WEB_VERSION__: JSON.stringify(localWebBuild?.version ?? null),
    },
    plugins: [
        // The Rig terminal protocol (@slopus/ghostty-web) decodes compressed wire
        // frames with node:zlib and node Buffer; these polyfills make them real in
        // the browser instead of empty externals that would throw at runtime.
        nodePolyfills({
            include: ["buffer", "zlib", "crypto", "stream", "util"],
            globals: { Buffer: true },
        }),
        // The app's routes are served from source here, so this config needs the
        // router plugin too: without it a route module is not a Fast Refresh
        // boundary and every component edit reloads the whole page.
        appRouterPlugin(),
        tailwindcss(),
        react(),
        babel({ presets: [reactCompilerPreset()] }),
        // Happy2-ui's empty-state marks are drawn by a WASM Lottie renderer that
        // ships hardcoded CDN URLs for its binary. This cuts them out so the
        // renderer can only ever load the copy bundled here.
        lottieLocalWasmPlugin(),
        browserLocalRigPlugin(),
        ...(localWebBuild ? [localWebVersionPlugin(localWebBuild)] : []),
    ],
    build: {
        outDir: "dist/renderer",
    },
});
