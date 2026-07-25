import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { defineConfig } from "vite";
import { appRouterPlugin } from "happy2-app/vite";
import { browserLocalRigPlugin } from "./sources/main/browserDevServer";

export default defineConfig({
    base: "./",
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
        browserLocalRigPlugin(),
    ],
    build: {
        outDir: "dist/renderer",
    },
});
