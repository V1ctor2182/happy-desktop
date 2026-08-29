use std::{ops::Range, time::Duration};

use unicode_segmentation::UnicodeSegmentation;

use crate::{theme::Theme, ui::theme_roles::ThemeRole};
use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, DispatchPhase, Element, ElementId,
    ElementInputHandler, Entity, EntityInputHandler, EventEmitter, FocusHandle, Focusable,
    GlobalElementId, Hsla, KeyBinding, LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, PaintQuad, Pixels, Point, ShapedLine, SharedString, Style, TextRun,
    UTF16Selection, UnderlineStyle, Window, actions, div, fill, point, prelude::*, px, relative,
    size,
};

actions!(
    happy_text_input,
    [
        Backspace,
        Delete,
        Left,
        Right,
        SelectLeft,
        SelectRight,
        SelectAll,
        Home,
        End,
        ShowCharacterPalette,
        Paste,
        Cut,
        Copy,
        FocusNext,
        FocusPrevious,
    ]
);

const KEY_CONTEXT: &str = "HappyTextInput";
const DRAG_SCROLL_STEP: Pixels = px(24.0);
const DRAG_EDGE_WIDTH: Pixels = px(1.0);
const DRAG_SCROLL_INTERVAL: Duration = Duration::from_millis(40);

/// Installs the platform text-editing bindings used by [`TextInput`].
///
/// Call this once while initializing the application. The bindings are scoped to
/// `HappyTextInput`, so they do not affect other focused controls.
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, Some(KEY_CONTEXT)),
        KeyBinding::new("delete", Delete, Some(KEY_CONTEXT)),
        KeyBinding::new("left", Left, Some(KEY_CONTEXT)),
        KeyBinding::new("right", Right, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-left", SelectLeft, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-right", SelectRight, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-a", SelectAll, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-v", Paste, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-c", Copy, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-x", Cut, Some(KEY_CONTEXT)),
        KeyBinding::new("home", Home, Some(KEY_CONTEXT)),
        KeyBinding::new("end", End, Some(KEY_CONTEXT)),
        KeyBinding::new("ctrl-cmd-space", ShowCharacterPalette, Some(KEY_CONTEXT)),
        KeyBinding::new("tab", FocusNext, Some(KEY_CONTEXT)),
        KeyBinding::new("shift-tab", FocusPrevious, Some(KEY_CONTEXT)),
    ]);
}

/// Typed output emitted after a user edit changes the input value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextInputEvent {
    Changed { value: SharedString },
}

/// A shell-neutral, single-line GPUI text editor.
///
/// A field shell owns borders, background, padding, height, and typography. This
/// entity fills that shell, inherits its text style, owns native selection/IME
/// state, and emits [`TextInputEvent`] for user edits.
pub struct TextInput {
    id: SharedString,
    theme: Theme,
    focus_handle: FocusHandle,
    value: SharedString,
    placeholder: SharedString,
    selected_range: Range<usize>,
    selection_reversed: bool,
    marked_range: Option<Range<usize>>,
    last_layout: Option<ShapedLine>,
    last_bounds: Option<Bounds<Pixels>>,
    horizontal_scroll: Pixels,
    is_selecting: bool,
    drag_position: Option<Point<Pixels>>,
    drag_lifecycle: usize,
}

