//! Props-only, virtualized file browser for the permanent Files surface.
//!
//! The caller owns product state, the stable root focus handle, list geometry,
//! and scrollbar lifecycle. This module has no store, router, or transport.

use std::{cell::RefCell, rc::Rc};

use gpui::{
    AnyElement, App, CursorStyle, Entity, FocusHandle, FontWeight, IntoElement, ListAlignment,
    ListState, MouseButton, RenderOnce, SharedString, Window, div, list, prelude::*, px,
};

use super::{
    icon::Icon,
    icon_data::{self, UpstreamIcon},
    scrollbar::{Scrollbar, ScrollbarState},
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const FILE_BROWSER_HEADER_HEIGHT: f32 = 32.0;
pub const FILE_BROWSER_CONTROL_HEIGHT: f32 = 24.0;
pub const FILE_BROWSER_HEADER_INSET: f32 = 6.0;
pub const FILE_BROWSER_GROUP_GAP: f32 = 8.0;
pub const FILE_BROWSER_ROW_HEIGHT: f32 = 28.0;
pub const FILE_BROWSER_DISCLOSURE_SIZE: f32 = 16.0;
pub const FILE_BROWSER_BASE_INDENT: f32 = 8.0;
pub const FILE_BROWSER_DEPTH_INDENT: f32 = 16.0;
pub const FILE_BROWSER_OVERDRAW: f32 = 140.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileBrowserScope {
    AllFiles,
    Changes,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileBrowserLayout {
    List,
    Tree,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileBrowserEntryKind {
    File,
    Directory {
        expanded: bool,
    },
    /// A secondary paging action, not a file-system entity.
    LoadMore,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileBrowserIconFamily {
    Code,
    Data,
    Style,
    Image,
    Video,
    Audio,
    Shell,
    Secret,
    Archive,
    Prose,
    Config,
    Directory { expanded: bool },
    Other,
}

impl FileBrowserIconFamily {
    fn glyph(self) -> UpstreamIcon {
        use icon_data::ionicons;
        match self {
            Self::Code => ionicons::CODE_SLASH_OUTLINE,
            Self::Data => ionicons::SERVER_OUTLINE,
            Self::Style => ionicons::COLOR_PALETTE_OUTLINE,
            Self::Image => ionicons::IMAGE_OUTLINE,
            Self::Video => ionicons::VIDEOCAM_OUTLINE,
            Self::Audio => ionicons::MUSICAL_NOTES_OUTLINE,
            Self::Shell => ionicons::TERMINAL_OUTLINE,
            Self::Secret => ionicons::DOCUMENT_LOCK_OUTLINE,
            Self::Archive => ionicons::ARCHIVE_OUTLINE,
            Self::Prose => ionicons::READER_OUTLINE,
            Self::Config => ionicons::SETTINGS_OUTLINE,
            Self::Directory { expanded: true } => ionicons::FOLDER_OPEN_OUTLINE,
            Self::Directory { expanded: false } => ionicons::FOLDER_OUTLINE,
            Self::Other => ionicons::DOCUMENT_OUTLINE,
        }
    }
}

#[derive(Clone)]
pub struct FileBrowserStatus {
    pub label: SharedString,
    /// A semantic generated theme role. Raw product colors are not accepted.
    pub role: ThemeRole,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FileBrowserChangeStats {
    pub files: u32,
    /// `None` means the source did not provide a truthful insertion count.
    pub added: Option<u32>,
    /// `None` means the source did not provide a truthful deletion count.
    pub deleted: Option<u32>,
    /// False marks the provided aggregate as approximate rather than authoritative.
    pub counts_exact: bool,
}

#[derive(Clone)]
pub struct FileBrowserEntry {
    pub id: SharedString,
    pub name: SharedString,
    pub directory: Option<SharedString>,
    pub depth: usize,
    pub kind: FileBrowserEntryKind,
    /// Closed file-family vocabulary backed by the shared upstream font source.
    pub icon: FileBrowserIconFamily,
    /// Explicit semantic theme role for the icon. Raw colors are not accepted.
    pub icon_role: ThemeRole,
    pub status: Option<FileBrowserStatus>,
    pub changes: Option<FileBrowserChangeStats>,
}

pub type FileBrowserScopeHandler = Rc<dyn Fn(FileBrowserScope, &mut Window, &mut App)>;
pub type FileBrowserLayoutHandler = Rc<dyn Fn(FileBrowserLayout, &mut Window, &mut App)>;
pub type FileBrowserEntryHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

/// Caller-owned virtual-list geometry. Reconcile it before rendering changed rows.
#[derive(Clone)]
pub struct FileBrowserListState {
    list: ListState,
    ids: Rc<RefCell<Vec<SharedString>>>,
}

impl FileBrowserListState {
    pub fn new(entries: &[FileBrowserEntry]) -> Self {
        Self {
            list: ListState::new(entries.len(), ListAlignment::Top, px(FILE_BROWSER_OVERDRAW)),
            ids: Rc::new(RefCell::new(
                entries.iter().map(|entry| entry.id.clone()).collect(),
            )),
        }
    }

    pub fn list_state(&self) -> ListState {
        self.list.clone()
    }

    pub fn reconcile(&self, entries: &[FileBrowserEntry]) {
        let next: Vec<_> = entries.iter().map(|entry| entry.id.clone()).collect();
        let old = self.ids.borrow().clone();
        if old == next {
            return;
        }
        let mut prefix = 0;
        while prefix < old.len() && prefix < next.len() && old[prefix] == next[prefix] {
            prefix += 1;
        }
        let mut suffix = 0;
        while suffix < old.len() - prefix
            && suffix < next.len() - prefix
            && old[old.len() - 1 - suffix] == next[next.len() - 1 - suffix]
        {
            suffix += 1;
        }
        self.list
            .splice(prefix..old.len() - suffix, next.len() - prefix - suffix);
        *self.ids.borrow_mut() = next;
    }
}

#[derive(Clone)]
pub struct FileBrowserFocusHandles {
    pub root: FocusHandle,
    pub all_files: FocusHandle,
    pub changes: FocusHandle,
    pub list: FocusHandle,
    pub tree: FocusHandle,
}

#[derive(IntoElement)]
pub struct FileBrowser {
    pub id: SharedString,
    pub theme: Theme,
    pub width: f32,
    pub scope: FileBrowserScope,
    pub layout: FileBrowserLayout,
    pub change_stats: FileBrowserChangeStats,
    pub entries: Rc<Vec<FileBrowserEntry>>,
    pub selected_entry_id: Option<SharedString>,
    pub list_state: FileBrowserListState,
    /// Stable caller-owned focus handles; ordinary renders must reuse them.
    pub focus: FileBrowserFocusHandles,
    /// Caller-owned and constructed over `list_state.list_state()`.
    pub scrollbar: Entity<ScrollbarState>,
    pub on_scope_change: Option<FileBrowserScopeHandler>,
    pub on_layout_change: Option<FileBrowserLayoutHandler>,
    pub on_entry_select: Option<FileBrowserEntryHandler>,
    pub on_entry_open: Option<FileBrowserEntryHandler>,
    pub on_entry_toggle: Option<FileBrowserEntryHandler>,
}

fn part(id: SharedString, name: impl Into<SharedString>) -> impl Fn() -> String {
    let name = name.into();
    move || format!("{id}.{name}")
}

impl RenderOnce for FileBrowser {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let rows = self.entries.clone();
        let selected = self.selected_entry_id.clone();
        let list_state = self.list_state.list_state();
        let keyboard_list = list_state.clone();
        let keyboard_rows = rows.clone();
        let keyboard_selected = selected.clone();
        let keyboard_select = self.on_entry_select.clone();
        let keyboard_open = self.on_entry_open.clone();
        let keyboard_toggle = self.on_entry_toggle.clone();
        let focus = self.focus.clone();
        let wheel_bar = self.scrollbar.clone();
        let hover_bar = self.scrollbar.clone();
        let move_bar = self.scrollbar.clone();
        let up_bar = self.scrollbar.clone();
        let up_out_bar = self.scrollbar.clone();
        let painted_bar = self.scrollbar.clone();
        let row_width = self.width;
        let row_select = self.on_entry_select.clone();
        let row_open = self.on_entry_open.clone();
        let row_toggle = self.on_entry_toggle.clone();

        div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "root"))
            .relative()
            .w(px(self.width))
            .h_full()
            .min_w_0()
            .min_h_0()
            .m_0()
            .p_0()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::Surface))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .tab_index(0)
            .tab_group()
            .track_focus(&focus.root.clone().tab_index(1).tab_stop(true))
            .on_key_down(move |event, window, cx| {
                if event.is_held {
                    return;
                }
                let key = event.keystroke.key.as_str();
                if key == "tab" {
                    cx.stop_propagation();
                    if event.keystroke.modifiers.shift {
                        window.focus_prev();
                    } else {
                        window.focus_next();
                    }
                    return;
                }
                if keyboard_rows.is_empty() {
                    return;
                }
                let current = keyboard_selected
                    .as_ref()
                    .and_then(|id| keyboard_rows.iter().position(|entry| &entry.id == id))
                    .unwrap_or(0);
                let target = match key {
                    "up" => Some(current.saturating_sub(1)),
                    "down" => Some((current + 1).min(keyboard_rows.len() - 1)),
                    "home" => Some(0),
                    "end" => Some(keyboard_rows.len() - 1),
                    "left" => match keyboard_rows[current].kind {
                        FileBrowserEntryKind::Directory { expanded: true } => {
                            if let Some(toggle) = &keyboard_toggle {
                                toggle(keyboard_rows[current].id.clone(), window, cx);
                            }
                            None
                        }
                        _ => (0..current).rev().find(|index| {
                            keyboard_rows[*index].depth < keyboard_rows[current].depth
                        }),
                    },
                    "right" => match keyboard_rows[current].kind {
                        FileBrowserEntryKind::Directory { expanded: false } => {
                            if let Some(toggle) = &keyboard_toggle {
                                toggle(keyboard_rows[current].id.clone(), window, cx);
                            }
                            None
                        }
                        FileBrowserEntryKind::Directory { expanded: true }
                            if current + 1 < keyboard_rows.len()
                                && keyboard_rows[current + 1].depth
                                    > keyboard_rows[current].depth =>
                        {
                            Some(current + 1)
                        }
                        _ => None,
                    },
                    "space" | " " => {
                        match keyboard_rows[current].kind {
                            FileBrowserEntryKind::Directory { .. } => {
                                if let Some(toggle) = &keyboard_toggle {
                                    toggle(keyboard_rows[current].id.clone(), window, cx);
                                }
                            }
                            FileBrowserEntryKind::File => {
                                if let Some(select) = &keyboard_select {
                                    select(keyboard_rows[current].id.clone(), window, cx);
                                }
                            }
                            FileBrowserEntryKind::LoadMore => {}
                        }
                        None
                    }
                    "enter" => {
                        if let Some(open) = &keyboard_open {
                            open(keyboard_rows[current].id.clone(), window, cx);
                        }
                        None
                    }
                    _ => return,
                };
                cx.stop_propagation();
                if let Some(target) = target {
                    keyboard_list.scroll_to_reveal_item(target);
                    if let Some(select) = &keyboard_select {
                        select(keyboard_rows[target].id.clone(), window, cx);
                    }
                }
            })
            .on_mouse_move(move |event, _, cx| {
                move_bar.update(cx, |bar, cx| bar.pointer_move(event, cx));
            })
            .on_mouse_up(MouseButton::Left, move |event, _, cx| {
                up_bar.update(cx, |bar, cx| bar.pointer_up(event, cx));
            })
            .on_mouse_up_out(MouseButton::Left, move |event, _, cx| {
                up_out_bar.update(cx, |bar, cx| bar.pointer_up(event, cx));
            })
            .child(render_header(
                &id,
                theme,
                self.width,
                self.scope,
                if self.scope == FileBrowserScope::AllFiles {
                    FileBrowserLayout::Tree
                } else {
                    self.layout
                },
                self.change_stats,
                self.on_scope_change,
                self.on_layout_change,
                focus.clone(),
            ))
            .child(
                div()
                    .debug_selector(part(id.clone(), "body"))
                    .relative()
                    .w_full()
                    .flex_1()
                    .min_h_0()
                    .m_0()
                    .p_0()
                    .child(
                        div()
                            .id(SharedString::from(format!("{id}-viewport")))
                            .debug_selector(part(id.clone(), "viewport"))
                            .size_full()
                            .m_0()
                            .p_0()
                            .on_scroll_wheel(move |event, window, cx| {
                                let accepted = wheel_bar.update(cx, |bar, cx| {
                                    bar.trusted_wheel(event, false, window.line_height(), cx)
                                });
                                if accepted {
                                    cx.stop_propagation();
                                }
                            })
                            .on_hover(move |hovered, _, cx| {
                                hover_bar.update(cx, |bar, cx| bar.surface_hover(*hovered, cx));
                            })
                            .child(
                                list(list_state, move |index, _, _| {
                                    render_entry(
                                        &id,
                                        theme,
                                        row_width,
                                        rows[index].clone(),
                                        selected.as_ref() == Some(&rows[index].id),
                                        focus.root.clone(),
                                        row_select.clone(),
                                        row_open.clone(),
                                        row_toggle.clone(),
                                    )
                                })
                                .size_full()
                                .m_0()
                                .p_0(),
                            ),
                    )
                    .child(Scrollbar::new(
                        format!("{}.scrollbar", self.id),
                        painted_bar,
                        theme.role(ThemeRole::HappyScrollbarQuietColor).into(),
                    )),
            )
    }
}

