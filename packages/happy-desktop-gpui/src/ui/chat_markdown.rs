//! Safe, deterministic chat Markdown for the native transcript.
//!
//! This is deliberately a bounded GFM-shaped projection, not an HTML renderer.
//! Raw HTML is always text and image syntax becomes a non-loading attachment label.

use gpui::{
    AnyElement, App, FontWeight, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px,
};
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

use super::theme_roles::ThemeRole;
use crate::{fonts, theme::Theme};

pub const MARKDOWN_MAX_BYTES: usize = 256 * 1024;
pub const MARKDOWN_MAX_BLOCKS: usize = 2_048;
pub const MARKDOWN_MAX_NODES: usize = 8_192;
pub const MARKDOWN_MAX_DEPTH: usize = 8;
pub const MARKDOWN_MAX_CODE_LINES: usize = 4_096;
const MARKDOWN_MAX_TABLE_COLUMNS: usize = 32;
const MARKDOWN_MAX_LINK_BYTES: usize = 2_048;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarkdownInline {
    Text(SharedString),
    Strong(Vec<MarkdownInline>),
    Emphasis(Vec<MarkdownInline>),
    Strikethrough(Vec<MarkdownInline>),
    Code(SharedString),
    /// Parsing guarantees that `destination` is an absolute HTTP(S) URL.
    Link {
        content: Vec<MarkdownInline>,
        destination: SharedString,
    },
    ImageSuppressed {
        alt: SharedString,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarkdownListItem {
    pub depth: usize,
    pub task: Option<bool>,
    pub content: Vec<MarkdownInline>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarkdownBlock {
    Paragraph(Vec<MarkdownInline>),
    Heading {
        level: u8,
        content: Vec<MarkdownInline>,
    },
    Quote {
        depth: usize,
        content: Vec<MarkdownInline>,
    },
    List {
        ordered: bool,
        items: Vec<MarkdownListItem>,
    },
    Table {
        header: Vec<Vec<MarkdownInline>>,
        rows: Vec<Vec<Vec<MarkdownInline>>>,
    },
    Code {
        language: Option<SharedString>,
        text: SharedString,
        line_count: usize,
    },
    Rule,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MarkdownDocument {
    pub blocks: Vec<MarkdownBlock>,
    pub truncated: bool,
}

#[derive(Default)]
struct ParseBudget {
    nodes: usize,
    truncated: bool,
}

impl ParseBudget {
    fn take(&mut self) -> bool {
        if self.nodes >= MARKDOWN_MAX_NODES {
            self.truncated = true;
            false
        } else {
            self.nodes += 1;
            true
        }
    }
}

#[derive(Default)]
struct InlineTarget {
    root: Vec<MarkdownInline>,
    stack: Vec<InlineFrame>,
}

struct InlineFrame {
    kind: InlineKind,
    content: Vec<MarkdownInline>,
}

enum InlineKind {
    Strong,
    Emphasis,
    Strikethrough,
    Link(Option<SharedString>),
    Image,
    Transparent,
}

impl InlineTarget {
    fn start(&mut self, kind: InlineKind, budget: &mut ParseBudget) {
        let kind = if self.stack.len() >= MARKDOWN_MAX_DEPTH {
            budget.truncated = true;
            InlineKind::Transparent
        } else {
            kind
        };
        self.stack.push(InlineFrame {
            kind,
            content: Vec::new(),
        });
    }

    fn end(&mut self, budget: &mut ParseBudget) {
        let Some(frame) = self.stack.pop() else {
            return;
        };
        let node = match frame.kind {
            InlineKind::Strong => Some(MarkdownInline::Strong(frame.content)),
            InlineKind::Emphasis => Some(MarkdownInline::Emphasis(frame.content)),
            InlineKind::Strikethrough => Some(MarkdownInline::Strikethrough(frame.content)),
            InlineKind::Link(Some(destination)) => Some(MarkdownInline::Link {
                content: frame.content,
                destination,
            }),
            // Unsafe destinations stay visible as inert label content.
            InlineKind::Link(None) | InlineKind::Transparent => {
                for child in frame.content {
                    self.push_existing(child);
                }
                None
            }
            InlineKind::Image => Some(MarkdownInline::ImageSuppressed {
                alt: inline_plain_text(&frame.content).into(),
            }),
        };
        if let Some(node) = node {
            self.push(node, budget);
        }
    }

    fn text(&mut self, text: &str, budget: &mut ParseBudget) {
        if !text.is_empty() {
            self.push(MarkdownInline::Text(text.to_owned().into()), budget);
        }
    }

    fn push_existing(&mut self, node: MarkdownInline) {
        let destination = self
            .stack
            .last_mut()
            .map(|frame| &mut frame.content)
            .unwrap_or(&mut self.root);
        if let MarkdownInline::Text(text) = &node
            && let Some(MarkdownInline::Text(previous)) = destination.last_mut()
        {
            let mut joined = previous.to_string();
            joined.push_str(text);
            *previous = joined.into();
        } else {
            destination.push(node);
        }
    }

    fn push(&mut self, node: MarkdownInline, budget: &mut ParseBudget) {
        let destination = self
            .stack
            .last_mut()
            .map(|frame| &mut frame.content)
            .unwrap_or(&mut self.root);
        if let MarkdownInline::Text(text) = &node
            && let Some(MarkdownInline::Text(previous)) = destination.last_mut()
        {
            let mut joined = previous.to_string();
            joined.push_str(text);
            *previous = joined.into();
            return;
        }
        if budget.take() {
            destination.push(node);
        }
    }

    fn finish(mut self, budget: &mut ParseBudget) -> Vec<MarkdownInline> {
        while !self.stack.is_empty() {
            self.end(budget);
        }
        self.root
    }
}

struct OpenBlock {
    kind: OpenBlockKind,
    inline: InlineTarget,
}

enum OpenBlockKind {
    Paragraph,
    Heading(u8),
    Quote(usize),
}

struct OpenItem {
    ordinal: usize,
    depth: usize,
    task: Option<bool>,
    inline: InlineTarget,
}

#[derive(Default)]
struct OpenTable {
    header: Vec<Vec<MarkdownInline>>,
    rows: Vec<Vec<Vec<MarkdownInline>>>,
    row: Vec<Vec<MarkdownInline>>,
    cell: Option<InlineTarget>,
    in_header: bool,
}

struct OpenCode {
    language: Option<SharedString>,
    text: String,
}

struct DocumentBuilder {
    blocks: Vec<MarkdownBlock>,
    budget: ParseBudget,
    quote_depth: usize,
    lists: Vec<bool>,
    list_block: Option<(bool, Vec<(usize, MarkdownListItem)>)>,
    item_ordinal: usize,
    items: Vec<OpenItem>,
    block: Option<OpenBlock>,
    table: Option<OpenTable>,
    code: Option<OpenCode>,
}

impl DocumentBuilder {
    fn new() -> Self {
        Self {
            blocks: Vec::new(),
            budget: ParseBudget::default(),
            quote_depth: 0,
            lists: Vec::new(),
            list_block: None,
            item_ordinal: 0,
            items: Vec::new(),
            block: None,
            table: None,
            code: None,
        }
    }

    fn inline(&mut self) -> Option<&mut InlineTarget> {
        if let Some(table) = self.table.as_mut() {
            if table.cell.is_some() {
                return table.cell.as_mut();
            }
        }
        if let Some(item) = self.items.last_mut() {
            return Some(&mut item.inline);
        }
        self.block.as_mut().map(|block| &mut block.inline)
    }

    fn push_block(&mut self, block: MarkdownBlock) {
        if self.blocks.len() >= MARKDOWN_MAX_BLOCKS {
            self.budget.truncated = true;
        } else if self.budget.take() {
            self.blocks.push(block);
        }
    }

    fn start_inline(&mut self, kind: InlineKind) {
        let mut budget = std::mem::take(&mut self.budget);
        if let Some(inline) = self.inline() {
            inline.start(kind, &mut budget);
        }
        self.budget = budget;
    }
    fn end_inline(&mut self) {
        let mut budget = std::mem::take(&mut self.budget);
        if let Some(inline) = self.inline() {
            inline.end(&mut budget);
        }
        self.budget = budget;
    }
    fn text(&mut self, text: &str) {
        if let Some(code) = self.code.as_mut() {
            code.text.push_str(text);
            return;
        }
        let mut budget = std::mem::take(&mut self.budget);
        if let Some(inline) = self.inline() {
            inline.text(text, &mut budget);
        }
        self.budget = budget;
    }

    fn html_text(&mut self, text: &str) {
        if self.code.is_none()
            && self.table.is_none()
            && self.items.is_empty()
            && self.block.is_none()
        {
            self.block = Some(OpenBlock {
                kind: OpenBlockKind::Paragraph,
                inline: InlineTarget::default(),
            });
        }
        self.text(text);
    }

    fn finish_block(&mut self) {
        let Some(block) = self.block.take() else {
            return;
        };
        let content = block.inline.finish(&mut self.budget);
        let block = match block.kind {
            OpenBlockKind::Paragraph => MarkdownBlock::Paragraph(content),
            OpenBlockKind::Heading(level) => MarkdownBlock::Heading { level, content },
            OpenBlockKind::Quote(depth) => MarkdownBlock::Quote { depth, content },
        };
        self.push_block(block);
    }

    fn finish_list(&mut self) {
        if !self.lists.is_empty() {
            return;
        }
        if let Some((ordered, mut indexed_items)) = self.list_block.take() {
            indexed_items.sort_by_key(|(ordinal, _)| *ordinal);
            let items = indexed_items.into_iter().map(|(_, item)| item).collect();
            self.push_block(MarkdownBlock::List { ordered, items });
        }
    }

    fn event(&mut self, event: Event<'_>) {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    if self.items.is_empty() && self.table.is_none() {
                        self.finish_block();
                        self.block = Some(OpenBlock {
                            kind: if self.quote_depth > 0 {
                                OpenBlockKind::Quote(self.quote_depth.min(MARKDOWN_MAX_DEPTH))
                            } else {
                                OpenBlockKind::Paragraph
                            },
                            inline: InlineTarget::default(),
                        });
                    }
                }
                Tag::Heading { level, .. } => {
                    self.finish_block();
                    self.block = Some(OpenBlock {
                        kind: OpenBlockKind::Heading(heading_level(level)),
                        inline: InlineTarget::default(),
                    })
                }
                Tag::BlockQuote(_) => {
                    self.quote_depth += 1;
                    if self.quote_depth > MARKDOWN_MAX_DEPTH {
                        self.budget.truncated = true;
                    }
                }
                Tag::CodeBlock(kind) => {
                    self.code = Some(OpenCode {
                        language: match kind {
                            CodeBlockKind::Fenced(info) if !info.trim().is_empty() => {
                                Some(info.trim().to_owned().into())
                            }
                            _ => None,
                        },
                        text: String::new(),
                    })
                }
                Tag::List(start) => {
                    let ordered = start.is_some();
                    if self.lists.is_empty() {
                        self.list_block = Some((ordered, Vec::new()));
                    }
                    self.lists.push(ordered);
                    if self.lists.len() > MARKDOWN_MAX_DEPTH {
                        self.budget.truncated = true;
                    }
                }
                Tag::Item => {
                    let ordinal = self.item_ordinal;
                    self.item_ordinal += 1;
                    self.items.push(OpenItem {
                        ordinal,
                        depth: self
                            .lists
                            .len()
                            .saturating_sub(1)
                            .min(MARKDOWN_MAX_DEPTH - 1),
                        task: None,
                        inline: InlineTarget::default(),
                    });
                }
                Tag::Table(_) => self.table = Some(OpenTable::default()),
                Tag::TableHead => {
                    if let Some(table) = self.table.as_mut() {
                        table.in_header = true;
                    }
                }
                Tag::TableRow => {
                    if let Some(table) = self.table.as_mut() {
                        table.row.clear();
                    }
                }
                Tag::TableCell => {
                    if let Some(table) = self.table.as_mut() {
                        table.cell = Some(InlineTarget::default());
                    }
                }
                Tag::Emphasis => self.start_inline(InlineKind::Emphasis),
                Tag::Strong => self.start_inline(InlineKind::Strong),
                Tag::Strikethrough => self.start_inline(InlineKind::Strikethrough),
                Tag::Link { dest_url, .. } => self.start_inline(InlineKind::Link(
                    safe_http_destination(&dest_url).then(|| dest_url.to_string().into()),
                )),
                Tag::Image { .. } => self.start_inline(InlineKind::Image),
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Paragraph => {
                    if self.items.is_empty() && self.table.is_none() {
                        self.finish_block();
                    }
                }
                TagEnd::Heading(_) => self.finish_block(),
                TagEnd::BlockQuote(_) => self.quote_depth = self.quote_depth.saturating_sub(1),
                TagEnd::CodeBlock => {
                    if let Some(code) = self.code.take() {
                        let (text, line_count, cut) = bounded_code(&code.text);
                        self.budget.truncated |= cut;
                        self.push_block(MarkdownBlock::Code {
                            language: code.language,
                            text: text.into(),
                            line_count,
                        });
                    }
                }
                TagEnd::List(_) => {
                    self.lists.pop();
                    self.finish_list();
                }
                TagEnd::Item => {
                    if let Some(item) = self.items.pop() {
                        let ordinal = item.ordinal;
                        let item = MarkdownListItem {
                            depth: item.depth,
                            task: item.task,
                            content: item.inline.finish(&mut self.budget),
                        };
                        if self.budget.take() {
                            if let Some((_, items)) = self.list_block.as_mut() {
                                items.push((ordinal, item));
                            }
                        }
                    }
                }
                TagEnd::Table => {
                    if let Some(table) = self.table.take() {
                        self.push_block(MarkdownBlock::Table {
                            header: table.header,
                            rows: table.rows,
                        });
                    }
                }
                TagEnd::TableHead => {
                    if let Some(table) = self.table.as_mut() {
                        table.header = std::mem::take(&mut table.row);
                        table.in_header = false;
                    }
                }
                TagEnd::TableRow => {
                    if self.budget.take()
                        && let Some(table) = self.table.as_mut()
                    {
                        let row = std::mem::take(&mut table.row);
                        if table.in_header {
                            table.header = row;
                        } else {
                            table.rows.push(row);
                        }
                    }
                }
                TagEnd::TableCell => {
                    let mut budget = std::mem::take(&mut self.budget);
                    if budget.take()
                        && let Some(table) = self.table.as_mut()
                        && table.row.len() < MARKDOWN_MAX_TABLE_COLUMNS
                        && let Some(cell) = table.cell.take()
                    {
                        table.row.push(cell.finish(&mut budget));
                    }
                    self.budget = budget;
                }
                TagEnd::Emphasis
                | TagEnd::Strong
                | TagEnd::Strikethrough
                | TagEnd::Link
                | TagEnd::Image => self.end_inline(),
                _ => {}
            },
            Event::Text(text) => self.text(&text),
            Event::Html(text) | Event::InlineHtml(text) => self.html_text(&text),
            Event::Code(text) => {
                let mut budget = std::mem::take(&mut self.budget);
                if let Some(inline) = self.inline() {
                    inline.push(MarkdownInline::Code(text.to_string().into()), &mut budget);
                }
                self.budget = budget;
            }
            Event::SoftBreak => self.text(" "),
            Event::HardBreak => self.text("\n"),
            Event::Rule => self.push_block(MarkdownBlock::Rule),
            Event::TaskListMarker(checked) => {
                if let Some(item) = self.items.last_mut() {
                    item.task = Some(checked);
                }
            }
            _ => {}
        }
    }
}

