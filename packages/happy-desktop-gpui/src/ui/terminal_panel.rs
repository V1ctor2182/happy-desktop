//! Store-, transport-, and router-free native terminal presentation.
//!
//! The caller owns terminal lifetime, focus, selection, scroll offsets, and the
//! last resize it accepted. This component only paints a bounded projection and
//! turns GPUI events into typed intents.

use crate::ui::theme_roles::ThemeRole;
use crate::{fonts, theme::Theme};
use gpui::{
    AnyElement, App, Bounds, Context, Element, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, FocusHandle, FontWeight, GlobalElementId, Hsla, IntoElement, IsZero,
    KeyDownEvent, LayoutId, MouseButton, Pixels, RenderOnce, SharedString, Style, UTF16Selection,
    Window, div, prelude::*, px, relative,
};
use regex::Regex;
use std::{ops::Range, rc::Rc, sync::LazyLock};
use url::Url;

pub const TERMINAL_CELL_WIDTH: f32 = 8.4;
pub const TERMINAL_CELL_HEIGHT: f32 = 18.0;
pub const TERMINAL_INSET_X: f32 = 12.0;
pub const TERMINAL_INSET_Y: f32 = 8.0;
pub const TERMINAL_MAX_HISTORY_ROWS: usize = 10_000;
pub const TERMINAL_MAX_PROJECTED_ROWS: usize = 512;
pub const TERMINAL_MAX_PROJECTED_CELLS: usize = 16_384;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalColorScheme {
    Light,
    Dark,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TerminalPanelLayout {
    Fill,
    Dock { height: f32 },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalStatus {
    Connecting,
    Connected,
    Disconnected,
    Exited,
    Error,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalAvailability {
    Available,
    Reconnecting,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerminalColor(pub Hsla);
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerminalCellStyle {
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    pub overline: bool,
    pub strikethrough: bool,
    pub inverse: bool,
    pub invisible: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct TerminalCell {
    pub column: u16,
    pub width: u8,
    pub text: SharedString,
    pub foreground: Option<TerminalColor>,
    pub background: Option<TerminalColor>,
    pub style: TerminalCellStyle,
    pub hyperlink: Option<SharedString>,
}
#[derive(Clone, Debug, PartialEq)]
pub struct TerminalRow {
    /// Stable absolute row number. Screen rows follow retained history rows.
    pub row: u64,
    pub wrapped: bool,
    pub cells: Rc<Vec<TerminalCell>>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalCursor {
    pub column: u16,
    /// Retained vector-relative visual row. This is never an absolute protocol row ID.
    pub visual_row: usize,
    pub visible: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerminalInputModes {
    pub cursor_keys_application: bool,
    pub bracketed_paste: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct TerminalGrid {
    pub columns: u16,
    pub rows: Rc<Vec<TerminalRow>>,
    pub cursor: Option<TerminalCursor>,
    /// Absolute, end-exclusive protocol row range omitted before the retained projection.
    pub omitted_before: Option<Range<u64>>,
    pub input_modes: TerminalInputModes,
}
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TerminalScrollState {
    pub x: f32,
    pub y: f32,
    /// Last resolved window-space viewport bounds supplied by the layout canvas.
    pub viewport_x: f32,
    pub viewport_y: f32,
    pub viewport_width: f32,
    pub viewport_height: f32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalSize {
    pub columns: u16,
    pub rows: u16,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TerminalPosition {
    pub row: u64,
    pub column: u16,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalSelection {
    pub anchor: TerminalPosition,
    pub head: TerminalPosition,
}
impl TerminalSelection {
    pub fn ordered(self) -> (TerminalPosition, TerminalPosition) {
        if self.anchor <= self.head {
            (self.anchor, self.head)
        } else {
            (self.head, self.anchor)
        }
    }
    pub fn contains(self, position: TerminalPosition, width: u8) -> bool {
        let (start, end) = self.ordered();
        let cell_end = TerminalPosition {
            row: position.row,
            column: position.column.saturating_add(width as u16),
        };
        position < end && cell_end > start
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalLink {
    pub url: SharedString,
    pub row: u64,
    pub start: u16,
    pub end: u16,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerminalModifiers {
    pub control: bool,
    pub alt: bool,
    pub shift: bool,
    pub command: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerminalKey {
    Character(SharedString),
    Enter,
    Backspace,
    Tab,
    Escape,
    Insert,
    Delete,
    Home,
    End,
    PageUp,
    PageDown,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Function(u8),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalKeyIntent {
    pub key: TerminalKey,
    pub modifiers: TerminalModifiers,
    /// The emulator's current DECCKM state. The owner passes this to its native key encoder.
    pub cursor_keys_application: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerminalInputIntent {
    Key(TerminalKeyIntent),
    Text(SharedString),
    Paste { text: SharedString, bracketed: bool },
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TerminalScrollIntent {
    By {
        x: f32,
        y: f32,
    },
    To(TerminalScrollState),
    ViewportBounds {
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    },
    PageAt {
        axis: TerminalScrollAxis,
        pointer: f32,
    },
    DragStart {
        axis: TerminalScrollAxis,
        pointer: f32,
        on_thumb: bool,
    },
    DragMove {
        axis: TerminalScrollAxis,
        pointer: f32,
    },
    DragEnd {
        axis: TerminalScrollAxis,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalScrollAxis {
    Horizontal,
    Vertical,
}

pub type TerminalInputHandler = Rc<dyn Fn(TerminalInputIntent, &mut Window, &mut App)>;
pub type TerminalResizeHandler = Rc<dyn Fn(TerminalSize, &mut Window, &mut App)>;
pub type TerminalScrollHandler = Rc<dyn Fn(TerminalScrollIntent, &mut Window, &mut App)>;
pub type TerminalSelectionHandler = Rc<dyn Fn(Option<TerminalSelection>, &mut Window, &mut App)>;
pub type TerminalLinkHandler = Rc<dyn Fn(TerminalLink, &mut Window, &mut App)>;
pub type TerminalHoverLinkHandler = Rc<dyn Fn(Option<TerminalLink>, &mut Window, &mut App)>;
pub type TerminalReconnectHandler = Rc<dyn Fn(&mut Window, &mut App)>;
pub type TerminalCopyHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

/// Stable caller-owned IME bridge. Construct it once beside the surface store.
pub struct TerminalInputCapture {
    focus: FocusHandle,
    on_input: TerminalInputHandler,
    writable: bool,
    marked: Option<String>,
}
impl TerminalInputCapture {
    pub fn new(focus: FocusHandle, on_input: TerminalInputHandler) -> Self {
        Self {
            focus,
            on_input,
            writable: true,
            marked: None,
        }
    }
    pub fn focus_handle(&self) -> FocusHandle {
        self.focus.clone()
    }
    pub fn set_writable(&mut self, writable: bool) {
        self.writable = writable;
        if !writable {
            self.marked = None;
        }
    }
}
impl EntityInputHandler for TerminalInputCapture {
    fn text_for_range(
        &mut self,
        _: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        actual.replace(0..0);
        Some(String::new())
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: 0..0,
            reversed: false,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked.as_ref().map(|s| 0..s.encode_utf16().count())
    }
    fn unmark_text(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.writable {
            if let Some(text) = self.marked.take() {
                if !text.is_empty() {
                    (self.on_input)(TerminalInputIntent::Text(text.into()), window, cx);
                }
            }
        } else {
            self.marked = None;
        }
    }
    fn replace_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.marked = None;
        if self.writable && !text.is_empty() {
            (self.on_input)(
                TerminalInputIntent::Text(text.to_owned().into()),
                window,
                cx,
            );
        }
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) {
        if self.writable {
            self.marked = Some(text.to_owned());
        }
    }
    fn bounds_for_range(
        &mut self,
        _: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        Some(bounds)
    }
    fn character_index_for_point(
        &mut self,
        _: gpui::Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        Some(0)
    }
}

struct TerminalInputElement {
    capture: Entity<TerminalInputCapture>,
}
impl IntoElement for TerminalInputElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for TerminalInputElement {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = relative(1.).into();
        (window.request_layout(style, [], cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut Window,
        _: &mut App,
    ) {
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus = self.capture.read(cx).focus.clone();
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.capture.clone()),
            cx,
        );
    }
}

#[derive(IntoElement)]
pub struct TerminalPanel {
    pub id: SharedString,
    pub theme: Theme,
    /// Fixed for the session lifetime; terminal defaults never follow a later theme switch.
    pub color_scheme: TerminalColorScheme,
    pub layout: TerminalPanelLayout,
    pub status: TerminalStatus,
    pub availability: TerminalAvailability,
    pub notice: Option<SharedString>,
    pub exit_code: Option<i32>,
    pub grid: Option<Rc<TerminalGrid>>,
    pub scroll: TerminalScrollState,
    pub selection: Option<TerminalSelection>,
    pub hovered_link: Option<TerminalLink>,
    pub focused: bool,
    pub focus: FocusHandle,
    pub input_capture: Entity<TerminalInputCapture>,
    /// Last size accepted by the caller. Equal geometry is not emitted again.
    pub reported_size: Option<TerminalSize>,
    pub on_input: TerminalInputHandler,
    pub on_resize: TerminalResizeHandler,
    pub on_scroll: TerminalScrollHandler,
    pub on_selection: TerminalSelectionHandler,
    pub on_copy: TerminalCopyHandler,
    pub on_open_link: Option<TerminalLinkHandler>,
    pub on_hover_link: Option<TerminalHoverLinkHandler>,
    pub on_reconnect: TerminalReconnectHandler,
}

impl RenderOnce for TerminalPanel {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let fixed_theme = match self.color_scheme {
            TerminalColorScheme::Light => Theme::light(),
            TerminalColorScheme::Dark => Theme::dark(),
        };
        let read_only = self.availability != TerminalAvailability::Available
            || self.status != TerminalStatus::Connected;
        let default_fg: Hsla = fixed_theme.role(ThemeRole::Text).into();
        let default_bg: Hsla = fixed_theme.role(ThemeRole::Surface).into();
        let link_color: Hsla = fixed_theme.role(ThemeRole::TextLink).into();
        let selection_color: Hsla = fixed_theme.role(ThemeRole::TerminalSelection).into();
        let rows = self
            .grid
            .as_ref()
            .map(|g| bounded_rows(&g.rows, self.scroll))
            .unwrap_or_default();
        let links: Rc<Vec<TerminalLink>> =
            Rc::new(rows.iter().flat_map(|r| links_for_row(&r.row)).collect());
        // Copy projection is deliberately event-time work. Render only scans the visible rows.
        let copy_rows = self.grid.as_ref().map(|grid| grid.rows.clone());
        let copy_selection = self.selection;
        let focus = self.focus.clone();
        let key_input = self.on_input.clone();
        let copy = self.on_copy.clone();
        let modes = self
            .grid
            .as_ref()
            .map(|g| g.input_modes)
            .unwrap_or_default();
        let writable = !read_only;
        let mut root = div()
            .id(self.id.clone())
            .debug_selector({
                let id = self.id.clone();
                move || format!("{id}.root")
            })
            .relative()
            .w_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .bg(default_bg)
            .font_family(fonts::MONO_FAMILY)
            .text_size(px(14.0))
            .line_height(px(TERMINAL_CELL_HEIGHT))
            .track_focus(&self.focus.tab_index(0).tab_stop(!read_only))
            .when(self.focused && !read_only, |v| {
                v.border_1()
                    .border_color(self.theme.role(ThemeRole::RadioActive))
            })
            .when(read_only, |v| v.opacity(0.60))
            .on_mouse_down(MouseButton::Left, move |_, window, _| {
                if writable {
                    focus.focus(window);
                }
            })
            .on_key_down(move |event, window, cx| {
                if !writable || event.is_held {
                    return;
                }
                if is_copy(event) {
                    if let (Some(rows), Some(selection)) = (copy_rows.as_ref(), copy_selection) {
                        let text: SharedString = selection_text(rows, selection).into();
                        if !text.is_empty() {
                            cx.stop_propagation();
                            copy(text, window, cx);
                        }
                    }
                    return;
                }
                if is_paste(event) {
                    if let Some(text) = cx.read_from_clipboard().and_then(|v| v.text()) {
                        cx.stop_propagation();
                        let clean = if modes.bracketed_paste {
                            strip_bracketed_paste_close(&text)
                        } else {
                            text
                        };
                        key_input(
                            TerminalInputIntent::Paste {
                                text: clean.into(),
                                bracketed: modes.bracketed_paste,
                            },
                            window,
                            cx,
                        );
                    }
                    return;
                }
                if let Some(key) = key_intent(event, modes.cursor_keys_application) {
                    cx.stop_propagation();
                    key_input(TerminalInputIntent::Key(key), window, cx);
                }
            });
        root = match self.layout {
            TerminalPanelLayout::Fill => root.h_full(),
            TerminalPanelLayout::Dock { height } => root.h(px(height.max(0.0))),
        };
        let scroll_handler = self.on_scroll.clone();
        root = root.on_scroll_wheel(move |event, window, cx| {
            let d = event.delta.pixel_delta(window.line_height());
            if !d.x.is_zero() || !d.y.is_zero() {
                cx.stop_propagation();
                scroll_handler(
                    TerminalScrollIntent::By {
                        x: -f32::from(d.x),
                        y: -f32::from(d.y),
                    },
                    window,
                    cx,
                );
            }
        });
        if let Some(hover) = self.on_hover_link.clone() {
            root = root.on_hover(move |inside, window, cx| {
                if !*inside {
                    hover(None, window, cx);
                }
            });
        }
        let projected = div()
            .absolute()
            .left(px(TERMINAL_INSET_X - self.scroll.x))
            .top(px(TERMINAL_INSET_Y - self.scroll.y))
            .children(rows.into_iter().map(|projected_row| {
                render_row(
                    projected_row.row,
                    projected_row.visual_row,
                    links.clone(),
                    self.selection,
                    self.hovered_link.clone(),
                    default_fg,
                    default_bg,
                    link_color,
                    selection_color,
                    self.on_selection.clone(),
                    self.on_open_link.clone(),
                    self.on_hover_link.clone(),
                )
            }));
        let cursor =
            self.grid
                .as_ref()
                .and_then(|g| g.cursor)
                .filter(|c| c.visible)
                .map(|c| {
                    div()
                        .absolute()
                        .left(px(TERMINAL_INSET_X + c.column as f32 * TERMINAL_CELL_WIDTH
                            - self.scroll.x))
                        .top(px(TERMINAL_INSET_Y
                            + c.visual_row as f32 * TERMINAL_CELL_HEIGHT
                            - self.scroll.y))
                        .w(px(TERMINAL_CELL_WIDTH))
                        .h(px(TERMINAL_CELL_HEIGHT))
                        .bg(default_fg)
                        .opacity(0.55)
                });
        let notice = notice_text(
            self.status,
            self.availability,
            self.notice.clone(),
            self.exit_code,
        );
        let has_status_bar = notice.is_some();
        let omitted_notice = self.grid.as_ref().and_then(|grid| {
            grid.omitted_before.as_ref().map(|range| {
                let count = range.end.saturating_sub(range.start);
                SharedString::from(format!(
                    "History limited: {count} earlier rows omitted ({}–{})",
                    range.start,
                    range.end.saturating_sub(1)
                ))
            })
        });
        let reconnect = self.on_reconnect.clone();
        let status_bar = notice.map(|text| {
            div()
                .absolute()
                .left_0()
                .right_0()
                .top_0()
                .h(px(28.0))
                .px(px(12.0))
                .flex()
                .items_center()
                .justify_between()
                .bg(self.theme.role(ThemeRole::SurfaceHigh))
                .font_family(fonts::UI_FAMILY)
                .text_size(px(11.0))
                .text_color(self.theme.role(ThemeRole::TextSecondary))
                .child(text)
                .when(
                    matches!(
                        self.status,
                        TerminalStatus::Disconnected | TerminalStatus::Error
                    ),
                    |v| {
                        v.child(
                            div()
                                .id(SharedString::from(format!("{}-reconnect", self.id)))
                                .cursor_pointer()
                                .child("Reconnect")
                                .on_mouse_up(MouseButton::Left, move |_, w, cx| reconnect(w, cx)),
                        )
                    },
                )
        });
        let projection_notice = omitted_notice.map(|text| {
            div()
                .absolute()
                .left(px(12.0))
                .top(px(if has_status_bar { 32.0 } else { 4.0 }))
                .h(px(20.0))
                .px(px(6.0))
                .flex()
                .items_center()
                .rounded(px(4.0))
                .bg(self.theme.role(ThemeRole::SurfaceHigh))
                .font_family(fonts::UI_FAMILY)
                .text_size(px(11.0))
                .text_color(self.theme.role(ThemeRole::TextSecondary))
                .child(text)
        });
        // Persistent 8px track / 6px ink scrollbars. The owner performs drag/page math
        // so scroll identity stays outside this reusable renderer.
        let content_width = self.grid.as_ref().map_or(0.0, |g| {
            g.columns.min(1000) as f32 * TERMINAL_CELL_WIDTH + 2.0 * TERMINAL_INSET_X
        });
        let retained_rows = self
            .grid
            .as_ref()
            .map_or(0, |g| g.rows.len().min(TERMINAL_MAX_HISTORY_ROWS));
        let content_height = retained_rows as f32 * TERMINAL_CELL_HEIGHT + 2.0 * TERMINAL_INSET_Y;
        let viewport_width = self.scroll.viewport_width.max(1.0);
        let viewport_height = self.scroll.viewport_height.max(1.0);
        let vertical_thumb = (viewport_height
            * (viewport_height / content_height.max(viewport_height)))
        .clamp(18.0_f32.min(viewport_height), viewport_height);
        let horizontal_thumb = (viewport_width
            * (viewport_width / content_width.max(viewport_width)))
        .clamp(18.0_f32.min(viewport_width), viewport_width);
        let vertical_max = (content_height - viewport_height).max(0.0);
        let horizontal_max = (content_width - viewport_width).max(0.0);
        let vertical_top = if vertical_max > 0.0 {
            (viewport_height - vertical_thumb)
                * (self.scroll.y.clamp(0.0, vertical_max) / vertical_max)
        } else {
            0.0
        };
        let horizontal_left = if horizontal_max > 0.0 {
            (viewport_width - horizontal_thumb)
                * (self.scroll.x.clamp(0.0, horizontal_max) / horizontal_max)
        } else {
            0.0
        };
        let bar_color = self.theme.role(ThemeRole::HappyScrollbarColor);
        let vertical_handler = self.on_scroll.clone();
        let vertical_drag = self.on_scroll.clone();
        let horizontal_handler = self.on_scroll.clone();
        let horizontal_drag = self.on_scroll.clone();
        let vertical: AnyElement = div()
            .absolute()
            .right_0()
            .top_0()
            .bottom_0()
            .w(px(8.0))
            .on_mouse_down(MouseButton::Left, move |event, w, cx| {
                vertical_handler(
                    TerminalScrollIntent::PageAt {
                        axis: TerminalScrollAxis::Vertical,
                        pointer: f32::from(event.position.y),
                    },
                    w,
                    cx,
                )
            })
            .child(
                div()
                    .absolute()
                    .right(px(1.0))
                    .top(px(vertical_top))
                    .w(px(6.0))
                    .h(px(vertical_thumb))
                    .rounded(px(3.0))
                    .bg(bar_color)
                    .on_mouse_down(MouseButton::Left, move |event, w, cx| {
                        cx.stop_propagation();
                        vertical_drag(
                            TerminalScrollIntent::DragStart {
                                axis: TerminalScrollAxis::Vertical,
                                pointer: f32::from(event.position.y),
                                on_thumb: true,
                            },
                            w,
                            cx,
                        );
                    }),
            )
            .into_any_element();
        let horizontal: AnyElement = div()
            .absolute()
            .left_0()
            .right_0()
            .bottom_0()
            .h(px(8.0))
            .on_mouse_down(MouseButton::Left, move |event, w, cx| {
                horizontal_handler(
                    TerminalScrollIntent::PageAt {
                        axis: TerminalScrollAxis::Horizontal,
                        pointer: f32::from(event.position.x),
                    },
                    w,
                    cx,
                )
            })
            .child(
                div()
                    .absolute()
                    .left(px(horizontal_left))
                    .bottom(px(1.0))
                    .h(px(6.0))
                    .w(px(horizontal_thumb))
                    .rounded(px(3.0))
                    .bg(bar_color)
                    .on_mouse_down(MouseButton::Left, move |event, w, cx| {
                        cx.stop_propagation();
                        horizontal_drag(
                            TerminalScrollIntent::DragStart {
                                axis: TerminalScrollAxis::Horizontal,
                                pointer: f32::from(event.position.x),
                                on_thumb: true,
                            },
                            w,
                            cx,
                        );
                    }),
            )
            .into_any_element();
        let move_v = self.on_scroll.clone();
        let move_h = self.on_scroll.clone();
        let up_v = self.on_scroll.clone();
        let up_h = self.on_scroll.clone();
        root = root
            .on_mouse_move(move |event, w, cx| {
                if event.pressed_button == Some(MouseButton::Left) {
                    move_v(
                        TerminalScrollIntent::DragMove {
                            axis: TerminalScrollAxis::Vertical,
                            pointer: f32::from(event.position.y),
                        },
                        w,
                        cx,
                    );
                    move_h(
                        TerminalScrollIntent::DragMove {
                            axis: TerminalScrollAxis::Horizontal,
                            pointer: f32::from(event.position.x),
                        },
                        w,
                        cx,
                    );
                }
            })
            .on_mouse_up(MouseButton::Left, move |_, w, cx| {
                up_v(
                    TerminalScrollIntent::DragEnd {
                        axis: TerminalScrollAxis::Vertical,
                    },
                    w,
                    cx,
                );
                up_h(
                    TerminalScrollIntent::DragEnd {
                        axis: TerminalScrollAxis::Horizontal,
                    },
                    w,
                    cx,
                );
            });
        let resize = self.on_resize.clone();
        let viewport = self.on_scroll.clone();
        let reported = self.reported_size;
        root.child(projected)
            .children(cursor)
            .child(TerminalInputElement {
                capture: self.input_capture,
            })
            .children(status_bar)
            .children(projection_notice)
            .child(vertical)
            .child(horizontal)
            .child(
                gpui::canvas(
                    |bounds, _, _| bounds,
                    move |bounds, _, window, cx| {
                        let x = f32::from(bounds.origin.x);
                        let y = f32::from(bounds.origin.y);
                        let width = f32::from(bounds.size.width);
                        let height = f32::from(bounds.size.height);
                        let viewport_callback = viewport.clone();
                        window.defer(cx, move |w, cx| {
                            viewport_callback(
                                TerminalScrollIntent::ViewportBounds {
                                    x,
                                    y,
                                    width,
                                    height,
                                },
                                w,
                                cx,
                            )
                        });
                        let size = size_for_bounds(width, height);
                        if Some(size) != reported {
                            let callback = resize.clone();
                            window.defer(cx, move |w, cx| callback(size, w, cx));
                        }
                    },
                )
                .absolute()
                .size_full(),
            )
    }
}

struct ProjectedTerminalRow {
    visual_row: usize,
    row: TerminalRow,
}

fn bounded_rows(rows: &[TerminalRow], scroll: TerminalScrollState) -> Vec<ProjectedTerminalRow> {
    let first = (scroll.y.max(0.0) / TERMINAL_CELL_HEIGHT).floor() as usize;
    let count = ((scroll.viewport_height.max(TERMINAL_CELL_HEIGHT) / TERMINAL_CELL_HEIGHT).ceil()
        as usize
        + 4)
    .min(TERMINAL_MAX_PROJECTED_ROWS);
    let mut cell_budget = TERMINAL_MAX_PROJECTED_CELLS;
    rows.iter()
        .enumerate()
        .skip(first)
        .take(count)
        .filter_map(|(visual_row, row)| {
            if !row.cells.is_empty() && cell_budget == 0 {
                return None;
            }
            let cells: Vec<_> = row
                .cells
                .iter()
                .take(1000)
                .filter(|cell| cell.column < 1000)
                .take(cell_budget)
                .cloned()
                .collect();
            cell_budget = cell_budget.saturating_sub(cells.len());
            Some(ProjectedTerminalRow {
                visual_row,
                row: TerminalRow {
                    row: row.row,
                    wrapped: row.wrapped,
                    cells: Rc::new(cells),
                },
            })
        })
        .collect()
}
fn size_for_bounds(width: f32, height: f32) -> TerminalSize {
    TerminalSize {
        columns: (((width - 2.0 * TERMINAL_INSET_X) / TERMINAL_CELL_WIDTH)
            .floor()
            .max(1.0)
            .min(1000.0)) as u16,
        rows: (((height - 2.0 * TERMINAL_INSET_Y) / TERMINAL_CELL_HEIGHT)
            .floor()
            .max(1.0)
            .min(1000.0)) as u16,
    }
}

#[allow(clippy::too_many_arguments)]
fn render_row(
    row: TerminalRow,
    visual_row: usize,
    links: Rc<Vec<TerminalLink>>,
    selection: Option<TerminalSelection>,
    hovered: Option<TerminalLink>,
    default_fg: Hsla,
    default_bg: Hsla,
    link_color: Hsla,
    selection_color: Hsla,
    on_selection: TerminalSelectionHandler,
    on_open: Option<TerminalLinkHandler>,
    on_hover: Option<TerminalHoverLinkHandler>,
) -> impl IntoElement {
    let row_number = row.row;
    let cells: Vec<TerminalCell> = row
        .cells
        .iter()
        .take(TERMINAL_MAX_PROJECTED_CELLS)
        .cloned()
        .collect();
    div()
        .absolute()
        .left_0()
        .top(px(visual_row as f32 * TERMINAL_CELL_HEIGHT))
        .h(px(TERMINAL_CELL_HEIGHT))
        .flex()
        .items_start()
        .children(cells.into_iter().map(move |cell| {
            let position = TerminalPosition {
                row: row_number,
                column: cell.column,
            };
            let link = links
                .iter()
                .find(|l| {
                    l.row == row_number
                        && cell.column < l.end
                        && cell.column + cell.width as u16 > l.start
                })
                .cloned();
            let (fg, bg) = if cell.style.inverse {
                (
                    cell.background.map(|c| c.0).unwrap_or(default_bg),
                    cell.foreground.map(|c| c.0).unwrap_or(default_fg),
                )
            } else {
                (
                    cell.foreground.map(|c| c.0).unwrap_or(default_fg),
                    cell.background.map(|c| c.0).unwrap_or(default_bg),
                )
            };
            let select = selection.is_some_and(|s| s.contains(position, cell.width));
            let link_hovered = link.as_ref().is_some_and(|l| hovered.as_ref() == Some(l));
            let selection_handler = on_selection.clone();
            let selection_move = on_selection.clone();
            let open = on_open.clone();
            let hover = on_hover.clone();
            let link_click = link.clone();
            let link_move = link.clone();
            div()
                .absolute()
                .left(px(cell.column as f32 * TERMINAL_CELL_WIDTH))
                .w(px(cell.width.clamp(1, 2) as f32 * TERMINAL_CELL_WIDTH))
                .h(px(TERMINAL_CELL_HEIGHT))
                .overflow_hidden()
                .whitespace_nowrap()
                .text_color(if link.is_some() { link_color } else { fg })
                .bg(if select { selection_color } else { bg })
                .font_weight(if cell.style.bold {
                    FontWeight::SEMIBOLD
                } else {
                    FontWeight::NORMAL
                })
                .when(cell.style.italic, |v| v.italic())
                .opacity(if cell.style.invisible {
                    0.0
                } else if cell.style.dim {
                    0.6
                } else {
                    1.0
                })
                .when(cell.style.underline || link_hovered, |v| {
                    v.border_b_1()
                        .border_color(if link.is_some() { link_color } else { fg })
                })
                .when(cell.style.overline, |v| v.border_t_1().border_color(fg))
                .when(cell.style.strikethrough, |v| v.line_through())
                .when(link.is_some() && on_open.is_some(), |v| v.cursor_pointer())
                .on_mouse_down(MouseButton::Left, move |event, w, cx| {
                    cx.stop_propagation();
                    let next = if event.modifiers.shift {
                        selection.map(|s| TerminalSelection {
                            anchor: s.anchor,
                            head: position,
                        })
                    } else {
                        Some(TerminalSelection {
                            anchor: position,
                            head: TerminalPosition {
                                row: position.row,
                                column: position.column + cell.width as u16,
                            },
                        })
                    };
                    selection_handler(next, w, cx)
                })
                .on_mouse_move(move |event, w, cx| {
                    if event.pressed_button == Some(MouseButton::Left) {
                        selection_move(
                            selection.map(|s| TerminalSelection {
                                anchor: s.anchor,
                                head: TerminalPosition {
                                    row: position.row,
                                    column: position.column + cell.width as u16,
                                },
                            }),
                            w,
                            cx,
                        )
                    }
                    if let Some(cb) = hover.as_ref() {
                        cb(link_move.clone(), w, cx)
                    }
                })
                .on_mouse_up(MouseButton::Left, move |_, w, cx| {
                    if let (Some(cb), Some(link)) = (open.as_ref(), link_click.clone()) {
                        cb(link, w, cx)
                    }
                })
                .child(if cell.text.is_empty() {
                    SharedString::from(" ")
                } else {
                    cell.text.clone()
                })
        }))
}

fn links_for_row(row: &TerminalRow) -> Vec<TerminalLink> {
    let mut out = Vec::new();
    for cell in row.cells.iter().take(TERMINAL_MAX_PROJECTED_CELLS) {
        if let Some(raw) = cell.hyperlink.as_ref() {
            if let Some(url) = web_url(raw) {
                out.push(TerminalLink {
                    url: url.into(),
                    row: row.row,
                    start: cell.column,
                    end: cell.column + cell.width as u16,
                });
            }
        }
    }
    let mut chars = vec![
        ' ';
        row.cells
            .iter()
            .take(TERMINAL_MAX_PROJECTED_CELLS)
            .map(|c| c.column as usize + c.width as usize)
            .max()
            .unwrap_or(0)
    ];
    for cell in row.cells.iter().take(TERMINAL_MAX_PROJECTED_CELLS) {
        for (i, ch) in cell.text.chars().enumerate() {
            if cell.column as usize + i < chars.len() {
                chars[cell.column as usize + i] = ch;
            }
        }
    }
    let text: String = chars.into_iter().collect();
    static WEB_URL: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"https?://[^\s<>"']+"#).expect("static terminal URL regex"));
    for m in WEB_URL.find_iter(&text) {
        let raw = m
            .as_str()
            .trim_end_matches(&[')', ',', '.', ';', ':', '!', '?', '}', ']'][..]);
        if let Some(url) = web_url(raw) {
            out.push(TerminalLink {
                url: url.into(),
                row: row.row,
                start: m.start() as u16,
                end: (m.start() + raw.len()) as u16,
            });
        }
    }
    out
}
fn web_url(raw: &str) -> Option<String> {
    let parsed = Url::parse(raw).ok()?;
    matches!(parsed.scheme(), "http" | "https").then(|| parsed.to_string())
}
fn selection_text(rows: &[TerminalRow], selection: TerminalSelection) -> String {
    let (start, end) = selection.ordered();
    rows.iter()
        .skip(rows.len().saturating_sub(TERMINAL_MAX_HISTORY_ROWS))
        .filter(|r| r.row >= start.row && r.row <= end.row)
        .map(|r| {
            let mut text = String::new();
            let mut at = 0u16;
            for c in r.cells.iter().take(1000) {
                let p = TerminalPosition {
                    row: r.row,
                    column: c.column,
                };
                if !selection.contains(p, c.width) {
                    continue;
                }
                if c.column > at {
                    text.push_str(&" ".repeat((c.column - at) as usize));
                }
                text.push_str(&c.text);
                at = c.column + c.width as u16;
            }
            text.trim_end().to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn strip_bracketed_paste_close(text: &str) -> String {
    text.replace("\x1b[201~", "").replace('\x1b', "")
}
fn is_copy(e: &KeyDownEvent) -> bool {
    (e.keystroke.modifiers.platform || e.keystroke.modifiers.control)
        && e.keystroke.key.eq_ignore_ascii_case("c")
}
fn is_paste(e: &KeyDownEvent) -> bool {
    (e.keystroke.modifiers.platform || e.keystroke.modifiers.control)
        && e.keystroke.key.eq_ignore_ascii_case("v")
}
fn key_intent(e: &KeyDownEvent, cursor_keys_application: bool) -> Option<TerminalKeyIntent> {
    let key = e.keystroke.key.as_str();
    let parsed = match key {
        "enter" => TerminalKey::Enter,
        "backspace" => TerminalKey::Backspace,
        "tab" => TerminalKey::Tab,
        "escape" => TerminalKey::Escape,
        "insert" => TerminalKey::Insert,
        "delete" => TerminalKey::Delete,
        "home" => TerminalKey::Home,
        "end" => TerminalKey::End,
        "pageup" => TerminalKey::PageUp,
        "pagedown" => TerminalKey::PageDown,
        "up" => TerminalKey::ArrowUp,
        "down" => TerminalKey::ArrowDown,
        "left" => TerminalKey::ArrowLeft,
        "right" => TerminalKey::ArrowRight,
        _ if key.starts_with('f') => {
            let n = key[1..].parse().ok()?;
            if !(1..=12).contains(&n) {
                return None;
            }
            TerminalKey::Function(n)
        }
        _ => {
            let text = e
                .keystroke
                .key_char
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| key.to_owned());
            if text.chars().count() != 1 {
                return None;
            }
            TerminalKey::Character(text.into())
        }
    };
    let m = e.keystroke.modifiers;
    Some(TerminalKeyIntent {
        key: parsed,
        modifiers: TerminalModifiers {
            control: m.control,
            alt: m.alt,
            shift: m.shift,
            command: m.platform,
        },
        cursor_keys_application,
    })
}
fn notice_text(
    status: TerminalStatus,
    availability: TerminalAvailability,
    notice: Option<SharedString>,
    exit: Option<i32>,
) -> Option<SharedString> {
    if notice.is_some() {
        return notice;
    }
    match availability {
        TerminalAvailability::Reconnecting => return Some("Happy Agent reconnecting".into()),
        TerminalAvailability::Unavailable => return Some("Happy Agent unavailable".into()),
        TerminalAvailability::Available => {}
    }
    match status {
        TerminalStatus::Disconnected => Some("Disconnected".into()),
        TerminalStatus::Exited => Some(
            format!("Exited {}", exit.map(|v| v.to_string()).unwrap_or_default())
                .trim()
                .to_owned()
                .into(),
        ),
        TerminalStatus::Error => Some("Terminal error".into()),
        TerminalStatus::Connecting => Some("Connecting…".into()),
        TerminalStatus::Connected => None,
    }
}
