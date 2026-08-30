use std::{cell::RefCell, ops::Range, rc::Rc, time::Duration};

use unicode_segmentation::UnicodeSegmentation;

use crate::{
    theme::Theme,
    ui::{
        scrollbar::{ScrollbarAxis, normalized_wheel_delta},
        theme_roles::ThemeRole,
    },
};
use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, DispatchPhase, Element, ElementId,
    ElementInputHandler, Entity, EntityInputHandler, EventEmitter, FocusHandle, Focusable,
    GlobalElementId, Hsla, KeyBinding, LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, PaintQuad, Pixels, Point, ScrollWheelEvent, SharedString, Style, TextAlign,
    TextRun, UTF16Selection, UnderlineStyle, Window, WrappedLine, actions, div, fill, point,
    prelude::*, px, relative, size,
};

actions!(
    happy_text_area,
    [
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectAll,
        Home,
        End,
        Submit,
        Newline,
        Save,
        ShowCharacterPalette,
        Paste,
        Cut,
        Copy,
        FocusNext,
        FocusPrevious,
    ]
);

const KEY_CONTEXT: &str = "HappyTextArea";
const COMPOSER_LINE_HEIGHT: Pixels = px(22.0);
const EDITOR_LINE_HEIGHT: Pixels = px(20.0);
const EDITOR_GUTTER_WIDTH: Pixels = px(44.0);
const MAX_HIGHLIGHT_SPANS: usize = 65_536;
const MIN_LINES: usize = 1;
const MAX_LINES: usize = 8;
const SCROLLBAR_LANE: Pixels = px(8.0);
const SCROLLBAR_INK: Pixels = px(6.0);
const HORIZONTAL_SCROLLBAR_LANE: Pixels = px(10.0);
const CARET_REVEAL_MARGIN: Pixels = px(8.0);
const DRAG_SCROLL_STEP: Pixels = px(22.0);
const DRAG_SCROLL_INTERVAL: Duration = Duration::from_millis(40);

/// Installs the platform editing bindings used by [`TextArea`].
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, Some(KEY_CONTEXT)),
        KeyBinding::new("delete", Delete, Some(KEY_CONTEXT)),
        KeyBinding::new("left", Left, Some(KEY_CONTEXT)),
        KeyBinding::new("right", Right, Some(KEY_CONTEXT)),
        KeyBinding::new("up", Up, Some(KEY_CONTEXT)),
        KeyBinding::new("down", Down, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-left", SelectLeft, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-right", SelectRight, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-up", SelectUp, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-down", SelectDown, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-a", SelectAll, Some(KEY_CONTEXT)),
        KeyBinding::new("home", Home, Some(KEY_CONTEXT)),
        KeyBinding::new("end", End, Some(KEY_CONTEXT)),
        KeyBinding::new("enter", Submit, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-enter", Newline, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-s", Save, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-v", Paste, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-c", Copy, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-x", Cut, Some(KEY_CONTEXT)),
        KeyBinding::new("tab", FocusNext, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-tab", FocusPrevious, Some(KEY_CONTEXT)),
        KeyBinding::new("ctrl-cmd-space", ShowCharacterPalette, Some(KEY_CONTEXT)),
    ]);
}

/// Typed output from a controlled composer text area.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextAreaEvent {
    Changed { value: SharedString },
    Submit { value: SharedString },
}

/// Semantic commands that a parent-owned transient UI may intercept while the
/// editor keeps keyboard focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextAreaCommand {
    Previous,
    Next,
    Commit,
    FocusPrevious,
    FocusNext,
}

/// Returns `true` only when the caller consumed the command.
pub type TextAreaCommandHandler = Rc<dyn Fn(TextAreaCommand, &mut Window, &mut App) -> bool>;
/// A closed semantic palette for caller-provided source highlighting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextHighlightKind {
    Keyword,
    String,
    Comment,
    Number,
    Function,
    Type,
    Variable,
    Constant,
    Operator,
    Punctuation,
}

impl TextHighlightKind {
    fn role(self) -> ThemeRole {
        match self {
            Self::Keyword => ThemeRole::CodeKeyword,
            Self::String => ThemeRole::CodeString,
            Self::Comment => ThemeRole::CodeComment,
            Self::Number => ThemeRole::CodeNumber,
            Self::Function => ThemeRole::CodeFunction,
            Self::Type => ThemeRole::CodeType,
            Self::Variable => ThemeRole::CodeVariable,
            Self::Constant => ThemeRole::CodeConstant,
            Self::Operator => ThemeRole::CodeOperator,
            Self::Punctuation => ThemeRole::CodePunctuation,
        }
    }
}

/// A UTF-8 byte range whose meaning was parsed by the caller.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextHighlightSpan {
    pub range: Range<usize>,
    pub kind: TextHighlightKind,
}
/// Bounded semantic-highlight ingress result for product disclosure.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TextHighlightStatus {
    pub requested: usize,
    pub accepted: usize,
    pub limit_truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextAreaLayout {
    Composer,
    Editor { wrap: bool, line_numbers: bool },
}

struct LayoutLine {
    line: WrappedLine,
    gutter: Option<WrappedLine>,
    start: usize,
    y: Pixels,
}

impl LayoutLine {
    fn visual_lines(&self) -> usize {
        self.line.wrap_boundaries().len() + 1
    }

    fn end(&self) -> usize {
        self.start + self.line.len()
    }

    fn height(&self, line_height: Pixels) -> Pixels {
        line_height * self.visual_lines()
    }

    fn local_position(&self, index: usize, line_height: Pixels) -> Point<Pixels> {
        self.line
            .position_for_index(index.min(self.line.len()), line_height)
            .unwrap_or_else(|| point(px(0.0), px(0.0)))
    }

    fn visual_ranges(&self) -> Vec<Range<usize>> {
        let mut boundaries = vec![0];
        for boundary in self.line.wrap_boundaries() {
            let run = &self.line.runs()[boundary.run_ix];
            boundaries.push(run.glyphs[boundary.glyph_ix].index);
        }
        boundaries.push(self.line.len());
        boundaries.windows(2).map(|pair| pair[0]..pair[1]).collect()
    }
}

struct TextLayout {
    lines: Vec<LayoutLine>,
    width: Pixels,
    height: Pixels,
    line_height: Pixels,
}

#[derive(Default)]
struct TextAreaGeometry {
    layout: Option<Rc<TextLayout>>,
    bounds: Option<Bounds<Pixels>>,
    height: Pixels,
    vertical_scroll: Pixels,
    horizontal_scroll: Pixels,
    reveal_cursor: bool,
}

impl TextLayout {
    fn position_for_index(&self, index: usize) -> Point<Pixels> {
        if let Some(line) = self
            .lines
            .iter()
            .find(|line| index >= line.start && index <= line.end())
        {
            let local = line.local_position(index - line.start, self.line_height);
            return point(local.x, line.y + local.y);
        }
        self.lines
            .last()
            .map(|line| {
                let local = line.local_position(line.line.len(), self.line_height);
                point(local.x, line.y + local.y)
            })
            .unwrap_or_default()
    }

    fn index_for_position(&self, position: Point<Pixels>) -> usize {
        if self.lines.is_empty() {
            return 0;
        }
        if position.y <= px(0.0) {
            let line = &self.lines[0];
            return line.start
                + line
                    .line
                    .closest_index_for_position(point(position.x, px(0.0)), self.line_height)
                    .unwrap_or_else(|index| index);
        }
        for line in &self.lines {
            if position.y < line.y + line.height(self.line_height) {
                let local = point(position.x, (position.y - line.y).max(px(0.0)));
                return line.start
                    + line
                        .line
                        .closest_index_for_position(local, self.line_height)
                        .unwrap_or_else(|index| index);
            }
        }
        self.lines.last().map(LayoutLine::end).unwrap_or(0)
    }

    fn visual_range_at(&self, index: usize) -> Range<usize> {
        for line in &self.lines {
            if index >= line.start && index <= line.end() {
                let local = index - line.start;
                for range in line.visual_ranges() {
                    if local >= range.start && local <= range.end {
                        return line.start + range.start..line.start + range.end;
                    }
                }
            }
        }
        index..index
    }
}

fn normalize_highlights(
    highlights: &[TextHighlightSpan],
    text: &str,
) -> (Vec<TextHighlightSpan>, TextHighlightStatus) {
    let mut valid = highlights
        .iter()
        .filter(|span| {
            span.range.start < span.range.end
                && span.range.end <= text.len()
                && text.is_char_boundary(span.range.start)
                && text.is_char_boundary(span.range.end)
        })
        .cloned()
        .collect::<Vec<_>>();
    valid.sort_by_key(|span| (span.range.start, span.range.end));
    let mut normalized = Vec::with_capacity(valid.len().min(MAX_HIGHLIGHT_SPANS));
    let mut last_end = 0;
    let mut limit_truncated = false;
    for span in valid {
        if span.range.start < last_end {
            continue;
        }
        last_end = span.range.end;
        if normalized.len() < MAX_HIGHLIGHT_SPANS {
            normalized.push(span);
        } else {
            limit_truncated = true;
            break;
        }
    }
    let status = TextHighlightStatus {
        requested: highlights.len(),
        accepted: normalized.len(),
        limit_truncated,
    };
    (normalized, status)
}