impl MarkdownDocument {
    pub fn parse(source: &str) -> Self {
        let (source, byte_truncated) = truncate_utf8(source, MARKDOWN_MAX_BYTES);
        let options =
            Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH;
        let mut builder = DocumentBuilder::new();
        for event in Parser::new_ext(source, options) {
            builder.event(event);
        }
        builder.finish_block();
        builder.finish_list();
        Self {
            blocks: builder.blocks,
            truncated: byte_truncated || builder.budget.truncated,
        }
    }
}

fn truncate_utf8(source: &str, max: usize) -> (&str, bool) {
    if source.len() <= max {
        return (source, false);
    }
    let mut end = max;
    while !source.is_char_boundary(end) {
        end -= 1;
    }
    (&source[..end], true)
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn bounded_code(text: &str) -> (String, usize, bool) {
    let mut lines = text.lines();
    let kept: Vec<_> = lines.by_ref().take(MARKDOWN_MAX_CODE_LINES).collect();
    let cut = lines.next().is_some();
    let line_count = kept.len().max(1);
    (kept.join("\n"), line_count, cut)
}

fn inline_plain_text(parts: &[MarkdownInline]) -> String {
    let mut result = String::new();
    for part in parts {
        match part {
            MarkdownInline::Text(value) | MarkdownInline::Code(value) => result.push_str(value),
            MarkdownInline::Strong(content)
            | MarkdownInline::Emphasis(content)
            | MarkdownInline::Strikethrough(content) => {
                result.push_str(&inline_plain_text(content))
            }
            MarkdownInline::Link { content, .. } => result.push_str(&inline_plain_text(content)),
            MarkdownInline::ImageSuppressed { alt } => result.push_str(alt),
        }
    }
    result
}

fn safe_http_destination(destination: &str) -> bool {
    destination.len() <= MARKDOWN_MAX_LINK_BYTES
        && (destination.starts_with("https://") || destination.starts_with("http://"))
        && destination
            .split_once("://")
            .is_some_and(|(_, rest)| !rest.is_empty())
        && !destination.chars().any(char::is_whitespace)
        && !destination.chars().any(char::is_control)
}

#[derive(IntoElement)]
pub struct ChatMarkdown {
    pub id: SharedString,
    pub theme: Theme,
    pub document: MarkdownDocument,
}

impl RenderOnce for ChatMarkdown {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let debug_id = id.clone();
        let theme = self.theme;
        div()
            .debug_selector(move || format!("{debug_id}.root"))
            .w_full()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::AgentMessageText))
            .children(
                self.document
                    .blocks
                    .into_iter()
                    .enumerate()
                    .map(move |(index, block)| render_block(block, index, theme, id.clone())),
            )
            .when(self.document.truncated, |view| {
                view.child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child("Content truncated"),
                )
            })
    }
}

