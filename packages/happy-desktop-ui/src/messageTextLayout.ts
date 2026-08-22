import {
    clearCache,
    layout,
    measureNaturalWidth,
    prepare,
    prepareWithSegments,
    type PreparedText,
} from "@chenglou/pretext";

/**
 * Height of chat body copy, resolved from the font and the measure instead of
 * from a mounted element.
 *
 * The virtualized message list needs a row's height *before* that row mounts: a
 * constant guess makes the scrollbar lie and turns every offset the reader
 * scrolls into a correction. Pretext resolves the same line breaking the browser
 * would, so an unmounted row is sized to within a line of its painted height.
 *
 * Every constant below mirrors `styles/message.css` and the `--happy-font-*`
 * tokens in `theme.css`. They are duplicated deliberately — reading them back
 * out of the cascade needs a mounted element, which is the thing this module
 * exists to avoid — so a change to either must be made here too.
 */
const UI_FAMILY = '"happy Figtree", system-ui, sans-serif';
const MONO_FAMILY = '"happy Mono", ui-monospace, monospace';
/** `.happy-message__body p` — the shape almost every chat line takes. */
const PARAGRAPH_SIZE = 16;
const PARAGRAPH_LINE = 24;
/** `.happy-message__body pre code`, which never wraps (`white-space: pre`). */
const CODE_LINE = 20;
const CODE_PADDING = 16;
/** `.happy-message__body > * + *` stacking, and the wider margin around `pre`. */
const BLOCK_GAP = 8;
const CODE_GAP = 12;
/** `hr`, and the 8px vertical padding inside every table cell. */
const RULE_HEIGHT = 1;
const TABLE_CELL_PADDING = 8;
/**
 * `blockquote` — a 2px rule plus its 10px inset, taken off the measure. The
 * paragraph inside it is the one place the body's margin reset does not reach,
 * so it keeps the user-agent's 1em leading above and below.
 */
const QUOTE_INSET = 12;
const QUOTE_MARGIN = 16;
/** `ul/ol` indent, and the extra leading between consecutive `li`. */
const LIST_INDENT = 24;
const LIST_ITEM_GAP = 6;
/** `.happy-system-notice__text` — 13px copy on a 20px line. */
const NOTICE_SIZE = 13;
const NOTICE_LINE = 20;
let fontsWatched = false;
let fontGeneration = 0;
const fontListeners = new Set<() => void>();
type Dictionary<T> = Record<string, T | undefined>;
const dictionaryCreate = <T>(): Dictionary<T> => Object.create(null) as Dictionary<T>;
export interface MessageTextLayoutCache {
    /** Font generation this cache was measured against. */
    generation: number;
    /** Width-independent Pretext preparation, grouped by font then source text. */
    prepared: Dictionary<Dictionary<PreparedText>>;
    /** Final Markdown body heights, grouped by source text then wrapping measure. */
    markdownHeights: Dictionary<Dictionary<number>>;
    /** Final wrapped-run heights, grouped by font, source text, then layout dimensions. */
    runHeights: Dictionary<Dictionary<Dictionary<number>>>;
    /** Natural widths, grouped by font then source text. */
    naturalWidths: Dictionary<Dictionary<number>>;
}
/**
 * One conversation's text-layout cache. It deliberately has no practical entry
 * cap: a transcript's immutable history is precisely the content most likely to
 * be measured again, and evicting its oldest rows turns a long-history scan into
 * cache churn. The cache lifetime is owned by the conversation surface.
 */
export function messageTextLayoutCacheCreate(): MessageTextLayoutCache {
    return {
        generation: fontGeneration,
        prepared: dictionaryCreate(),
        markdownHeights: dictionaryCreate(),
        runHeights: dictionaryCreate(),
        naturalWidths: dictionaryCreate(),
    };
}
/** Standalone callers keep the old no-setup API; chat surfaces supply their own cache. */
const sharedCache = messageTextLayoutCacheCreate();
/**
 * Every cached layout was resolved against whichever face was installed at the
 * time. A webfont arriving later changes real line breaking, so the generation
 * advances once and Pretext's own cache is dropped. Conversation caches clear
 * lazily the next time they are read, without a global registry retaining them.
 */