fn change_value(value: Option<u32>, sign: char) -> String {
    value.map_or_else(|| "—".to_owned(), |value| format!("{sign}{value}"))
}

fn file_count_value(stats: FileBrowserChangeStats) -> String {
    if stats.counts_exact {
        stats.files.to_string()
    } else {
        format!("~{}", stats.files)
    }
}

fn render_header(
    id: &SharedString,
    theme: Theme,
    width: f32,
    scope: FileBrowserScope,
    layout: FileBrowserLayout,
    stats: FileBrowserChangeStats,
    on_scope: Option<FileBrowserScopeHandler>,
    on_layout: Option<FileBrowserLayoutHandler>,
    focus: FileBrowserFocusHandles,
) -> AnyElement {
    let compact = width < 250.0;
    let all_files = on_scope.clone().map(|callback| {
        Rc::new(move |window: &mut Window, cx: &mut App| {
            callback(FileBrowserScope::AllFiles, window, cx)
        }) as ControlHandler
    });
    let changes = on_scope.map(|callback| {
        Rc::new(move |window: &mut Window, cx: &mut App| {
            callback(FileBrowserScope::Changes, window, cx)
        }) as ControlHandler
    });
    let list_layout = on_layout.clone().map(|callback| {
        Rc::new(move |window: &mut Window, cx: &mut App| {
            callback(FileBrowserLayout::List, window, cx)
        }) as ControlHandler
    });
    let tree_layout = on_layout.map(|callback| {
        Rc::new(move |window: &mut Window, cx: &mut App| {
            callback(FileBrowserLayout::Tree, window, cx)
        }) as ControlHandler
    });

    div()
        .debug_selector(part(id.clone(), "header"))
        .w_full()
        .h(px(FILE_BROWSER_HEADER_HEIGHT))
        .flex_none()
        .overflow_hidden()
        .child(
            div()
                .debug_selector(part(id.clone(), "control-lane"))
                .w_full()
                .h_full()
                .flex()
                .items_center()
                .gap(px(FILE_BROWSER_GROUP_GAP))
                .px(px(FILE_BROWSER_HEADER_INSET))
                .child(
                    div()
                        .debug_selector(part(id.clone(), "scope-group"))
                        .h(px(FILE_BROWSER_CONTROL_HEIGHT))
                        .flex_none()
                        .flex()
                        .items_center()
                        .gap(px(2.0))
                        .child(label_control(
                            id,
                            "scope-all",
                            "All Files",
                            scope == FileBrowserScope::AllFiles,
                            theme,
                            all_files,
                            compact,
                            focus.all_files.clone(),
                        ))
                        .child(label_control(
                            id,
                            "scope-changes",
                            "Changes",
                            scope == FileBrowserScope::Changes,
                            theme,
                            changes,
                            compact,
                            focus.changes.clone(),
                        )),
                )
                .when(scope == FileBrowserScope::AllFiles, |lane| {
                    lane.child(
                        div()
                            .absolute()
                            .size(px(0.0))
                            .overflow_hidden()
                            .child(
                                div().track_focus(&focus.list.clone().tab_index(0).tab_stop(false)),
                            )
                            .child(
                                div().track_focus(&focus.tree.clone().tab_index(0).tab_stop(false)),
                            ),
                    )
                })
                .when(scope == FileBrowserScope::Changes, |lane| {
                    lane.child(
                        div()
                            .debug_selector(part(id.clone(), "changes-summary"))
                            .h(px(FILE_BROWSER_CONTROL_HEIGHT))
                            .flex_1()
                            .min_w(px(if compact { 48.0 } else { 42.0 }))
                            .when(compact, |summary| summary.max_w(px(48.0)).overflow_hidden())
                            .flex()
                            .items_center()
                            .justify_end()
                            .gap(px(if compact { 1.0 } else { 3.0 }))
                            .font_family(fonts::MONO_FAMILY)
                            .text_size(px(if compact { 9.0 } else { 10.0 }))
                            .line_height(px(16.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(file_count_value(stats))
                            .child(
                                div()
                                    .text_color(theme.role(ThemeRole::DiffSuccess))
                                    .child(change_value(stats.added, '+')),
                            )
                            .child(
                                div()
                                    .text_color(theme.role(ThemeRole::DiffError))
                                    .child(change_value(stats.deleted, '-')),
                            ),
                    )
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "layout-group"))
                            .h(px(FILE_BROWSER_CONTROL_HEIGHT))
                            .flex_none()
                            .flex()
                            .items_center()
                            .gap(px(2.0))
                            .child(icon_control(
                                id,
                                "layout-list",
                                "List",
                                icon_data::ionicons::LIST_OUTLINE,
                                layout == FileBrowserLayout::List,
                                theme,
                                list_layout,
                                focus.list.clone(),
                            ))
                            .child(icon_control(
                                id,
                                "layout-tree",
                                "Tree",
                                icon_data::octicons::GIT_BRANCH,
                                layout == FileBrowserLayout::Tree,
                                theme,
                                tree_layout,
                                focus.tree.clone(),
                            )),
                    )
                }),
        )
        .into_any_element()
}