fn inline_text(
    parts: Vec<MarkdownInline>,
    theme: Theme,
    scope: impl Into<SharedString>,
) -> AnyElement {
    inline_text_at(parts, theme, scope.into(), String::new())
}

fn inline_text_at(
    parts: Vec<MarkdownInline>,
    theme: Theme,
    scope: SharedString,
    parent_path: String,
) -> AnyElement {
    let mut row = div().flex().flex_wrap().items_baseline();
    for (index, part) in parts.into_iter().enumerate() {
        let path = if parent_path.is_empty() {
            index.to_string()
        } else {
            format!("{parent_path}-{index}")
        };
        row = row.child(match part {
            MarkdownInline::Text(text) => div().child(text).into_any_element(),
            MarkdownInline::Strong(content) => div()
                .font_weight(FontWeight::BOLD)
                .child(inline_text_at(content, theme, scope.clone(), path))
                .into_any_element(),
            MarkdownInline::Emphasis(content) => div()
                .italic()
                .child(inline_text_at(content, theme, scope.clone(), path))
                .into_any_element(),
            MarkdownInline::Strikethrough(content) => div()
                .line_through()
                .child(inline_text_at(content, theme, scope.clone(), path))
                .into_any_element(),
            MarkdownInline::Code(text) => div()
                .mx(px(2.0))
                .px(px(4.0))
                .rounded(px(4.0))
                .bg(theme.role(ThemeRole::SurfaceHigh))
                .font_family(fonts::MONO_FAMILY)
                .child(text)
                .into_any_element(),
            MarkdownInline::Link {
                content,
                destination,
            } => {
                let link_id = SharedString::from(format!("{scope}-link-{path}"));
                let debug_id = link_id.clone();
                let pointer = destination.clone();
                let keyboard = destination;
                div()
                    .id(link_id)
                    .debug_selector(move || format!("{debug_id}.root"))
                    .tab_index(0)
                    .cursor_pointer()
                    .px(px(1.0))
                    .border_b_1()
                    .border_color(theme.role(ThemeRole::TextLink))
                    .focus(|style| style.bg(theme.role(ThemeRole::SurfaceSelected)))
                    .text_color(theme.role(ThemeRole::TextLink))
                    .on_click(move |_, _, cx| cx.open_url(&pointer))
                    .on_key_down(move |event, _, cx| {
                        if !event.is_held
                            && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                        {
                            cx.stop_propagation();
                            cx.open_url(&keyboard);
                        }
                    })
                    .child(
                        div()
                            .debug_selector(|| "markdown.link".to_owned())
                            .child(inline_text_at(content, theme, scope.clone(), path)),
                    )
                    .into_any_element()
            }
            MarkdownInline::ImageSuppressed { alt } => div()
                .text_color(theme.role(ThemeRole::TextSecondary))
                .child(format!("[image: {alt}]"))
                .into_any_element(),
        });
    }
    row.into_any_element()
}