/// A reusable, controlled multiline native GPUI input.
///
/// Composer layout reserves an 8 px lane and grows through eight 22 px lines.
/// Editor layout fills its caller-owned pane, uses 13/20 mono source geometry,
/// and keeps selection, IME composition, scroll, and entity identity stable.
pub struct TextArea {
    id: SharedString,
    theme: Theme,
    focus_handle: FocusHandle,
    command_handler: Option<TextAreaCommandHandler>,
    layout_mode: TextAreaLayout,
    highlights: Vec<TextHighlightSpan>,
    highlight_status: TextHighlightStatus,
    value: SharedString,
    placeholder: SharedString,
    disabled: bool,
    read_only: bool,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    geometry: Rc<RefCell<TextAreaGeometry>>,
    preferred_x: Option<Pixels>,
    is_selecting: bool,
    is_scrollbar_dragging: bool,
    is_horizontal_scrollbar_dragging: bool,
    drag_position: Option<Point<Pixels>>,
    drag_lifecycle: usize,
}

impl TextArea {
    pub fn new(
        id: impl Into<SharedString>,
        value: impl Into<SharedString>,
        placeholder: impl Into<SharedString>,
        theme: Theme,
        cx: &mut Context<Self>,
    ) -> Self {
        let value = value.into();
        let cursor = value.len();
        Self {
            id: id.into(),
            theme,
            focus_handle: cx.focus_handle().tab_index(0).tab_stop(true),
            command_handler: None,
            layout_mode: TextAreaLayout::Composer,
            highlights: Vec::new(),
            highlight_status: TextHighlightStatus::default(),
            value,
            placeholder: placeholder.into(),
            disabled: false,
            read_only: false,
            selected_range: cursor..cursor,
            selection_reversed: false,
            marked_range: None,
            geometry: Rc::new(RefCell::new(TextAreaGeometry {
                height: COMPOSER_LINE_HEIGHT,
                reveal_cursor: true,
                ..Default::default()
            })),
            preferred_x: None,
            is_selecting: false,
            is_scrollbar_dragging: false,
            is_horizontal_scrollbar_dragging: false,
            drag_position: None,
            drag_lifecycle: 0,
        }
    }

    pub fn value(&self) -> &SharedString {
        &self.value
    }

    /// Installs a stable caller-owned command boundary. The handler may decide
    /// dynamically whether a transient surface is open and return `false` to
    /// preserve normal editor or focus behavior.
    pub fn set_command_handler(&mut self, handler: Option<TextAreaCommandHandler>) {
        self.command_handler = handler;
    }

    /// Configures full-pane editor layout without changing value, selection, or IME state.
    pub fn set_layout(&mut self, layout: TextAreaLayout, cx: &mut Context<Self>) {
        if self.layout_mode != layout {
            self.layout_mode = layout;
            let mut geometry = self.geometry.borrow_mut();
            geometry.layout = None;
            if !matches!(layout, TextAreaLayout::Editor { wrap: false, .. }) {
                geometry.horizontal_scroll = px(0.0);
            }
            cx.notify();
        }
    }

    /// Replaces caller-parsed semantic spans without touching selection or composition.
    pub fn set_highlights(
        &mut self,
        highlights: Vec<TextHighlightSpan>,
        cx: &mut Context<Self>,
    ) -> TextHighlightStatus {
        let (highlights, status) = normalize_highlights(&highlights, &self.value);
        if self.highlights != highlights || self.highlight_status != status {
            self.highlights = highlights;
            self.highlight_status = status;
            self.geometry.borrow_mut().layout = None;
            cx.notify();
        }
        status
    }

    pub fn highlight_status(&self) -> TextHighlightStatus {
        self.highlight_status
    }

    fn command_intercept(
        &self,
        command: TextAreaCommand,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let handled = self
            .command_handler
            .as_ref()
            .is_some_and(|handler| handler(command, window, cx));
        if handled {
            cx.stop_propagation();
        }
        handled
    }

