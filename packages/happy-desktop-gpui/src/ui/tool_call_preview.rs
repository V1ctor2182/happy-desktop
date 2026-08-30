use std::{rc::Rc, sync::Arc};

use gpui::{
    App, Entity, FocusHandle, FontWeight, IntoElement, RenderOnce, SharedString, Window, div,
    prelude::*, px,
};

use super::{
    Button, ButtonVariant, ControlSize,
    components::ScrollSurface,
    icon::{Icon, IconName},
    scrollbar::ScrollbarState,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const TOOL_PREVIEW_MAX_DIFF_LINES: usize = 400;
pub const TOOL_PREVIEW_MAX_FILES: usize = 40;
pub const TOOL_PREVIEW_MAX_OPERATIONS: usize = 200;
pub const TOOL_PREVIEW_MAX_SEARCH_SOURCES: usize = 100;
pub const TOOL_PREVIEW_MAX_TEXT_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolCallStatus {
    AwaitingApproval,
    Running,
    Stopped,
    Completed,
    Failed,
}
impl ToolCallStatus {
    fn label(self) -> &'static str {
        match self {
            Self::AwaitingApproval => "Awaiting approval",
            Self::Running => "Running",
            Self::Stopped => "Stopped",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolDiffLineKind {
    Add,
    Delete,
    Context,
}
#[derive(Clone)]
pub struct ToolDiffLine {
    pub kind: ToolDiffLineKind,
    pub old_number: Option<u32>,
    pub new_number: Option<u32>,
    pub text: SharedString,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolDiffFileKind {
    Add,
    Delete,
    Update,
}
#[derive(Clone)]
pub struct ToolDiffFile {
    pub path: SharedString,
    pub kind: ToolDiffFileKind,
    pub language: Option<SharedString>,
    pub added: u32,
    pub deleted: u32,
    pub omitted_lines: Option<u64>,
    pub lines: Vec<ToolDiffLine>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolExplorationKind {
    List,
    Read,
    Search,
}
impl ToolExplorationKind {
    fn label(self) -> &'static str {
        match self {
            Self::List => "List",
            Self::Read => "Read",
            Self::Search => "Search",
        }
    }
}
#[derive(Clone)]
pub struct ToolExplorationOperation {
    pub kind: ToolExplorationKind,
    pub target: SharedString,
}

/// A closed, authoritative presentation selected by the owned producer layer.
/// The view never examines a tool name or argument shape to choose a variant.
#[derive(Clone)]
pub enum ToolSearchTarget {
    Web,
    X,
}

impl ToolSearchTarget {
    fn label(self) -> &'static str {
        match self {
            Self::Web => "Web search",
            Self::X => "X search",
        }
    }
}

#[derive(Clone)]
pub struct ToolSearchSource {
    pub title: SharedString,
    pub url: SharedString,
}

#[derive(Clone)]
pub enum ToolCallPresentation {
    ExecCommand {
        command: SharedString,
        output: SharedString,
        terminal_id: Option<SharedString>,
    },
    BackgroundTerminalInteraction {
        command: SharedString,
        input: SharedString,
        terminal_id: SharedString,
    },
    FileDiff {
        files: Vec<ToolDiffFile>,
        omitted_files: Option<u64>,
    },
    Exploration {
        operations: Vec<ToolExplorationOperation>,
        omitted_operations: Option<u64>,
    },
    Search {
        query: SharedString,
        target: ToolSearchTarget,
        sources: Vec<ToolSearchSource>,
        omitted_sources: Option<u64>,
    },
    /// Exact JSON fallback used only when the authoritative message has no typed presentation.
    Generic { arguments_json: SharedString },
}
impl ToolCallPresentation {
    fn title(&self) -> &'static str {
        match self {
            Self::ExecCommand { .. } | Self::BackgroundTerminalInteraction { .. } => "Terminal",
            Self::FileDiff { .. } => "File edit",
            Self::Search { .. } => "Search",
            Self::Exploration { .. } | Self::Generic { .. } => "Tool call",
        }
    }
    fn icon(&self) -> IconName {
        match self {
            Self::ExecCommand { .. } | Self::BackgroundTerminalInteraction { .. } => {
                IconName::Terminal
            }
            Self::FileDiff { .. } => IconName::Doc,
            Self::Search { .. } | Self::Exploration { .. } | Self::Generic { .. } => IconName::Zap,
        }
    }
}

#[derive(Clone)]
pub struct ToolCallPreviewData {
    pub tool_name: SharedString,
    /// Human-readable label is explicit; the component does not humanize protocol names.
    pub tool_label: SharedString,
    pub status: ToolCallStatus,
    pub presentation: ToolCallPresentation,
    pub result: Option<SharedString>,
    pub failure: Option<SharedString>,
}

pub type ToolCallTerminalHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct ToolCallPreview {
    pub id: SharedString,
    pub theme: Theme,
    pub tool: Arc<ToolCallPreviewData>,
    pub vertical_scrollbar: Entity<ScrollbarState>,
    pub horizontal_scrollbar: Entity<ScrollbarState>,
    /// Separate caller-owned lifetime for terminal transcript scroll position.
    pub terminal_scrollbar: Entity<ScrollbarState>,
    /// Retained by the caller only when the typed presentation has an exact terminal identity.
    pub open_terminal_focus: Option<FocusHandle>,
    pub open_terminal_disabled: bool,
    pub on_open_terminal: Option<ToolCallTerminalHandler>,
}

fn bounded_text(value: SharedString) -> SharedString {
    if value.len() <= TOOL_PREVIEW_MAX_TEXT_BYTES {
        return value;
    }
    let mut end = TOOL_PREVIEW_MAX_TEXT_BYTES.min(value.len());
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}\n… output bounded at {} bytes",
        &value[..end],
        TOOL_PREVIEW_MAX_TEXT_BYTES
    )
    .into()
}
fn code_block(id: String, theme: Theme, text: SharedString, failed: bool) -> gpui::AnyElement {
    div()
        .debug_selector(move || id.clone())
        .w_full()
        .min_w_0()
        .flex_none()
        .p(px(10.0))
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .rounded(px(6.0))
        .bg(theme.role(ThemeRole::DiffContextBg))
        .font_family(fonts::MONO_FAMILY)
        .text_size(px(12.0))
        .line_height(px(18.0))
        .text_color(if failed {
            theme.role(ThemeRole::StatusError)
        } else {
            theme.role(ThemeRole::Text)
        })
        .child(bounded_text(text))
        .into_any_element()
}
fn labeled(
    id: String,
    theme: Theme,
    label: &'static str,
    body: gpui::AnyElement,
) -> gpui::AnyElement {
    div()
        .debug_selector(move || id.clone())
        .w_full()
        .min_w_0()
        .flex_none()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .h(px(16.0))
                .text_size(px(11.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.role(ThemeRole::TextSecondary))
                .child(label),
        )
        .child(body)
        .into_any_element()
}