fn render_block(
    block: MarkdownBlock,
    index: usize,
    theme: Theme,
    document_id: SharedString,
) -> AnyElement {
    let block_id = SharedString::from(format!("{document_id}-block-{index}"));
    let root = div()
        .id(block_id.clone())
        .debug_selector(move || format!("markdown.block-{index}"))
        .w_full();
    match block {
        MarkdownBlock::Paragraph(parts) => root
            .text_size(px(14.0))
            .line_height(px(21.0))
            .child(inline_text(parts, theme, block_id))
            .into_any_element(),
        MarkdownBlock::Heading { level, content } => root
            .text_size(px(match level {
                1 => 22.0,
                2 => 19.0,
                _ => 16.0,
            }))
            .line_height(px(28.0))
            .font_weight(FontWeight::BOLD)
            .child(inline_text(content, theme, block_id))
            .into_any_element(),
        MarkdownBlock::Quote { depth, content } => root
            .pl(px(12.0 + (depth.saturating_sub(1) * 12) as f32))
            .border_l_2()
            .border_color(theme.role(ThemeRole::Divider))
            .text_color(theme.role(ThemeRole::TextSecondary))
            .child(inline_text(content, theme, block_id))
            .into_any_element(),
        MarkdownBlock::List { ordered, items } => {
            let scope = block_id;
            root.flex()
                .flex_col()
                .gap(px(4.0))
                .children(items.into_iter().enumerate().map(move |(i, item)| {
                    let marker = match item.task {
                        Some(true) => "[x]".to_owned(),
                        Some(false) => "[ ]".to_owned(),
                        None if ordered => format!("{}.", i + 1),
                        None => "•".to_owned(),
                    };
                    div()
                        .flex()
                        .gap(px(8.0))
                        .pl(px((item.depth * 16) as f32))
                        .child(marker)
                        .child(inline_text(
                            item.content,
                            theme,
                            format!("{scope}-item-{i}"),
                        ))
                }))
                .into_any_element()
        }
        MarkdownBlock::Table { header, rows } => {
            let scope = block_id;
            root.flex()
                .flex_col()
                .border_1()
                .border_color(theme.role(ThemeRole::Divider))
                .child(render_table_row(
                    header,
                    true,
                    theme,
                    format!("{scope}-header"),
                ))
                .children(rows.into_iter().enumerate().map(move |(row_index, row)| {
                    render_table_row(row, false, theme, format!("{scope}-row-{row_index}"))
                }))
                .into_any_element()
        }
        MarkdownBlock::Code { language, text, .. } => root
            .flex()
            .flex_col()
            .rounded(px(8.0))
            .bg(theme.role(ThemeRole::SurfaceHigh))
            .when_some(language, |v, language| {
                v.child(
                    div()
                        .px(px(12.0))
                        .pt(px(8.0))
                        .text_size(px(11.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(language),
                )
            })
            .child(
                div()
                    .p(px(12.0))
                    .font_family(fonts::MONO_FAMILY)
                    .text_size(px(12.0))
                    .line_height(px(18.0))
                    .child(text),
            )
            .into_any_element(),
        MarkdownBlock::Rule => root
            .h(px(1.0))
            .bg(theme.role(ThemeRole::Divider))
            .into_any_element(),
    }
}

fn render_table_row(
    cells: Vec<Vec<MarkdownInline>>,
    header: bool,
    theme: Theme,
    scope: impl Into<SharedString>,
) -> AnyElement {
    let scope = scope.into();
    div()
        .flex()
        .w_full()
        .border_b_1()
        .border_color(theme.role(ThemeRole::Divider))
        .children(
            cells
                .into_iter()
                .enumerate()
                .map(move |(cell_index, cell)| {
                    div()
                        .flex_1()
                        .min_w_0()
                        .p(px(8.0))
                        .when(header, |cell| cell.font_weight(FontWeight::BOLD))
                        .child(inline_text(
                            cell,
                            theme,
                            format!("{scope}-cell-{cell_index}"),
                        ))
                }),
        )
        .into_any_element()
}

/// Width-sensitive deterministic estimate used before GPUI measures a row.
pub fn markdown_height(document: &MarkdownDocument, width: f32) -> f32 {
    let columns = ((width.max(80.0) - 8.0) / 7.2).floor().max(8.0) as usize;
    let mut height = 0.0;
    for block in &document.blocks {
        let block_height = match block {
            MarkdownBlock::Paragraph(parts) | MarkdownBlock::Quote { content: parts, .. } => {
                21.0 * wrapped_lines(inline_len(parts), columns) as f32
            }
            MarkdownBlock::Heading { level, content } => {
                (if *level <= 2 { 28.0 } else { 24.0 })
                    * wrapped_lines(inline_len(content), columns) as f32
            }
            MarkdownBlock::List { items, .. } => items
                .iter()
                .map(|item| {
                    21.0 * wrapped_lines(
                        inline_len(&item.content) + 3,
                        columns.saturating_sub(3 + item.depth * 2),
                    ) as f32
                })
                .sum(),
            MarkdownBlock::Table { header, rows } => {
                let row_count = rows.len() + 1;
                let cell_columns = columns / header.len().max(1);
                let header_lines = header
                    .iter()
                    .map(|cell| wrapped_lines(inline_len(cell), cell_columns))
                    .max()
                    .unwrap_or(1);
                let body_lines: usize = rows
                    .iter()
                    .map(|row| {
                        row.iter()
                            .map(|cell| wrapped_lines(inline_len(cell), cell_columns))
                            .max()
                            .unwrap_or(1)
                    })
                    .sum();
                17.0 * (header_lines + body_lines) as f32 + 16.0 * row_count as f32
            }
            MarkdownBlock::Code {
                line_count, text, ..
            } => 24.0 + 18.0 * (*line_count).max(wrapped_lines(text.len(), columns)) as f32,
            MarkdownBlock::Rule => 1.0,
        };
        if height > 0.0 {
            height += 8.0;
        }
        height += block_height;
    }
    if document.truncated {
        height += 24.0;
    }
    height
}

fn inline_len(parts: &[MarkdownInline]) -> usize {
    parts
        .iter()
        .map(|part| match part {
            MarkdownInline::Text(value) | MarkdownInline::Code(value) => value.len(),
            MarkdownInline::Strong(content)
            | MarkdownInline::Emphasis(content)
            | MarkdownInline::Strikethrough(content) => inline_len(content),
            MarkdownInline::Link { content, .. } => inline_len(content),
            MarkdownInline::ImageSuppressed { alt } => alt.len() + 9,
        })
        .sum()
}

fn wrapped_lines(len: usize, columns: usize) -> usize {
    len.max(1).div_ceil(columns.max(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_inline_escapes_underscore_emphasis_and_autolinks() {
        let doc = MarkdownDocument::parse(
            r"**bold [safe](https://example.com/path)** \*literal\* _emphasis_ <https://example.org>",
        );
        let MarkdownBlock::Paragraph(parts) = &doc.blocks[0] else {
            panic!("expected paragraph");
        };
        assert!(matches!(
            &parts[0],
            MarkdownInline::Strong(content)
                if content.iter().any(|part| matches!(part,
                    MarkdownInline::Link { destination, .. }
                    if destination == "https://example.com/path"))
        ));
        assert!(parts.iter().any(|part| matches!(
            part,
            MarkdownInline::Text(text) if text.contains("*literal*")
        )));
        assert!(
            parts
                .iter()
                .any(|part| matches!(part, MarkdownInline::Emphasis(_)))
        );
        assert!(parts.iter().any(|part| matches!(
            part,
            MarkdownInline::Link { destination, .. }
                if destination == "https://example.org"
        )));
    }

    #[test]
    fn parses_gfm_tables_tasks_strikes_and_nested_blocks() {
        let doc = MarkdownDocument::parse(
            "| Name | State |\n| --- | :---: |\n| build | ~~old~~ new |\n\n- [x] shipped\n  - [ ] follow-up\n\n> > nested",
        );
        assert!(
            matches!(&doc.blocks[0], MarkdownBlock::Table { header, rows } if header.len() == 2 && rows.len() == 1)
        );
        assert!(
            matches!(&doc.blocks[1], MarkdownBlock::List { items, .. } if items.len() == 2 && items[0].task == Some(true) && items[1].depth == 1)
        );
        assert!(matches!(
            &doc.blocks[2],
            MarkdownBlock::Quote { depth: 2, .. }
        ));
        assert!(format!("{doc:?}").contains("Strikethrough"));
    }

    #[test]
    fn parser_never_materializes_html_remote_images_or_unsafe_links() {
        let doc = MarkdownDocument::parse(
            "<script>alert(1)</script>

![cat](https://bad/x.png) [bad](javascript:alert(1)) [ok](https://example.com)",
        );
        assert!(doc.blocks.iter().any(|block| matches!(
            block,
            MarkdownBlock::Paragraph(parts)
                if parts.iter().any(|part| matches!(part,
                    MarkdownInline::ImageSuppressed { alt } if alt == "cat"))
        )));
        assert!(format!("{doc:?}").contains("<script>"));
        assert!(!format!("{doc:?}").contains("destination: \"javascript:"));
        assert!(format!("{doc:?}").contains("https://example.com"));
    }

    #[test]
    fn malformed_streaming_input_stays_literal_and_all_limits_hold() {
        let malformed = format!("**open [link](https://example.com {}", "> ".repeat(20_000));
        let doc = MarkdownDocument::parse(&malformed);
        assert!(doc.blocks.len() <= MARKDOWN_MAX_BLOCKS);
        assert!(doc.truncated || malformed.len() <= MARKDOWN_MAX_BYTES);
        assert!(format!("{doc:?}").contains("**open"));
        let unicode = "é".repeat(MARKDOWN_MAX_BYTES);
        assert!(MarkdownDocument::parse(&unicode).truncated);
    }

    #[test]
    fn parser_and_estimator_are_bounded_and_width_sensitive() {
        let doc = MarkdownDocument::parse(&"word ".repeat(100_000));
        assert!(doc.truncated);
        assert!(doc.blocks.len() <= MARKDOWN_MAX_BLOCKS);
        assert!(markdown_height(&doc, 220.0) > markdown_height(&doc, 560.0));
    }

    #[gpui::test]
    fn repeated_destination_links_have_unique_pointer_and_keyboard_identity(
        cx: &mut gpui::TestAppContext,
    ) {
        use gpui::{Context, Modifiers, Render, size};
        struct Fixture {
            before: gpui::FocusHandle,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div()
                    .w(px(560.0))
                    .tab_index(0)
                    .track_focus(&self.before)
                    .child(ChatMarkdown {
                        id: "repeated-links".into(),
                        theme: Theme::light(),
                        document: MarkdownDocument::parse(
                            "[one](https://example.com/same) [two](https://example.com/same)",
                        ),
                    })
            }
        }
        let (view, cx) = cx.add_window_view(|_, cx| Fixture {
            before: cx.focus_handle().tab_index(0).tab_stop(true),
        });
        cx.simulate_resize(size(px(560.0), px(120.0)));
        cx.run_until_parked();
        let first = cx
            .debug_bounds("repeated-links-block-0-link-0.root")
            .unwrap();
        let second = cx
            .debug_bounds("repeated-links-block-0-link-2.root")
            .unwrap();
        assert_ne!(
            first, second,
            "repeated destinations retain occurrence identity"
        );
        cx.simulate_click(first.center(), Modifiers::default());
        assert_eq!(cx.opened_url().as_deref(), Some("https://example.com/same"));
        cx.simulate_click(second.center(), Modifiers::default());
        assert_eq!(cx.opened_url().as_deref(), Some("https://example.com/same"));

        cx.update(|window, app| {
            view.read(app).before.focus(window);
            window.focus_next();
        });
        cx.simulate_keystrokes("enter");
        assert_eq!(cx.opened_url().as_deref(), Some("https://example.com/same"));
        cx.update(|window, _| window.focus_next());
        cx.simulate_keystrokes("enter");
        assert_eq!(cx.opened_url().as_deref(), Some("https://example.com/same"));
    }

    #[gpui::test]
    fn markdown_has_real_narrow_wide_light_dark_geometry(cx: &mut gpui::TestAppContext) {
        use gpui::{Context, Modifiers, Render, size};
        struct Fixture {
            width: f32,
            dark: bool,
            before: gpui::FocusHandle,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div()
                    .w(px(self.width))
                    .tab_index(0)
                    .track_focus(&self.before)
                    .child(ChatMarkdown {
                    id: "markdown-tested".into(),
                    theme: if self.dark { Theme::dark() } else { Theme::light() },
                    document: MarkdownDocument::parse(
                        "# Heading\n\nA paragraph with **strong**, ~~old~~ text and [a link](https://example.com).\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```rs\nlet value = 42;\n```",
                    ),
                })
            }
        }
        let (view, cx) = cx.add_window_view(|_, cx| Fixture {
            width: 220.0,
            dark: false,
            before: cx.focus_handle(),
        });
        cx.simulate_resize(size(px(560.0), px(500.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        let narrow = cx.debug_bounds("markdown-tested.root").unwrap();
        assert_eq!(narrow.size.width, px(220.0));
        assert!(narrow.size.height > px(80.0));
        let link = cx.debug_bounds("markdown.link").unwrap();
        cx.update(|window, app| {
            view.read(app).before.focus(window);
            window.focus_next();
        });
        cx.simulate_keystrokes("enter");
        assert_eq!(
            cx.opened_url().as_deref(),
            Some("https://example.com"),
            "safe links are keyboard operable",
        );
        cx.simulate_click(link.center(), Modifiers::default());
        assert_eq!(cx.opened_url().as_deref(), Some("https://example.com"));
        view.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            fixture.dark = true;
            cx.notify();
        });
        cx.run_until_parked();
        let wide = cx.debug_bounds("markdown-tested.root").unwrap();
        assert_eq!(wide.size.width, px(560.0));
        assert!(wide.size.height > px(80.0));
    }
}