function watchFonts() {
    if (fontsWatched || typeof document === "undefined" || !document.fonts) return;
    fontsWatched = true;
    void document.fonts.ready.then(() => {
        fontGeneration += 1;
        clearCache();
        for (const listener of fontListeners) listener();
    });
}
/** Current generation of the faces every text estimate was resolved against. */
export function messageTextLayoutFontGenerationGet(): number {
    return fontGeneration;
}
/** Notifies mounted transcript estimators when webfont arrival changes line breaking. */
export function messageTextLayoutFontGenerationSubscribe(listener: () => void): () => void {
    watchFonts();
    fontListeners.add(listener);
    return () => fontListeners.delete(listener);
}
/** Clears one conversation's measurements when the installed font generation changes. */
export function messageTextLayoutCacheRefresh(cache: MessageTextLayoutCache): boolean {
    watchFonts();
    if (cache.generation === fontGeneration) return false;
    cache.prepared = dictionaryCreate();
    cache.markdownHeights = dictionaryCreate();
    cache.runHeights = dictionaryCreate();
    cache.naturalWidths = dictionaryCreate();
    cache.generation = fontGeneration;
    return true;
}
function cacheReady(cache: MessageTextLayoutCache): MessageTextLayoutCache {
    messageTextLayoutCacheRefresh(cache);
    return cache;
}
function preparedText(text: string, font: string, cache: MessageTextLayoutCache): PreparedText {
    const ready = cacheReady(cache);
    let byText = ready.prepared[font];
    if (!byText) {
        byText = dictionaryCreate();
        ready.prepared[font] = byText;
    }
    const hit = byText[text];
    if (hit !== undefined) return hit;
    const value = prepare(text, font, { whiteSpace: "normal" });
    byText[text] = value;
    return value;
}
/** Painted height of one wrapped run, never less than a single line box. */
function runHeight(
    text: string,
    font: string,
    lineHeight: number,
    measure: number,
    cache: MessageTextLayoutCache,
): number {
    if (measure <= 0 || text.trim().length === 0) return lineHeight;
    const ready = cacheReady(cache);
    const value = preparedText(text, font, ready);
    let byText = ready.runHeights[font];
    if (!byText) {
        byText = dictionaryCreate();
        ready.runHeights[font] = byText;
    }
    let layouts = byText[text];
    if (!layouts) {
        layouts = dictionaryCreate();
        byText[text] = layouts;
    }
    const key = `${String(measure)}:${String(lineHeight)}`;
    const hit = layouts[key];
    if (hit !== undefined) return hit;
    const height = Math.max(lineHeight, layout(value, measure, lineHeight).height);
    layouts[key] = height;
    return height;
}
const FENCE = /^\s*```/u;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/u;
const HEADING = /^(#{1,6})\s+/u;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;
const QUOTE = /^\s*>\s?/u;
const TABLE_ROW = /^\s*\|/u;
/** The heading ramp: h2 is the largest, h3 alone carries a taller line. */
const HEADINGS = [
    { size: 16, line: 24, weight: 900 },
    { size: 20, line: 24, weight: 600 },
    { size: 16, line: 28, weight: 600 },
    { size: 16, line: 24, weight: 600 },
    { size: 16, line: 24, weight: 600 },
    { size: 16, line: 24, weight: 600 },
] as const;
/** A block's painted box plus the margins that separate it from its neighbours. */
type Block = { readonly height: number; readonly marginTop: number; readonly marginBottom: number };
/* Only fenced code carries a margin of its own; every other block relies on the
   `> * + *` stacking rule, which never applies to the body's first child. */
const flow = (height: number): Block => ({ height, marginTop: 0, marginBottom: 0 });
/** Height of a bullet or ordered list, including its nesting. */
function listHeight(
    lines: readonly string[],
    measure: number,
    cache: MessageTextLayoutCache,
): number {
    const font = `${PARAGRAPH_SIZE}px ${UI_FAMILY}`;
    const levels = lines.map((line) => Math.floor((LIST_ITEM.exec(line)?.[1]?.length ?? 0) / 2));
    /* `li + li` opens 6px between siblings of one list. An item that opens a
       nested list is that list's first child and takes no leading; closing back
       out to a shallower level resumes the run it left. */
    const opened: boolean[] = [];
    let total = 0;
    for (const [index, line] of lines.entries()) {
        const level = levels[index]!;
        total += runHeight(
            line.replace(LIST_ITEM, ""),
            font,
            PARAGRAPH_LINE,
            measure - LIST_INDENT * (level + 1),
            cache,
        );
        if (opened[level]) total += LIST_ITEM_GAP;
        opened[level] = true;
        opened.length = level + 1;
    }
    return total;
}
/**
 * One Markdown block's painted box. Every shape a chat body actually produces is
 * modelled from its own type ramp: prose, the six headings, lists with their
 * nesting, fenced code, tables, rules, and quotes. A blockquote is measured as
 * the prose inside it, which is a floor rather than a truth when it holds
 * several blocks — and the row's own measurement corrects it.
 */
function blockHeight(block: string, measure: number, cache: MessageTextLayoutCache): Block {
    const lines = block.split("\n");
    if (FENCE.test(block)) {
        /* `pre code` sets `white-space: pre`, so a code line never wraps however
           long it is, and the card carries its own 12px margins. */
        const code = lines.filter((line) => !FENCE.test(line));
        return {
            height: CODE_PADDING * 2 + Math.max(1, code.length) * CODE_LINE,
            marginTop: CODE_GAP,
            marginBottom: CODE_GAP,
        };
    }
    if (RULE.test(block)) return flow(RULE_HEIGHT);
    if (TABLE_ROW.test(lines[0] ?? "")) {
        /* A GFM table drops its delimiter row; every remaining row is one line of
           cell text in its 8px vertical padding, over collapsed 1px borders. */
        const rows = lines.filter((line) => !/^\s*\|[\s:|-]*\|\s*$/u.test(line)).length;
        return flow(rows * (PARAGRAPH_LINE + TABLE_CELL_PADDING * 2) + rows + 1);
    }
    const heading = HEADING.exec(block);
    if (heading) {
        const ramp = HEADINGS[heading[1]!.length - 1]!;
        return flow(
            runHeight(
                block.replace(HEADING, "").replace(/\n/gu, " ").trim(),
                `${ramp.weight} ${ramp.size}px ${UI_FAMILY}`,
                ramp.line,
                measure,
                cache,
            ),
        );
    }
    if (lines.every((line) => LIST_ITEM.test(line))) return flow(listHeight(lines, measure, cache));
    const quoted = QUOTE.test(lines[0] ?? "");
    const text = (quoted ? lines.map((line) => line.replace(QUOTE, "")) : lines).join(" ").trim();
    const height = runHeight(
        text,
        `${PARAGRAPH_SIZE}px ${UI_FAMILY}`,
        PARAGRAPH_LINE,
        measure - (quoted ? QUOTE_INSET : 0),
        cache,
    );
    return quoted ? { height, marginTop: QUOTE_MARGIN, marginBottom: QUOTE_MARGIN } : flow(height);
}
/**
 * Painted height of a Markdown message body wrapped at `measure` px. Adjacent
 * block margins collapse to the larger of the two, exactly as they do in flow,
 * and only a block carrying its own margin (fenced code) contributes one at the
 * body's outer edges. An empty body still occupies one line box, matching the
 * anchor paragraph a streaming reply keeps so an empty generation cannot
 * collapse its row.
 */
export function markdownBodyHeight(
    text: string,
    measure: number,
    cache: MessageTextLayoutCache = sharedCache,
): number {
    const ready = cacheReady(cache);
    let byMeasure = ready.markdownHeights[text];
    if (!byMeasure) {
        byMeasure = dictionaryCreate();
        ready.markdownHeights[text] = byMeasure;
    }
    const measureKey = String(measure);
    const cached = byMeasure[measureKey];
    if (cached !== undefined) return cached;
    const blocks = text
        .split(/\n{2,}/u)
        .filter((block) => block.trim().length > 0)
        .map((block) => blockHeight(block, measure, ready));
    const first = blocks[0];
    if (!first) {
        byMeasure[measureKey] = PARAGRAPH_LINE;
        return PARAGRAPH_LINE;
    }
    let total = first.height + first.marginTop;
    for (let index = 1; index < blocks.length; index += 1) {
        const previous = blocks[index - 1]!;
        const block = blocks[index]!;
        total += Math.max(previous.marginBottom, BLOCK_GAP, block.marginTop) + block.height;
    }
    const height = total + blocks[blocks.length - 1]!.marginBottom;
    byMeasure[measureKey] = height;
    return height;
}
/** Painted height of a service line's 13px copy wrapped at `measure` px. */
export function noticeTextHeight(
    text: string,
    measure: number,
    cache: MessageTextLayoutCache = sharedCache,
): number {
    return runHeight(text, `${NOTICE_SIZE}px ${UI_FAMILY}`, NOTICE_LINE, measure, cache);
}
/**
 * Width of the 11px mono time that shares the own-message bubble line. It is
 * transparent until hover but always in flow, so it takes real measure away
 * from the bubble beside it.
 */
export function asideTimeWidth(time: string, cache: MessageTextLayoutCache = sharedCache): number {
    if (time.length === 0) return 0;
    const ready = cacheReady(cache);
    const font = `11px ${MONO_FAMILY}`;
    let byText = ready.naturalWidths[font];
    if (!byText) {
        byText = dictionaryCreate();
        ready.naturalWidths[font] = byText;
    }
    const hit = byText[time];
    if (hit !== undefined) return hit;
    const width = measureNaturalWidth(prepareWithSegments(time, font, { whiteSpace: "normal" }));
    byText[time] = width;
    return width;
}