type ControlHandler = Rc<dyn Fn(&mut Window, &mut App)>;

fn control_base(
    id: &SharedString,
    selector: &'static str,
    selected: bool,
    theme: Theme,
    on_activate: Option<ControlHandler>,
    root_focus: FocusHandle,
) -> gpui::Stateful<gpui::Div> {
    let enabled = on_activate.is_some();
    let mouse = on_activate.clone();
    let keyboard = on_activate;
    div()
        .id(SharedString::from(format!("{id}-{selector}")))
        .debug_selector(part(id.clone(), selector))
        .track_focus(&root_focus.clone().tab_index(0).tab_stop(enabled))
        .h(px(FILE_BROWSER_CONTROL_HEIGHT))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(6.0))
        .when(selected, |control| {
            control.bg(theme.role(ThemeRole::SurfaceSelected))
        })
        .focus(|style| {
            style
                .border_2()
                .border_color(theme.role(ThemeRole::RadioActive))
        })
        .text_color(if selected {
            theme.role(ThemeRole::Text)
        } else {
            theme.role(ThemeRole::TextSecondary)
        })
        .when(mouse.is_some(), |control| {
            control
                .cursor(CursorStyle::PointingHand)
                .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                    cx.stop_propagation();
                    root_focus.focus(window);
                })
                .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                    cx.stop_propagation();
                    mouse.as_ref().unwrap()(window, cx);
                })
        })
        .when(keyboard.is_some(), |control| {
            control.on_key_down(move |event, window, cx| {
                if !event.is_held && event.keystroke.key == "tab" {
                    cx.stop_propagation();
                    if event.keystroke.modifiers.shift {
                        window.focus_prev();
                    } else {
                        window.focus_next();
                    }
                } else if !event.is_held
                    && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                {
                    cx.stop_propagation();
                    keyboard.as_ref().unwrap()(window, cx);
                }
            })
        })
}