    pub fn selection(&self) -> UTF16Selection {
        UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        }
    }

    pub fn theme_reconcile(&mut self, theme: Theme, cx: &mut Context<Self>) {
        if self.theme != theme {
            self.theme = theme;
            {
                let mut geometry = self.geometry.borrow_mut();
                geometry.layout = None;
                geometry.reveal_cursor = true;
            }
            cx.notify();
        }
    }

    /// Reconciles a controlled value. An unchanged value preserves selection,
    /// composition, scroll, and focus identity.
    pub fn set_value(&mut self, value: impl Into<SharedString>, cx: &mut Context<Self>) {
        let value = value.into();
        if value == self.value {
            return;
        }
        self.value = value;
        self.highlights.clear();
        self.highlight_status = TextHighlightStatus::default();
        let cursor = self.value.len();
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.marked_range = None;
        {
            let mut geometry = self.geometry.borrow_mut();
            geometry.layout = None;
            geometry.reveal_cursor = true;
        }
        self.preferred_x = None;
        cx.notify();
    }

    pub fn set_placeholder(
        &mut self,
        placeholder: impl Into<SharedString>,
        cx: &mut Context<Self>,
    ) {
        let placeholder = placeholder.into();
        if placeholder != self.placeholder {
            self.placeholder = placeholder;
            cx.notify();
        }
    }

    pub fn set_disabled(&mut self, disabled: bool, cx: &mut Context<Self>) {
        if disabled != self.disabled {
            self.disabled = disabled;
            self.marked_range = None;
            cx.notify();
        }
    }

    pub fn set_read_only(&mut self, read_only: bool, cx: &mut Context<Self>) {
        if read_only != self.read_only {
            self.read_only = read_only;
            self.marked_range = None;
            cx.notify();
        }
    }

    fn can_edit(&self) -> bool {
        !self.disabled && !self.read_only
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = self.valid_boundary(offset);
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        self.preferred_x = None;
        self.geometry.borrow_mut().reveal_cursor = true;
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = self.valid_boundary(offset);
        if self.selection_reversed {
            self.selected_range.start = offset;
        } else {
            self.selected_range.end = offset;
        }
        if self.selected_range.end < self.selected_range.start {
            self.selection_reversed = !self.selection_reversed;
            self.selected_range = self.selected_range.end..self.selected_range.start;
        }
        self.geometry.borrow_mut().reveal_cursor = true;
        cx.notify();
    }

    fn valid_boundary(&self, offset: usize) -> usize {
        grapheme_boundary_at_or_before(&self.value, offset)
    }

    fn previous_boundary(&self, offset: usize) -> usize {
        previous_grapheme_boundary(&self.value, offset)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        next_grapheme_boundary(&self.value, offset)
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let offset = self.previous_boundary(self.cursor_offset());
            self.move_to(offset, cx);
        } else {
            self.move_to(self.selected_range.start, cx);
        }
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            let offset = self.next_boundary(self.cursor_offset());
            self.move_to(offset, cx);
        } else {
            self.move_to(self.selected_range.end, cx);
        }
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        let offset = self.previous_boundary(self.cursor_offset());
        self.preferred_x = None;
        self.select_to(offset, cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        let offset = self.next_boundary(self.cursor_offset());
        self.preferred_x = None;
        self.select_to(offset, cx);
    }

    fn vertical_target(&mut self, direction: f32) -> Option<usize> {
        let geometry = self.geometry.borrow();
        let layout = geometry.layout.as_ref()?;
        let position = layout.position_for_index(self.cursor_offset());
        let x = *self.preferred_x.get_or_insert(position.x);
        Some(layout.index_for_position(point(x, position.y + layout.line_height * direction)))
    }

    fn up(&mut self, _: &Up, window: &mut Window, cx: &mut Context<Self>) {
        if self.command_intercept(TextAreaCommand::Previous, window, cx) {
            return;
        }
        if let Some(offset) = self.vertical_target(-1.0) {
            let preferred = self.preferred_x;
            self.move_to(offset, cx);
            self.preferred_x = preferred;
        }
    }

    fn down(&mut self, _: &Down, window: &mut Window, cx: &mut Context<Self>) {
        if self.command_intercept(TextAreaCommand::Next, window, cx) {
            return;
        }
        if let Some(offset) = self.vertical_target(1.0) {
            let preferred = self.preferred_x;
            self.move_to(offset, cx);
            self.preferred_x = preferred;
        }
    }

    fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.vertical_target(-1.0) {
            self.select_to(offset, cx);
        }
    }

    fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(offset) = self.vertical_target(1.0) {
            self.select_to(offset, cx);
        }
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        let target = self
            .geometry
            .borrow()
            .layout
            .as_ref()
            .map(|layout| layout.visual_range_at(self.cursor_offset()).start)
            .unwrap_or(0);
        self.move_to(target, cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        let target = self
            .geometry
            .borrow()
            .layout
            .as_ref()
            .map(|layout| layout.visual_range_at(self.cursor_offset()).end)
            .unwrap_or(self.value.len());
        self.move_to(target, cx);
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.selected_range = 0..self.value.len();
        self.selection_reversed = false;
        self.preferred_x = None;
        self.geometry.borrow_mut().reveal_cursor = true;
        cx.notify();
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_edit() {
            return;
        }
        if self.selected_range.is_empty() {
            let offset = self.previous_boundary(self.cursor_offset());
            self.select_to(offset, cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_edit() {
            return;
        }
        if self.selected_range.is_empty() {
            let offset = self.next_boundary(self.cursor_offset());
            self.select_to(offset, cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn submit(&mut self, _: &Submit, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(self.layout_mode, TextAreaLayout::Editor { .. }) {
            if self.can_edit() {
                self.replace_text_in_range(None, "\n", window, cx);
            }
            return;
        }
        if self.command_intercept(TextAreaCommand::Commit, window, cx) {
            return;
        }
        if self.can_edit() {
            cx.emit(TextAreaEvent::Submit {
                value: self.value.clone(),
            });
        }
    }

    fn newline(&mut self, _: &Newline, window: &mut Window, cx: &mut Context<Self>) {
        if self.can_edit() {
            self.replace_text_in_range(None, "\n", window, cx);
        }
    }

    fn focus_next(&mut self, _: &FocusNext, window: &mut Window, cx: &mut Context<Self>) {
        if !self.command_intercept(TextAreaCommand::FocusNext, window, cx) {
            window.focus_next();
            cx.stop_propagation();
        }
    }

    fn focus_previous(&mut self, _: &FocusPrevious, window: &mut Window, cx: &mut Context<Self>) {
        if !self.command_intercept(TextAreaCommand::FocusPrevious, window, cx) {
            window.focus_prev();
            cx.stop_propagation();
        }
    }

    fn show_character_palette(
        &mut self,
        _: &ShowCharacterPalette,
        window: &mut Window,
        _: &mut Context<Self>,
    ) {
        if self.can_edit() {
            window.show_character_palette();
        }
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_edit() {
            return;
        }
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(
                None,
                &text.replace("\r\n", "\n").replace('\r', "\n"),
                window,
                cx,
            );
        }
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.disabled && !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.value[self.selected_range.clone()].to_string(),
            ));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if self.can_edit() && !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.value[self.selected_range.clone()].to_string(),
            ));
            self.replace_text_in_range(None, "", window, cx);
        }
    }

    fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        let geometry = self.geometry.borrow();
        let (Some(bounds), Some(layout)) = (geometry.bounds, geometry.layout.as_ref()) else {
            return 0;
        };
        let local = point(
            (position.x - bounds.left())
                .max(px(0.0))
                .min(bounds.size.width)
                + geometry.horizontal_scroll,
            position.y - bounds.top() + geometry.vertical_scroll,
        );
        self.valid_boundary(layout.index_for_position(local))
    }

    fn scroll_to_track_position(&mut self, position: Point<Pixels>) {
        let mut geometry = self.geometry.borrow_mut();
        let (Some(bounds), Some(layout)) = (geometry.bounds, geometry.layout.as_ref().cloned())
        else {
            return;
        };
        let max_scroll = (layout.height - bounds.size.height).max(px(0.0));
        if max_scroll <= px(0.0) {
            return;
        }
        let thumb_height =
            (bounds.size.height * (bounds.size.height / layout.height)).max(layout.line_height);
        let travel = (bounds.size.height - thumb_height).max(px(1.0));
        let local = (position.y - bounds.top() - thumb_height / 2.0).clamp(px(0.0), travel);
        geometry.vertical_scroll = max_scroll * (local / travel);
    }

    fn scroll_to_horizontal_track_position(&mut self, position: Point<Pixels>) {
        let mut geometry = self.geometry.borrow_mut();
        let (Some(bounds), Some(layout)) = (geometry.bounds, geometry.layout.as_ref().cloned())
        else {
            return;
        };
        let max_scroll = (layout.width - bounds.size.width).max(px(0.0));
        if max_scroll <= px(0.0) {
            return;
        }
        let thumb_width =
            (bounds.size.width * (bounds.size.width / layout.width)).max(EDITOR_LINE_HEIGHT);
        let travel = (bounds.size.width - thumb_width).max(px(1.0));
        let local = (position.x - bounds.left() - thumb_width / 2.0).clamp(px(0.0), travel);
        geometry.horizontal_scroll = max_scroll * (local / travel);
    }

    fn on_scroll_wheel(
        &mut self,
        event: &ScrollWheelEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mut geometry = self.geometry.borrow_mut();
        let (Some(bounds), Some(layout)) = (geometry.bounds, geometry.layout.as_ref().cloned())
        else {
            return;
        };
        let horizontal_enabled =
            matches!(self.layout_mode, TextAreaLayout::Editor { wrap: false, .. });
        let vertical_delta = normalized_wheel_delta(
            ScrollbarAxis::Vertical,
            event,
            horizontal_enabled,
            window.line_height(),
        );
        let horizontal_delta = horizontal_enabled.then(|| {
            normalized_wheel_delta(ScrollbarAxis::Horizontal, event, true, window.line_height())
        });
        let max_vertical = (layout.height - bounds.size.height).max(px(0.0));
        let next_vertical =
            (geometry.vertical_scroll - vertical_delta).clamp(px(0.0), max_vertical);
        let mut changed = next_vertical != geometry.vertical_scroll;
        geometry.vertical_scroll = next_vertical;
        if let Some(horizontal_delta) = horizontal_delta {
            let max_horizontal = (layout.width - bounds.size.width).max(px(0.0));
            let next_horizontal =
                (geometry.horizontal_scroll - horizontal_delta).clamp(px(0.0), max_horizontal);
            changed |= next_horizontal != geometry.horizontal_scroll;
            geometry.horizontal_scroll = next_horizontal;
        }
        if changed {
            drop(geometry);
            cx.notify();
            cx.stop_propagation();
        }
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.disabled {
            return;
        }
        let (horizontal_scrollbar_hit, scrollbar_hit) = {
            let geometry = self.geometry.borrow();
            match (geometry.bounds, geometry.layout.as_ref()) {
                (Some(bounds), Some(layout)) => (
                    matches!(self.layout_mode, TextAreaLayout::Editor { wrap: false, .. })
                        && layout.width > bounds.size.width
                        && event.position.y >= bounds.bottom(),
                    layout.height > bounds.size.height && event.position.x >= bounds.right(),
                ),
                _ => (false, false),
            }
        };
        if horizontal_scrollbar_hit {
            self.is_horizontal_scrollbar_dragging = true;
            self.scroll_to_horizontal_track_position(event.position);
            cx.notify();
            return;
        }
        if scrollbar_hit {
            self.is_scrollbar_dragging = true;
            self.scroll_to_track_position(event.position);
            cx.notify();
            return;
        }
        window.focus(&self.focus_handle);
        self.is_selecting = true;
        self.drag_position = Some(event.position);
        self.start_drag_lifecycle(cx);
        let offset = self.index_for_mouse_position(event.position);
        if event.modifiers.shift {
            self.select_to(offset, cx);
        } else {
            self.move_to(offset, cx);
        }
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.is_horizontal_scrollbar_dragging {
            self.scroll_to_horizontal_track_position(event.position);
            cx.notify();
        } else if self.is_scrollbar_dragging {
            self.scroll_to_track_position(event.position);
            cx.notify();
        } else if self.is_selecting {
            self.drag_position = Some(event.position);
            self.scroll_for_drag(event.position);
            let offset = self.index_for_mouse_position(event.position);
            self.select_to(offset, cx);
        }
    }

    fn on_mouse_up(&mut self, event: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        if event.button == MouseButton::Left {
            self.is_selecting = false;
            self.is_scrollbar_dragging = false;
            self.is_horizontal_scrollbar_dragging = false;
            self.drag_position = None;
            self.drag_lifecycle = self.drag_lifecycle.wrapping_add(1);
        }
    }

    fn scroll_for_drag(&mut self, position: Point<Pixels>) {
        let mut geometry = self.geometry.borrow_mut();
        let (Some(bounds), Some(layout)) = (geometry.bounds, geometry.layout.as_ref().cloned())
        else {
            return;
        };
        let max_scroll = (layout.height - bounds.size.height).max(px(0.0));
        if position.y <= bounds.top() {
            geometry.vertical_scroll = (geometry.vertical_scroll - DRAG_SCROLL_STEP).max(px(0.0));
        } else if position.y >= bounds.bottom() {
            geometry.vertical_scroll =
                (geometry.vertical_scroll + DRAG_SCROLL_STEP).min(max_scroll);
        }
        if matches!(self.layout_mode, TextAreaLayout::Editor { wrap: false, .. }) {
            let max_horizontal = (layout.width - bounds.size.width).max(px(0.0));
            if position.x <= bounds.left() {
                geometry.horizontal_scroll =
                    (geometry.horizontal_scroll - DRAG_SCROLL_STEP).max(px(0.0));
            } else if position.x >= bounds.right() {
                geometry.horizontal_scroll =
                    (geometry.horizontal_scroll + DRAG_SCROLL_STEP).min(max_horizontal);
            }
        }
    }

    fn start_drag_lifecycle(&mut self, cx: &mut Context<Self>) {
        self.drag_lifecycle = self.drag_lifecycle.wrapping_add(1);
        let lifecycle = self.drag_lifecycle;
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            loop {
                executor.timer(DRAG_SCROLL_INTERVAL).await;
                let keep_running = this
                    .update(cx, |area, cx| {
                        if !area.is_selecting || area.drag_lifecycle != lifecycle {
                            return false;
                        }
                        if let Some(position) = area.drag_position {
                            area.scroll_for_drag(position);
                            let offset = area.index_for_mouse_position(position);
                            area.select_to(offset, cx);
                        }
                        true
                    })
                    .unwrap_or(false);
                if !keep_running {
                    break;
                }
            }
        })
        .detach();
    }

    fn emit_changed(&self, cx: &mut Context<Self>) {
        cx.emit(TextAreaEvent::Changed {
            value: self.value.clone(),
        });
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        utf8_offset_for_utf16(&self.value, offset)
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut offset = offset.min(self.value.len());
        while !self.value.is_char_boundary(offset) {
            offset -= 1;
        }
        self.value[..offset].encode_utf16().count()
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        let start = self.offset_from_utf16(range.start);
        let end = self.offset_from_utf16(range.end);
        start.min(end)..start.max(end)
    }

    fn replacement_range(&self, range: Option<&Range<usize>>) -> Range<usize> {
        range
            .map(|range| self.range_from_utf16(range))
            .or_else(|| self.marked_range.clone())
            .unwrap_or_else(|| self.selected_range.clone())
    }

    fn replace_range(&mut self, range: Range<usize>, text: &str) {
        self.highlights.clear();
        self.highlight_status = TextHighlightStatus::default();
        self.value = format!(
            "{}{}{}",
            &self.value[..range.start],
            text,
            &self.value[range.end..]
        )
        .into();
    }
}