impl RenderOnce for ToolCallPreview {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let status = self.tool.status;
        let failed = status == ToolCallStatus::Failed || self.tool.failure.is_some();
        let title = self.tool.presentation.title();
        let icon = self.tool.presentation.icon();
        let terminal_id = match &self.tool.presentation {
            ToolCallPresentation::ExecCommand {
                terminal_id: Some(terminal_id),
                ..
            }
            | ToolCallPresentation::BackgroundTerminalInteraction { terminal_id, .. } => {
                Some(terminal_id.clone())
            }
            _ => None,
        };
        let body = match &self.tool.presentation {
            ToolCallPresentation::ExecCommand {
                command, output, ..
            } => {
                let terminal = ScrollSurface {
                    id: format!("{}-terminal", id).into(),
                    theme,
                    width: None,
                    height: Some(240.0),
                    vertical: Some(self.terminal_scrollbar),
                    horizontal: None,
                    content: code_block(
                        format!("{}.terminal-content", id),
                        theme,
                        if output.is_empty() {
                            "(no output)".into()
                        } else {
                            output.clone()
                        },
                        false,
                    ),
                };
                div()
                    .w_full()
                    .min_h_full()
                    .flex()
                    .flex_col()
                    .gap(px(12.0))
                    .child(labeled(
                        format!("{}.command", id),
                        theme,
                        "Command",
                        code_block(
                            format!("{}.command-code", id),
                            theme,
                            command.clone(),
                            false,
                        ),
                    ))
                    .child(terminal)
                    .into_any_element()
            }
            ToolCallPresentation::BackgroundTerminalInteraction { command, input, .. } => {
                let terminal = ScrollSurface {
                    id: format!("{}-terminal", id).into(),
                    theme,
                    width: None,
                    height: Some(240.0),
                    vertical: Some(self.terminal_scrollbar),
                    horizontal: None,
                    content: code_block(
                        format!("{}.terminal-content", id),
                        theme,
                        if input.is_empty() {
                            "(no input)".into()
                        } else {
                            input.clone()
                        },
                        false,
                    ),
                };
                div()
                    .w_full()
                    .min_h_full()
                    .flex()
                    .flex_col()
                    .gap(px(12.0))
                    .child(labeled(
                        format!("{}.command", id),
                        theme,
                        "Command",
                        code_block(
                            format!("{}.command-code", id),
                            theme,
                            command.clone(),
                            false,
                        ),
                    ))
                    .child(terminal)
                    .into_any_element()
            }
            ToolCallPresentation::FileDiff {
                files,
                omitted_files,
            } => div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .children(files.iter().map(|file| {
                    let path = file.path.clone();
                    let kind = match file.kind {
                        ToolDiffFileKind::Add => "added",
                        ToolDiffFileKind::Delete => "deleted",
                        ToolDiffFileKind::Update => "updated",
                    };
                    let metadata: SharedString = file
                        .language
                        .as_ref()
                        .map(|language| format!("{kind} · {language}").into())
                        .unwrap_or_else(|| kind.into());
                    let omitted_lines = file.omitted_lines;
                    div()
                        .w_full()
                        .min_w_0()
                        .flex_none()
                        .flex()
                        .flex_col()
                        .border_1()
                        .border_color(theme.role(ThemeRole::Divider))
                        .rounded(px(6.0))
                        .overflow_hidden()
                        .child(
                            div()
                                .h(px(32.0))
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .px(px(10.0))
                                .bg(theme.role(ThemeRole::SurfaceHigh))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .truncate()
                                        .font_family(fonts::MONO_FAMILY)
                                        .text_size(px(11.0))
                                        .child(path),
                                )
                                .child(
                                    div()
                                        .flex_none()
                                        .text_size(px(10.0))
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child(metadata),
                                )
                                .child(
                                    div()
                                        .flex_none()
                                        .font_family(fonts::MONO_FAMILY)
                                        .text_size(px(10.0))
                                        .child(format!("+{} −{}", file.added, file.deleted)),
                                ),
                        )
                        .children(file.lines.iter().map(|line| {
                            let (mark, bg, color) = match line.kind {
                                ToolDiffLineKind::Add => {
                                    ("+", ThemeRole::DiffAddedBg, ThemeRole::DiffAddedText)
                                }
                                ToolDiffLineKind::Delete => {
                                    ("−", ThemeRole::DiffRemovedBg, ThemeRole::DiffRemovedText)
                                }
                                ToolDiffLineKind::Context => {
                                    (" ", ThemeRole::DiffContextBg, ThemeRole::DiffContextText)
                                }
                            };
                            div()
                                .w_full()
                                .min_w_0()
                                .min_h(px(18.0))
                                .flex()
                                .bg(theme.role(bg))
                                .font_family(fonts::MONO_FAMILY)
                                .text_size(px(11.0))
                                .line_height(px(18.0))
                                .text_color(theme.role(color))
                                .child(
                                    div()
                                        .w(px(34.0))
                                        .flex_none()
                                        .flex()
                                        .justify_end()
                                        .pr(px(5.0))
                                        .text_color(theme.role(ThemeRole::DiffLineNumberText))
                                        .child(
                                            line.old_number
                                                .map(|number| number.to_string())
                                                .unwrap_or_default(),
                                        ),
                                )
                                .child(
                                    div()
                                        .w(px(34.0))
                                        .flex_none()
                                        .flex()
                                        .justify_end()
                                        .pr(px(5.0))
                                        .text_color(theme.role(ThemeRole::DiffLineNumberText))
                                        .child(
                                            line.new_number
                                                .map(|number| number.to_string())
                                                .unwrap_or_default(),
                                        ),
                                )
                                .child(div().w(px(14.0)).flex_none().child(mark))
                                .child(div().flex_1().min_w_0().child(line.text.clone()))
                        }))
                        .when_some(omitted_lines, |this, omitted| {
                            this.child(
                                div()
                                    .px(px(10.0))
                                    .py(px(6.0))
                                    .text_size(px(10.0))
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(format!("… {omitted} lines omitted")),
                            )
                        })
                }))
                .when_some(*omitted_files, |this, omitted| {
                    this.child(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(format!("… {omitted} files omitted")),
                    )
                })
                .into_any_element(),
            ToolCallPresentation::Exploration {
                operations,
                omitted_operations,
            } => labeled(
                format!("{}.operations", id),
                theme,
                "Operations",
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap(px(6.0))
                    .children(operations.iter().map(|operation| {
                        div()
                            .w_full()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .py(px(8.0))
                            .px(px(10.0))
                            .border_l_2()
                            .border_color(theme.role(ThemeRole::Divider))
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(operation.kind.label()),
                            )
                            .child(
                                div()
                                    .font_family(fonts::MONO_FAMILY)
                                    .text_size(px(12.0))
                                    .child(operation.target.clone()),
                            )
                    }))
                    .when_some(*omitted_operations, |this, omitted| {
                        this.child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child(format!("… {omitted} operations omitted")),
                        )
                    })
                    .into_any_element(),
            )
            .into_any_element(),
            ToolCallPresentation::Search {
                query,
                target,
                sources,
                omitted_sources,
            } => labeled(
                format!("{}.search", id),
                theme,
                target.clone().label(),
                div()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .child(code_block(
                        format!("{}.search-query", id),
                        theme,
                        query.clone(),
                        false,
                    ))
                    .children(sources.iter().map(|source| {
                        div()
                            .w_full()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .py(px(6.0))
                            .border_b_1()
                            .border_color(theme.role(ThemeRole::Divider))
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(source.title.clone()),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .font_family(fonts::MONO_FAMILY)
                                    .text_size(px(10.0))
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(source.url.clone()),
                            )
                    }))
                    .when_some(*omitted_sources, |this, omitted| {
                        this.child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child(format!("… {omitted} sources omitted")),
                        )
                    })
                    .into_any_element(),
            )
            .into_any_element(),
            ToolCallPresentation::Generic { arguments_json } => labeled(
                format!("{}.arguments", id),
                theme,
                "Arguments",
                code_block(
                    format!("{}.arguments-code", id),
                    theme,
                    arguments_json.clone(),
                    false,
                ),
            ),
        };
        let mut content = div()
            .debug_selector({
                let id = id.clone();
                move || format!("{id}.content")
            })
            .w_full()
            .min_w_0()
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(12.0))
            .p(px(12.0))
            .child(body);
        if let Some(text) = self
            .tool
            .failure
            .clone()
            .or_else(|| self.tool.result.clone())
        {
            content = content.child(labeled(
                format!("{}.result", id),
                theme,
                if failed { "Failure" } else { "Result" },
                code_block(format!("{}.result-code", id), theme, text, failed),
            ));
        }
        div()
            .debug_selector({
                let id = id.clone();
                move || format!("{id}.root")
            })
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .child(
                div()
                    .debug_selector({
                        let id = id.clone();
                        move || format!("{id}.heading")
                    })
                    .w_full()
                    .min_h(px(48.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(12.0))
                    .py(px(8.0))
                    .border_b_1()
                    .border_color(theme.role(ThemeRole::Divider))
                    .child(Icon::decorative(
                        icon,
                        16.0,
                        theme.role(ThemeRole::TextSecondary).into(),
                        format!("{}.heading-icon", id),
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .h(px(16.0))
                                    .truncate()
                                    .text_size(px(13.0))
                                    .font_weight(FontWeight::BOLD)
                                    .child(title),
                            )
                            .child(
                                div()
                                    .h(px(14.0))
                                    .truncate()
                                    .text_size(px(11.0))
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(self.tool.tool_label.clone()),
                            ),
                    )
                    .when_some(
                        terminal_id
                            .zip(self.open_terminal_focus)
                            .zip(self.on_open_terminal),
                        |heading, ((terminal_id, focus_handle), handler)| {
                            heading.child(Button {
                                id: format!("{}.open-terminal", id).into(),
                                theme,
                                label: "Open terminal".into(),
                                size: ControlSize::Small,
                                variant: ButtonVariant::Ghost,
                                icon: Some(IconName::Terminal),
                                icon_only: false,
                                disabled: self.open_terminal_disabled,
                                force_focused: false,
                                focus_handle: Some(focus_handle),
                                on_activate: Some(Rc::new(move |window, cx| {
                                    handler(terminal_id.clone(), window, cx)
                                })),
                            })
                        },
                    )
                    .child(
                        div()
                            .flex_none()
                            .text_size(px(11.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(if failed {
                                theme.role(ThemeRole::StatusError)
                            } else {
                                theme.role(ThemeRole::TextSecondary)
                            })
                            .child(status.label()),
                    ),
            )
            .child(div().flex_1().min_h_0().child(ScrollSurface {
                id: format!("{}-scroll", id).into(),
                theme,
                width: None,
                height: None,
                vertical: Some(self.vertical_scrollbar),
                horizontal: Some(self.horizontal_scrollbar),
                content: content.into_any_element(),
            }))
    }
}