fn label_control(
    id: &SharedString,
    selector: &'static str,
    label: &'static str,
    selected: bool,
    theme: Theme,
    on_activate: Option<ControlHandler>,
    compact: bool,
    root_focus: FocusHandle,
) -> AnyElement {
    control_base(id, selector, selected, theme, on_activate, root_focus)
        .when(compact, |control| {
            control.w(px(if selector == "scope-all" { 44.0 } else { 48.0 }))
        })
        .when(!compact, |control| control.px(px(7.0)))
        .text_size(px(11.0))
        .line_height(px(16.0))
        .font_weight(FontWeight::SEMIBOLD)
        .child(label)
        .into_any_element()
}

#[allow(clippy::too_many_arguments)]
fn icon_control(
    id: &SharedString,
    selector: &'static str,
    label: &'static str,
    glyph: UpstreamIcon,
    selected: bool,
    theme: Theme,
    on_activate: Option<ControlHandler>,
    root_focus: FocusHandle,
) -> AnyElement {
    control_base(id, selector, selected, theme, on_activate, root_focus)
        .w(px(FILE_BROWSER_CONTROL_HEIGHT))
        .child(Icon::upstream(
            glyph,
            14.0,
            theme
                .role(if selected {
                    ThemeRole::Text
                } else {
                    ThemeRole::TextSecondary
                })
                .into(),
            format!("{id}.{selector}.icon"),
        ))
        .child(
            div()
                .absolute()
                .size(px(0.0))
                .overflow_hidden()
                .child(label),
        )
        .into_any_element()
}