impl EventEmitter<TextAreaEvent> for TextArea {}

impl EntityInputHandler for TextArea {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range);
        actual_range.replace(self.range_to_utf16(&range));
        Some(self.value[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(self.selection())
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked_range
            .as_ref()
            .map(|range| self.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if self.marked_range.take().is_some() {
            cx.notify();
        }
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.can_edit() {
            return;
        }
        let range = self.replacement_range(range_utf16.as_ref());
        let changed = &self.value[range.clone()] != new_text;
        let cursor = range.start + new_text.len();
        self.replace_range(range, new_text);
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.marked_range = None;
        {
            let mut geometry = self.geometry.borrow_mut();
            geometry.layout = None;
            geometry.reveal_cursor = true;
        }
        self.preferred_x = None;
        cx.notify();
        if changed {
            self.emit_changed(cx);
        }
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.can_edit() {
            return;
        }
        let range = self.replacement_range(range_utf16.as_ref());
        let changed = &self.value[range.clone()] != new_text;
        let inserted_start = range.start;
        self.replace_range(range, new_text);
        self.marked_range =
            (!new_text.is_empty()).then_some(inserted_start..inserted_start + new_text.len());
        self.selected_range = new_selected_range_utf16
            .map(|range| {
                let start = utf8_offset_for_utf16(new_text, range.start);
                let end = utf8_offset_for_utf16(new_text, range.end);
                inserted_start + start.min(end)..inserted_start + start.max(end)
            })
            .unwrap_or_else(|| {
                let cursor = inserted_start + new_text.len();
                cursor..cursor
            });
        self.selection_reversed = false;
        {
            let mut geometry = self.geometry.borrow_mut();
            geometry.layout = None;
            geometry.reveal_cursor = true;
        }
        self.preferred_x = None;
        cx.notify();
        if changed {
            self.emit_changed(cx);
        }
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let geometry = self.geometry.borrow();
        let layout = geometry.layout.as_ref()?;
        let range = self.range_from_utf16(&range_utf16);
        let start = layout.position_for_index(range.start);
        let end = layout.position_for_index(range.end);
        Some(Bounds::from_corners(
            point(
                bounds.left() + start.x - geometry.horizontal_scroll,
                bounds.top() + start.y - geometry.vertical_scroll,
            ),
            point(
                bounds.left() + end.x.max(start.x + px(1.0)) - geometry.horizontal_scroll,
                bounds.top() + end.y - geometry.vertical_scroll + layout.line_height,
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let geometry = self.geometry.borrow();
        let bounds = geometry.bounds?;
        let layout = geometry.layout.as_ref()?;
        let local = point(
            position.x - bounds.left() + geometry.horizontal_scroll,
            position.y - bounds.top() + geometry.vertical_scroll,
        );
        Some(self.offset_to_utf16(self.valid_boundary(layout.index_for_position(local))))
    }
}

struct TextAreaElement {
    area: Entity<TextArea>,
}

struct PrepaintState {
    layout: Option<Rc<TextLayout>>,
    selection: Vec<PaintQuad>,
    caret: Option<PaintQuad>,
    scrollbar: Option<PaintQuad>,
    horizontal_scrollbar: Option<PaintQuad>,
    gutter_separator: Option<PaintQuad>,
    vertical_scroll: Pixels,
    horizontal_scroll: Pixels,
}

impl IntoElement for TextAreaElement {
    type Element = Self;
    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TextAreaElement {
    type RequestLayoutState = ();
    type PrepaintState = PrepaintState;

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
    ) -> (LayoutId, Self::RequestLayoutState) {
        let area = self.area.read(cx);
        let showing_placeholder = area.value.is_empty();
        let display_text = if showing_placeholder {
            area.placeholder.clone()
        } else {
            area.value.clone()
        };
        let text_style = window.text_style();
        let layout_mode = area.layout_mode;
        let line_height = match layout_mode {
            TextAreaLayout::Composer => COMPOSER_LINE_HEIGHT,
            TextAreaLayout::Editor { .. } => EDITOR_LINE_HEIGHT,
        };
        let font_size = match layout_mode {
            TextAreaLayout::Composer => text_style.font_size.to_pixels(window.rem_size()),
            TextAreaLayout::Editor { .. } => px(13.0),
        };
        let font = match layout_mode {
            TextAreaLayout::Composer => text_style.font(),
            TextAreaLayout::Editor { .. } => gpui::font(crate::fonts::MONO_FAMILY),
        };
        let default_color: Hsla = if showing_placeholder {
            area.theme.role(ThemeRole::InputPlaceholder).into()
        } else if area.disabled {
            area.theme.role(ThemeRole::TextSecondary).into()
        } else {
            area.theme.role(ThemeRole::InputText).into()
        };
        let highlights: &[TextHighlightSpan] = if showing_placeholder {
            &[]
        } else {
            &area.highlights
        };
        let mut boundaries = Vec::with_capacity(highlights.len() * 2 + 4);
        boundaries.extend([0, display_text.len()]);
        for span in highlights {
            boundaries.extend([span.range.start, span.range.end]);
        }
        if let Some(marked) = &area.marked_range {
            boundaries.extend([marked.start, marked.end]);
        }
        boundaries.sort_unstable();
        boundaries.dedup();
        let mut runs = Vec::with_capacity(boundaries.len().saturating_sub(1));
        let mut span_index = 0;
        for edge in boundaries.windows(2) {
            let range = edge[0]..edge[1];
            if range.is_empty() {
                continue;
            }
            while span_index < highlights.len() && highlights[span_index].range.end <= range.start {
                span_index += 1;
            }
            let kind = highlights
                .get(span_index)
                .filter(|span| span.range.start <= range.start && span.range.end >= range.end)
                .map(|span| span.kind);
            let color = kind
                .map(|kind| Hsla::from(area.theme.role(kind.role())))
                .unwrap_or(default_color);
            let marked = area
                .marked_range
                .as_ref()
                .is_some_and(|marked| marked.start <= range.start && marked.end >= range.end);
            runs.push(TextRun {
                len: range.len(),
                font: font.clone(),
                color,
                background_color: None,
                underline: marked.then_some(UnderlineStyle {
                    color: Some(color),
                    thickness: px(1.0),
                    wavy: false,
                }),
                strikethrough: None,
            });
        }
        let gutter_color: Hsla = area.theme.role(ThemeRole::CodeGutter).into();
        let geometry = area.geometry.clone();
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        if matches!(layout_mode, TextAreaLayout::Editor { .. }) {
            style.size.height = relative(1.).into();
        }
        let layout_id =
            window.request_measured_layout(style, move |known, available, window, _| {
                let width = known
                    .width
                    .or(match available.width {
                        gpui::AvailableSpace::Definite(width) => Some(width),
                        _ => None,
                    })
                    .unwrap_or(px(0.0));
                let wrap_width = match layout_mode {
                    TextAreaLayout::Composer | TextAreaLayout::Editor { wrap: true, .. } => {
                        Some(width)
                    }
                    TextAreaLayout::Editor { wrap: false, .. } => None,
                };
                let shaped = window
                    .text_system()
                    .shape_text(display_text.clone(), font_size, &runs, wrap_width, None)
                    .unwrap_or_default();
                let show_gutter = matches!(
                    layout_mode,
                    TextAreaLayout::Editor {
                        line_numbers: true,
                        ..
                    }
                );
                let mut lines = Vec::new();
                let mut start = 0;
                let mut y = px(0.0);
                let mut measured_width = px(0.0);
                for (index, line) in shaped.into_iter().enumerate() {
                    let line_size = line.size(line_height);
                    measured_width = measured_width.max(line_size.width);
                    let height = line_height * (line.wrap_boundaries().len() + 1);
                    let len = line.len();
                    let gutter = show_gutter.then(|| {
                        let number: SharedString = (index + 1).to_string().into();
                        let run = TextRun {
                            len: number.len(),
                            font: gpui::font(crate::fonts::MONO_FAMILY),
                            color: gutter_color,
                            background_color: None,
                            underline: None,
                            strikethrough: None,
                        };
                        window
                            .text_system()
                            .shape_text(number, px(11.0), &[run], None, None)
                            .unwrap_or_default()
                            .into_iter()
                            .next()
                            .expect("line number must shape")
                    });
                    lines.push(LayoutLine {
                        line,
                        gutter,
                        start,
                        y,
                    });
                    start += len + 1;
                    y += height;
                }
                let layout = Rc::new(TextLayout {
                    lines,
                    width: measured_width,
                    height: y.max(line_height),
                    line_height,
                });
                let wanted_height = match layout_mode {
                    TextAreaLayout::Composer => {
                        let wanted_lines =
                            ((layout.height / line_height) as usize).clamp(MIN_LINES, MAX_LINES);
                        line_height * wanted_lines
                    }
                    TextAreaLayout::Editor { .. } => known
                        .height
                        .or(match available.height {
                            gpui::AvailableSpace::Definite(height) => Some(height),
                            _ => None,
                        })
                        .unwrap_or(layout.height),
                };
                let mut geometry = geometry.borrow_mut();
                geometry.layout = Some(layout);
                geometry.height = wanted_height;
                size(known.width.unwrap_or(measured_width), wanted_height)
            });
        (layout_id, ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let area = self.area.read(cx);
        let showing_placeholder = area.value.is_empty();
        let color: Hsla = if showing_placeholder {
            area.theme.role(ThemeRole::InputPlaceholder).into()
        } else if area.disabled {
            area.theme.role(ThemeRole::TextSecondary).into()
        } else {
            area.theme.role(ThemeRole::InputText).into()
        };
        let geometry = area.geometry.clone();
        let mut committed = geometry.borrow_mut();
        let layout = committed
            .layout
            .clone()
            .expect("text area measurement must exist before prepaint");
        let wanted_height = committed.height;
        let max_scroll = (layout.height - wanted_height).max(px(0.0));
        let horizontal_enabled =
            matches!(area.layout_mode, TextAreaLayout::Editor { wrap: false, .. });
        let max_horizontal = if horizontal_enabled {
            (layout.width - bounds.size.width).max(px(0.0))
        } else {
            px(0.0)
        };
        let cursor_position = layout.position_for_index(area.cursor_offset());
        let mut scroll = committed.vertical_scroll.min(max_scroll).max(px(0.0));
        let mut horizontal_scroll = committed.horizontal_scroll.min(max_horizontal).max(px(0.0));
        if committed.reveal_cursor {
            if cursor_position.y < scroll {
                scroll = cursor_position.y;
            } else if cursor_position.y + layout.line_height > scroll + wanted_height {
                scroll = cursor_position.y + layout.line_height - wanted_height;
            }
            if horizontal_enabled {
                let viewport_left = horizontal_scroll + CARET_REVEAL_MARGIN;
                let viewport_right = horizontal_scroll + bounds.size.width - CARET_REVEAL_MARGIN;
                if cursor_position.x < viewport_left {
                    horizontal_scroll = (cursor_position.x - CARET_REVEAL_MARGIN).max(px(0.0));
                } else if cursor_position.x > viewport_right {
                    horizontal_scroll = (cursor_position.x + CARET_REVEAL_MARGIN
                        - bounds.size.width)
                        .min(max_horizontal);
                }
            } else {
                horizontal_scroll = px(0.0);
            }
            committed.reveal_cursor = false;
        }
        committed.bounds = Some(bounds);
        committed.vertical_scroll = scroll;
        committed.horizontal_scroll = horizontal_scroll;
        drop(committed);

        let mut selection = Vec::new();
        if !showing_placeholder && !area.selected_range.is_empty() {
            for line in &layout.lines {
                for segment in line.visual_ranges() {
                    let global = line.start + segment.start..line.start + segment.end;
                    let start = area.selected_range.start.max(global.start);
                    let end = area.selected_range.end.min(global.end);
                    if start < end {
                        let from = layout.position_for_index(start);
                        let to = layout.position_for_index(end);
                        selection.push(fill(
                            Bounds::from_corners(
                                point(
                                    bounds.left() + from.x - horizontal_scroll,
                                    bounds.top() + from.y - scroll,
                                ),
                                point(
                                    bounds.left() + to.x.max(from.x + px(1.0)) - horizontal_scroll,
                                    bounds.top() + from.y - scroll + layout.line_height,
                                ),
                            ),
                            Hsla::from(area.theme.role(ThemeRole::RadioActive)).opacity(0.32),
                        ));
                    }
                }
            }
        }
        let caret = area.selected_range.is_empty().then(|| {
            fill(
                Bounds::new(
                    point(
                        bounds.left() + cursor_position.x - horizontal_scroll,
                        bounds.top() + cursor_position.y - scroll,
                    ),
                    size(px(1.0), layout.line_height),
                ),
                color,
            )
        });
        let scrollbar = if layout.height > wanted_height {
            let thumb_height =
                (wanted_height * (wanted_height / layout.height)).max(layout.line_height);
            let travel = wanted_height - thumb_height;
            let top = if max_scroll > px(0.0) {
                travel * (scroll / max_scroll)
            } else {
                px(0.0)
            };
            let trailing = if matches!(area.layout_mode, TextAreaLayout::Editor { .. }) {
                px(10.0)
            } else {
                (SCROLLBAR_LANE - SCROLLBAR_INK) / 2.0
            };
            Some(fill(
                Bounds::new(
                    point(bounds.right() + trailing, bounds.top() + top),
                    size(SCROLLBAR_INK, thumb_height),
                ),
                Hsla::from(area.theme.role(ThemeRole::HappyScrollbarActiveColor)),
            ))
        } else {
            None
        };
        let horizontal_scrollbar =
            (horizontal_enabled && layout.width > bounds.size.width).then(|| {
                let thumb_width = (bounds.size.width * (bounds.size.width / layout.width))
                    .max(EDITOR_LINE_HEIGHT);
                let travel = bounds.size.width - thumb_width;
                let left = if max_horizontal > px(0.0) {
                    travel * (horizontal_scroll / max_horizontal)
                } else {
                    px(0.0)
                };
                fill(
                    Bounds::new(
                        point(bounds.left() + left, bounds.bottom() + px(2.0)),
                        size(thumb_width, SCROLLBAR_INK),
                    ),
                    Hsla::from(area.theme.role(ThemeRole::HappyScrollbarActiveColor)),
                )
            });
        let gutter_separator = matches!(
            area.layout_mode,
            TextAreaLayout::Editor {
                line_numbers: true,
                ..
            }
        )
        .then(|| {
            fill(
                Bounds::new(
                    point(bounds.left() - px(8.0), bounds.top()),
                    size(px(1.0), bounds.size.height),
                ),
                Hsla::from(area.theme.role(ThemeRole::Divider)),
            )
        });
        PrepaintState {
            layout: Some(layout),
            selection,
            caret,
            scrollbar,
            horizontal_scrollbar,
            gutter_separator,
            vertical_scroll: scroll,
            horizontal_scroll,
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let (focus_handle, disabled) = {
            let area = self.area.read(cx);
            (area.focus_handle.clone(), area.disabled)
        };
        let move_area = self.area.clone();
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
            if phase == DispatchPhase::Capture {
                move_area.update(cx, |area, cx| area.on_mouse_move(event, window, cx));
            }
        });
        let up_area = self.area.clone();
        window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
            if phase == DispatchPhase::Capture {
                up_area.update(cx, |area, cx| area.on_mouse_up(event, window, cx));
            }
        });
        if !disabled {
            window.handle_input(
                &focus_handle,
                ElementInputHandler::new(bounds, self.area.clone()),
                cx,
            );
        }
        for quad in prepaint.selection.drain(..) {
            window.paint_quad(quad);
        }
        if let Some(separator) = prepaint.gutter_separator.take() {
            window.paint_quad(separator);
        }
        let layout = prepaint.layout.take().expect("text area layout must exist");
        for line in &layout.lines {
            if let Some(gutter) = &line.gutter {
                let gutter_width = gutter.size(layout.line_height).width;
                gutter
                    .paint(
                        point(
                            bounds.left() - px(14.0) - gutter_width,
                            bounds.top() + line.y - prepaint.vertical_scroll,
                        ),
                        layout.line_height,
                        TextAlign::Left,
                        None,
                        window,
                        cx,
                    )
                    .expect("line number must paint");
            }
            line.line
                .paint(
                    point(
                        bounds.left() - prepaint.horizontal_scroll,
                        bounds.top() + line.y - prepaint.vertical_scroll,
                    ),
                    layout.line_height,
                    TextAlign::Left,
                    Some(bounds),
                    window,
                    cx,
                )
                .expect("text area line must paint");
        }
        if focus_handle.is_focused(window) && !disabled {
            if let Some(caret) = prepaint.caret.take() {
                window.paint_quad(caret);
            }
        }
        if let Some(scrollbar) = prepaint.scrollbar.take() {
            window.paint_quad(scrollbar);
        }
        if let Some(scrollbar) = prepaint.horizontal_scrollbar.take() {
            window.paint_quad(scrollbar);
        }
    }
}

impl Render for TextArea {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let id = self.id.clone();
        div()
            .id(self.id.clone())
            .debug_selector(move || format!("{}.root", id))
            .key_context(KEY_CONTEXT)
            .track_focus(&self.focus_handle(cx))
            .tab_index(if self.disabled { -1 } else { 0 })
            .cursor(if self.disabled {
                CursorStyle::Arrow
            } else {
                CursorStyle::IBeam
            })
            .w_full()
            .min_w_0()
            .when(
                matches!(self.layout_mode, TextAreaLayout::Editor { .. }),
                |root| root.h_full().min_h_0(),
            )
            .when(
                matches!(
                    self.layout_mode,
                    TextAreaLayout::Editor {
                        line_numbers: true,
                        ..
                    }
                ),
                |root| root.pl(EDITOR_GUTTER_WIDTH),
            )
            .pr(
                if matches!(self.layout_mode, TextAreaLayout::Editor { .. }) {
                    px(16.0)
                } else {
                    SCROLLBAR_LANE
                },
            )
            .when(
                matches!(self.layout_mode, TextAreaLayout::Editor { wrap: false, .. }),
                |root| root.pb(HORIZONTAL_SCROLLBAR_LANE),
            )
            .when(
                matches!(self.layout_mode, TextAreaLayout::Editor { .. }),
                |root| {
                    root.font_family(crate::fonts::MONO_FAMILY)
                        .text_size(px(13.0))
                        .line_height(EDITOR_LINE_HEIGHT)
                },
            )
            .overflow_hidden()
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::up))
            .on_action(cx.listener(Self::down))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_up))
            .on_action(cx.listener(Self::select_down))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::submit))
            .on_action(cx.listener(Self::newline))
            .on_action(cx.listener(Self::show_character_palette))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::focus_next))
            .on_action(cx.listener(Self::focus_previous))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_scroll_wheel(cx.listener(Self::on_scroll_wheel))
            .child(TextAreaElement { area: cx.entity() })
    }
}

