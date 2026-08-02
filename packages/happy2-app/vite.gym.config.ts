import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { lottieLocalWasmPlugin } from "happy2-ui/vite";

export default defineConfig({
    plugins: [
        tailwindcss(),
        react(),
        babel({ presets: [reactCompilerPreset()] }),
        // Gym tests run real happy2-ui pages in a real browser, so they bundle
        // the Lottie renderer and need its CDN URLs removed like anything else.
        lottieLocalWasmPlugin(),
    ],
    test: {
        include: ["tests/**/*.gym.test.tsx"],
        setupFiles: ["tests/gymSetup.ts"],
        testTimeout: 30_000,
        browser: {
            enabled: true,
            headless: true,
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
            provider: playwright({
                contextOptions: {
                    deviceScaleFactor: 2,
                    viewport: { height: 900, width: 1300 },
                },
            }),
            ui: false,
            viewport: { height: 800, width: 1200 },
        },
    },
});