#[allow(clippy::too_many_arguments)]
fn render_entry(
    root_id: &SharedString,
    theme: Theme,
    width: f32,
    entry: FileBrowserEntry,
    selected: bool,
    root_focus: FocusHandle,
    on_select: Option<FileBrowserEntryHandler>,
    on_open: Option<FileBrowserEntryHandler>,
    on_toggle: Option<FileBrowserEntryHandler>,
) -> AnyElement {
    let id = entry.id.clone();
    if entry.kind == FileBrowserEntryKind::LoadMore {
        return render_load_more(root_id, theme, entry, selected, root_focus, on_open);
    }
    let indent = FILE_BROWSER_BASE_INDENT + FILE_BROWSER_DEPTH_INDENT * entry.depth as f32;
    let directory = entry.directory.as_ref().map(|path| {
        let available = ((width - 150.0).max(48.0) / 6.5) as usize;
        middle_elide(path, available.max(7))
    });
    let click_select = on_select.clone();
    let click_open = on_open.clone();
    let click_toggle = on_toggle.clone();
    let click_id = id.clone();
    let is_directory = matches!(entry.kind, FileBrowserEntryKind::Directory { .. });
    let max_name_width = (width * 0.52).clamp(72.0, 180.0);

    div()
        .id(id.clone())
        .debug_selector(part(root_id.clone(), format!("entry-{id}")))
        .w_full()
        .h(px(FILE_BROWSER_ROW_HEIGHT))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(4.0))
        .pr(px(8.0))
        .pl(px(indent))
        .when(selected, |row| {
            row.bg(theme.role(ThemeRole::SurfaceSelected))
        })
        .hover(|row| row.bg(theme.role(ThemeRole::SurfaceRipple)))
        .cursor(CursorStyle::PointingHand)
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            cx.stop_propagation();
            root_focus.focus(window);
        })
        .on_mouse_up(MouseButton::Left, move |event, window, cx| {
            cx.stop_propagation();
            if event.click_count >= 2 {
                if is_directory {
                    if let Some(toggle) = &click_toggle {
                        toggle(click_id.clone(), window, cx);
                    }
                } else if let Some(open) = &click_open {
                    open(click_id.clone(), window, cx);
                }
            } else if let Some(select) = &click_select {
                select(click_id.clone(), window, cx);
            }
        })
        .child(
            div()
                .debug_selector(part(root_id.clone(), format!("entry-{id}.disclosure")))
                .size(px(FILE_BROWSER_DISCLOSURE_SIZE))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .children(match entry.kind {
                    FileBrowserEntryKind::Directory { expanded } => Some(Icon::upstream(
                        if expanded {
                            icon_data::ionicons::CHEVRON_DOWN_OUTLINE
                        } else {
                            icon_data::ionicons::CHEVRON_FORWARD_OUTLINE
                        },
                        12.0,
                        theme.role(ThemeRole::TextSecondary).into(),
                        format!("{root_id}.entry-{id}.disclosure-icon"),
                    )),
                    FileBrowserEntryKind::File | FileBrowserEntryKind::LoadMore => None,
                }),
        )
        .child(Icon::upstream(
            entry.icon.glyph(),
            16.0,
            theme.role(entry.icon_role).into(),
            format!("{root_id}.entry-{id}.icon"),
        ))
        .child(
            div()
                .debug_selector(part(root_id.clone(), format!("entry-{id}.path")))
                .flex_1()
                .min_w_0()
                .h(px(18.0))
                .flex()
                .items_center()
                .gap(px(4.0))
                .child(
                    div()
                        .debug_selector(part(root_id.clone(), format!("entry-{id}.name")))
                        .max_w(px(max_name_width))
                        .truncate()
                        .text_size(px(13.0))
                        .line_height(px(18.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.role(ThemeRole::Text))
                        .child(entry.name),
                )
                .children(directory.map(|path| {
                    div()
                        .debug_selector(part(root_id.clone(), format!("entry-{id}.directory")))
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(13.0))
                        .line_height(px(18.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(path)
                })),
        )
        .children(entry.status.map(|status| {
            div()
                .debug_selector(part(root_id.clone(), format!("entry-{id}.status")))
                .flex_none()
                .font_family(fonts::MONO_FAMILY)
                .text_size(px(10.0))
                .line_height(px(16.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.role(status.role))
                .child(status.label)
        }))
        .children(entry.changes.map(|stats| {
            div()
                .debug_selector(part(root_id.clone(), format!("entry-{id}.changes")))
                .flex_none()
                .flex()
                .gap(px(4.0))
                .font_family(fonts::MONO_FAMILY)
                .text_size(px(10.0))
                .line_height(px(16.0))
                .children((!stats.counts_exact).then(|| {
                    div()
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child("~")
                }))
                .child(
                    div()
                        .text_color(theme.role(ThemeRole::DiffSuccess))
                        .child(change_value(stats.added, '+')),
                )
                .child(
                    div()
                        .text_color(theme.role(ThemeRole::DiffError))
                        .child(change_value(stats.deleted, '-')),
                )
        }))
        .into_any_element()
}

fn render_load_more(
    root_id: &SharedString,
    theme: Theme,
    entry: FileBrowserEntry,
    selected: bool,
    root_focus: FocusHandle,
    on_open: Option<FileBrowserEntryHandler>,
) -> AnyElement {
    let id = entry.id.clone();
    let click_id = id.clone();
    let click_open = on_open;
    div()
        .id(id.clone())
        .debug_selector(part(root_id.clone(), format!("entry-{id}")))
        .w_full()
        .h(px(FILE_BROWSER_ROW_HEIGHT))
        .flex_none()
        .px(px(8.0))
        .flex()
        .items_center()
        .when(selected, |row| {
            row.bg(theme.role(ThemeRole::SurfaceSelected))
        })
        .hover(|row| row.bg(theme.role(ThemeRole::SurfaceRipple)))
        .cursor(CursorStyle::PointingHand)
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            cx.stop_propagation();
            root_focus.focus(window);
        })
        .on_mouse_up(MouseButton::Left, move |_, window, cx| {
            cx.stop_propagation();
            if let Some(open) = &click_open {
                open(click_id.clone(), window, cx);
            }
        })
        .child(
            div()
                .debug_selector(part(root_id.clone(), format!("entry-{id}.load-more")))
                .w_full()
                .h(px(20.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.0))
                .font_family(fonts::UI_FAMILY)
                .text_size(px(12.0))
                .line_height(px(16.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(theme.role(ThemeRole::TextSecondary))
                .child(entry.name),
        )
        .into_any_element()
}

fn middle_elide(path: &str, max_chars: usize) -> SharedString {
    let chars: Vec<_> = path.chars().collect();
    if chars.len() <= max_chars {
        return path.to_owned().into();
    }
    let room = max_chars.saturating_sub(1);
    let leading = room / 2;
    let trailing = room - leading;
    let value: String = chars[..leading]
        .iter()
        .chain(std::iter::once(&'…'))
        .chain(chars[chars.len() - trailing..].iter())
        .collect();
    value.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::{ScrollbarAppearance, ScrollbarPlacement};
    use gpui::{Context, Render, TestAppContext as _, size};

    fn entries(count: usize) -> Rc<Vec<FileBrowserEntry>> {
        Rc::new(
            (0..count)
                .map(|index| FileBrowserEntry {
                    id: format!("file-{index}").into(),
                    name: if index == 0 {
                        "file_browser.rs".into()
                    } else {
                        format!("item-{index}.rs").into()
                    },
                    directory: Some(
                        "packages/happy-desktop-gpui/src/ui/components/deep/folder".into(),
                    ),
                    depth: index.min(2),
                    kind: if index == 1 {
                        FileBrowserEntryKind::Directory { expanded: true }
                    } else {
                        FileBrowserEntryKind::File
                    },
                    icon: if index == 0 {
                        FileBrowserIconFamily::Code
                    } else {
                        FileBrowserIconFamily::Other
                    },
                    icon_role: if index == 0 {
                        ThemeRole::TextLink
                    } else {
                        ThemeRole::BoxWarningText
                    },
                    status: Some(FileBrowserStatus {
                        label: if index == 0 {
                            "Created".into()
                        } else {
                            "Modified".into()
                        },
                        role: if index == 0 {
                            ThemeRole::DiffSuccess
                        } else {
                            ThemeRole::BoxWarningText
                        },
                    }),
                    changes: Some(FileBrowserChangeStats {
                        files: 0,
                        added: Some(index as u32 + 2),
                        deleted: Some(1),
                        counts_exact: true,
                    }),
                })
                .collect(),
        )
    }

    struct Fixture {
        browser: FileBrowserListState,
        scrollbar: Entity<ScrollbarState>,
        focus: FileBrowserFocusHandles,
        entries: Rc<Vec<FileBrowserEntry>>,
        width: f32,
        theme: Theme,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            FileBrowser {
                id: "tested-files".into(),
                theme: self.theme,
                width: self.width,
                scope: FileBrowserScope::Changes,
                layout: FileBrowserLayout::Tree,
                change_stats: FileBrowserChangeStats {
                    files: 12,
                    added: Some(48),
                    deleted: Some(7),
                    counts_exact: true,
                },
                entries: self.entries.clone(),
                selected_entry_id: Some("file-0".into()),
                list_state: self.browser.clone(),
                focus: self.focus.clone(),
                scrollbar: self.scrollbar.clone(),
                on_scope_change: Some(Rc::new(|_, _, _| {})),
                on_layout_change: Some(Rc::new(|_, _, _| {})),
                on_entry_select: Some(Rc::new(|_, _, _| {})),
                on_entry_open: Some(Rc::new(|_, _, _| {})),
                on_entry_toggle: Some(Rc::new(|_, _, _| {})),
            }
        }
    }

    fn render_browser<'a>(
        cx: &'a mut gpui::TestAppContext,
        width: f32,
        theme: Theme,
    ) -> (Entity<Fixture>, &'a mut gpui::VisualTestContext) {
        let entries = entries(1000);
        let state = FileBrowserListState::new(&entries);
        let scrollbar_list = state.list_state();
        let (fixture, cx) = cx.add_window_view(move |_, cx| Fixture {
            browser: state,
            scrollbar: cx.new(|_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Always,
                    ScrollbarPlacement::Overlay,
                    scrollbar_list,
                )
            }),
            focus: FileBrowserFocusHandles {
                root: cx.focus_handle(),
                all_files: cx.focus_handle(),
                changes: cx.focus_handle(),
                list: cx.focus_handle(),
                tree: cx.focus_handle(),
            },
            entries,
            width,
            theme,
        });
        cx.simulate_resize(size(px(width), px(300.0)));
        cx.run_until_parked();
        (fixture, cx)
    }

    #[test]
    fn middle_elision_preserves_both_ends() {
        assert_eq!(middle_elide("packages/ui/file", 9).as_ref(), "pack…file");
        assert_eq!(middle_elide("short", 9).as_ref(), "short");
    }

    #[test]
    fn unknown_and_approximate_change_facts_are_explicit() {
        assert_eq!(change_value(None, '+'), "—");
        assert_eq!(change_value(Some(12), '-'), "-12");
        assert_eq!(
            file_count_value(FileBrowserChangeStats {
                files: 9,
                added: None,
                deleted: Some(2),
                counts_exact: false,
            }),
            "~9"
        );
    }

    #[test]
    fn caller_reconciles_list_geometry_outside_render() {
        let initial = entries(2);
        let state = FileBrowserListState::new(&initial);
        let changed = entries(5);
        state.reconcile(&changed);
        assert_eq!(state.list_state().item_count(), 5);
    }

    #[gpui::test]
    fn load_more_click_and_enter_open_without_file_selection(cx: &mut gpui::TestAppContext) {
        use gpui::Modifiers;

        struct LoadMoreFixture {
            browser: FileBrowserListState,
            scrollbar: Entity<ScrollbarState>,
            focus: FileBrowserFocusHandles,
            entries: Rc<Vec<FileBrowserEntry>>,
            opens: Rc<RefCell<Vec<SharedString>>>,
            selections: Rc<RefCell<Vec<SharedString>>>,
        }
        impl Render for LoadMoreFixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let opens = self.opens.clone();
                let selections = self.selections.clone();
                FileBrowser {
                    id: "load-more-files".into(),
                    theme: Theme::dark(),
                    width: 220.0,
                    scope: FileBrowserScope::AllFiles,
                    layout: FileBrowserLayout::Tree,
                    change_stats: FileBrowserChangeStats::default(),
                    entries: self.entries.clone(),
                    selected_entry_id: Some("more".into()),
                    list_state: self.browser.clone(),
                    focus: self.focus.clone(),
                    scrollbar: self.scrollbar.clone(),
                    on_scope_change: None,
                    on_layout_change: None,
                    on_entry_select: Some(Rc::new(move |id, _, _| {
                        selections.borrow_mut().push(id);
                    })),
                    on_entry_open: Some(Rc::new(move |id, _, _| {
                        opens.borrow_mut().push(id);
                    })),
                    on_entry_toggle: None,
                }
            }
        }
        let entries = Rc::new(vec![FileBrowserEntry {
            id: "more".into(),
            name: "Load more files…".into(),
            directory: None,
            depth: 0,
            kind: FileBrowserEntryKind::LoadMore,
            icon: FileBrowserIconFamily::Other,
            icon_role: ThemeRole::TextSecondary,
            status: None,
            changes: None,
        }]);
        let browser = FileBrowserListState::new(&entries);
        let scrollbar_list = browser.list_state();
        let (fixture, cx) = cx.add_window_view(move |_, cx| LoadMoreFixture {
            browser,
            scrollbar: cx.new(|_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Always,
                    ScrollbarPlacement::Overlay,
                    scrollbar_list,
                )
            }),
            focus: FileBrowserFocusHandles {
                root: cx.focus_handle(),
                all_files: cx.focus_handle(),
                changes: cx.focus_handle(),
                list: cx.focus_handle(),
                tree: cx.focus_handle(),
            },
            entries,
            opens: Rc::new(RefCell::new(Vec::new())),
            selections: Rc::new(RefCell::new(Vec::new())),
        });
        cx.simulate_resize(size(px(220.0), px(100.0)));
        cx.run_until_parked();
        let row = cx.debug_bounds("load-more-files.entry-more").unwrap();
        cx.simulate_click(row.center(), Modifiers::default());
        let focus = fixture.read_with(cx, |fixture, _| fixture.focus.root.clone());
        cx.update(|window, _| focus.focus(window));
        cx.simulate_keystrokes("enter");
        fixture.read_with(cx, |fixture, _| {
            assert_eq!(
                fixture.opens.borrow().as_slice(),
                &[SharedString::from("more"), SharedString::from("more")]
            );
            assert!(fixture.selections.borrow().is_empty());
        });
        assert!(cx.debug_bounds("load-more-files.entry-more.path").is_none());
        assert!(
            cx.debug_bounds("load-more-files.entry-more.status")
                .is_none()
        );
    }

    #[gpui::test]
    fn constrained_tab_and_shift_tab_follow_real_external_boundaries(
        cx: &mut gpui::TestAppContext,
    ) {
        use gpui::Modifiers;

        struct FocusFixture {
            browser: FileBrowserListState,
            scrollbar: Entity<ScrollbarState>,
            focus: FileBrowserFocusHandles,
            before: FocusHandle,
            after: FocusHandle,
            entries: Rc<Vec<FileBrowserEntry>>,
        }
        impl Render for FocusFixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let sentinel = |id: &'static str, focus: FocusHandle| {
                    div()
                        .id(id)
                        .h(px(24.0))
                        .flex_none()
                        .track_focus(
                            &focus
                                .tab_index(if id == "before-files" { -1 } else { 1 })
                                .tab_stop(true),
                        )
                        .on_key_down(|event, window, cx| {
                            if !event.is_held && event.keystroke.key == "tab" {
                                cx.stop_propagation();
                                if event.keystroke.modifiers.shift {
                                    window.focus_prev();
                                } else {
                                    window.focus_next();
                                }
                            }
                        })
                };
                div()
                    .w(px(220.0))
                    .h(px(348.0))
                    .tab_group()
                    .flex()
                    .flex_col()
                    .child(sentinel("before-files", self.before.clone()))
                    .child(
                        div()
                            .w(px(220.0))
                            .h(px(300.0))
                            .flex_none()
                            .child(FileBrowser {
                                id: "focus-files".into(),
                                theme: Theme::dark(),
                                width: 220.0,
                                scope: FileBrowserScope::Changes,
                                layout: FileBrowserLayout::Tree,
                                change_stats: FileBrowserChangeStats {
                                    files: 12,
                                    added: Some(48),
                                    deleted: Some(7),
                                    counts_exact: true,
                                },
                                entries: self.entries.clone(),
                                selected_entry_id: Some("file-0".into()),
                                list_state: self.browser.clone(),
                                focus: self.focus.clone(),
                                scrollbar: self.scrollbar.clone(),
                                on_scope_change: Some(Rc::new(|_, _, _| {})),
                                on_layout_change: Some(Rc::new(|_, _, _| {})),
                                on_entry_select: Some(Rc::new(|_, _, _| {})),
                                on_entry_open: Some(Rc::new(|_, _, _| {})),
                                on_entry_toggle: Some(Rc::new(|_, _, _| {})),
                            }),
                    )
                    .child(sentinel("after-files", self.after.clone()))
            }
        }

        let entries = entries(1000);
        let browser = FileBrowserListState::new(&entries);
        let scrollbar_list = browser.list_state();
        let (fixture, cx) = cx.add_window_view(move |_, cx| FocusFixture {
            browser,
            scrollbar: cx.new(|_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Always,
                    ScrollbarPlacement::Overlay,
                    scrollbar_list,
                )
            }),
            focus: FileBrowserFocusHandles {
                root: cx.focus_handle(),
                all_files: cx.focus_handle(),
                changes: cx.focus_handle(),
                list: cx.focus_handle(),
                tree: cx.focus_handle(),
            },
            before: cx.focus_handle(),
            after: cx.focus_handle(),
            entries,
        });
        cx.simulate_resize(size(px(220.0), px(348.0)));
        cx.run_until_parked();
        let (focus, before, after) = fixture.read_with(cx, |fixture, _| {
            (
                fixture.focus.clone(),
                fixture.before.clone(),
                fixture.after.clone(),
            )
        });

        cx.update(|window, _| before.focus(window));
        for (name, expected) in [
            ("all", &focus.all_files),
            ("changes", &focus.changes),
            ("list", &focus.list),
            ("tree", &focus.tree),
            ("root", &focus.root),
        ] {
            cx.simulate_keystrokes("tab");
            assert!(
                cx.update(|window, _| expected.is_focused(window)),
                "expected {name}; before={} all={} changes={} list={} tree={} root={} after={}",
                cx.update(|window, _| before.is_focused(window)),
                cx.update(|window, _| focus.all_files.is_focused(window)),
                cx.update(|window, _| focus.changes.is_focused(window)),
                cx.update(|window, _| focus.list.is_focused(window)),
                cx.update(|window, _| focus.tree.is_focused(window)),
                cx.update(|window, _| focus.root.is_focused(window)),
                cx.update(|window, _| after.is_focused(window)),
            );
        }
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, _| after.is_focused(window)));

        for expected in [
            &focus.root,
            &focus.tree,
            &focus.list,
            &focus.changes,
            &focus.all_files,
        ] {
            cx.simulate_keystrokes("shift-tab");
            assert!(cx.update(|window, _| expected.is_focused(window)));
        }
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, _| before.is_focused(window)));

        let header = cx.debug_bounds("focus-files.header").unwrap();
        let tree = cx.debug_bounds("focus-files.layout-tree").unwrap();
        assert!(tree.left() >= header.left() && tree.right() <= header.right());

        let row = cx.debug_bounds("focus-files.entry-file-0").unwrap();
        cx.simulate_click(row.center(), Modifiers::default());
        assert!(cx.update(|window, _| focus.root.is_focused(window)));
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, _| after.is_focused(window)));
    }

    #[gpui::test]
    fn real_geometry_is_full_bleed_virtualized_and_non_overlapping_at_required_widths(
        cx: &mut gpui::TestAppContext,
    ) {
        for theme in [Theme::light(), Theme::dark()] {
            for width in [220.0, 340.0] {
                let (_, rendered) = render_browser(cx, width, theme);
                assert_eq!(rendered.update(|window, _| window.scale_factor()), 2.0);
                let root = rendered.debug_bounds("tested-files.root").unwrap();
                let header = rendered.debug_bounds("tested-files.header").unwrap();
                let body = rendered.debug_bounds("tested-files.body").unwrap();
                let viewport = rendered.debug_bounds("tested-files.viewport").unwrap();
                assert_eq!(root.size, size(px(width), px(300.0)));
                assert_eq!(header.size.height, px(FILE_BROWSER_HEADER_HEIGHT));
                assert_eq!(body, viewport, "full-bleed list viewport has no spacing");
                assert_eq!(body.origin.y, header.bottom_left().y);
                assert_eq!(body.size.width, px(width));
                assert_eq!(
                    rendered
                        .debug_bounds("tested-files.scope-all")
                        .unwrap()
                        .size
                        .height,
                    px(24.0)
                );
                assert_eq!(
                    rendered
                        .debug_bounds("tested-files.layout-list")
                        .unwrap()
                        .size
                        .height,
                    px(24.0)
                );
                if width == 220.0 {
                    let all = rendered.debug_bounds("tested-files.scope-all").unwrap();
                    let changes_scope =
                        rendered.debug_bounds("tested-files.scope-changes").unwrap();
                    let summary = rendered
                        .debug_bounds("tested-files.changes-summary")
                        .unwrap();
                    let list_control = rendered.debug_bounds("tested-files.layout-list").unwrap();
                    let tree_control = rendered.debug_bounds("tested-files.layout-tree").unwrap();
                    assert_eq!(changes_scope.left() - all.right(), px(2.0));
                    assert_eq!(summary.left() - changes_scope.right(), px(8.0));
                    assert_eq!(list_control.left() - summary.right(), px(8.0));
                    assert_eq!(tree_control.left() - list_control.right(), px(2.0));
                    assert!(tree_control.right() <= header.right() - px(6.0));
                }
                let first = rendered.debug_bounds("tested-files.entry-file-0").unwrap();
                assert_eq!(first.size, size(px(width), px(FILE_BROWSER_ROW_HEIGHT)));
                let path = rendered
                    .debug_bounds("tested-files.entry-file-0.path")
                    .unwrap();
                let status = rendered
                    .debug_bounds("tested-files.entry-file-0.status")
                    .unwrap();
                let changes = rendered
                    .debug_bounds("tested-files.entry-file-0.changes")
                    .unwrap();
                assert!(path.right() <= status.left());
                assert!(status.right() <= changes.left());
                assert_eq!(first.left(), body.left());
                assert!(
                    rendered
                        .debug_bounds("tested-files.entry-file-40")
                        .is_none(),
                    "virtual list must not render remote rows"
                );
            }
        }
    }

    #[gpui::test]
    fn indentation_disclosure_typography_and_caller_identity_are_real_geometry(
        cx: &mut gpui::TestAppContext,
    ) {
        let (_, rendered) = render_browser(cx, 340.0, Theme::dark());
        let row0 = rendered.debug_bounds("tested-files.entry-file-0").unwrap();
        let row1 = rendered.debug_bounds("tested-files.entry-file-1").unwrap();
        let disclosure0 = rendered
            .debug_bounds("tested-files.entry-file-0.disclosure")
            .unwrap();
        let disclosure1 = rendered
            .debug_bounds("tested-files.entry-file-1.disclosure")
            .unwrap();
        assert_eq!(disclosure0.left() - row0.left(), px(8.0));
        assert_eq!(disclosure1.left() - row1.left(), px(24.0));
        assert_eq!(disclosure1.size, size(px(16.0), px(16.0)));
        let name = rendered
            .debug_bounds("tested-files.entry-file-0.name")
            .unwrap();
        assert_eq!(name.size.height, px(18.0));
    }
}