impl Focusable for TextArea {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

fn grapheme_boundary_at_or_before(text: &str, offset: usize) -> usize {
    let offset = offset.min(text.len());
    if offset == text.len() {
        return text.len();
    }
    text.grapheme_indices(true)
        .map(|(index, _)| index)
        .take_while(|index| *index <= offset)
        .last()
        .unwrap_or(0)
}

fn previous_grapheme_boundary(text: &str, offset: usize) -> usize {
    let clamped = offset.min(text.len());
    let boundary = grapheme_boundary_at_or_before(text, clamped);
    if boundary < clamped {
        return boundary;
    }
    text.grapheme_indices(true)
        .map(|(index, _)| index)
        .take_while(|index| *index < boundary)
        .last()
        .unwrap_or(0)
}

fn next_grapheme_boundary(text: &str, offset: usize) -> usize {
    let offset = grapheme_boundary_at_or_before(text, offset);
    text.grapheme_indices(true)
        .map(|(index, _)| index)
        .find(|index| *index > offset)
        .unwrap_or(text.len())
}

fn utf8_offset_for_utf16(text: &str, offset: usize) -> usize {
    let mut utf16 = 0;
    for (utf8, ch) in text.char_indices() {
        if utf16 >= offset {
            return utf8;
        }
        utf16 += ch.len_utf16();
    }
    text.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{Modifiers, Render, ScrollDelta, TestAppContext, VisualTestContext};

    struct Fixture {
        area: Entity<TextArea>,
        width: Pixels,
        height: Option<Pixels>,
        events: Vec<TextAreaEvent>,
        before: FocusHandle,
        after: FocusHandle,
        parent_commands: Rc<RefCell<Vec<TextAreaCommand>>>,
        parent_keys: Rc<RefCell<Vec<String>>>,
    }

    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let previous = self.parent_commands.clone();
            let next = self.parent_commands.clone();
            let commit = self.parent_commands.clone();
            let focus_next = self.parent_commands.clone();
            let focus_previous = self.parent_commands.clone();
            let parent_keys = self.parent_keys.clone();
            div()
                .id("text-area-fixture-parent")
                .size_full()
                .on_key_down(move |event, _, _| {
                    parent_keys
                        .borrow_mut()
                        .push(event.keystroke.key.to_string());
                })
                .on_action(move |_: &Up, _, _| {
                    previous.borrow_mut().push(TextAreaCommand::Previous)
                })
                .on_action(move |_: &Down, _, _| next.borrow_mut().push(TextAreaCommand::Next))
                .on_action(move |_: &Submit, _, _| {
                    commit.borrow_mut().push(TextAreaCommand::Commit)
                })
                .on_action(move |_: &FocusNext, _, _| {
                    focus_next.borrow_mut().push(TextAreaCommand::FocusNext)
                })
                .on_action(move |_: &FocusPrevious, _, _| {
                    focus_previous
                        .borrow_mut()
                        .push(TextAreaCommand::FocusPrevious)
                })
                .p(px(10.0))
                .child(div().size_0().tab_index(0).track_focus(&self.before))
                .child(
                    div()
                        .w(self.width)
                        .when_some(self.height, |surface, height| surface.h(height))
                        .child(self.area.clone()),
                )
                .child(div().size_0().tab_index(0).track_focus(&self.after))
        }
    }

    fn render<'a>(
        cx: &'a mut TestAppContext,
        width: Pixels,
        value: &str,
    ) -> (Entity<Fixture>, &'a mut VisualTestContext) {
        cx.update(init);
        let value = value.to_string();
        let (fixture, cx) = cx.add_window_view(move |_, cx| {
            let area = cx.new(|cx| {
                TextArea::new(
                    "test-text-area",
                    value,
                    "Write a message",
                    Theme::light(),
                    cx,
                )
            });
            cx.subscribe(&area, |fixture: &mut Fixture, _, event, _| {
                fixture.events.push(event.clone());
            })
            .detach();
            Fixture {
                area,
                width,
                height: None,
                events: Vec::new(),
                before: cx.focus_handle().tab_index(0).tab_stop(true),
                after: cx.focus_handle().tab_index(0).tab_stop(true),
                parent_commands: Rc::new(RefCell::new(Vec::new())),
                parent_keys: Rc::new(RefCell::new(Vec::new())),
            }
        });
        cx.simulate_resize(size(px(620.0), px(260.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        (fixture, cx)
    }

    fn area(fixture: &Entity<Fixture>, cx: &mut VisualTestContext) -> Entity<TextArea> {
        fixture.read_with(cx, |fixture, _| fixture.area.clone())
    }

    #[gpui::test]
    fn real_layout_reserves_lane_and_wraps_at_220_and_560(cx: &mut TestAppContext) {
        let text = "A long composer line with enough words to wrap repeatedly without any explicit newline. ".repeat(12);
        let (fixture, cx) = render(cx, px(220.0), &text);
        let area = area(&fixture, cx);
        let narrow_root = cx.debug_bounds("test-text-area.root").unwrap();
        let (narrow_text, narrow_content_height, narrow_height) = area.read_with(cx, |area, _| {
            let geometry = area.geometry.borrow();
            (
                geometry.bounds.unwrap(),
                geometry.layout.as_ref().unwrap().height,
                geometry.height,
            )
        });
        assert_eq!(narrow_root.size.width, px(220.0));
        assert_eq!(narrow_text.size.width, px(212.0));
        assert_eq!(narrow_height, px(176.0));
        assert!(narrow_content_height > narrow_height);

        fixture.update(cx, |fixture, cx| {
            fixture.width = px(560.0);
            cx.notify();
        });
        cx.run_until_parked();
        let wide_root = cx.debug_bounds("test-text-area.root").unwrap();
        let (wide_text, wide_content_height) = area.read_with(cx, |area, _| {
            let geometry = area.geometry.borrow();
            (
                geometry.bounds.unwrap(),
                geometry.layout.as_ref().unwrap().height,
            )
        });
        assert_eq!(wide_root.size.width, px(560.0));
        assert_eq!(wide_text.size.width, px(552.0));
        assert!(wide_content_height < narrow_content_height);
    }

    #[gpui::test]
    fn native_input_focus_emoji_newline_and_utf16_ime_are_real(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, px(220.0), "");
        let area = area(&fixture, cx);
        let bounds = cx.debug_bounds("test-text-area.root").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        assert!(cx.update(|window, app| area.read(app).focus_handle.is_focused(window)));

        cx.simulate_input("👨‍👩‍👧‍👦");
        cx.simulate_keystrokes("shift-enter");
        cx.simulate_input("café");
        assert_eq!(
            area.read_with(cx, |area, _| area.value().to_string()),
            "👨‍👩‍👧‍👦\ncafé"
        );

        cx.update(|window, app| {
            area.update(app, |area, cx| {
                let end = area.offset_to_utf16(area.value.len());
                area.replace_and_mark_text_in_range(Some(end..end), "世界", Some(2..2), window, cx);
                let marked = area.marked_text_range(window, cx).unwrap();
                assert_eq!(marked.end - marked.start, 2);
                assert_eq!(
                    area.selected_text_range(false, window, cx)
                        .unwrap()
                        .range
                        .end,
                    end + 2
                );
            });
        });
        cx.run_until_parked();
        let ime = cx.update(|window, app| {
            area.update(app, |area, cx| {
                let marked = area.marked_text_range(window, cx).unwrap();
                {
                    let bounds = area.geometry.borrow().bounds.unwrap();
                    area.bounds_for_range(marked, bounds, window, cx)
                }
                .unwrap()
            })
        });
        assert!(ime.size.height >= COMPOSER_LINE_HEIGHT);
    }

    #[gpui::test]
    fn grapheme_selection_copy_cut_and_paste_preserve_multiline_text(cx: &mut TestAppContext) {
        let family = "👨‍👩‍👧‍👦";
        let (fixture, cx) = render(cx, px(220.0), &format!("{family}\nsecond"));
        let area = area(&fixture, cx);
        let bounds = cx.debug_bounds("test-text-area.root").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-a left shift-right cmd-c");
        assert_eq!(
            cx.update(|_, app| app.read_from_clipboard().and_then(|item| item.text())),
            Some(family.to_string())
        );
        cx.simulate_keystrokes("cmd-x cmd-a right cmd-v");
        assert_eq!(
            area.read_with(cx, |area, _| area.value().to_string()),
            format!("\nsecond{family}")
        );
        assert!(
            fixture.read_with(cx, |fixture, _| fixture.events.iter().any(
                |event| matches!(event, TextAreaEvent::Changed { value } if value.contains('\n'))
            ))
        );
    }

    #[gpui::test]
    fn enter_submits_and_shift_enter_changes_controlled_value(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, px(560.0), "hello");
        let area = area(&fixture, cx);
        let bounds = cx.debug_bounds("test-text-area.root").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-a right enter");
        assert_eq!(
            area.read_with(cx, |area, _| area.value().to_string()),
            "hello"
        );
        assert!(fixture.read_with(cx, |fixture, _| fixture.events.contains(
            &TextAreaEvent::Submit {
                value: "hello".into()
            }
        )));

        cx.simulate_keystrokes("shift-enter");
        assert_eq!(
            area.read_with(cx, |area, _| area.value().to_string()),
            "hello\n"
        );
        assert!(fixture.read_with(cx, |fixture, _| fixture.events.contains(
            &TextAreaEvent::Changed {
                value: "hello\n".into()
            }
        )));
    }

    #[gpui::test]
    fn unchanged_controlled_reconcile_keeps_selection_and_disabled_read_only_block_edits(
        cx: &mut TestAppContext,
    ) {
        let (fixture, cx) = render(cx, px(220.0), "one\ntwo");
        let area = area(&fixture, cx);
        let bounds = cx.debug_bounds("test-text-area.root").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("home shift-right");
        let before = area.read_with(cx, |area, _| {
            let selection = area.selection();
            (selection.range, selection.reversed)
        });
        area.update(cx, |area, cx| area.set_value("one\ntwo", cx));
        assert_eq!(
            area.read_with(cx, |area, _| {
                let selection = area.selection();
                (selection.range, selection.reversed)
            }),
            before
        );

        area.update(cx, |area, cx| area.set_read_only(true, cx));
        cx.simulate_input("x");
        cx.simulate_keystrokes("backspace shift-enter enter");
        assert_eq!(
            area.read_with(cx, |area, _| area.value().to_string()),
            "one\ntwo"
        );
        area.update(cx, |area, cx| {
            area.set_read_only(false, cx);
            area.set_disabled(true, cx);
        });
        cx.simulate_input("x");
        assert_eq!(
            area.read_with(cx, |area, _| area.value().to_string()),
            "one\ntwo"
        );
    }

    #[gpui::test]
    fn fitting_area_scrollbar_lane_click_keeps_normal_caret_focus_behavior(
        cx: &mut TestAppContext,
    ) {
        let (fixture, cx) = render(cx, px(220.0), "short");
        let area = area(&fixture, cx);
        let root = cx.debug_bounds("test-text-area.root").unwrap();
        cx.simulate_click(
            point(root.right() - px(1.0), root.center().y),
            Modifiers::default(),
        );
        assert!(cx.update(|window, app| area.read(app).focus_handle.is_focused(window)));
        area.read_with(cx, |area, _| {
            assert!(!area.is_scrollbar_dragging);
            assert_eq!(area.selected_range, area.value.len()..area.value.len());
            let geometry = area.geometry.borrow();
            assert!(
                geometry.layout.as_ref().unwrap().height <= geometry.bounds.unwrap().size.height
            );
        });
    }

    #[gpui::test]
    fn overflowing_area_wheel_and_track_input_scroll_real_geometry(cx: &mut TestAppContext) {
        let text = (0..40)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (fixture, cx) = render(cx, px(220.0), &text);
        let area = area(&fixture, cx);
        area.update(cx, |area, cx| area.move_to(0, cx));
        cx.run_until_parked();
        assert_eq!(
            area.read_with(cx, |area, _| area.geometry.borrow().vertical_scroll),
            px(0.0)
        );
        let root = cx.debug_bounds("test-text-area.root").unwrap();
        cx.simulate_event(ScrollWheelEvent {
            position: root.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-44.0))),
            ..Default::default()
        });
        let wheel_scroll = area.read_with(cx, |area, _| area.geometry.borrow().vertical_scroll);
        assert!(wheel_scroll > px(0.0));
        cx.simulate_click(
            point(root.right() - px(1.0), root.bottom() - px(2.0)),
            Modifiers::default(),
        );
        assert!(
            area.read_with(cx, |area, _| area.geometry.borrow().vertical_scroll) > wheel_scroll,
            "clicking the reserved scrollbar track moves the thumb"
        );
    }

    #[gpui::test]
    fn nowrap_editor_horizontal_wheel_track_caret_hit_testing_and_wrap_reset(
        cx: &mut TestAppContext,
    ) {
        let text = format!("start {} end", "long_segment_".repeat(40));
        let (fixture, cx) = render(cx, px(220.0), &text);
        let area = area(&fixture, cx);
        fixture.update(cx, |fixture, cx| {
            fixture.height = Some(px(160.0));
            fixture.area.update(cx, |area, cx| {
                area.set_layout(
                    TextAreaLayout::Editor {
                        wrap: false,
                        line_numbers: true,
                    },
                    cx,
                );
                area.move_to(0, cx);
            });
            cx.notify();
        });
        cx.run_until_parked();
        let root = cx.debug_bounds("test-text-area.root").unwrap();
        area.read_with(cx, |area, _| {
            let geometry = area.geometry.borrow();
            assert!(geometry.layout.as_ref().unwrap().width > geometry.bounds.unwrap().size.width);
            assert_eq!(geometry.horizontal_scroll, px(0.0));
        });
        cx.simulate_event(ScrollWheelEvent {
            position: root.center(),
            delta: ScrollDelta::Pixels(point(px(-80.0), px(0.0))),
            ..Default::default()
        });
        let wheel = area.read_with(cx, |area, _| area.geometry.borrow().horizontal_scroll);
        assert!(wheel > px(0.0));
        cx.simulate_click(
            point(root.right() - px(2.0), root.bottom() - px(2.0)),
            Modifiers::default(),
        );
        let track = area.read_with(cx, |area, _| area.geometry.borrow().horizontal_scroll);
        assert!(track > wheel);
        area.update(cx, |area, cx| {
            let end = area.value.len();
            area.move_to(end, cx)
        });
        cx.run_until_parked();
        area.read_with(cx, |area, _| {
            let geometry = area.geometry.borrow();
            let bounds = geometry.bounds.unwrap();
            let layout = geometry.layout.as_ref().unwrap();
            let max = (layout.width - bounds.size.width).max(px(0.0));
            assert!(geometry.horizontal_scroll >= max - CARET_REVEAL_MARGIN);
            assert!(
                area.index_for_mouse_position(point(bounds.right() - px(4.0), bounds.center().y))
                    > 0
            );
        });
        area.update(cx, |area, cx| {
            area.set_layout(
                TextAreaLayout::Editor {
                    wrap: true,
                    line_numbers: true,
                },
                cx,
            )
        });
        cx.run_until_parked();
        assert_eq!(
            area.read_with(cx, |area, _| area.geometry.borrow().horizontal_scroll),
            px(0.0)
        );
    }

    #[gpui::test]
    fn semantic_command_handler_consumes_picker_navigation_commit_and_tabs(
        cx: &mut TestAppContext,
    ) {
        let (fixture, cx) = render(cx, px(220.0), "first\nsecond");
        let area = area(&fixture, cx);
        let commands = Rc::new(RefCell::new(Vec::new()));
        let recorded = commands.clone();
        area.update(cx, |area, _| {
            area.set_command_handler(Some(Rc::new(move |command, _, _| {
                recorded.borrow_mut().push(command);
                true
            })));
        });
        cx.update(|window, app| area.read(app).focus_handle.focus(window));
        let selection = area.read_with(cx, |area, _| {
            let selection = area.selection();
            (selection.range, selection.reversed)
        });
        cx.simulate_keystrokes("up down enter tab shift-tab");
        assert_eq!(
            commands.borrow().as_slice(),
            &[
                TextAreaCommand::Previous,
                TextAreaCommand::Next,
                TextAreaCommand::Commit,
                TextAreaCommand::FocusNext,
                TextAreaCommand::FocusPrevious,
            ]
        );
        assert_eq!(
            area.read_with(cx, |area, _| {
                let selection = area.selection();
                (selection.range, selection.reversed)
            }),
            selection
        );
        assert!(!fixture.read_with(cx, |fixture, _| {
            fixture
                .events
                .iter()
                .any(|event| matches!(event, TextAreaEvent::Submit { .. }))
        }));
        assert!(cx.update(|window, app| area.read(app).focus_handle.is_focused(window)));
        assert!(fixture.read_with(cx, |fixture, _| fixture.parent_commands.borrow().is_empty()));
        assert!(fixture.read_with(cx, |fixture, _| fixture.parent_keys.borrow().is_empty()));
    }

    #[gpui::test]
    fn unhandled_semantic_commands_keep_editor_and_focus_fallbacks(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, px(220.0), "first\nsecond");
        let area = area(&fixture, cx);
        let commands = Rc::new(RefCell::new(Vec::new()));
        let recorded = commands.clone();
        area.update(cx, |area, _| {
            area.set_command_handler(Some(Rc::new(move |command, _, _| {
                recorded.borrow_mut().push(command);
                false
            })));
        });
        cx.update(|window, app| area.read(app).focus_handle.focus(window));
        let cursor_before = area.read_with(cx, |area, _| area.selection().range);
        cx.simulate_keystrokes("up");
        assert_ne!(
            area.read_with(cx, |area, _| area.selection().range),
            cursor_before
        );
        cx.simulate_keystrokes("down enter");
        assert!(fixture.read_with(cx, |fixture, _| fixture.events.contains(
            &TextAreaEvent::Submit {
                value: "first\nsecond".into()
            }
        )));

        fixture.read_with(cx, |fixture, _| fixture.parent_keys.borrow_mut().clear());
        cx.update(|window, app| area.read(app).focus_handle.focus(window));
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, app| fixture.read(app).after.is_focused(window)));

        cx.update(|window, app| area.read(app).focus_handle.focus(window));
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, app| fixture.read(app).before.is_focused(window)));
        assert!(commands.borrow().contains(&TextAreaCommand::Previous));
        assert!(commands.borrow().contains(&TextAreaCommand::Next));
        assert!(commands.borrow().contains(&TextAreaCommand::Commit));
        assert!(commands.borrow().contains(&TextAreaCommand::FocusNext));
        assert!(commands.borrow().contains(&TextAreaCommand::FocusPrevious));
        let parent = fixture.read_with(cx, |fixture, _| fixture.parent_commands.borrow().clone());
        assert!(parent.is_empty());
        assert!(fixture.read_with(cx, |fixture, _| fixture.parent_keys.borrow().is_empty()));
    }

    #[test]
    fn grapheme_boundaries_keep_combining_marks_and_emoji_atomic() {
        let value = "a\u{301}👨‍👩‍👧‍👦👍🏽z";
        let boundaries: Vec<_> = value
            .grapheme_indices(true)
            .map(|(index, _)| index)
            .chain(std::iter::once(value.len()))
            .collect();
        assert_eq!(next_grapheme_boundary(value, boundaries[0]), boundaries[1]);
        assert_eq!(next_grapheme_boundary(value, boundaries[1]), boundaries[2]);
        assert_eq!(
            previous_grapheme_boundary(value, boundaries[3]),
            boundaries[2]
        );
    }
    #[gpui::test]
    fn highlights_normalize_on_ingress_and_clear_on_text_mutation(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, px(220.0), "abcdef");
        let area = area(&fixture, cx);
        area.update(cx, |area, cx| {
            let status = area.set_highlights(
                vec![
                    TextHighlightSpan {
                        range: 2..5,
                        kind: TextHighlightKind::String,
                    },
                    TextHighlightSpan {
                        range: 0..3,
                        kind: TextHighlightKind::Keyword,
                    },
                    TextHighlightSpan {
                        range: 99..100,
                        kind: TextHighlightKind::Comment,
                    },
                ],
                cx,
            );
            assert_eq!(status.requested, 3);
            assert!(!status.limit_truncated);
            assert_eq!(area.highlights.len(), 1);
            assert_eq!(area.highlights[0].range, 0..3);
            area.replace_range(0..0, "x");
            assert!(area.highlights.is_empty());
        });
    }

    #[test]
    fn semantic_highlight_normalization_is_bounded_and_non_overlapping() {
        let text = "x ".repeat(MAX_HIGHLIGHT_SPANS + 10_000);
        let spans = (0..MAX_HIGHLIGHT_SPANS + 10_000)
            .map(|index| TextHighlightSpan {
                range: index * 2..index * 2 + 1,
                kind: TextHighlightKind::Keyword,
            })
            .collect::<Vec<_>>();
        let (normalized, status) = normalize_highlights(&spans, &text);
        assert_eq!(normalized.len(), MAX_HIGHLIGHT_SPANS);
        assert!(status.limit_truncated);
        assert_eq!(status.accepted, MAX_HIGHLIGHT_SPANS);
        assert!(
            normalized
                .windows(2)
                .all(|pair| pair[0].range.end <= pair[1].range.start)
        );
    }
}
