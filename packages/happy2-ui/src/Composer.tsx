import {
    useLayoutEffect,
    useRef,
    useState,
    type ChangeEvent,
    type ClipboardEvent as ReactClipboardEvent,
    type CSSProperties,
    type DragEvent as ReactDragEvent,
    type FormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
} from "react";
import { AudienceToggle, type AudienceValue } from "./AudienceToggle";
import { CommandPicker, type CommandPickerItem } from "./CommandPicker";
import { Avatar, type ToneName } from "./Avatar";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { EmojiPicker, type EmojiItem } from "./EmojiPicker";
import { Icon, type IconName } from "./Icon";
/* ---- ContextChips ----------------------------------------------------- */
export type ContextKind = "file" | "run";
export type ContextItem = {
    detail?: string;
    id: string;
    kind: ContextKind;
    label: string;
};
export type ContextChipsProps = {
    className?: string;
    "data-testid"?: string;
    items: ContextItem[];
    label?: string;
    onRemove?: (id: string) => void;
    readOnly?: boolean;
    style?: CSSProperties;
};
const kindIcons: Record<ContextKind, IconName> = {
    file: "doc",
    run: "play",
};
/** Attached-context row for the composer: 24px chips with kind icons. */
export function ContextChips(props: ContextChipsProps) {
    return (
        <div
            className={["happy2-context-chips", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="context-chips"
            data-testid={props["data-testid"]}
            style={props.style}
        >
            {props.label ? (
                <span className="happy2-context-chips__label" data-happy2-ui="context-chips-label">
                    {props.label}
                </span>
            ) : null}
            {props.items.map((item) => (
                <span
                    className="happy2-context-chips__chip"
                    key={item.id}
                    data-kind={item.kind}
                    data-happy2-ui="context-chips-chip"
                >
                    <span
                        className="happy2-context-chips__icon"
                        data-happy2-ui="context-chips-icon"
                    >
                        <Icon name={kindIcons[item.kind]} size={12} />
                    </span>
                    <span
                        className="happy2-context-chips__text"
                        data-happy2-ui="context-chips-text"
                    >
                        {item.label}
                    </span>
                    {item.detail ? (
                        <span
                            className="happy2-context-chips__detail"
                            data-happy2-ui="context-chips-detail"
                        >
                            {item.detail}
                        </span>
                    ) : null}
                    {!props.readOnly && props.onRemove ? (
                        <button
                            aria-label={`Remove ${item.label}`}
                            className="happy2-context-chips__remove"
                            data-happy2-ui="context-chips-remove"
                            onClick={() => props.onRemove?.(item.id)}
                            type="button"
                        >
                            <Icon name="close" size={12} />
                        </button>
                    ) : null}
                </span>
            ))}
        </div>
    );
}
/* ---- MentionPicker ----------------------------------------------------- */
export type Mentionable = {
    description?: string;
    id: string;
    initials: string;
    /** Documents render under their own subsection with a doc glyph. */
    kind?: "person" | "document";
    name: string;
    status?: "ready" | "working";
    tone?: ToneName;
};
export type MentionPickerProps = {
    /** Optional controlled highlight; defaults to the first filtered mention. */
    activeId?: string;
    className?: string;
    "data-testid"?: string;
    /** Visible heading for the picker (default "Mentions"). */
    label?: string;
    mentions?: Mentionable[];
    onSelect: (mention: Mentionable) => void;
    query: string;
    style?: CSSProperties;
};
/*
 * People always precede documents so the flat keyboard-navigation order in the
 * composer matches the picker's grouped rendering exactly.
 */
function filterMentions(mentions: Mentionable[], query: string) {
    const needle = query.trim().toLowerCase();
    const matched = needle
        ? mentions.filter((mention) => mention.name.toLowerCase().includes(needle))
        : mentions;
    return [
        ...matched.filter((mention) => mention.kind !== "document"),
        ...matched.filter((mention) => mention.kind === "document"),
    ];
}
/**
 * Raised popover listing mention candidates, filtered by `query`. It spans the
 * composer it belongs to and wears the command picker's geometry — quiet
 * section headings over one-line 32px rows — so `@` and `/` are one surface.
 * People render first under the primary heading; document candidates follow
 * under their own "Documents" subsection with a doc glyph instead of an avatar.
 */
export function MentionPicker(props: MentionPickerProps) {
    const candidates = () => props.mentions ?? [];
    const filtered = () => filterMentions(candidates(), props.query);
    const activeId = () => props.activeId ?? filtered()[0]?.id;
    const people = () => filtered().filter((mention) => mention.kind !== "document");
    const documents = () => filtered().filter((mention) => mention.kind === "document");
    const row = (mention: Mentionable) => (
        <button
            aria-selected={mention.id === activeId() ? "true" : "false"}
            key={mention.id}
            className="happy2-mention-picker__row"
            data-active={mention.id === activeId() ? "" : undefined}
            data-happy2-ui="mention-picker-row"
            data-mention-id={mention.id}
            onClick={() => props.onSelect(mention)}
            role="option"
            type="button"
        >
            {mention.kind === "document" ? (
                <span
                    className="happy2-mention-picker__doc-glyph"
                    data-happy2-ui="mention-picker-doc-glyph"
                >
                    <Icon name="doc" size={16} />
                </span>
            ) : (
                <Avatar initials={mention.initials} size="xs" tone={mention.tone} type="agent" />
            )}
            <span className="happy2-mention-picker__meta" data-happy2-ui="mention-picker-meta">
                <span className="happy2-mention-picker__name" data-happy2-ui="mention-picker-name">
                    {mention.name}
                </span>
                {mention.description ? (
                    <span
                        className="happy2-mention-picker__description"
                        data-happy2-ui="mention-picker-description"
                    >
                        {mention.description}
                    </span>
                ) : null}
            </span>
            {mention.status
                ? ((status) => (
                      <Badge
                          className="happy2-mention-picker__status"
                          label={status}
                          variant={status === "ready" ? "success" : "warning"}
                      />
                  ))(mention.status)
                : null}
        </button>
    );
    return (
        <div
            aria-label={props.label ?? "Mentions"}
            className={["happy2-mention-picker", props.className].filter(Boolean).join(" ")}
            data-happy2-ui="mention-picker"
            data-testid={props["data-testid"]}
            role="listbox"
            style={props.style}
        >
            {/* The primary heading labels the people beneath it, so it is
                withheld when every candidate is a document and "Documents"
                is about to say the same thing one row lower. */}
            {people().length > 0 || filtered().length === 0 ? (
                <div
                    className="happy2-mention-picker__header"
                    data-happy2-ui="mention-picker-header"
                >
                    {props.label ?? "Mentions"}
                </div>
            ) : null}
            {filtered().length > 0 ? (
                <>
                    {people().map(row)}
                    {documents().length > 0 ? (
                        <div
                            className="happy2-mention-picker__header"
                            data-happy2-ui="mention-picker-documents-header"
                        >
                            Documents
                        </div>
                    ) : null}
                    {documents().map(row)}
                </>
            ) : (
                <div className="happy2-mention-picker__empty" data-happy2-ui="mention-picker-empty">
                    No mentions match “{props.query}”
                </div>
            )}
        </div>
    );
}
/* ---- Composer ----------------------------------------------------------- */
export type ComposerProps = {
    /** Native file-picker accept filter, used with `onAttachmentsSelect`. */
    attachmentAccept?: string;
    /** Allows more than one file in the native picker. */
    attachmentMultiple?: boolean;
    /**
     * Current message destination. Supplying it (with `onAudienceChange`)
     * renders the People/Agents toggle and enables Shift+Tab switching.
     */
    audience?: AudienceValue;
    className?: string;
    /** Short companion for `hint`, shown only when the toolbar needs to compact. */
    compactHint?: string;
    /**
     * Native plugin composer contribution triggers. The composer retains this
     * integration point while those controls are temporarily withheld.
     */
    contributions?: ReactNode;
    contextItems?: ContextItem[];
    /**
     * Slash commands offered for the current draft, already filtered by the
     * owner. Supplying them (with `onCommandSelect`) renders the command
     * popover and gives the arrow keys, Enter, and Tab to it.
     */
    commands?: readonly CommandPickerItem[];
    /** Chooses a command from the popover; the owner clears the draft. */
    onCommandSelect?: (id: string) => void;
    "data-testid"?: string;
    disabled?: boolean;
    /**
     * Makes this composer the last resort for content the surface has no other
     * home for: a character typed — or a Cmd/Ctrl+V pasted — while no control
     * that wants it has focus moves focus here and lands in the draft, and files
     * dragged anywhere over the window that nothing else answers are attached
     * here rather than opened by the browser. Only the composer the reader is
     * currently writing into may claim any of that, so an owner that mounts more
     * than one composer at a time turns it on for exactly one of them.
     */
    focusOnType?: boolean;
    /** e.g. "Enter to send · @ to hand off to an agent" */
    hint?: string;
    /** Opens a host-owned attachment browser. Takes precedence over the native picker. */
    onAttachFile?: () => void;
    /** Called for toggle clicks and Shift+Tab with the next audience. */
    onAudienceChange?: (audience: AudienceValue) => void;
    /** Receives files picked, pasted into the draft, or dropped onto the composer. */
    onAttachmentsSelect?: (files: File[]) => void;
    onContextRemove?: (id: string) => void;
    /** Called after an emoji is selected. Unicode emoji are also inserted into the draft. */
    onEmojiSelect?: (emoji: EmojiItem) => void;
    /** Reports browser focus transitions of the editable text control. */
    onFocusChange?: (focused: boolean) => void;
    /** Called when a mention is inserted from the picker. */
    onMentionSelect?: (mention: Mentionable) => void;
    mentions?: Mentionable[];
    /** Visible heading above the mention candidates (default "Mentions"). */
    mentionPickerLabel?: string;
    /** Optional controlled model-selection control, rendered in the composer toolbar. */
    modelControl?: ReactNode;
    /** Optional controlled accessory rendered below the composer card. */
    footerControl?: ReactNode;
    onSend: () => unknown;
    /**
     * Ends the agent's current inference. With `running`, it takes over the send
     * control while the draft is empty; typing gives the control back to sending,
     * because a message written during a run steers it rather than stopping it.
     * Escape in the text control calls it too, whatever the draft holds.
     */
    onStop?: () => void;
    onValueChange: (value: string) => void;
    placeholder?: string;
    /** Keeps the composer geometry stable while the current send is being acknowledged. */
    pending?: boolean;
    /** True while the agent is producing a reply, which is what `onStop` ends. */
    running?: boolean;
    /** Emoji available to the composer's searchable picker. */
    emoji?: EmojiItem[];
    /** Emoji ids rendered in the picker's recent section. */
    recentEmoji?: string[];
    /** Overrides the text-only send check when attached context is sendable. */
    sendEnabled?: boolean;
    style?: CSSProperties;
    value: string;
};
const LINE_HEIGHT = 22;
const MIN_LINES = 1;
const MAX_LINES = 8;

/**
 * How far an edge fade may reach into the draft. It is a ceiling, never a fixed
 * band: a fade is only ever as tall as the line fragment the scrollport is
 * already cutting, so a line that is entirely visible — with its selection and
 * its caret — is never painted over.
 */
const MAX_FADE = 10;

/**
 * Points inside the card that already belong to something: a control, a link,
 * an editable area, an attachment chip whose name stays selectable, or a
 * popover that owns its own pointer and keyboard interaction. Everything else
 * in the card is the draft's own dead space.
 */
const SURFACE_CLAIMED_TARGETS =
    '[data-happy2-ui="composer-popover"], [data-happy2-ui="composer-emoji-popover"], [data-happy2-ui="context-chips-chip"], button, input, textarea, select, a, [contenteditable], [tabindex], [role="button"], [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"]';

/**
 * Below the card the composer stops being one input surface. The footer row
 * carries the session's own controls and agent-authored status text, which
 * stays selectable and never hands the caret to the draft.
 */
const FOOTER_TARGETS = '[data-happy2-ui="composer-audience"], [data-happy2-ui="composer-footer"]';

/**
 * Controls that make words out of characters: text entry, and the list and menu
 * roles whose typeahead selects by what is typed. Focus here is the reader
 * writing somewhere else, so the composer never takes a character from them.
 */
const TEXT_TARGETS =
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="menuitem"], [role="option"], [role="searchbox"], [role="textbox"]';

/**
 * Controls that are pressed rather than typed into. They keep only the keys they
 * actually answer to — Enter, which is not a character, and Space — because a
 * button holding focus is usually just where the last click landed. Clicking
 * "+" for a new tab must not mean the next word is swallowed by the button.
 */
const ACTIVATION_TARGETS =
    'button, a[href], [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="radio"]';

/**
 * Cmd/Ctrl+V alone. Paste is the one command shortcut the composer claims,
 * because it carries content rather than performing an action: pasting with
 * nothing focused means putting that text or image somewhere, and the draft is
 * the only place on the surface that can hold it.
 */
function isPasteShortcut(event: KeyboardEvent): boolean {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
    return event.key === "v" || event.key === "V";
}

/**
 * Whether a drag in flight is carrying files. `types` is the only thing a drag
 * lets anyone read before it is dropped — the items themselves stay sealed until
 * then — so it is what decides whether the composer offers itself as the
 * destination. Dragging a selection of text, including one inside the draft,
 * carries no files and is left entirely to the browser.
 */
function dragCarriesFiles(transfer: DataTransfer | null): boolean {
    return transfer !== null && Array.from(transfer.types).includes("Files");
}

/**
 * Whether this keystroke is ordinary typing that nothing on screen has claimed,
 * which is what makes redirecting it into `textarea` a last resort rather than a
 * hijack. It is typing when a single character was produced without a command
 * modifier and no composition is in flight; it is unclaimed when nothing has
 * already handled the event, no text control has focus, no focused button is
 * being pressed with Space, and no modal is up — while a dialog owns the screen
 * the composer behind it is not where the reader is writing. A composer that is
 * not rendered cannot be typed into either.
 *
 * The button rule is the point of the split: `:focus-visible` cannot tell a
 * clicked button from a tabbed-to one (Chromium reports it for both once a key
 * arrives, and WebKit does not focus buttons on click at all), so this asks what
 * the control does with the key instead of how it came to be focused.
 */
function typingIsUnclaimed(event: KeyboardEvent, textarea: HTMLTextAreaElement): boolean {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
    const paste = isPasteShortcut(event);
    if (!paste) {
        if (event.metaKey || event.ctrlKey || event.altKey) return false;
        // Length 1 is what separates a produced character from Escape, Enter,
        // Tab, the arrows, and a dead key waiting for the one it will combine
        // with.
        if (event.key.length !== 1) return false;
    }
    const target = event.target;
    if (target instanceof Element) {
        if (target.closest(TEXT_TARGETS)) return false;
        // A button answers to Space, but never to paste.
        if (!paste && event.key === " " && target.closest(ACTIVATION_TARGETS)) return false;
    }
    if (document.querySelector('[data-happy2-ui="modal-overlay"], [role="dialog"]')) return false;
    return textarea.isConnected && textarea.checkVisibility();
}
/**
 * Message composer: focus-within surface card with a one-line resting textarea
 * that grows through eight lines, context chips, capability-driven file/mention/emoji actions,
 * a primary send control, and keyboard-accessible picker popovers.
 */
export function Composer(props: ComposerProps) {
    const composerEl = useRef<HTMLDivElement>(null);
    const fileInputEl = useRef<HTMLInputElement>(null);
    const inputEl = useRef<HTMLDivElement>(null);
    const textareaEl = useRef<HTMLTextAreaElement>(null);
    const wasBusy = useRef(Boolean(props.disabled || props.pending));
    const [mentionStart, setMentionStart] = useState<number | null>(null);
    const [mentionQuery, setMentionQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    /*
     * Which command Enter would run. It is an index rather than an id because
     * the offered list narrows as the draft is typed; the index is clamped into
     * the current list on every read, so a shrinking list moves the highlight
     * instead of losing it.
     */
    const [commandIndex, setCommandIndex] = useState(0);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [emojiQuery, setEmojiQuery] = useState("");
    /* Whether a file drag this composer will take is currently in flight. */
    const [dropActive, setDropActive] = useState(false);
    const restoreFocusAfterSend = useRef(false);
    const [selection, setSelection] = useState({ start: 0, end: 0 });
    const busy = Boolean(props.disabled || props.pending);
    const mentions = () => props.mentions ?? [];
    const filtered = () => filterMentions(mentions(), mentionQuery);
    const mentionOpen = () => !busy && mentionStart !== null && mentions().length > 0;
    const activeMention = () => {
        const list = filtered();
        if (list.length === 0) return undefined;
        return list[Math.min(activeIndex, list.length - 1)];
    };
    const commands = () => props.commands ?? [];
    const commandOpen = () => !busy && commands().length > 0 && props.onCommandSelect !== undefined;
    const activeCommand = () => {
        const list = commands();
        if (list.length === 0) return undefined;
        return list[Math.min(commandIndex, list.length - 1)];
    };
    const selectCommand = (id: string) => {
        setCommandIndex(0);
        props.onCommandSelect?.(id);
        textareaEl.current?.focus();
    };
    const canSend = () =>
        !busy && !commandOpen() && (props.sendEnabled ?? props.value.trim().length > 0);
    /*
     * One control, two acts. While the agent is running an empty draft has
     * nothing to send, so that same circle stops the run; the moment there is
     * something to say it returns to sending, and what it sends steers the run
     * already under way.
     */
    const stopShown = () =>
        Boolean(props.running && props.onStop) && props.value.trim().length === 0;
    const emoji = () => props.emoji ?? [];
    const filteredEmoji = () => {
        const needle = emojiQuery.trim().toLowerCase();
        if (!needle) return emoji();
        return emoji().filter(
            (item) =>
                item.id.toLowerCase().includes(needle) || item.name.toLowerCase().includes(needle),
        );
    };
    const hasAttachmentAction = () => Boolean(props.onAttachFile || props.onAttachmentsSelect);
    const audienceEnabled = () => Boolean(props.audience && props.onAudienceChange);
    const audienceToggle = () => {
        if (!props.audience) return;
        props.onAudienceChange?.(props.audience === "agents" ? "people" : "agents");
    };
    /*
     * Sizes the two edge fades from the scrolled draft itself. Every line box is
     * exactly LINE_HEIGHT tall, so what the scrollport cuts at each end is the
     * remainder of the offset: none of it at a line-aligned position — which is
     * where the draft rests after typing or an arrow key, and where both fades
     * collapse to nothing — and up to a line elsewhere. A fade covers that
     * fragment and stops, capped so a badly cut line is softened rather than
     * erased, which is what keeps whole lines, selections, and the caret out of
     * it entirely.
     *
     * The measurement is written straight to the wrapper because it comes from
     * the committed textarea, like the auto-grown height above: only the browser
     * knows where the viewport sits, and a scroll gesture must not re-render the
     * composer on every frame to say so.
     */
    const draftFadeSync = (el: HTMLTextAreaElement) => {
        const wrapper = inputEl.current;
        if (!wrapper) return;
        // How much of the first visible line the top edge has taken, and how
        // much of the next line the bottom edge is showing. Either being zero
        // means that end cuts nothing and gets no fade.
        const cutAbove = el.scrollTop % LINE_HEIGHT;
        const shownBelow = (el.scrollTop + el.clientHeight) % LINE_HEIGHT;
        const hasBelow = el.scrollHeight - el.clientHeight - el.scrollTop > 0.5;
        const top = cutAbove > 0.5 ? Math.min(LINE_HEIGHT - cutAbove, MAX_FADE) : 0;
        const bottom = hasBelow && shownBelow > 0.5 ? Math.min(shownBelow, MAX_FADE) : 0;
        wrapper.style.setProperty("--happy2-composer-fade-top", `${top}px`);
        wrapper.style.setProperty("--happy2-composer-fade-bottom", `${bottom}px`);
    };
    /* Start as one line, then grow up to eight lines for longer drafts. */
    // eslint-disable-next-line happy2-react/no-layout-effect -- textarea auto-growth must read the committed scrollHeight and write its live DOM height before the browser paints the new draft
    useLayoutEffect(() => {
        void props.value;
        const el = textareaEl.current;
        if (!el) return;
        const minHeight = LINE_HEIGHT * MIN_LINES;
        const maxHeight = LINE_HEIGHT * MAX_LINES;
        el.style.height = `${minHeight}px`;
        el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
        // The new height is what decides what the scrollport cuts, so the fades
        // are settled in the same pass that resized the control.
        draftFadeSync(el);
    }, [props.value]);
    const closeMention = () => {
        setMentionStart(null);
        setMentionQuery("");
        setActiveIndex(0);
    };
    const closeEmoji = () => {
        setEmojiOpen(false);
        setEmojiQuery("");
    };
    const closePopovers = () => {
        closeMention();
        closeEmoji();
    };
    // eslint-disable-next-line happy2-react/no-layout-effect -- a completed send returns real keyboard focus to the committed textarea only when this composer initiated the focus handoff
    useLayoutEffect(() => {
        if (wasBusy.current && !busy && restoreFocusAfterSend.current) {
            textareaEl.current?.focus();
            restoreFocusAfterSend.current = false;
        }
        wasBusy.current = busy;
    }, [busy]);
    // eslint-disable-next-line happy2-react/no-layout-effect -- composer popovers require one document-level outside-pointer listener whose lifetime follows the mounted composer and is completely cleaned up
    useLayoutEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (!composerEl.current?.contains(event.target as Node)) closePopovers();
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
    });
    // eslint-disable-next-line happy2-react/no-layout-effect -- claiming typing that no focused control wants requires one window-level keydown listener, which no handler on a rendered element can express
    useLayoutEffect(() => {
        if (!props.focusOnType || busy) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const textarea = textareaEl.current;
            if (!textarea || !typingIsUnclaimed(event, textarea)) return;
            // Deliberately not prevented: focusing the textarea inside keydown
            // makes the browser deliver this very keystroke to it, so the letter
            // that summoned the composer is the first one typed into it, and a
            // redirected Cmd+V pastes into the draft through the composer's own
            // paste handler — images and files included.
            textarea.focus();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [busy, props.focusOnType]);
    const rememberSelection = () => {
        const el = textareaEl.current;
        if (!el) return;
        setSelection({
            start: el.selectionStart ?? props.value.length,
            end: el.selectionEnd ?? props.value.length,
        });
    };
    const focusAt = (position: number) => {
        const el = textareaEl.current;
        if (!el) return;
        queueMicrotask(() => {
            el.focus();
            el.setSelectionRange(position, position);
            setSelection({ start: position, end: position });
        });
    };
    const replaceSelection = (text: string) => {
        const current = selection;
        const next = props.value.slice(0, current.start) + text + props.value.slice(current.end);
        const nextCaret = current.start + text.length;
        props.onValueChange(next);
        focusAt(nextCaret);
    };
    const detectMention = (el: HTMLTextAreaElement) => {
        if (mentions().length === 0) return;
        const caret = el.selectionStart ?? el.value.length;
        const before = el.value.slice(0, caret);
        const match = /(^|[\s([{])@([\w-]*)$/.exec(before);
        if (!match) {
            closeMention();
            return;
        }
        const query = match[2] ?? "";
        const start = caret - query.length - 1;
        if (mentionStart !== start || mentionQuery !== query) setActiveIndex(0);
        setMentionStart(start);
        setMentionQuery(query);
    };
    const selectMention = (mention: Mentionable) => {
        const el = textareaEl.current;
        const start = mentionStart;
        if (!el || start === null) return;
        const caret = el.selectionStart ?? el.value.length;
        const insertion = `@${mention.name} `;
        const next = el.value.slice(0, start) + insertion + el.value.slice(caret);
        closeMention();
        props.onValueChange(next);
        props.onMentionSelect?.(mention);
        const nextCaret = start + insertion.length;
        focusAt(nextCaret);
    };
    const triggerMention = () => {
        const el = textareaEl.current;
        if (!el || busy || mentions().length === 0) return;
        closeEmoji();
        el.focus();
        const caret = el.selectionStart ?? props.value.length;
        const before = props.value.slice(0, caret);
        const needsSpace = before.length > 0 && !/[\s([{]$/.test(before);
        const insertion = `${needsSpace ? " " : ""}@`;
        const next = before + insertion + props.value.slice(el.selectionEnd ?? caret);
        props.onValueChange(next);
        setMentionStart(caret + insertion.length - 1);
        setMentionQuery("");
        setActiveIndex(0);
        const nextCaret = caret + insertion.length;
        focusAt(nextCaret);
    };
    const triggerEmoji = () => {
        if (busy || emoji().length === 0) return;
        closeMention();
        rememberSelection();
        const open = !emojiOpen;
        setEmojiOpen(open);
        setEmojiQuery("");
        queueMicrotask(() => {
            if (!open) return;
            composerEl.current
                ?.querySelector<HTMLInputElement>('[data-happy2-ui="emoji-picker"] input')
                ?.focus();
        });
    };
    const selectEmoji = (id: string) => {
        const item = emoji().find((candidate) => candidate.id === id);
        if (!item) return;
        closeEmoji();
        if (item.char) replaceSelection(item.char);
        else textareaEl.current?.focus();
        props.onEmojiSelect?.(item);
    };
    const triggerAttachment = () => {
        if (busy) return;
        closePopovers();
        if (props.onAttachFile) props.onAttachFile();
        else fileInputEl.current?.click();
    };
    const selectAttachments = (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.currentTarget.files ?? []);
        if (files.length > 0) props.onAttachmentsSelect?.(files);
        event.currentTarget.value = "";
        textareaEl.current?.focus();
    };
    const send = () => {
        if (!canSend()) return;
        closePopovers();
        restoreFocusAfterSend.current = true;
        void props.onSend();
        queueMicrotask(() => {
            const textarea = textareaEl.current;
            if (!textarea || textarea.disabled || textarea.readOnly) return;
            textarea.focus();
            restoreFocusAfterSend.current = false;
        });
    };
    const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (
            event.key === "Tab" &&
            event.shiftKey &&
            audienceEnabled() &&
            !busy &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();
            audienceToggle();
            return;
        }
        if (commandOpen()) {
            const list = commands();
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setCommandIndex((index) => (Math.min(index, list.length - 1) + 1) % list.length);
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setCommandIndex(
                    (index) => (Math.min(index, list.length - 1) - 1 + list.length) % list.length,
                );
                return;
            }
            if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
                event.preventDefault();
                const command = activeCommand();
                if (command) selectCommand(command.id);
                return;
            }
            if (event.key === "Escape") {
                // The whole draft is the command being typed, so dismissing the
                // popover and clearing what opened it are the same act.
                event.preventDefault();
                setCommandIndex(0);
                props.onValueChange("");
                return;
            }
        }
        if (mentionOpen()) {
            const list = filtered();
            if (event.key === "ArrowDown" && list.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % list.length);
                return;
            }
            if (event.key === "ArrowUp" && list.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + list.length) % list.length);
                return;
            }
            if (
                (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) &&
                list.length > 0
            ) {
                event.preventDefault();
                const mention = activeMention();
                if (mention) selectMention(mention);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                closeMention();
                return;
            }
        }
        if (emojiOpen && event.key === "Escape") {
            event.preventDefault();
            closeEmoji();
            textareaEl.current?.focus();
            return;
        }
        /*
         * Escape stops the run, the way it does in the Rig TUI, and it is the
         * last thing Escape can mean here: every popover above has already had
         * its turn and returned. What is half-written stays written — the draft
         * was aimed at the run being called off, not at the next one — and a
         * draft with something in it stops the run just the same, even though
         * the send control has taken the circle back from stop.
         */
        if (
            event.key === "Escape" &&
            props.running &&
            props.onStop &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();
            props.onStop();
            return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
        }
    };
    const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
        // A new query is a new list; start its highlight at the top.
        setCommandIndex(0);
        props.onValueChange(event.currentTarget.value);
        rememberSelection();
        detectMention(event.currentTarget);
    };
    const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
        // Anything on the clipboard that arrived as a file is an attachment: a
        // screenshot, a PDF copied in Finder, a log someone dragged in. Text
        // pastes carry no files and fall through to the textarea untouched.
        const files = Array.from(event.clipboardData.files);
        if (files.length === 0 || !props.onAttachmentsSelect) return;
        event.preventDefault();
        props.onAttachmentsSelect(files);
    };
    /*
     * Dropping files is attaching them, exactly as pasting them is: the same
     * screenshot, the same PDF, arriving by the other gesture. A composer that
     * cannot take attachments at all — or one that is switched off — leaves the
     * drag alone rather than accepting it into nothing.
     */
    const dropAccepted = () => Boolean(props.onAttachmentsSelect) && !props.disabled;
    const attachDropped = (transfer: DataTransfer | null) => {
        const files = Array.from(transfer?.files ?? []);
        if (files.length > 0) props.onAttachmentsSelect?.(files);
    };
    /*
     * Answering `dragover` is what makes the drop possible at all: an
     * unprevented one leaves the browser's own default in charge, which opens
     * the dropped file over the page. It repeats for as long as the pointer is
     * over the card, so it is also what raises the card's drop state.
     */
    const dragOverSurface = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!dropAccepted() || !dragCarriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!dropActive) setDropActive(true);
    };
    const dragLeaveSurface = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!dropActive) return;
        // `dragleave` also fires on every boundary crossed *inside* the card —
        // into the textarea, onto a control — so the pointer's own position is
        // what says whether the drag has really left it. Leaving the window
        // reports a point outside the card too, which is the same answer.
        const bounds = event.currentTarget.getBoundingClientRect();
        const inside =
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom;
        if (!inside) setDropActive(false);
    };
    const dropOnSurface = (event: ReactDragEvent<HTMLDivElement>) => {
        if (!dropAccepted() || !dragCarriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        setDropActive(false);
        attachDropped(event.dataTransfer);
    };
    /*
     * The same claim the composer makes over unclaimed typing, made over a file
     * nothing else on the surface wants: a screenshot dragged at the transcript,
     * the sidebar, or the gap beside the card is meant for this conversation,
     * and the draft is the only place on the surface that can hold it. Left
     * alone the browser would navigate the whole window onto that file instead.
     *
     * A surface that answers the drag itself has already prevented the event by
     * the time it reaches the window, and so has the card above, which is what
     * keeps one drop from being attached twice.
     */
    // eslint-disable-next-line happy2-react/no-layout-effect -- claiming a file drop no surface wants requires window-level drag listeners whose lifetime follows the mounted composer, which no handler on a rendered element can express
    useLayoutEffect(() => {
        if (!props.focusOnType || !dropAccepted()) return;
        const onDragOver = (event: DragEvent) => {
            if (event.defaultPrevented || !dragCarriesFiles(event.dataTransfer)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
            // Whatever the pointer is over, this composer is where the file will
            // land, so the card says so for the whole flight of the drag.
            setDropActive(true);
        };
        const onDragLeave = (event: DragEvent) => {
            // Only a pointer that has left the window has taken the drag away;
            // every boundary inside the page bubbles the same event here.
            if (
                event.clientX > 0 &&
                event.clientY > 0 &&
                event.clientX < window.innerWidth &&
                event.clientY < window.innerHeight
            )
                return;
            setDropActive(false);
        };
        const onDrop = (event: DragEvent) => {
            setDropActive(false);
            if (event.defaultPrevented || !dragCarriesFiles(event.dataTransfer)) return;
            event.preventDefault();
            attachDropped(event.dataTransfer);
        };
        window.addEventListener("dragover", onDragOver);
        window.addEventListener("dragleave", onDragLeave);
        window.addEventListener("drop", onDrop);
        return () => {
            window.removeEventListener("dragover", onDragOver);
            window.removeEventListener("dragleave", onDragLeave);
            window.removeEventListener("drop", onDrop);
        };
    });
    /*
     * The composer is one input surface, not a small textarea surrounded by
     * dead padding. Keep native and semantic controls in charge of their own
     * pointer interactions, but direct every other point in the card to the
     * editable control. Popovers are visually adjacent to the card but own
     * their separate keyboard interactions, and the footer row below the card
     * is not part of the input surface at all.
     *
     * It runs on mousedown and suppresses that event's default, which is the
     * whole point: pressing a plain <div> otherwise hands focus to the nearest
     * focusable ancestor — the document body — right after this handler asked
     * for the textarea, so the card looked inert everywhere but the text itself.
     * Only dead space is defaulted away; claimed targets return first and keep
     * their own press behavior, including the text selection that starts inside
     * the textarea and the footer.
     */
    const focusTextareaFromSurface = (event: ReactMouseEvent<HTMLDivElement>) => {
        // Composing is the primary button's job. A secondary or middle press is
        // the platform's — a context menu, a paste — and taking its default
        // away would answer a question that was not asked here.
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const claimed = target.closest(`${SURFACE_CLAIMED_TARGETS}, ${FOOTER_TARGETS}`);
        if (claimed && event.currentTarget.contains(claimed)) return;
        const textarea = textareaEl.current;
        if (!textarea || textarea.disabled) return;
        event.preventDefault();
        textarea.focus();
    };
    return (
        <div
            className={["happy2-composer", props.className].filter(Boolean).join(" ")}
            aria-busy={props.pending ? "true" : undefined}
            data-audience={audienceEnabled() ? "" : undefined}
            data-agents={audienceEnabled() && props.audience === "agents" ? "" : undefined}
            data-disabled={props.disabled ? "" : undefined}
            data-dropping={dropActive && dropAccepted() ? "" : undefined}
            data-pending={props.pending ? "" : undefined}
            data-happy2-ui="composer"
            data-testid={props["data-testid"]}
            onDragEnter={dragOverSurface}
            onDragLeave={dragLeaveSurface}
            onDragOver={dragOverSurface}
            onDrop={dropOnSurface}
            onMouseDown={focusTextareaFromSurface}
            onBlur={(event) => {
                const next = event.relatedTarget;
                if (next && !event.currentTarget.contains(next as Node)) closePopovers();
            }}
            style={props.style}
            ref={composerEl}
        >
            <div className="happy2-composer__surface" data-happy2-ui="composer-surface">
                {(props.contextItems?.length ?? 0) > 0 ? (
                    <div className="happy2-composer__context" data-happy2-ui="composer-context">
                        <ContextChips
                            items={props.contextItems ?? []}
                            onRemove={props.onContextRemove}
                            readOnly={!props.onContextRemove}
                        />
                    </div>
                ) : null}
                <div
                    className="happy2-composer__input"
                    data-happy2-ui="composer-input"
                    ref={inputEl}
                >
                    <textarea
                        className="happy2-composer__textarea"
                        data-happy2-ui="composer-textarea"
                        disabled={props.disabled}
                        readOnly={props.pending}
                        onBlur={() => {
                            rememberSelection();
                            props.onFocusChange?.(false);
                        }}
                        onClick={rememberSelection}
                        onFocus={() => props.onFocusChange?.(true)}
                        onInput={onInput}
                        onKeyDown={onKeyDown}
                        onPaste={onPaste}
                        onScroll={(event) => draftFadeSync(event.currentTarget)}
                        onSelect={rememberSelection}
                        placeholder={props.placeholder}
                        ref={textareaEl}
                        rows={MIN_LINES}
                        value={props.value}
                    />
                    {/* Decorative edge fades: the draft dissolves into the card
                        where it runs past the visible lines, so a clipped line
                        is never cut on a hard edge. */}
                    <div
                        aria-hidden="true"
                        className="happy2-composer__fade happy2-composer__fade--top"
                        data-happy2-ui="composer-fade-top"
                    />
                    <div
                        aria-hidden="true"
                        className="happy2-composer__fade happy2-composer__fade--bottom"
                        data-happy2-ui="composer-fade-bottom"
                    />
                </div>
                <div className="happy2-composer__toolbar" data-happy2-ui="composer-toolbar">
                    <div className="happy2-composer__leading" data-happy2-ui="composer-leading">
                        {hasAttachmentAction() ? (
                            <Button
                                aria-label="Attach file"
                                disabled={busy}
                                icon="plus"
                                iconOnly
                                onClick={triggerAttachment}
                                size="small"
                                variant="ghost"
                            />
                        ) : null}
                        {mentions().length > 0 ? (
                            <Button
                                aria-label="Mention someone"
                                disabled={busy}
                                icon="at"
                                iconOnly
                                onClick={triggerMention}
                                size="small"
                                variant="ghost"
                            />
                        ) : null}
                        {emoji().length > 0 ? (
                            <Button
                                aria-expanded={emojiOpen ? "true" : "false"}
                                aria-haspopup="dialog"
                                aria-label="Add emoji"
                                disabled={busy}
                                icon="smile"
                                iconOnly
                                onClick={triggerEmoji}
                                size="small"
                                variant="ghost"
                            />
                        ) : null}
                    </div>
                    <div className="happy2-composer__trailing" data-happy2-ui="composer-trailing">
                        {props.modelControl ? (
                            <div className="happy2-composer__model" data-happy2-ui="composer-model">
                                {props.modelControl}
                            </div>
                        ) : null}
                        {stopShown() ? (
                            <Button
                                aria-label="Stop the agent"
                                className="happy2-composer__send happy2-composer__stop"
                                data-action="stop"
                                icon="stop"
                                iconOnly
                                onClick={() => props.onStop?.()}
                                size="small"
                                variant="primary"
                            />
                        ) : (
                            <Button
                                aria-label="Send message"
                                className="happy2-composer__send"
                                disabled={!canSend()}
                                icon="arrow-up"
                                iconOnly
                                onClick={send}
                                size="small"
                                variant="primary"
                            />
                        )}
                    </div>
                </div>
                {commandOpen() ? (
                    <div
                        className="happy2-composer__popover"
                        data-happy2-ui="composer-popover"
                        onMouseDown={(event) => event.preventDefault()}
                    >
                        <CommandPicker
                            activeId={activeCommand()?.id}
                            items={commands()}
                            onSelect={selectCommand}
                        />
                    </div>
                ) : null}
                {mentionOpen() ? (
                    <div
                        className="happy2-composer__popover"
                        data-happy2-ui="composer-popover"
                        onMouseDown={(event) => event.preventDefault()}
                    >
                        <MentionPicker
                            activeId={activeMention()?.id}
                            label={props.mentionPickerLabel}
                            mentions={mentions()}
                            onSelect={selectMention}
                            query={mentionQuery}
                        />
                    </div>
                ) : null}
                {emojiOpen && !busy ? (
                    <div
                        aria-label="Choose emoji"
                        className="happy2-composer__popover happy2-composer__popover--emoji"
                        data-happy2-ui="composer-emoji-popover"
                        onKeyDown={(event) => {
                            if (event.key !== "Escape") return;
                            event.preventDefault();
                            closeEmoji();
                            textareaEl.current?.focus();
                        }}
                        role="dialog"
                    >
                        <EmojiPicker
                            emoji={filteredEmoji()}
                            onQueryChange={setEmojiQuery}
                            onSelect={selectEmoji}
                            query={emojiQuery}
                            recent={props.recentEmoji}
                        />
                    </div>
                ) : null}
                {props.onAttachmentsSelect && !props.onAttachFile ? (
                    <input
                        accept={props.attachmentAccept}
                        aria-hidden="true"
                        className="happy2-composer__file-input"
                        multiple={props.attachmentMultiple}
                        onChange={selectAttachments}
                        ref={fileInputEl}
                        tabIndex={-1}
                        type="file"
                    />
                ) : null}
            </div>
            {audienceEnabled() || props.footerControl ? (
                <div
                    className="happy2-composer__footer"
                    data-happy2-ui={audienceEnabled() ? "composer-audience" : "composer-footer"}
                >
                    {audienceEnabled() ? (
                        <AudienceToggle
                            disabled={busy}
                            onChange={(value) => props.onAudienceChange?.(value)}
                            value={props.audience!}
                        />
                    ) : null}
                    {props.footerControl}
                </div>
            ) : null}
        </div>
    );
}
