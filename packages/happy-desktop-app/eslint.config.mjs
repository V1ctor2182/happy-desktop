import js from "@eslint/js";
import css from "@eslint/css";
import babelParser from "@babel/eslint-parser";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import layoutPolicy from "../../eslint/layout-policy.mjs";
import reactPolicy from "../../eslint/react-policy.mjs";
import themePolicy from "../../eslint/theme-policy.mjs";

const common = {
    plugins: { "happy-layout": layoutPolicy, "happy-react": reactPolicy },
    extends: [
        js.configs.recommended,
        react.configs.flat.recommended,
        react.configs.flat["jsx-runtime"],
        reactHooks.configs.flat["recommended-latest"],
        jsxA11y.flatConfigs.recommended,
    ],
    settings: { react: { version: "detect" } },
    rules: {
        "no-restricted-imports": [
            "error",
            {
                paths: [
                    {
                        name: "react",
                        importNames: ["useEffect", "useState"],
                        message:
                            "App state belongs in happy-desktop-state/Zustand. useEffect and useState are not allowed in happy-desktop-app.",
                    },
                ],
            },
        ],
        "no-undef": "off",
        "no-unused-vars": "off",
        "no-restricted-syntax": [
            "error",
            {
                selector:
                    "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(useEffect|useState)$/]",
                message:
                    "App state belongs in happy-desktop-state/Zustand. useEffect and useState are not allowed in happy-desktop-app.",
            },
        ],
        "react/prop-types": "off",
        "react-hooks/exhaustive-deps": "error",
        "happy-react/no-layout-effect": "error",
        "happy-react/no-local-state": "error",
        "happy-react/require-react-exception-reason": "error",
        "happy-layout/require-layout-exception-reason": "error",
        "happy-layout/scrollport-no-spacing": "error",
        "happy-layout/use-flex-layout": "error",
    },
};

function languageOptions(plugins) {
    return {
        parser: babelParser,
        globals: { ...globals.browser, ...globals.node },
        parserOptions: {
            requireConfigFile: false,
            babelOptions: {
                babelrc: false,
                configFile: false,
                parserOpts: { plugins },
            },
        },
    };
}

export default defineConfig(
    globalIgnores(["dist/**", "coverage/**"]),
    { ...common, files: ["**/*.ts"], languageOptions: languageOptions(["typescript"]) },
    {
        ...common,
        files: ["**/*.tsx"],
        languageOptions: languageOptions(["typescript", "jsx"]),
    },
    {
        files: ["**/*.css"],
        language: "css/css",
        languageOptions: { tolerant: true },
        plugins: { css, "happy-layout": layoutPolicy, "happy-theme": themePolicy },
        rules: {
            "happy-layout/require-layout-exception-reason": "error",
            "happy-layout/scrollport-no-spacing": "error",
            "happy-layout/use-flex-layout": "error",
            "happy-theme/no-direct-color": "error",
            "happy-theme/theme-color-variables-only": "error",
            "happy-theme/theme-color-variable-references-only": "error",
        },
    },
);
