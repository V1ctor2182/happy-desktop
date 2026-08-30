//! Typed, virtualized, store-free file diff presentation.

use super::{
    file_editor::FileEditorHandler,
    scrollbar::{Scrollbar, ScrollbarState},
    text_area::{Save, TextArea},
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};
use gpui::{
    AnyElement, App, Entity, FocusHandle, FontWeight, IntoElement, ListAlignment, ListState,
    MouseButton, RenderOnce, SharedString, Window, div, list, point, prelude::*, px,
};
use std::{cell::RefCell, rc::Rc};

pub const FILE_DIFF_TOOLBAR_HEIGHT: f32 = 32.0;
pub const FILE_DIFF_LINE_HEIGHT: f32 = 20.0;
pub const FILE_DIFF_OVERDRAW: f32 = 160.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileDiffMode {
    Preview,
    Unified,
    Split,
    Edit,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileDiffLineKind {
    Context,
    Added,
    Removed,
    Changed,
    Hunk,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDiffText {
    pub old: SharedString,
    pub new: SharedString,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDiffPreviewLine {
    pub id: SharedString,
    pub line: u32,
    pub text: SharedString,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileDiffLine {
    pub id: SharedString,
    pub kind: FileDiffLineKind,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub old_text: Option<SharedString>,
    pub new_text: Option<SharedString>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FileDiffStats {
    pub added: u32,
    pub removed: u32,
    pub counts_exact: bool,
}
/// Caller-computed bounded nowrap widths in logical pixels for one diff generation.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FileDiffContentWidths {
    pub preview: f32,
    pub unified: f32,
    pub split_old: f32,
    pub split_new: f32,
}
impl FileDiffContentWidths {
    fn bounded(value: f32) -> gpui::Pixels {
        px(value.clamp(0.0, 1_000_000.0))
    }
}
pub type FileDiffModeHandler = Rc<dyn Fn(FileDiffMode, &mut Window, &mut App)>;
pub type FileDiffWrapHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

#[derive(Clone)]
pub struct FileDiffFocus {
    pub wrap: FocusHandle,
    pub preview: FocusHandle,
    pub unified: FocusHandle,
    pub split: FocusHandle,
    pub edit: FocusHandle,
}

#[derive(Clone)]
pub struct FileDiffListState {
    list: ListState,
    ids: Rc<RefCell<Vec<SharedString>>>,
}
impl FileDiffListState {
    fn from_ids(ids: Vec<SharedString>) -> Self {
        Self {
            list: ListState::new(ids.len(), ListAlignment::Top, px(FILE_DIFF_OVERDRAW)),
            ids: Rc::new(RefCell::new(ids)),
        }
    }
    pub fn new(lines: &[FileDiffLine]) -> Self {
        Self::from_ids(lines.iter().map(|line| line.id.clone()).collect())
    }
    pub fn new_preview(lines: &[FileDiffPreviewLine]) -> Self {
        Self::from_ids(lines.iter().map(|line| line.id.clone()).collect())
    }
    pub fn list_state(&self) -> ListState {
        self.list.clone()
    }
    pub fn reconcile(&self, lines: &[FileDiffLine]) {
        self.reconcile_ids(lines.iter().map(|line| line.id.clone()).collect());
    }
    pub fn reconcile_preview(&self, lines: &[FileDiffPreviewLine]) {
        self.reconcile_ids(lines.iter().map(|line| line.id.clone()).collect());
    }
    fn reconcile_ids(&self, next: Vec<SharedString>) {
        let old = self.ids.borrow().clone();
        if old == next {
            return;
        }
        let mut prefix = 0;
        while prefix < old.len() && prefix < next.len() && old[prefix] == next[prefix] {
            prefix += 1
        }
        let mut suffix = 0;
        while suffix < old.len() - prefix
            && suffix < next.len() - prefix
            && old[old.len() - 1 - suffix] == next[next.len() - 1 - suffix]
        {
            suffix += 1
        }
        self.list
            .splice(prefix..old.len() - suffix, next.len() - prefix - suffix);
        *self.ids.borrow_mut() = next;
    }
}

fn control(
    id: SharedString,
    label: &'static str,
    selected: bool,
    theme: Theme,
    focus: FocusHandle,
    handler: Option<FileEditorHandler>,
) -> AnyElement {
    let pointer = handler.clone();
    let pointer_focus = focus.clone();
    div()
        .id(id.clone())
        .debug_selector(move || format!("{id}.root"))
        .h(px(24.0))
        .flex()
        .items_center()
        .px(px(8.0))
        .rounded(px(4.0))
        .font_family(fonts::UI_FAMILY)
        .text_size(px(11.0))
        .line_height(px(16.0))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(theme.role(ThemeRole::Text))
        .track_focus(&focus.tab_index(0).tab_stop(handler.is_some()))
        .on_key_down(|event, window, cx| {
            if !event.is_held && event.keystroke.key.as_str() == "tab" {
                cx.stop_propagation();
                if event.keystroke.modifiers.shift {
                    window.focus_prev();
                } else {
                    window.focus_next();
                }
            }
        })
        .when(selected, |v| v.bg(theme.role(ThemeRole::SurfaceSelected)))
        .when(handler.is_some(), |v| v.cursor_pointer())
        .when_some(pointer, |v, activate| {
            v.on_mouse_down(MouseButton::Left, move |_, window, _| {
                pointer_focus.focus(window)
            })
            .on_mouse_up(MouseButton::Left, move |_, w, cx| activate(w, cx))
            .on_key_down(move |event, w, cx| {
                if !event.is_held && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                {
                    cx.stop_propagation();
                    handler.as_ref().unwrap()(w, cx);
                }
            })
        })
        .child(label)
        .into_any_element()
}

fn line_cell(
    id: SharedString,
    number: Option<u32>,
    text: Option<SharedString>,
    kind: FileDiffLineKind,
    side: &'static str,
    width: Option<gpui::Pixels>,
    wrap: bool,
    theme: Theme,
) -> AnyElement {
    let (background, color) = match kind {
        FileDiffLineKind::Added => (ThemeRole::DiffAddedBg, ThemeRole::DiffAddedText),
        FileDiffLineKind::Removed => (ThemeRole::DiffRemovedBg, ThemeRole::DiffRemovedText),
        FileDiffLineKind::Changed if side == "old" => {
            (ThemeRole::DiffRemovedBg, ThemeRole::DiffRemovedText)
        }
        FileDiffLineKind::Changed => (ThemeRole::DiffAddedBg, ThemeRole::DiffAddedText),
        FileDiffLineKind::Hunk => (ThemeRole::DiffHunkHeaderBg, ThemeRole::DiffHunkHeaderText),
        FileDiffLineKind::Context => (ThemeRole::DiffContextBg, ThemeRole::DiffContextText),
    };
    div()
        .debug_selector(move || format!("{id}.{side}"))
        .min_w_0()
        .when_some(width, |cell, width| cell.w(width).flex_none())
        .when(width.is_none(), |cell| cell.w_full().flex_1())
        .flex()
        .items_start()
        .bg(theme.role(background))
        .font_family(fonts::MONO_FAMILY)
        .text_size(px(13.0))
        .line_height(px(FILE_DIFF_LINE_HEIGHT))
        .text_color(theme.role(color))
        .child(
            div()
                .w(px(44.0))
                .h(px(FILE_DIFF_LINE_HEIGHT))
                .flex_none()
                .flex()
                .items_center()
                .justify_end()
                .pr(px(8.0))
                .bg(theme.role(ThemeRole::DiffLineNumberBg))
                .text_size(px(11.0))
                .text_color(theme.role(ThemeRole::DiffLineNumberText))
                .child(number.map(|n| n.to_string()).unwrap_or_default()),
        )
        .child(
            div()
                .min_w_0()
                .flex_1()
                .min_h(px(FILE_DIFF_LINE_HEIGHT))
                .px(px(8.0))
                .pr(px(16.0))
                .when(!wrap, |v| v.flex_none().whitespace_nowrap())
                .child(text.unwrap_or_default()),
        )
        .into_any_element()
}

fn virtual_surface(
    id: SharedString,
    theme: Theme,
    cx: &App,
    state: ListState,
    scrollbar: Entity<ScrollbarState>,
    horizontal_scrollbar: Option<Entity<ScrollbarState>>,
    content_width: gpui::Pixels,
    render: Rc<dyn Fn(usize) -> AnyElement>,
) -> AnyElement {
    let has_horizontal = horizontal_scrollbar.is_some();
    let wheel = scrollbar.clone();
    let bars: Vec<Entity<ScrollbarState>> = std::iter::once(scrollbar.clone())
        .chain(horizontal_scrollbar.iter().cloned())
        .collect();
    let hover_bars = bars.clone();
    let move_bars = bars.clone();
    let up_bars = bars.clone();
    let up_out_bars = bars.clone();
    let painted = scrollbar.clone();
    let rows = div()
        .h_full()
        .when(has_horizontal, |rows| rows.w(content_width).flex_none())
        .when(!has_horizontal, |rows| rows.w_full().min_w_0())
        .child(
            list(state, move |index, _, _| render(index))
                .size_full()
                .m_0()
                .p_0(),
        );
    let content: AnyElement = match horizontal_scrollbar.clone() {
        Some(horizontal) => {
            let handle = horizontal.read(cx).scroll_handle().clone();
            let horizontal_wheel = horizontal.clone();
            div()
                .id(SharedString::from(format!("{id}-horizontal-viewport")))
                .size_full()
                .min_w_0()
                .min_h_0()
                .overflow_x_scroll()
                .track_scroll(&handle)
                .on_scroll_wheel(move |event, window, cx| {
                    let accepted = horizontal_wheel.update(cx, |bar, cx| {
                        bar.trusted_wheel(event, true, window.line_height(), cx)
                    });
                    if accepted {
                        cx.stop_propagation();
                    }
                })
                .child(rows)
                .into_any_element()
        }
        None => rows.into_any_element(),
    };
    div()
        .id(SharedString::from(format!("{id}-viewport")))
        .relative()
        .size_full()
        .min_h_0()
        .m_0()
        .p_0()
        .on_scroll_wheel(move |event, window, cx| {
            let accepted = wheel.update(cx, |bar, cx| {
                bar.trusted_wheel(event, has_horizontal, window.line_height(), cx)
            });
            if accepted {
                cx.stop_propagation();
            }
        })
        .on_hover(move |hovered, _, cx| {
            for bar in &hover_bars {
                bar.update(cx, |bar, cx| bar.surface_hover(*hovered, cx));
            }
        })
        .on_mouse_move(move |event, _, cx| {
            for bar in &move_bars {
                bar.update(cx, |bar, cx| bar.pointer_move(event, cx));
            }
        })
        .on_mouse_up(MouseButton::Left, move |event, _, cx| {
            for bar in &up_bars {
                bar.update(cx, |bar, cx| bar.pointer_up(event, cx));
            }
        })
        .on_mouse_up_out(MouseButton::Left, move |event, _, cx| {
            for bar in &up_out_bars {
                bar.update(cx, |bar, cx| bar.pointer_up(event, cx));
            }
        })
        .child(content)
        .child(Scrollbar::new(
            format!("{id}.scrollbar"),
            painted,
            theme.role(ThemeRole::HappyScrollbarQuietColor).into(),
        ))
        .children(horizontal_scrollbar.map(|bar| {
            Scrollbar::new(
                format!("{id}.horizontal-scrollbar"),
                bar,
                theme.role(ThemeRole::HappyScrollbarQuietColor).into(),
            )
        }))
        .into_any_element()
}

#[derive(IntoElement)]
pub struct FileDiff {
    pub id: SharedString,
    pub theme: Theme,
    pub text: FileDiffText,
    pub lines: Rc<Vec<FileDiffLine>>,
    pub list_state: FileDiffListState,
    pub preview_lines: Rc<Vec<FileDiffPreviewLine>>,
    pub preview_list_state: FileDiffListState,
    pub mode: FileDiffMode,
    pub wrap: bool,
    pub stats: Option<FileDiffStats>,
    pub content_widths: FileDiffContentWidths,
    /// Caller-authored disclosure for bounded, partial, or unavailable diff output.
    pub notice: Option<SharedString>,
    pub scrollbar: Entity<ScrollbarState>,
    pub preview_scrollbar: Entity<ScrollbarState>,
    /// Caller-owned X state shared by Preview, Unified, and Split when wrapping is off.
    pub horizontal_scrollbar: Entity<ScrollbarState>,
    pub editor: Option<Entity<TextArea>>,
    pub focus: FileDiffFocus,
    pub on_mode_change: Option<FileDiffModeHandler>,
    pub on_wrap_change: Option<FileDiffWrapHandler>,
    /// Caller-owned save intent. Use `None` for disabled or read-only edit buffers.
    pub on_save: Option<FileEditorHandler>,
}
impl RenderOnce for FileDiff {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let id = self.id.clone();
        let notice = self.notice.clone();
        let horizontal_scrollbar = self.horizontal_scrollbar.clone();
        let mode_handler = |mode| {
            self.on_mode_change.clone().map(|h| {
                Rc::new(move |w: &mut Window, cx: &mut App| h(mode, w, cx)) as FileEditorHandler
            })
        };
        let save_handler = self.on_save.clone();
        let wrap_handler = self.on_wrap_change.clone().map(|h| {
            let next = !self.wrap;
            let horizontal = horizontal_scrollbar.clone();
            Rc::new(move |w: &mut Window, cx: &mut App| {
                if next {
                    horizontal.update(cx, |bar, _| {
                        bar.scroll_handle().set_offset(point(px(0.0), px(0.0)))
                    });
                }
                h(next, w, cx)
            }) as FileEditorHandler
        });
        let (content_width, split_widths) = match self.mode {
            FileDiffMode::Preview => (
                FileDiffContentWidths::bounded(self.content_widths.preview),
                None,
            ),
            FileDiffMode::Unified => (
                FileDiffContentWidths::bounded(self.content_widths.unified),
                None,
            ),
            FileDiffMode::Split => {
                let old = FileDiffContentWidths::bounded(self.content_widths.split_old);
                let new = FileDiffContentWidths::bounded(self.content_widths.split_new);
                (old + new, Some((old, new)))
            }
            FileDiffMode::Edit => (px(0.0), None),
        };
        let body: AnyElement = match self.mode {
            FileDiffMode::Edit => self
                .editor
                .map(|editor| editor.into_any_element())
                .unwrap_or_else(|| {
                    div()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child("No edit buffer")
                        .into_any_element()
                }),
            FileDiffMode::Preview => {
                let rows = self.preview_lines.clone();
                let wrap = self.wrap;
                let render_id = id.clone();
                virtual_surface(
                    format!("{}-preview", self.id).into(),
                    theme,
                    cx,
                    self.preview_list_state.list_state(),
                    self.preview_scrollbar,
                    (!self.wrap).then(|| horizontal_scrollbar.clone()),
                    content_width,
                    Rc::new(move |index| {
                        let line = &rows[index];
                        line_cell(
                            format!("{}-preview-{}", render_id, line.id).into(),
                            Some(line.line),
                            Some(line.text.clone()),
                            FileDiffLineKind::Context,
                            "new",
                            None,
                            wrap,
                            theme,
                        )
                    }),
                )
            }
            mode @ (FileDiffMode::Unified | FileDiffMode::Split) => {
                let rows = self.lines.clone();
                let wrap = self.wrap;
                let render_id = id.clone();
                virtual_surface(
                    format!("{}-diff", self.id).into(),
                    theme,
                    cx,
                    self.list_state.list_state(),
                    self.scrollbar,
                    (!self.wrap).then(|| horizontal_scrollbar.clone()),
                    content_width,
                    Rc::new(move |index| {
                        let line = &rows[index];
                        match mode {
                            FileDiffMode::Unified if line.kind == FileDiffLineKind::Hunk => {
                                line_cell(
                                    format!("{}-line-{}", render_id, line.id).into(),
                                    None,
                                    line.new_text.clone().or_else(|| line.old_text.clone()),
                                    FileDiffLineKind::Hunk,
                                    "new",
                                    None,
                                    wrap,
                                    theme,
                                )
                            }
                            FileDiffMode::Unified => {
                                let (n, t, side) = if matches!(line.kind, FileDiffLineKind::Removed)
                                {
                                    (line.old_line, line.old_text.clone(), "old")
                                } else {
                                    (
                                        line.new_line,
                                        line.new_text.clone().or_else(|| line.old_text.clone()),
                                        "new",
                                    )
                                };
                                line_cell(
                                    format!("{}-line-{}", render_id, line.id).into(),
                                    n,
                                    t,
                                    line.kind,
                                    side,
                                    None,
                                    wrap,
                                    theme,
                                )
                            }
                            FileDiffMode::Split if line.kind == FileDiffLineKind::Hunk => {
                                line_cell(
                                    format!("{}-line-{}", render_id, line.id).into(),
                                    None,
                                    line.new_text.clone().or_else(|| line.old_text.clone()),
                                    FileDiffLineKind::Hunk,
                                    "new",
                                    None,
                                    wrap,
                                    theme,
                                )
                            }
                            FileDiffMode::Split => div()
                                .w_full()
                                .flex()
                                .child(line_cell(
                                    format!("{}-line-{}", render_id, line.id).into(),
                                    line.old_line,
                                    line.old_text.clone(),
                                    line.kind,
                                    "old",
                                    split_widths.map(|widths| widths.0),
                                    wrap,
                                    theme,
                                ))
                                .child(line_cell(
                                    format!("{}-line-{}", render_id, line.id).into(),
                                    line.new_line,
                                    line.new_text.clone(),
                                    line.kind,
                                    "new",
                                    split_widths.map(|widths| widths.1),
                                    wrap,
                                    theme,
                                ))
                                .into_any_element(),
                            _ => unreachable!(),
                        }
                    }),
                )
            }
        };
        div()
            .id(self.id.clone())
            .debug_selector({
                let id = self.id.clone();
                move || format!("{id}.root")
            })
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::Surface))
            .when_some(save_handler, |root, save| {
                root.on_action(move |_: &Save, window, cx| {
                    save(window, cx);
                    cx.stop_propagation();
                })
            })
            .child(
                div()
                    .debug_selector({
                        let id = self.id.clone();
                        move || format!("{id}.toolbar")
                    })
                    .w_full()
                    .h(px(FILE_DIFF_TOOLBAR_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .px(px(8.0))
                    .child(
                        div()
                            .debug_selector({
                                let id = self.id.clone();
                                move || format!("{id}.notice")
                            })
                            .min_w_0()
                            .flex_1()
                            .truncate()
                            .font_family(fonts::UI_FAMILY)
                            .text_size(px(11.0))
                            .line_height(px(16.0))
                            .text_color(theme.role(ThemeRole::Warning))
                            .when_some(notice, |notice_row, notice| notice_row.child(notice)),
                    )
                    .children(self.stats.map(|stats| {
                        let approximation = if stats.counts_exact { "" } else { "~" };
                        div()
                            .debug_selector({
                                let id = self.id.clone();
                                move || format!("{id}.stats")
                            })
                            .flex()
                            .items_center()
                            .gap(px(4.0))
                            .font_family(fonts::MONO_FAMILY)
                            .text_size(px(11.0))
                            .child(
                                div()
                                    .text_color(theme.role(ThemeRole::GitAddedText))
                                    .child(format!("{approximation}+{}", stats.added)),
                            )
                            .child(
                                div()
                                    .text_color(theme.role(ThemeRole::GitRemovedText))
                                    .child(format!("{approximation}-{}", stats.removed)),
                            )
                    }))
                    .child(control(
                        format!("{}-wrap", self.id).into(),
                        "Wrap",
                        self.wrap,
                        theme,
                        self.focus.wrap,
                        wrap_handler,
                    ))
                    .child(control(
                        format!("{}-preview", self.id).into(),
                        "Preview",
                        self.mode == FileDiffMode::Preview,
                        theme,
                        self.focus.preview,
                        mode_handler(FileDiffMode::Preview),
                    ))
                    .child(control(
                        format!("{}-unified", self.id).into(),
                        "Unified",
                        self.mode == FileDiffMode::Unified,
                        theme,
                        self.focus.unified,
                        mode_handler(FileDiffMode::Unified),
                    ))
                    .child(control(
                        format!("{}-split", self.id).into(),
                        "Split",
                        self.mode == FileDiffMode::Split,
                        theme,
                        self.focus.split,
                        mode_handler(FileDiffMode::Split),
                    ))
                    .child(control(
                        format!("{}-edit", self.id).into(),
                        "Edit",
                        self.mode == FileDiffMode::Edit,
                        theme,
                        self.focus.edit,
                        mode_handler(FileDiffMode::Edit),
                    )),
            )
            .child(
                div()
                    .debug_selector({
                        let id = self.id.clone();
                        move || format!("{id}.body")
                    })
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .child(body),
            )
    }
}

#[cfg(test)]
mod phase6_file_diff_tests {
    use super::*;
    use crate::ui::{ScrollbarAppearance, ScrollbarPlacement, SharedScrollHandle};
    use gpui::{
        Context, Modifiers, Render, ScrollDelta, ScrollWheelEvent, TestAppContext,
        VisualTestContext, point, size,
    };
    use std::cell::RefCell;

    struct Fixture {
        width: f32,
        mode: FileDiffMode,
        wrap: bool,
        modes: Rc<RefCell<Vec<FileDiffMode>>>,
        saves: Rc<RefCell<u32>>,
        editor: Entity<TextArea>,
        lines: Rc<Vec<FileDiffLine>>,
        list_state: FileDiffListState,
        scrollbar: Entity<ScrollbarState>,
        preview_lines: Rc<Vec<FileDiffPreviewLine>>,
        preview_list_state: FileDiffListState,
        preview_scrollbar: Entity<ScrollbarState>,
        horizontal_scrollbar: Entity<ScrollbarState>,
        focus: FileDiffFocus,
    }
    fn model() -> Vec<FileDiffLine> {
        (0..700)
            .map(|i| FileDiffLine {
                id: format!("row-{i}").into(),
                kind: if i == 1 {
                    FileDiffLineKind::Hunk
                } else if i % 5 == 0 {
                    FileDiffLineKind::Added
                } else {
                    FileDiffLineKind::Context
                },
                old_line: Some(i + 1),
                new_line: Some(i + 1),
                old_text: Some(if i == 1 {
                    "@@ -1,2 +1,2 @@".into()
                } else {
                    if i == 2 {
                        format!("old {}", "long_segment_".repeat(60)).into()
                    } else {
                        format!("old line {i}").into()
                    }
                }),
                new_text: Some(if i == 1 {
                    "@@ -1,2 +1,2 @@".into()
                } else {
                    if i == 2 {
                        format!("new {}", "long_segment_".repeat(60)).into()
                    } else {
                        format!("new line {i}").into()
                    }
                }),
            })
            .collect()
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let modes = self.modes.clone();
            let saves = self.saves.clone();
            div().w(px(self.width)).h(px(240.0)).child(FileDiff {
                id: "test-file-diff".into(),
                theme: Theme::light(),
                text: FileDiffText {
                    old: "old".into(),
                    new: "new".into(),
                },
                lines: self.lines.clone(),
                list_state: self.list_state.clone(),
                preview_lines: self.preview_lines.clone(),
                preview_list_state: self.preview_list_state.clone(),
                mode: self.mode,
                wrap: self.wrap,
                stats: Some(FileDiffStats {
                    added: 140,
                    removed: 0,
                    counts_exact: false,
                }),
                content_widths: FileDiffContentWidths {
                    preview: 6_000.0,
                    unified: 6_000.0,
                    split_old: 6_000.0,
                    split_new: 6_000.0,
                },
                notice: Some("Diff output truncated to bounded input".into()),
                scrollbar: self.scrollbar.clone(),
                preview_scrollbar: self.preview_scrollbar.clone(),
                horizontal_scrollbar: self.horizontal_scrollbar.clone(),
                editor: Some(self.editor.clone()),
                focus: self.focus.clone(),
                on_mode_change: Some(Rc::new(move |mode, _, _| modes.borrow_mut().push(mode))),
                on_wrap_change: Some(Rc::new(|_, _, _| {})),
                on_save: Some(Rc::new(move |_, _| *saves.borrow_mut() += 1)),
            })
        }
    }
    fn render(cx: &mut TestAppContext, width: f32) -> (Entity<Fixture>, &mut VisualTestContext) {
        cx.update(|cx| {
            crate::fonts::register(cx);
            super::super::text_area::init(cx)
        });
        let (fixture, cx) = cx.add_window_view(|_, cx| {
            let lines = Rc::new(model());
            let list_state = FileDiffListState::new(&lines);
            let preview_lines = Rc::new(
                (0..700)
                    .map(|i| FileDiffPreviewLine {
                        id: format!("preview-{i}").into(),
                        line: i + 1,
                        text: format!("new line {i}").into(),
                    })
                    .collect::<Vec<_>>(),
            );
            let preview_list_state = FileDiffListState::new_preview(&preview_lines);
            let scrollbar = cx.new(|_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Automatic,
                    ScrollbarPlacement::Overlay,
                    list_state.list_state(),
                )
            });
            let preview_scrollbar = cx.new(|_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Automatic,
                    ScrollbarPlacement::Overlay,
                    preview_list_state.list_state(),
                )
            });
            let horizontal_scrollbar = cx.new(|_| {
                ScrollbarState::horizontal(
                    ScrollbarAppearance::Always,
                    ScrollbarPlacement::Overlay,
                    SharedScrollHandle::new(),
                )
            });
            let editor = cx.new(|cx| {
                let mut editor =
                    TextArea::new("test-file-diff-editor", "editable", "", Theme::light(), cx);
                editor.set_layout(
                    super::super::text_area::TextAreaLayout::Editor {
                        wrap: false,
                        line_numbers: true,
                    },
                    cx,
                );
                editor
            });
            Fixture {
                width,
                mode: FileDiffMode::Unified,
                wrap: true,
                modes: Rc::new(RefCell::new(Vec::new())),
                saves: Rc::new(RefCell::new(0)),
                editor,
                lines,
                list_state,
                scrollbar,
                preview_lines,
                preview_list_state,
                preview_scrollbar,
                horizontal_scrollbar,
                focus: FileDiffFocus {
                    wrap: cx.focus_handle(),
                    preview: cx.focus_handle(),
                    unified: cx.focus_handle(),
                    split: cx.focus_handle(),
                    edit: cx.focus_handle(),
                },
            }
        });
        cx.simulate_resize(size(px(620.0), px(300.0)));
        cx.run_until_parked();
        (fixture, cx)
    }
    #[gpui::test]
    fn real_220_and_560_diff_geometry_virtualizes_and_reaches_last_line(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 220.0);
        assert_eq!(
            cx.debug_bounds("test-file-diff.root").unwrap().size.width,
            px(220.0)
        );
        assert_eq!(
            cx.debug_bounds("test-file-diff.toolbar")
                .unwrap()
                .size
                .height,
            px(32.0)
        );
        assert!(cx.debug_bounds("test-file-diff-line-row-0.new").is_some());
        assert!(cx.debug_bounds("test-file-diff-line-row-500.new").is_none());
        fixture.update(cx, |fixture, cx| {
            fixture.mode = FileDiffMode::Split;
            cx.notify();
        });
        cx.run_until_parked();
        let hunk = cx.debug_bounds("test-file-diff-line-row-1.new").unwrap();
        assert_eq!(
            hunk.size.width,
            cx.debug_bounds("test-file-diff.body").unwrap().size.width
        );
        assert!(cx.debug_bounds("test-file-diff-line-row-1.old").is_none());
        fixture.update(cx, |fixture, cx| {
            fixture.list_state.list_state().scroll_to(gpui::ListOffset {
                item_ix: 699,
                offset_in_item: px(0.0),
            });
            cx.notify();
        });
        cx.run_until_parked();
        let metrics = fixture.read_with(cx, |fixture, app| fixture.scrollbar.read(app).metrics());
        assert!(metrics.maximum_offset > px(0.0));
        assert_eq!(metrics.thumb.unwrap().bottom(), metrics.track.bottom());
        fixture.update(cx, |f, cx| {
            f.width = 560.0;
            cx.notify()
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("test-file-diff.root").unwrap().size.width,
            px(560.0)
        );
    }
    #[gpui::test]
    fn mode_controls_have_stable_focus_and_keyboard_activation(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 560.0);
        let focus = fixture.read_with(cx, |f, _| f.focus.clone());
        cx.update(|window, _| focus.wrap.focus(window));
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, _| focus.preview.is_focused(window)));
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, _| focus.wrap.is_focused(window)));
        let b = cx.debug_bounds("test-file-diff-split.root").unwrap();
        cx.simulate_click(b.center(), Modifiers::default());
        cx.simulate_keystrokes("enter");
        assert!(fixture.read_with(cx, |f, _| f.modes.borrow().contains(&FileDiffMode::Split)));
    }
    #[gpui::test]
    fn nowrap_diff_shares_exact_horizontal_scroll_and_wrap_resets_it(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 220.0);
        fixture.update(cx, |fixture, cx| {
            fixture.wrap = false;
            cx.notify();
        });
        cx.run_until_parked();
        let before = fixture.read_with(cx, |fixture, app| {
            let metrics = fixture.horizontal_scrollbar.read(app).metrics();
            assert!(metrics.maximum_offset > px(0.0));
            metrics.thumb.unwrap().origin.x
        });
        let body = cx.debug_bounds("test-file-diff.body").unwrap();
        cx.simulate_event(ScrollWheelEvent {
            position: body.center(),
            delta: ScrollDelta::Pixels(point(px(-120.0), px(0.0))),
            ..Default::default()
        });
        let after = fixture.read_with(cx, |fixture, app| {
            fixture
                .horizontal_scrollbar
                .read(app)
                .metrics()
                .thumb
                .unwrap()
                .origin
                .x
        });
        assert!(after > before);
        fixture.update(cx, |fixture, cx| {
            fixture.mode = FileDiffMode::Split;
            cx.notify();
        });
        cx.run_until_parked();
        let split = fixture.read_with(cx, |fixture, app| {
            fixture
                .horizontal_scrollbar
                .read(app)
                .metrics()
                .thumb
                .unwrap()
                .origin
                .x
        });
        assert!(
            split > before,
            "mode switch retains shared caller-owned X state"
        );
        fixture.update(cx, |fixture, cx| {
            fixture.mode = FileDiffMode::Preview;
            cx.notify();
        });
        cx.run_until_parked();
        let preview = fixture.read_with(cx, |fixture, app| {
            fixture
                .horizontal_scrollbar
                .read(app)
                .metrics()
                .thumb
                .unwrap()
                .origin
                .x
        });
        assert!(preview > before, "Preview uses the same retained X state");
        let wrap = cx.debug_bounds("test-file-diff-wrap.root").unwrap();
        cx.simulate_click(wrap.center(), Modifiers::default());
        assert_eq!(
            fixture.read_with(cx, |fixture, app| {
                fixture
                    .horizontal_scrollbar
                    .read(app)
                    .scroll_handle()
                    .offset()
                    .x
            }),
            px(0.0)
        );
    }

    #[gpui::test]
    fn edit_mode_cmd_s_bubbles_to_owner_save_handler(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 560.0);
        fixture.update(cx, |fixture, cx| {
            fixture.mode = FileDiffMode::Edit;
            cx.notify();
        });
        cx.run_until_parked();
        let editor = cx.debug_bounds("test-file-diff-editor.root").unwrap();
        cx.simulate_click(editor.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-s");
        assert_eq!(
            fixture.read_with(cx, |fixture, _| *fixture.saves.borrow()),
            1
        );
    }

    #[gpui::test]
    fn preview_uses_exact_current_file_rows_without_removed_gaps(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 560.0);
        fixture.update(cx, |fixture, cx| {
            fixture.mode = FileDiffMode::Preview;
            cx.notify();
        });
        cx.run_until_parked();
        let first = cx
            .debug_bounds("test-file-diff-preview-preview-0.new")
            .unwrap();
        let second = cx
            .debug_bounds("test-file-diff-preview-preview-1.new")
            .unwrap();
        assert_eq!(second.origin.y - first.origin.y, px(FILE_DIFF_LINE_HEIGHT));
    }
}
