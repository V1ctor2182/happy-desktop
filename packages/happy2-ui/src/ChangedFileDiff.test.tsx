import { expect, it } from "vitest";
import "./theme.css";
import "./styles/changed-file-diff.css";
import { ChangedFileDiff } from "./ChangedFileDiff";
import { createRenderer } from "./testing";

it("renders HEAD and working-tree text through Pierre Diffs in the active appearance", async () => {
    const view = createRenderer();
    view.render(
        () => (
            <div className="happy2-theme-dark" style={{ height: "360px", width: "640px" }}>
                <ChangedFileDiff
                    appearance="dark"
                    data-testid="diff"
                    loading
                    newContent={"export const answer = 43;\nexport const ready = true;\n"}
                    oldContent={"export const answer = 42;\n"}
                    path="src/answer.ts"
                />
            </div>
        ),
        { width: 680, height: 400, padding: 20 },
    );
    await view.ready();

    const root = view.$('[data-testid="diff"]');
    expect(root.element.tagName).toBe("SECTION");
    expect(root.element.getAttribute("aria-label")).toBe("Changes in src/answer.ts");
    expect(root.bounds().height).toBe(360);
    expect(
        root.element.querySelector('[data-happy2-ui="changed-file-diff-updating"]')?.textContent,
    ).toBe("Updating…");

    const renderer = root.element.querySelector("diffs-container") as HTMLElement | null;
    expect(renderer).not.toBeNull();
    await expect
        .poll(
            () =>
                renderer?.shadowRoot?.querySelectorAll('[data-line-type="change-deletion"]').length,
        )
        .toBeGreaterThan(0);
    await expect
        .poll(
            () =>
                renderer?.shadowRoot?.querySelectorAll('[data-line-type="change-addition"]').length,
        )
        .toBeGreaterThan(0);

    const header = renderer?.shadowRoot?.querySelector("[data-diffs-header]");
    expect(header?.textContent).toContain("src/answer.ts");
    expect(getComputedStyle(renderer!).colorScheme).toBe("dark");
});