impl TextInput {
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
            value,
            placeholder: placeholder.into(),
            selected_range: cursor..cursor,
            selection_reversed: false,
            marked_range: None,
            last_layout: None,
            last_bounds: None,
            horizontal_scroll: px(0.0),
            is_selecting: false,
            drag_position: None,
            drag_lifecycle: 0,
        }
    }

    pub fn theme_reconcile(&mut self, theme: Theme) {
        if self.theme != theme {
            self.theme = theme;
            self.last_layout = None;
        }
    }

    #[allow(dead_code)]
    pub fn value(&self) -> &SharedString {
        &self.value
    }

    #[allow(dead_code)]
    pub fn placeholder(&self) -> &SharedString {
        &self.placeholder
    }

    /// Reconciles an external value without emitting a user-change event.
    pub fn set_value(&mut self, value: impl Into<SharedString>, cx: &mut Context<Self>) {
        let value = value.into();
        if self.value == value {
            return;
        }
        self.value = value;
        let cursor = self.value.len();
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.marked_range = None;
        self.last_layout = None;
        cx.notify();
    }

    #[allow(dead_code)]
    pub fn set_placeholder(
        &mut self,
        placeholder: impl Into<SharedString>,
        cx: &mut Context<Self>,
    ) {
        let placeholder = placeholder.into();
        if self.placeholder != placeholder {
            self.placeholder = placeholder;
            cx.notify();
        }
    }

    pub fn selection(&self) -> UTF16Selection {
        UTF16Selection {
            range: self.range_to_utf16(&self.selected_range),
            reversed: self.selection_reversed,
        }
    }

    fn emit_changed(&self, cx: &mut Context<Self>) {
        cx.emit(TextInputEvent::Changed {
            value: self.value.clone(),
        });
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.previous_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.start, cx);
        }
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.move_to(self.next_boundary(self.cursor_offset()), cx);
        } else {
            self.move_to(self.selected_range.end, cx);
        }
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.previous_boundary(self.cursor_offset()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.next_boundary(self.cursor_offset()), cx);
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
        self.select_to(self.value.len(), cx);
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.value.len(), cx);
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.previous_boundary(self.cursor_offset()), cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_range.is_empty() {
            self.select_to(self.next_boundary(self.cursor_offset()), cx);
        }
        self.replace_text_in_range(None, "", window, cx);
    }

    fn focus_next(&mut self, _: &FocusNext, window: &mut Window, _: &mut Context<Self>) {
        window.focus_next();
    }
    fn focus_previous(&mut self, _: &FocusPrevious, window: &mut Window, _: &mut Context<Self>) {
        window.focus_prev();
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
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

    fn on_mouse_up(&mut self, event: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        if event.button == MouseButton::Left {
            self.is_selecting = false;
            self.drag_position = None;
            self.drag_lifecycle = self.drag_lifecycle.wrapping_add(1);
        }
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.is_selecting {
            self.drag_position = Some(event.position);
            self.scroll_for_drag(event.position);
            self.select_to(self.index_for_mouse_position(event.position), cx);
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
                    .update(cx, |input, cx| {
                        if !input.is_selecting || input.drag_lifecycle != lifecycle {
                            return false;
                        }
                        let Some(position) = input.drag_position else {
                            return true;
                        };
                        if input.drag_position_is_at_edge(position) {
                            input.scroll_for_drag(position);
                            let offset = input.index_for_mouse_position(position);
                            input.select_to(offset, cx);
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

    fn drag_position_is_at_edge(&self, position: Point<Pixels>) -> bool {
        self.last_bounds.as_ref().is_some_and(|bounds| {
            position.x <= bounds.left() + DRAG_EDGE_WIDTH
                || position.x >= bounds.right() - DRAG_EDGE_WIDTH
        })
    }

    fn scroll_for_drag(&mut self, position: Point<Pixels>) {
        let (Some(bounds), Some(line)) = (self.last_bounds, self.last_layout.as_ref()) else {
            return;
        };
        let max_scroll = (line.width + px(1.0) - bounds.size.width).max(px(0.0));
        if position.x <= bounds.left() + DRAG_EDGE_WIDTH {
            let overshoot = (bounds.left() - position.x).max(px(0.0));
            self.horizontal_scroll =
                (self.horizontal_scroll - DRAG_SCROLL_STEP - overshoot).max(px(0.0));
        } else if position.x >= bounds.right() - DRAG_EDGE_WIDTH {
            let overshoot = (position.x - bounds.right()).max(px(0.0));
            self.horizontal_scroll =
                (self.horizontal_scroll + DRAG_SCROLL_STEP + overshoot).min(max_scroll);
        }
    }

    fn show_character_palette(
        &mut self,
        _: &ShowCharacterPalette,
        window: &mut Window,
        _: &mut Context<Self>,
    ) {
        window.show_character_palette();
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(None, &text.replace(['\n', '\r'], " "), window, cx);
        }
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.value[self.selected_range.clone()].to_string(),
            ));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if !self.selected_range.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(
                self.value[self.selected_range.clone()].to_string(),
            ));
            self.replace_text_in_range(None, "", window, cx);
        }
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let offset = self.valid_boundary(offset);
        self.selected_range = offset..offset;
        self.selection_reversed = false;
        cx.notify();
    }

    fn cursor_offset(&self) -> usize {
        if self.selection_reversed {
            self.selected_range.start
        } else {
            self.selected_range.end
        }
    }

    fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        if self.value.is_empty() {
            return 0;
        }
        let (Some(bounds), Some(line)) = (self.last_bounds.as_ref(), self.last_layout.as_ref())
        else {
            return 0;
        };
        if position.y < bounds.top() {
            return 0;
        }
        if position.y > bounds.bottom() {
            return self.value.len();
        }
        let viewport_x = (position.x - bounds.left())
            .max(px(0.0))
            .min(bounds.size.width);
        self.valid_boundary(line.closest_index_for_x(viewport_x + self.horizontal_scroll))
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
        cx.notify();
    }

    fn valid_boundary(&self, offset: usize) -> usize {
        grapheme_boundary_at_or_before(&self.value, offset)
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

    fn previous_boundary(&self, offset: usize) -> usize {
        previous_grapheme_boundary(&self.value, offset)
    }

    fn next_boundary(&self, offset: usize) -> usize {
        next_grapheme_boundary(&self.value, offset)
    }

    fn replacement_range(&self, range_utf16: Option<&Range<usize>>) -> Range<usize> {
        range_utf16
            .map(|range| self.range_from_utf16(range))
            .or_else(|| self.marked_range.clone())
            .unwrap_or_else(|| self.selected_range.clone())
    }

    fn replace_range(&mut self, range: Range<usize>, new_text: &str) {
        self.value = format!(
            "{}{}{}",
            &self.value[..range.start],
            new_text,
            &self.value[range.end..]
        )
        .into();
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

fn scroll_to_reveal(
    current: Pixels,
    viewport_width: Pixels,
    content_width: Pixels,
    reveal_start: Pixels,
    reveal_end: Pixels,
    active: Pixels,
) -> Pixels {
    if viewport_width <= px(0.0) {
        return px(0.0);
    }

    let max_scroll = (content_width - viewport_width).max(px(0.0));
    let mut scroll = current.min(max_scroll).max(px(0.0));
    if reveal_end - reveal_start <= viewport_width {
        if reveal_start < scroll {
            scroll = reveal_start;
        } else if reveal_end > scroll + viewport_width {
            scroll = reveal_end - viewport_width;
        }
    } else if active < scroll {
        scroll = active;
    } else if active + px(1.0) > scroll + viewport_width {
        scroll = active + px(1.0) - viewport_width;
    }
    scroll.min(max_scroll).max(px(0.0))
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

impl EventEmitter<TextInputEvent> for TextInput {}

impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range_utf16);
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
        let range = self.replacement_range(range_utf16.as_ref());
        let changed = &self.value[range.clone()] != new_text;
        let cursor = range.start + new_text.len();
        self.replace_range(range, new_text);
        self.selected_range = cursor..cursor;
        self.selection_reversed = false;
        self.marked_range = None;
        self.last_layout = None;
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
        self.last_layout = None;
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
        let line = self.last_layout.as_ref()?;
        let range = self.range_from_utf16(&range_utf16);
        Some(Bounds::from_corners(
            point(
                bounds.left() + line.x_for_index(range.start) - self.horizontal_scroll,
                bounds.top(),
            ),
            point(
                bounds.left() + line.x_for_index(range.end) - self.horizontal_scroll,
                bounds.bottom(),
            ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        if self.value.is_empty() {
            return Some(0);
        }
        let bounds = self.last_bounds?;
        let line = self.last_layout.as_ref()?;
        let viewport_x = (point.x - bounds.left())
            .max(px(0.0))
            .min(bounds.size.width);
        let index = line.closest_index_for_x(viewport_x + self.horizontal_scroll);
        Some(self.offset_to_utf16(self.valid_boundary(index)))
    }
}

struct TextElement {
    input: Entity<TextInput>,
}

struct PrepaintState {
    line: Option<ShapedLine>,
    cursor: Option<PaintQuad>,
    selection: Option<PaintQuad>,
    horizontal_scroll: Pixels,
}

impl IntoElement for TextElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TextElement {
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
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = relative(1.).into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let input = self.input.read(cx);
        let style = window.text_style();
        let showing_placeholder = input.value.is_empty();
        let display_text = if showing_placeholder {
            input.placeholder.clone()
        } else {
            input.value.clone()
        };
        let text_color = if showing_placeholder {
            input.theme.role(ThemeRole::InputPlaceholder).into()
        } else {
            input.theme.role(ThemeRole::InputText).into()
        };
        let base_run = TextRun {
            len: display_text.len(),
            font: style.font(),
            color: text_color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let runs = if !showing_placeholder {
            if let Some(marked) = input.marked_range.as_ref() {
                vec![
                    TextRun {
                        len: marked.start,
                        ..base_run.clone()
                    },
                    TextRun {
                        len: marked.end - marked.start,
                        underline: Some(UnderlineStyle {
                            color: Some(base_run.color),
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
                .collect()
            } else {
                vec![base_run]
            }
        } else {
            vec![base_run]
        };
        let font_size = style.font_size.to_pixels(window.rem_size());
        let line = window
            .text_system()
            .shape_line(display_text, font_size, &runs, None);

        let cursor_x = line.x_for_index(input.cursor_offset());
        let reveal_range = input.marked_range.as_ref().unwrap_or(&input.selected_range);
        let reveal_start = line.x_for_index(reveal_range.start);
        let reveal_end = line.x_for_index(reveal_range.end) + px(1.0);
        let horizontal_scroll = if showing_placeholder {
            px(0.0)
        } else {
            scroll_to_reveal(
                input.horizontal_scroll,
                bounds.size.width,
                line.width + px(1.0),
                reveal_start,
                reveal_end,
                cursor_x,
            )
        };
        let text_left = bounds.left() - horizontal_scroll;
        let (selection, cursor) = if input.selected_range.is_empty() {
            (
                None,
                Some(fill(
                    Bounds::new(
                        point(text_left + cursor_x, bounds.top()),
                        size(px(1.0), bounds.size.height),
                    ),
                    style.color,
                )),
            )
        } else {
            (
                Some(fill(
                    Bounds::from_corners(
                        point(
                            text_left + line.x_for_index(input.selected_range.start),
                            bounds.top(),
                        ),
                        point(
                            text_left + line.x_for_index(input.selected_range.end),
                            bounds.bottom(),
                        ),
                    ),
                    Hsla::from(input.theme.role(ThemeRole::RadioActive)).opacity(0.32),
                )),
                None,
            )
        };

        PrepaintState {
            line: Some(line),
            cursor,
            selection,
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
        let focus_handle = self.input.read(cx).focus_handle.clone();
        let move_input = self.input.clone();
        window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
            if phase == DispatchPhase::Capture {
                move_input.update(cx, |input, cx| input.on_mouse_move(event, window, cx));
            }
        });
        let up_input = self.input.clone();
        window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
            if phase == DispatchPhase::Capture {
                up_input.update(cx, |input, cx| input.on_mouse_up(event, window, cx));
            }
        });
        window.handle_input(
            &focus_handle,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        if let Some(selection) = prepaint.selection.take() {
            window.paint_quad(selection);
        }
        let line = prepaint.line.take().expect("text line must be shaped");
        line.paint(
            point(bounds.left() - prepaint.horizontal_scroll, bounds.top()),
            bounds.size.height,
            window,
            cx,
        )
        .expect("text line must paint");
        if focus_handle.is_focused(window) {
            if let Some(cursor) = prepaint.cursor.take() {
                window.paint_quad(cursor);
            }
        }
        self.input.update(cx, |input, _| {
            input.last_layout = Some(line);
            input.last_bounds = Some(bounds);
            input.horizontal_scroll = prepaint.horizontal_scroll;
        });
    }
}

impl Render for TextInput {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let debug_id = self.id.clone();
        div()
            .id(self.id.clone())
            .debug_selector(move || format!("{}.root", debug_id))
            .key_context(KEY_CONTEXT)
            .track_focus(&self.focus_handle(cx))
            .tab_index(0)
            .cursor(CursorStyle::IBeam)
            .w_full()
            .h_full()
            .min_w_0()
            .overflow_hidden()
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::show_character_palette))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::focus_next))
            .on_action(cx.listener(Self::focus_previous))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .child(TextElement { input: cx.entity() })
    }
}

