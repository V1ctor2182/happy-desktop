use std::{cell::RefCell, ops::Range, rc::Rc, time::Duration};

use unicode_segmentation::UnicodeSegmentation;

use crate::{theme::Theme, ui::theme_roles::ThemeRole};
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
        ShowCharacterPalette,
        Paste,
        Cut,
        Copy,
        FocusNext,
        FocusPrevious,
    ]
);

const KEY_CONTEXT: &str = "HappyTextArea";
const LINE_HEIGHT: Pixels = px(22.0);
const MIN_LINES: usize = 1;
const MAX_LINES: usize = 8;
const SCROLLBAR_LANE: Pixels = px(8.0);
const SCROLLBAR_INK: Pixels = px(6.0);
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

struct LayoutLine {
    line: WrappedLine,
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

    fn height(&self) -> Pixels {
        LINE_HEIGHT * self.visual_lines()
    }

    fn local_position(&self, index: usize) -> Point<Pixels> {
        self.line
            .position_for_index(index.min(self.line.len()), LINE_HEIGHT)
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
    height: Pixels,
}

#[derive(Default)]
struct TextAreaGeometry {
    layout: Option<Rc<TextLayout>>,
    bounds: Option<Bounds<Pixels>>,
    height: Pixels,
    vertical_scroll: Pixels,
    reveal_cursor: bool,
}

impl TextLayout {
    fn position_for_index(&self, index: usize) -> Point<Pixels> {
        if let Some(line) = self
            .lines
            .iter()
            .find(|line| index >= line.start && index <= line.end())
        {
            let local = line.local_position(index - line.start);
            return point(local.x, line.y + local.y);
        }
        self.lines
            .last()
            .map(|line| {
                let local = line.local_position(line.line.len());
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
                    .closest_index_for_position(point(position.x, px(0.0)), LINE_HEIGHT)
                    .unwrap_or_else(|index| index);
        }
        for line in &self.lines {
            if position.y < line.y + line.height() {
                let local = point(position.x, (position.y - line.y).max(px(0.0)));
                return line.start
                    + line
                        .line
                        .closest_index_for_position(local, LINE_HEIGHT)
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

/// A reusable, controlled, multiline native GPUI editor for the chat composer.
///
/// The editor always reserves an 8 px scrollbar lane. Text wraps against the
/// remaining width, grows from one through eight 22 px lines, then scrolls.
pub struct TextArea {
    id: SharedString,
    theme: Theme,
    focus_handle: FocusHandle,
    command_handler: Option<TextAreaCommandHandler>,
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
            value,
            placeholder: placeholder.into(),
            disabled: false,
            read_only: false,
            selected_range: cursor..cursor,
            selection_reversed: false,
            marked_range: None,
            geometry: Rc::new(RefCell::new(TextAreaGeometry {
                height: LINE_HEIGHT,
                reveal_cursor: true,
                ..Default::default()
            })),
            preferred_x: None,
            is_selecting: false,
            is_scrollbar_dragging: false,
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
        Some(layout.index_for_position(point(x, position.y + LINE_HEIGHT * direction)))
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
                .min(bounds.size.width),
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
            (bounds.size.height * (bounds.size.height / layout.height)).max(LINE_HEIGHT);
        let travel = (bounds.size.height - thumb_height).max(px(1.0));
        let local = (position.y - bounds.top() - thumb_height / 2.0).clamp(px(0.0), travel);
        geometry.vertical_scroll = max_scroll * (local / travel);
    }

    fn on_scroll_wheel(
        &mut self,
        event: &ScrollWheelEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let delta = event.delta.pixel_delta(window.line_height());
        let delta = if delta.y != px(0.0) { delta.y } else { delta.x };
        let mut geometry = self.geometry.borrow_mut();
        let (Some(bounds), Some(layout)) = (geometry.bounds, geometry.layout.as_ref().cloned())
        else {
            return;
        };
        let max_scroll = (layout.height - bounds.size.height).max(px(0.0));
        let next = (geometry.vertical_scroll - delta).clamp(px(0.0), max_scroll);
        if next != geometry.vertical_scroll {
            geometry.vertical_scroll = next;
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
        let scrollbar_hit = {
            let geometry = self.geometry.borrow();
            match (geometry.bounds, geometry.layout.as_ref()) {
                (Some(bounds), Some(layout)) => {
                    layout.height > bounds.size.height && event.position.x >= bounds.right()
                }
                _ => false,
            }
        };
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
        if self.is_scrollbar_dragging {
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
                bounds.left() + start.x,
                bounds.top() + start.y - geometry.vertical_scroll,
            ),
            point(
                bounds.left() + end.x.max(start.x + px(1.0)),
                bounds.top() + end.y - geometry.vertical_scroll + LINE_HEIGHT,
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
            position.x - bounds.left(),
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
    vertical_scroll: Pixels,
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
        let color: Hsla = if showing_placeholder {
            area.theme.role(ThemeRole::InputPlaceholder).into()
        } else if area.disabled {
            area.theme.role(ThemeRole::TextSecondary).into()
        } else {
            area.theme.role(ThemeRole::InputText).into()
        };
        let base_run = TextRun {
            len: display_text.len(),
            font: text_style.font(),
            color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let runs = if !showing_placeholder {
            if let Some(marked) = area.marked_range.as_ref() {
                vec![
                    TextRun {
                        len: marked.start,
                        ..base_run.clone()
                    },
                    TextRun {
                        len: marked.end - marked.start,
                        underline: Some(UnderlineStyle {
                            color: Some(color),
                            thickness: px(1.0),
                            wavy: false,
                        }),
                        ..base_run.clone()
                    },
                    TextRun {
                        len: display_text.len() - marked.end,
                        ..base_run
                    },
                ]
                .into_iter()
                .filter(|run| run.len > 0)
                .collect::<Vec<_>>()
            } else {
                vec![base_run]
            }
        } else {
            vec![base_run]
        };
        let geometry = area.geometry.clone();
        let _ = area;
        let font_size = text_style.font_size.to_pixels(window.rem_size());
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        let layout_id =
            window.request_measured_layout(style, move |known, available, window, _| {
                let width = known
                    .width
                    .or(match available.width {
                        gpui::AvailableSpace::Definite(width) => Some(width),
                        _ => None,
                    })
                    .unwrap_or(px(0.0));
                let shaped = window
                    .text_system()
                    .shape_text(display_text.clone(), font_size, &runs, Some(width), None)
                    .unwrap_or_default();
                let mut lines = Vec::new();
                let mut start = 0;
                let mut y = px(0.0);
                let mut measured_width = px(0.0);
                for line in shaped {
                    let line_size = line.size(LINE_HEIGHT);
                    measured_width = measured_width.max(line_size.width);
                    let height = LINE_HEIGHT * (line.wrap_boundaries().len() + 1);
                    let len = line.len();
                    lines.push(LayoutLine { line, start, y });
                    start += len + 1;
                    y += height;
                }
                let layout = Rc::new(TextLayout {
                    lines,
                    height: y.max(LINE_HEIGHT),
                });
                let wanted_lines =
                    ((layout.height / LINE_HEIGHT) as usize).clamp(MIN_LINES, MAX_LINES);
                let wanted_height = LINE_HEIGHT * wanted_lines;
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
        let cursor_position = layout.position_for_index(area.cursor_offset());
        let mut scroll = committed.vertical_scroll.min(max_scroll).max(px(0.0));
        if committed.reveal_cursor {
            if cursor_position.y < scroll {
                scroll = cursor_position.y;
            } else if cursor_position.y + LINE_HEIGHT > scroll + wanted_height {
                scroll = cursor_position.y + LINE_HEIGHT - wanted_height;
            }
            committed.reveal_cursor = false;
        }
        committed.bounds = Some(bounds);
        committed.vertical_scroll = scroll;
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
                                point(bounds.left() + from.x, bounds.top() + from.y - scroll),
                                point(
                                    bounds.left() + to.x.max(from.x + px(1.0)),
                                    bounds.top() + from.y - scroll + LINE_HEIGHT,
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
                        bounds.left() + cursor_position.x,
                        bounds.top() + cursor_position.y - scroll,
                    ),
                    size(px(1.0), LINE_HEIGHT),
                ),
                color,
            )
        });
        let scrollbar = if layout.height > wanted_height {
            let thumb_height = (wanted_height * (wanted_height / layout.height)).max(LINE_HEIGHT);
            let travel = wanted_height - thumb_height;
            let top = if max_scroll > px(0.0) {
                travel * (scroll / max_scroll)
            } else {
                px(0.0)
            };
            Some(fill(
                Bounds::new(
                    point(
                        bounds.right() + (SCROLLBAR_LANE - SCROLLBAR_INK) / 2.0,
                        bounds.top() + top,
                    ),
                    size(SCROLLBAR_INK, thumb_height),
                ),
                Hsla::from(area.theme.role(ThemeRole::HappyScrollbarActiveColor)),
            ))
        } else {
            None
        };
        PrepaintState {
            layout: Some(layout),
            selection,
            caret,
            scrollbar,
            vertical_scroll: scroll,
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
        let layout = prepaint.layout.take().expect("text area layout must exist");
        for line in &layout.lines {
            line.line
                .paint(
                    point(
                        bounds.left(),
                        bounds.top() + line.y - prepaint.vertical_scroll,
                    ),
                    LINE_HEIGHT,
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
            .pr(SCROLLBAR_LANE)
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
                .child(div().w(self.width).child(self.area.clone()))
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
        assert!(ime.size.height >= LINE_HEIGHT);
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
}
