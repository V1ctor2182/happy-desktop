import { resolve } from "node:path";
import { defineConfig } from "vite";

const flavor = process.env.HAPPY2_DESKTOP_FLAVOR === "local-web" ? "local-web" : "standard";
const localWebOrigin =
    flavor === "local-web"
        ? process.env.HAPPY2_LOCAL_WEB_ORIGIN || "https://local.app.happy.engineering"
        : null;

export default defineConfig({
    define: {
        __HAPPY2_DESKTOP_FLAVOR__: JSON.stringify(flavor),
        __HAPPY2_LOCAL_WEB_ORIGIN__: JSON.stringify(localWebOrigin),
    },
    publicDir: false,
    build: {
        ssr: true,
        emptyOutDir: false,
        outDir: "dist",
        rollupOptions: {
            input: {
                main: resolve(import.meta.dirname, "sources/main/main.ts"),
            },
            external: [
                /^@slopus\/rig(?:\/|$)/u,
                "@lydell/node-pty",
                "electron",
                "electron-updater",
                "ws",
                // Kept out of the bundle and shipped as a runtime dependency, so
                // the notes collection merges with the same Yjs the editor uses.
                "yjs",
            ],
            output: {
                entryFileNames: "[name].js",
            },
        },
    },
});