impl Focusable for TextInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        Bounds, Context, Modifiers, Render, TestAppContext, VisualTestContext, div, point, px, size,
    };

    struct Fixture {
        input: Entity<TextInput>,
        changes: Vec<SharedString>,
    }

    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().p(px(10.0)).child(
                div()
                    .debug_selector(|| "input-shell".to_string())
                    .w(px(200.0))
                    .h(px(28.0))
                    .line_height(px(20.0))
                    .text_size(px(13.0))
                    .child(self.input.clone()),
            )
        }
    }

    fn render(cx: &mut TestAppContext) -> (Entity<Fixture>, &mut VisualTestContext) {
        cx.update(init);
        let (fixture, cx) = cx.add_window_view(|_, cx| {
            let input =
                cx.new(|cx| TextInput::new("test-input", "", "Type here", Theme::light(), cx));
            let subscription = cx.subscribe(&input, |fixture: &mut Fixture, _, event, _| {
                let TextInputEvent::Changed { value } = event;
                fixture.changes.push(value.clone());
            });
            subscription.detach();
            Fixture {
                input,
                changes: Vec::new(),
            }
        });
        cx.simulate_resize(size(px(240.0), px(80.0)));
        cx.run_until_parked();
        (fixture, cx)
    }

    #[gpui::test]
    fn fills_field_shell_with_real_input_geometry(cx: &mut TestAppContext) {
        let (_, cx) = render(cx);
        assert_eq!(
            cx.debug_bounds("input-shell"),
            Some(Bounds::new(
                point(px(10.0), px(10.0)),
                size(px(200.0), px(28.0))
            ))
        );
        assert_eq!(
            cx.debug_bounds("test-input.root"),
            Some(Bounds::new(
                point(px(10.0), px(10.0)),
                size(px(200.0), px(28.0))
            ))
        );
    }

    #[gpui::test]
    fn pointer_focus_enables_native_input_and_emits_typed_change(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx);
        cx.simulate_click(point(px(30.0), px(24.0)), Modifiers::default());
        let input = fixture.read_with(cx, |fixture, _| fixture.input.clone());
        assert!(cx.update(|window, app| input.read(app).focus_handle.is_focused(window)));

        cx.simulate_input("hé");
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            "hé"
        );
        assert_eq!(
            fixture.read_with(cx, |fixture, _| fixture.changes.clone()),
            vec![SharedString::from("h"), SharedString::from("hé")]
        );
    }

    #[gpui::test]
    fn dynamic_value_and_placeholder_reconcile_without_change_output(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx);
        let input = fixture.read_with(cx, |fixture, _| fixture.input.clone());
        input.update(cx, |input, cx| {
            input.set_value("external 🦀", cx);
            input.set_placeholder("Updated placeholder", cx);
        });
        cx.run_until_parked();
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            "external 🦀"
        );
        assert_eq!(
            input.read_with(cx, |input, _| input.placeholder().to_string()),
            "Updated placeholder"
        );
        assert!(fixture.read_with(cx, |fixture, _| fixture.changes.is_empty()));
    }
    #[gpui::test]
    fn inputs_are_keyboard_tab_stops_in_document_order(cx: &mut TestAppContext) {
        struct Pair {
            first: Entity<TextInput>,
            second: Entity<TextInput>,
        }
        impl Render for Pair {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div()
                    .tab_group()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .child(div().size(px(200.0)).h(px(28.0)).child(self.first.clone()))
                    .child(div().size(px(200.0)).h(px(28.0)).child(self.second.clone()))
            }
        }
        cx.update(init);
        let (pair, cx) = cx.add_window_view(|_, cx| Pair {
            first: cx.new(|cx| TextInput::new("tab-input-1", "", "First", Theme::light(), cx)),
            second: cx.new(|cx| TextInput::new("tab-input-2", "", "Second", Theme::light(), cx)),
        });
        cx.simulate_resize(size(px(240.0), px(100.0)));
        cx.run_until_parked();
        let first_bounds = cx.debug_bounds("tab-input-1.root").unwrap();
        cx.simulate_click(first_bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, app| {
            pair.read(app)
                .second
                .read(app)
                .focus_handle(app)
                .is_focused(window)
        }));
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, app| {
            pair.read(app)
                .first
                .read(app)
                .focus_handle(app)
                .is_focused(window)
        }));
    }

    #[test]
    fn grapheme_boundaries_keep_combining_marks_and_emoji_sequences_atomic() {
        let text = "a\u{301}👨‍👩‍👧‍👦👍🏽z";
        let boundaries: Vec<_> = text
            .grapheme_indices(true)
            .map(|(index, _)| index)
            .chain(std::iter::once(text.len()))
            .collect();

        assert_eq!(
            previous_grapheme_boundary(text, boundaries[1]),
            boundaries[0]
        );
        assert_eq!(next_grapheme_boundary(text, boundaries[0]), boundaries[1]);
        assert_eq!(next_grapheme_boundary(text, boundaries[1]), boundaries[2]);
        assert_eq!(
            previous_grapheme_boundary(text, boundaries[3]),
            boundaries[2]
        );
        assert_eq!(
            grapheme_boundary_at_or_before(text, boundaries[2] - 1),
            boundaries[1]
        );
    }

    #[gpui::test]
    fn keyboard_editing_moves_and_deletes_whole_graphemes(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx);
        let input = fixture.read_with(cx, |fixture, _| fixture.input.clone());
        input.update(cx, |input, cx| {
            input.set_value("a\u{301}👨‍👩‍👧‍👦z", cx);
        });
        cx.run_until_parked();
        let bounds = cx.debug_bounds("test-input.root").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());

        cx.simulate_keystrokes("home right right backspace");
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            "a\u{301}z"
        );
        cx.simulate_keystrokes("home delete");
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            "z"
        );
    }

    #[gpui::test]
    fn long_text_scrolls_caret_and_ime_bounds_into_the_viewport(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx);
        let input = fixture.read_with(cx, |fixture, _| fixture.input.clone());
        let value = "A very long single-line value with an IME composition at the end 世界";
        input.update(cx, |input, cx| input.set_value(value, cx));
        cx.run_until_parked();

        let (field_bounds, scroll, cursor_utf16) = input.read_with(cx, |input, _| {
            (
                input.last_bounds.unwrap(),
                input.horizontal_scroll,
                input.offset_to_utf16(input.cursor_offset()),
            )
        });
        assert!(scroll > px(0.0));

        let ime_bounds = cx.update(|window, app| {
            input.update(app, |input, cx| {
                input
                    .bounds_for_range(cursor_utf16..cursor_utf16, field_bounds, window, cx)
                    .unwrap()
            })
        });
        assert!(ime_bounds.left() >= field_bounds.left());
        assert!(ime_bounds.right() <= field_bounds.right());
    }

    #[gpui::test]
    fn pointer_drag_scrolls_and_selects_toward_hidden_text_end(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx);
        let input = fixture.read_with(cx, |fixture, _| fixture.input.clone());
        let value = (0..40).map(|_| "abcdefghij").collect::<String>();
        input.update(cx, |input, cx| input.set_value(value, cx));
        cx.run_until_parked();
        let bounds = cx.debug_bounds("test-input.root").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("home");
        cx.run_until_parked();

        let start = point(bounds.left() + px(32.0), bounds.center().y);
        let outside_right = point(bounds.right() + px(20.0), bounds.center().y);
        cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::default());
        cx.run_until_parked();
        cx.simulate_mouse_move(outside_right, MouseButton::Left, Modifiers::default());
        cx.run_until_parked();
        let initially_selected_end = input.read_with(cx, |input, _| input.selected_range.end);
        for _ in 0..16 {
            cx.executor().advance_clock(DRAG_SCROLL_INTERVAL);
            cx.run_until_parked();
        }

        let (selection, reversed, scroll) = input.read_with(cx, |input, _| {
            (
                input.selected_range.clone(),
                input.selection_reversed,
                input.horizontal_scroll,
            )
        });
        assert!(selection.end > initially_selected_end);
        assert!(!reversed);
        assert!(scroll > px(0.0));

        cx.simulate_mouse_up(outside_right, MouseButton::Left, Modifiers::default());
        assert!(!input.read_with(cx, |input, _| input.is_selecting));
        cx.executor().advance_clock(DRAG_SCROLL_INTERVAL * 2);
        cx.run_until_parked();
        assert_eq!(
            input.read_with(cx, |input, _| input.selected_range.clone()),
            selection
        );
    }

    #[gpui::test]
    fn pointer_drag_scrolls_and_selects_toward_hidden_text_start(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx);
        let input = fixture.read_with(cx, |fixture, _| fixture.input.clone());
        let value = (0..40).map(|_| "abcdefghij").collect::<String>();
        input.update(cx, |input, cx| input.set_value(value, cx));
        cx.run_until_parked();
        let bounds = cx.debug_bounds("test-input.root").unwrap();
        let initial_scroll = input.read_with(cx, |input, _| input.horizontal_scroll);
        assert!(initial_scroll > px(0.0));

        let start = point(bounds.right() - px(32.0), bounds.center().y);
        let outside_left = point(bounds.left() - px(20.0), bounds.center().y);
        cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::default());
        cx.run_until_parked();
        cx.simulate_mouse_move(outside_left, MouseButton::Left, Modifiers::default());
        cx.run_until_parked();
        let initially_selected_start = input.read_with(cx, |input, _| input.selected_range.start);
        for _ in 0..16 {
            cx.executor().advance_clock(DRAG_SCROLL_INTERVAL);
            cx.run_until_parked();
        }

        let (selection, reversed, scroll) = input.read_with(cx, |input, _| {
            (
                input.selected_range.clone(),
                input.selection_reversed,
                input.horizontal_scroll,
            )
        });
        assert!(selection.start < initially_selected_start);
        assert!(reversed);
        assert!(scroll < initial_scroll);

        cx.simulate_mouse_up(outside_left, MouseButton::Left, Modifiers::default());
        assert!(!input.read_with(cx, |input, _| input.is_selecting));
        cx.executor().advance_clock(DRAG_SCROLL_INTERVAL * 2);
        cx.run_until_parked();
        assert_eq!(
            input.read_with(cx, |input, _| input.selected_range.clone()),
            selection
        );
    }

    #[gpui::test]
    fn no_op_native_replacements_update_selection_without_emitting_changed(
        cx: &mut TestAppContext,
    ) {
        let (fixture, cx) = render(cx);
        let input = fixture.read_with(cx, |fixture, _| fixture.input.clone());
        input.update(cx, |input, cx| input.set_value("same", cx));
        cx.run_until_parked();
        cx.update(|window, app| {
            input.update(app, |input, cx| {
                let end = input.offset_to_utf16(input.value.len());
                input.selected_range = input.value.len()..input.value.len();
                input.replace_text_in_range(Some(end..end), "", window, cx);
                input.replace_text_in_range(Some(0..end), "same", window, cx);
            })
        });
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            "same"
        );
        assert!(fixture.read_with(cx, |fixture, _| fixture.changes.is_empty()));
    }
}
