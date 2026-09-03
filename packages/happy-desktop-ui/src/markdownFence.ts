import type { ExtraProps } from "react-markdown";
import { codeBlockLanguage } from "./CodeBlock";

export type MarkdownFence = {
    readonly label?: string;
    readonly lang?: string;
    readonly offset?: number;
    readonly text: string;
};

/** The authored contents and info label of one fenced Markdown code block. */
export function markdownFence(node: ExtraProps["node"]): MarkdownFence | undefined {
    const code = node?.children.find(
        (child) => child.type === "element" && child.tagName === "code",
    );
    if (code === undefined || code.type !== "element") return undefined;
    const text = code.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join("")
        .replace(/\n$/u, "");
    if (text.length === 0) return undefined;
    const names = code.properties["className"];
    const label = (Array.isArray(names) ? names.map(String) : [])
        .find((name) => name.startsWith("language-"))
        ?.slice("language-".length);
    const lang = codeBlockLanguage(label);
    const offset = node?.position?.start.offset;
    return {
        ...(label === undefined ? {} : { label }),
        ...(lang === undefined ? {} : { lang }),
        ...(offset === undefined ? {} : { offset }),
        text,
    };
}

export function markdownFenceIsMermaid(fence: MarkdownFence | undefined): boolean {
    return fence?.label?.trim().toLowerCase() === "mermaid";
}

/**
 * The exact command from a fence that explicitly identifies itself as a local
 * shell. Unlabelled snippets and console transcripts stay read-only: a Run
 * affordance must never guess that arbitrary code or copied output is safe to
 * hand to a terminal.
 */
export function markdownFenceCommand(fence: MarkdownFence | undefined): string | undefined {
    const label = fence?.label?.trim().toLowerCase();
    if (
        label !== "bash" &&
        label !== "sh" &&
        label !== "shell" &&
        label !== "shellscript" &&
        label !== "zsh"
    )
        return undefined;
    return fence?.text;
}
