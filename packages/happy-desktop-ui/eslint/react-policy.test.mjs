import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import reactPolicy from "../../../eslint/react-policy.mjs";

const policyRules = {
    "happy-react/no-layout-effect": "error",
    "happy-react/no-local-state": "error",
    "happy-react/require-react-exception-reason": "error",
};

function lint(code) {
    const linter = new Linter({ configType: "flat" });
    return linter.verify(
        code,
        [
            {
                files: ["**/*.jsx"],
                languageOptions: {
                    ecmaVersion: "latest",
                    parserOptions: { ecmaFeatures: { jsx: true } },
                    sourceType: "module",
                },
                plugins: { "happy-react": reactPolicy },
                rules: policyRules,
            },
        ],
        { filename: "fixture.jsx" },
    );
}

function ruleIds(code) {
    return lint(code).map(({ ruleId }) => ruleId);
}

test("flags a bare useLayoutEffect call", () => {
    assert.deepEqual(ruleIds("useLayoutEffect(() => {});"), ["happy-react/no-layout-effect"]);
});

test("flags a namespaced React.useLayoutEffect call", () => {
    assert.deepEqual(ruleIds("React.useLayoutEffect(() => {});"), ["happy-react/no-layout-effect"]);
});

test("allows a documented local escape hatch with a concrete reason", () => {
    assert.deepEqual(
        ruleIds(
            "// eslint-disable-next-line happy-react/no-layout-effect -- measure the caret against live DOM\nuseLayoutEffect(() => {});",
        ),
        [],
    );
});

test("rejects an escape hatch without a concrete reason", () => {
    assert.deepEqual(
        ruleIds(
            "// eslint-disable-next-line happy-react/no-layout-effect -- short\nuseLayoutEffect(() => {});",
        ),
        ["happy-react/require-react-exception-reason"],
    );
});

test("rejects a block/file-wide layout-effect disable", () => {
    assert.deepEqual(
        ruleIds(
            "/* eslint-disable happy-react/no-layout-effect -- broad blanket disable text */\nuseLayoutEffect(() => {});",
        ),
        ["happy-react/require-react-exception-reason"],
    );
});

test("flags useState, useReducer, and useEffect calls", () => {
    assert.deepEqual(ruleIds("useState(0); useReducer(r, 0); useEffect(fn);"), [
        "happy-react/no-local-state",
        "happy-react/no-local-state",
        "happy-react/no-local-state",
    ]);
});

test("forbids disabling the local-state ban", () => {
    assert.deepEqual(
        ruleIds(
            "// eslint-disable-next-line happy-react/no-local-state -- please let me keep it here\nuseState(0);",
        ),
        ["happy-react/require-react-exception-reason"],
    );
});
