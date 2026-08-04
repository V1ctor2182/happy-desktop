import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
    bracketMatching,
    HighlightStyle,
    indentUnit,
    LanguageDescription,
    syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import {
    drawSelection,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder as placeholderExtension,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useCallback, useLayoutEffect, useRef, type CSSProperties } from "react";

/**
 * The token palette, as CSS custom properties.
 *
 * These are the same names `code-editor.css` defines with `light-dark()`, and
 * the values behind them are Pierre's own theme — the one the file viewer and
 * the diff tokenize with. Editing a file therefore looks like reading it, and
 * the editor follows the product theme through `color-scheme` with nothing to
 * re-tokenize when it changes.
 */
const happyHighlightStyle = HighlightStyle.define([
    {
        tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
        color: "var(--code-comment)",
    },
    { tag: [tags.meta, tags.processingInstruction], color: "var(--code-comment)" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--code-string)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.self], color: "var(--code-number)" },
    {
        tag: [
            tags.keyword,
            tags.moduleKeyword,
            tags.controlKeyword,
            tags.definitionKeyword,
            tags.operatorKeyword,
            tags.modifier,
        ],
        color: "var(--code-keyword)",
    },
    {
        tag: [tags.typeName, tags.className, tags.namespace, tags.tagName, tags.labelName],
        color: "var(--code-type)",
    },
    {
        tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
        color: "var(--code-function)",
    },
    {
        tag: [tags.variableName, tags.propertyName, tags.attributeName],
        color: "var(--code-variable)",
    },
    {
        tag: [tags.constant(tags.variableName), tags.standard(tags.variableName)],
        color: "var(--code-constant)",
    },
    {
        tag: [
            tags.logicOperator,
            tags.arithmeticOperator,
            tags.compareOperator,
            tags.bitwiseOperator,
            tags.definitionOperator,
        ],
        color: "var(--code-operator)",
    },
    {
        tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator, tags.derefOperator],
        color: "var(--code-punctuation)",
    },
    { tag: [tags.heading, tags.strong], color: "var(--code-keyword)", fontWeight: "600" },
    { tag: [tags.emphasis], fontStyle: "italic" },
    { tag: [tags.link, tags.url], color: "var(--code-function)", textDecoration: "underline" },
    { tag: [tags.invalid], color: "var(--text-destructive)" },
]);

export type CodeEditorProps = {
    className?: string;
    "data-testid"?: string;
    style?: CSSProperties;
    /**
     * Full path or file name. The language follows from it, so a `.py` file is
     * Python without the caller naming a grammar.
     */
    name: string;
    /** The text being edited. */
    value: string;
    onValueChange?: (value: string) => void;
    /** Cmd/Ctrl+S inside the editor. */
    onSave?: () => void;
    readOnly?: boolean;
    placeholder?: string;
};

/** Everything the imperative editor keeps for as long as its view is mounted. */
type EditorHandle = {
    editable: Compartment;
    /** The read-only and placeholder configuration currently installed. */
    editableKey?: string;
    language: Compartment;
    /** Which file the loaded grammar belongs to, so a tab switch reloads it. */
    languageName?: string;
    view: EditorView;
};

/** Loads the grammar for a file name, or nothing when no language claims it. */
function languageReconfigure(handle: EditorHandle, name: string) {
    handle.languageName = name;
    const view = handle.view;
    const description = LanguageDescription.matchFilename(languages, name);
    if (description === null) {
        view.dispatch({ effects: handle.language.reconfigure([]) });
        return;
    }
    void description.load().then((support) => {
        // The editor may have been unmounted, or moved to another file, while
        // the grammar chunk was in flight.
        if (handle.languageName === name)
            view.dispatch({ effects: handle.language.reconfigure(support) });
    });
}

/**
 * C-175 CodeEditor — a real code editor for one file.
 *
 * CodeMirror owns the text: incremental parsing means highlighting keeps up
 * with typing on a file of any size, which is the whole reason a highlighted
 * `<pre>` behind a `<textarea>` is not what this is. Undo history, bracket
 * matching, a line-number gutter, and the platform's own editing keys come with
 * it; Cmd/Ctrl+S reports intent to save and nothing else here writes anything.
 *
 * The caller owns the text. `value` is authoritative — a revert, a reload from
 * disk, or a switch to another file replaces the document — while ordinary
 * typing reports through `onValueChange` without the caller having to echo it
 * back, so the cursor never moves under the person using it.
 */
export function CodeEditor(props: CodeEditorProps) {
    // The view's own listeners fire while the person types, long after the
    // render that installed them, so they read the current props from here
    // rather than closing over the ones the view was created with.
    const latest = useRef(props);
    const handle = useRef<EditorHandle | undefined>(undefined);
    const attach = useCallback((host: HTMLDivElement | null) => {
        if (host === null) return;
        const editable = new Compartment();
        const language = new Compartment();
        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: latest.current.value,
                extensions: [
                    lineNumbers(),
                    highlightActiveLineGutter(),
                    highlightActiveLine(),
                    highlightSpecialChars(),
                    drawSelection(),
                    history(),
                    bracketMatching(),
                    indentUnit.of("    "),
                    syntaxHighlighting(happyHighlightStyle),
                    language.of([]),
                    editable.of([]),
                    keymap.of([
                        {
                            key: "Mod-s",
                            preventDefault: true,
                            run: () => {
                                latest.current.onSave?.();
                                return true;
                            },
                        },
                        indentWithTab,
                        ...defaultKeymap,
                        ...historyKeymap,
                    ]),
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged)
                            latest.current.onValueChange?.(update.state.doc.toString());
                    }),
                    EditorState.allowMultipleSelections.of(true),
                ],
            }),
        });
        const created: EditorHandle = { editable, language, view };
        handle.current = created;
        languageReconfigure(created, latest.current.name);
        return () => {
            handle.current = undefined;
            created.languageName = undefined;
            view.destroy();
        };
    }, []);
    // eslint-disable-next-line happy2-react/no-layout-effect -- CodeMirror is an imperative document; this is the only boundary where the authoritative text, the file's grammar, and the read-only state reach it, and the view itself is created and destroyed by the ref callback above
    useLayoutEffect(() => {
        latest.current = props;
        const editor = handle.current;
        if (editor === undefined) return;
        // Typing already produced this text, and replacing a document the
        // person is inside of would drop their cursor to the top.
        if (props.value !== editor.view.state.doc.toString())
            editor.view.dispatch({
                changes: { from: 0, to: editor.view.state.doc.length, insert: props.value },
            });
        if (editor.languageName !== props.name) languageReconfigure(editor, props.name);
        const editableKey = `${String(props.readOnly === true)}|${props.placeholder ?? ""}`;
        if (editor.editableKey !== editableKey) {
            editor.editableKey = editableKey;
            editor.view.dispatch({
                effects: editor.editable.reconfigure([
                    EditorView.editable.of(props.readOnly !== true),
                    EditorState.readOnly.of(props.readOnly === true),
                    ...(props.placeholder === undefined
                        ? []
                        : [placeholderExtension(props.placeholder)]),
                ]),
            });
        }
    });
    return (
        <div
            className={["happy2-code-editor", props.className].filter(Boolean).join(" ")}
            data-happy-desktop-ui="code-editor"
            data-read-only={props.readOnly ? "" : undefined}
            data-testid={props["data-testid"]}
            ref={attach}
            style={props.style}
        />
    );
}
