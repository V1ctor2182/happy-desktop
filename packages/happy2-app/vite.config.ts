import { resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    plugins: [
        // happy2-app is consumed as source by happy2-desktop and happy2-web, so the
        // generated route tree is committed rather than produced by each consumer.
        // Generation runs here, where the routes live, and only regenerates on change.
        tanstackRouter({
            generatedRouteTree: resolve(import.meta.dirname, "sources/routeTree.gen.ts"),
            routesDirectory: resolve(import.meta.dirname, "sources/routes"),
            quoteStyle: "double",
            semicolons: true,
            target: "react",
        }),
        tailwindcss(),
        react(),
        babel({ presets: [reactCompilerPreset()] }),
    ],
    build: {
        lib: {
            entry: resolve(import.meta.dirname, "sources/index.ts"),
            formats: ["es"],
            fileName: "index",
        },
        rollupOptions: {
            external: ["react", "react-dom", "react/jsx-runtime"],
        },
    },
    test: {
        exclude: [...configDefaults.exclude, "**/*.gym.test.tsx"],
        environment: "jsdom",
        setupFiles: [resolve(import.meta.dirname, "tests/setup.ts")],
    },
});
