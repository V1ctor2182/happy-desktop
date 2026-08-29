//! Variable-height, bottom-aligned native chat transcript.
//!
//! `ChatTranscriptState` is caller-owned view state. It contains only GPUI list
//! geometry and semantic reading position; transport and product state stay out.

use gpui::{
    AnyElement, App, Entity, FocusHandle, IntoElement, ListAlignment, ListOffset, ListState,
    MouseButton, RenderOnce, SharedString, Window, div, list, prelude::*, px,
};
use std::{cell::RefCell, rc::Rc};

use super::{
    chat_message::{
        ChatMessage, ChatMessageModel, DelegationRow, DelegationRowModel, NoticeRow,
        NoticeRowModel, ProcessRow, ProcessRowModel, QuestionRow, QuestionRowModel, StatusRow,
        StatusRowModel, message_height,
    },
    scrollbar::{Scrollbar, ScrollbarState},
    theme_roles::ThemeRole,
};
use crate::theme::Theme;

pub const CHAT_TRANSCRIPT_OVERDRAW: f32 = 240.0;
pub const CHAT_TRANSCRIPT_SAFE_GUTTER: f32 = 24.0;
pub const CHAT_TRANSCRIPT_SCROLLBAR_TRACK: f32 = 8.0;
pub const CHAT_TRANSCRIPT_SCROLLBAR_INK: f32 = 6.0;

#[derive(Clone)]
pub enum ChatTranscriptContent {
    Message(ChatMessageModel),
    Question(QuestionRowModel),
    Delegation {
        model: DelegationRowModel,
        on_open: Option<super::chat_message::ChatActivate>,
    },
    Process {
        model: ProcessRowModel,
        on_stop: Option<super::chat_message::ChatActivate>,
    },
    Status(StatusRowModel),
    Notice(NoticeRowModel),
}
#[derive(Clone)]
pub struct ChatTranscriptRow {
    pub id: SharedString,
    /// Increment when the row's measured content changes (streaming, disclosure, review).
    pub revision: u64,
    pub content: ChatTranscriptContent,
}
impl ChatTranscriptRow {
    pub fn estimated_height(&self, width: f32) -> f32 {
        match &self.content {
            ChatTranscriptContent::Message(model) => message_height(model, width),
            ChatTranscriptContent::Question(model) => {
                80.0 + model
                    .questions
                    .iter()
                    .map(|q| 30.0 + q.options.len() as f32 * 34.0)
                    .sum::<f32>()
            }
            ChatTranscriptContent::Delegation { .. }
            | ChatTranscriptContent::Process { .. }
            | ChatTranscriptContent::Status(_) => 36.0,
            ChatTranscriptContent::Notice(model) => {
                if model.title.is_some() {
                    52.0
                } else {
                    36.0
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum TranscriptAnchor {
    Following,
    Parked {
        row_id: SharedString,
        offset_in_row: f32,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ChatTranscriptEvent {
    AnchorChanged(TranscriptAnchor),
    StartReached,
}

pub type ChatTranscriptEventHandler = Rc<dyn Fn(ChatTranscriptEvent, &mut Window, &mut App)>;
struct TranscriptMemory {
    rows: Vec<(SharedString, u64)>,
    anchor: TranscriptAnchor,
    visible: std::ops::Range<usize>,
    anchor_needs_layout: bool,
    anchor_changed: bool,
    start_reported: bool,
    pending_events: Vec<ChatTranscriptEvent>,
    dispatch_scheduled: bool,
}

#[derive(Clone)]
pub struct ChatTranscriptState {
    list: ListState,
    memory: Rc<RefCell<TranscriptMemory>>,
    event_handler: Rc<RefCell<Option<ChatTranscriptEventHandler>>>,
}
impl ChatTranscriptState {
    pub fn new(rows: &[ChatTranscriptRow]) -> Self {
        let list = ListState::new(
            rows.len(),
            ListAlignment::Bottom,
            px(CHAT_TRANSCRIPT_OVERDRAW),
        );
        let memory = Rc::new(RefCell::new(TranscriptMemory {
            rows: keys(rows),
            anchor: TranscriptAnchor::Following,
            visible: rows.len()..rows.len(),
            anchor_needs_layout: false,
            anchor_changed: false,
            start_reported: false,
            pending_events: Vec::new(),
            dispatch_scheduled: false,
        }));
        let event_handler: Rc<RefCell<Option<ChatTranscriptEventHandler>>> =
            Rc::new(RefCell::new(None));
        let observed = memory.clone();
        let dispatch_list = list.clone();
        let dispatch_handler = event_handler.clone();
        list.set_scroll_handler(move |event, window, cx| {
            let mut memory = observed.borrow_mut();
            memory.visible = event.visible_range.clone();
            if event.is_scrolled {
                // GPUI's event reports the semantic range but not its fractional
                // ListOffset. The coalesced deferred input dispatch captures exact
                // laid-out bounds instead of rounding to the row edge.
                memory.anchor_needs_layout = true;
            } else {
                if memory.anchor != TranscriptAnchor::Following {
                    memory.anchor = TranscriptAnchor::Following;
                    memory.anchor_changed = true;
                }
                memory.anchor_needs_layout = false;
            }
            if event.visible_range.start > 0 {
                memory.start_reported = false;
            }
            let schedule = !memory.dispatch_scheduled;
            if schedule {
                memory.dispatch_scheduled = true;
            }
            drop(memory);
            if schedule {
                let list = dispatch_list.clone();
                let memory = observed.clone();
                let handler = dispatch_handler.clone();
                window.defer(cx, move |window, cx| {
                    capture_layout_events(&list, &memory);
                    memory.borrow_mut().dispatch_scheduled = false;
                    dispatch_events(&memory, &handler, window, cx);
                });
            }
        });
        Self {
            list,
            memory,
            event_handler,
        }
    }
    pub fn list_state(&self) -> ListState {
        self.list.clone()
    }
    pub fn set_event_handler(&self, handler: Option<ChatTranscriptEventHandler>) {
        *self.event_handler.borrow_mut() = handler;
    }
    pub fn anchor(&self) -> TranscriptAnchor {
        self.memory.borrow().anchor.clone()
    }
    pub fn visible_range(&self) -> std::ops::Range<usize> {
        self.memory.borrow().visible.clone()
    }
    pub fn is_following(&self) -> bool {
        self.anchor() == TranscriptAnchor::Following
    }
    pub fn park_at(&self, row_id: impl Into<SharedString>, offset_in_row: f32) {
        let id = row_id.into();
        let index = self
            .memory
            .borrow()
            .rows
            .iter()
            .position(|(candidate, _)| candidate == &id)
            .unwrap_or(0);
        self.list.scroll_to(ListOffset {
            item_ix: index,
            offset_in_item: px(offset_in_row.max(0.0)),
        });
        self.memory.borrow_mut().anchor = TranscriptAnchor::Parked {
            row_id: id,
            offset_in_row: offset_in_row.max(0.0),
        };
    }
    pub fn follow(&self) {
        self.list.scroll_to(ListOffset {
            item_ix: self.list.item_count(),
            offset_in_item: px(0.0),
        });
        self.memory.borrow_mut().anchor = TranscriptAnchor::Following;
    }
    /// Reconcile append, prepend, streaming revision, and replacement without losing the semantic row anchor.
    pub fn reconcile(&self, rows: &[ChatTranscriptRow]) {
        let new = keys(rows);
        let (old, anchor) = {
            let m = self.memory.borrow();
            (m.rows.clone(), m.anchor.clone())
        };
        if old == new {
            return;
        }
        let mut prefix = 0;
        while prefix < old.len() && prefix < new.len() && old[prefix] == new[prefix] {
            prefix += 1;
        }
        let mut suffix = 0;
        while suffix < old.len() - prefix
            && suffix < new.len() - prefix
            && old[old.len() - 1 - suffix] == new[new.len() - 1 - suffix]
        {
            suffix += 1;
        }
        self.list
            .splice(prefix..old.len() - suffix, new.len() - prefix - suffix);
        {
            let mut m = self.memory.borrow_mut();
            m.rows = new.clone();
            m.visible = 0..0;
        }
        if let TranscriptAnchor::Parked {
            row_id,
            offset_in_row,
        } = anchor
        {
            if let Some(index) = new.iter().position(|(id, _)| id == &row_id) {
                self.list.scroll_to(ListOffset {
                    item_ix: index,
                    offset_in_item: px(offset_in_row),
                });
                self.memory.borrow_mut().anchor = TranscriptAnchor::Parked {
                    row_id,
                    offset_in_row,
                };
            } else {
                self.follow();
            }
        }
    }
    /// Reapply the semantic anchor during a composer or viewport resize. This is
    /// synchronous, so there is no correction frame after surrounding chrome changes.
    pub fn composer_resized(&self) {
        match self.anchor() {
            TranscriptAnchor::Following => self.follow(),
            TranscriptAnchor::Parked {
                row_id,
                offset_in_row,
            } => self.park_at(row_id, offset_in_row),
        }
    }
    /// Captures fractional layout-derived reading position and pagination state.
    /// Call this from an input/deferred controller step after GPUI has laid out the
    /// list. It never invokes product callbacks and rendering never calls it.
    pub fn capture_layout_events(&self) {
        capture_layout_events(&self.list, &self.memory);
    }

    /// Dispatches already-captured events through the typed handler. Callers may
    /// use this with `capture_layout_events` for non-scroll layout changes.
    pub fn dispatch_events(&self, window: &mut Window, cx: &mut App) {
        dispatch_events(&self.memory, &self.event_handler, window, cx);
    }

    /// Drains typed outputs for the product controller to observe outside render.
    pub fn take_events(&self) -> Vec<ChatTranscriptEvent> {
        std::mem::take(&mut self.memory.borrow_mut().pending_events)
    }
}
fn capture_layout_events(list: &ListState, memory: &Rc<RefCell<TranscriptMemory>>) {
    let (needs_layout, start) = {
        let memory = memory.borrow();
        (memory.anchor_needs_layout, memory.visible.start)
    };
    if needs_layout {
        let viewport = list.viewport_bounds();
        if let Some(bounds) = list.bounds_for_item(start) {
            let offset = f32::from((viewport.top() - bounds.top()).max(px(0.0)));
            let mut memory = memory.borrow_mut();
            if let Some((row_id, _)) = memory.rows.get(start).cloned() {
                memory.anchor = TranscriptAnchor::Parked {
                    row_id,
                    offset_in_row: offset,
                };
                memory.anchor_needs_layout = false;
                memory.anchor_changed = true;
            }
        }
    }
    let at_start = list.item_count() > 0 && list.bounds_for_item(0).is_some();
    let mut memory = memory.borrow_mut();
    if memory.anchor_changed && !memory.anchor_needs_layout {
        memory.anchor_changed = false;
        let anchor = memory.anchor.clone();
        memory
            .pending_events
            .push(ChatTranscriptEvent::AnchorChanged(anchor));
    }
    if !at_start {
        memory.start_reported = false;
    } else if !memory.start_reported {
        memory.start_reported = true;
        memory
            .pending_events
            .push(ChatTranscriptEvent::StartReached);
    }
}

fn dispatch_events(
    memory: &Rc<RefCell<TranscriptMemory>>,
    handler: &Rc<RefCell<Option<ChatTranscriptEventHandler>>>,
    window: &mut Window,
    cx: &mut App,
) {
    let events = std::mem::take(&mut memory.borrow_mut().pending_events);
    if let Some(handler) = handler.borrow().as_ref() {
        for event in events {
            handler(event, window, cx);
        }
    }
}

fn keys(rows: &[ChatTranscriptRow]) -> Vec<(SharedString, u64)> {
    rows.iter()
        .map(|row| (row.id.clone(), row.revision))
        .collect()
}

#[derive(IntoElement)]
pub struct ChatTranscript {
    pub id: SharedString,
    pub theme: Theme,
    pub state: ChatTranscriptState,
    pub scrollbar: Entity<ScrollbarState>,
    pub rows: Rc<Vec<ChatTranscriptRow>>,
    pub focus: Option<FocusHandle>,
}
impl RenderOnce for ChatTranscript {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let rows = self.rows.clone();
        let state = self.state.clone();
        let list_state = state.list_state();
        let wheel_bar = self.scrollbar.clone();
        let hover_bar = self.scrollbar.clone();
        let move_bar = self.scrollbar.clone();
        let up_bar = self.scrollbar.clone();
        let up_out_bar = self.scrollbar.clone();
        let painted_bar = self.scrollbar.clone();
        div()
            .debug_selector({
                let id = id.clone();
                move || format!("{id}.root")
            })
            .relative()
            .size_full()
            .min_w_0()
            .min_h_0()
            .m_0()
            .p_0()
            .bg(theme.role(ThemeRole::Surface))
            .on_mouse_move(move |event, _, cx| {
                move_bar.update(cx, |bar, cx| bar.pointer_move(event, cx));
            })
            .on_mouse_up(MouseButton::Left, move |event, _, cx| {
                up_bar.update(cx, |bar, cx| bar.pointer_up(event, cx));
            })
            .on_mouse_up_out(MouseButton::Left, move |event, _, cx| {
                up_out_bar.update(cx, |bar, cx| bar.pointer_up(event, cx));
            })
            .when(self.focus.is_some(), |v| v.tab_index(0))
            .when_some(self.focus, |v, focus| {
                v.track_focus(&focus.tab_index(0).tab_stop(true))
            })
            .child(
                div()
                    .id(SharedString::from(format!("{id}-viewport")))
                    .debug_selector({
                        let id = id.clone();
                        move || format!("{id}.viewport")
                    })
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
                            render_row(rows[index].clone(), theme)
                        })
                        .size_full()
                        .m_0()
                        .p_0(),
                    ),
            )
            .child(Scrollbar::new(
                format!("{id}.scrollbar"),
                painted_bar,
                theme.role(ThemeRole::HappyScrollbarQuietColor).into(),
            ))
    }
}
fn render_row(row: ChatTranscriptRow, theme: Theme) -> AnyElement {
    let stable = row.id.clone();
    div()
        .id(stable.clone())
        .debug_selector(move || format!("transcript-row-{stable}"))
        .w_full()
        .child(match row.content {
            ChatTranscriptContent::Message(model) => {
                ChatMessage { theme, model }.into_any_element()
            }
            ChatTranscriptContent::Question(model) => {
                QuestionRow { theme, model }.into_any_element()
            }
            ChatTranscriptContent::Delegation { model, on_open } => DelegationRow {
                theme,
                model,
                on_open,
            }
            .into_any_element(),
            ChatTranscriptContent::Process { model, on_stop } => ProcessRow {
                theme,
                model,
                on_stop,
            }
            .into_any_element(),
            ChatTranscriptContent::Status(model) => StatusRow { theme, model }.into_any_element(),
            ChatTranscriptContent::Notice(model) => NoticeRow { theme, model }.into_any_element(),
        })
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(id: &str, revision: u64) -> ChatTranscriptRow {
        ChatTranscriptRow {
            id: id.to_owned().into(),
            revision,
            content: ChatTranscriptContent::Status(StatusRowModel {
                id: id.to_owned().into(),
                label: id.to_owned().into(),
                detail: None,
                tone: super::super::chat_message::SemanticTone::Neutral,
            }),
        }
    }
    #[test]
    fn prepend_and_stream_keep_parked_semantic_anchor_exact() {
        let state = ChatTranscriptState::new(&[row("b", 0), row("c", 0)]);
        state.park_at("b", 7.0);
        state.reconcile(&[row("a", 0), row("b", 0), row("c", 1)]);
        assert_eq!(
            state.anchor(),
            TranscriptAnchor::Parked {
                row_id: "b".into(),
                offset_in_row: 7.0
            }
        );
        let offset = state.list.logical_scroll_top();
        assert_eq!(offset.item_ix, 1);
        assert_eq!(offset.offset_in_item, px(7.0));
    }
    #[test]
    fn following_survives_append_and_parked_never_follows() {
        let state = ChatTranscriptState::new(&[row("a", 0)]);
        state.reconcile(&[row("a", 0), row("b", 0)]);
        assert!(state.is_following());
        state.park_at("a", 0.0);
        state.reconcile(&[row("a", 0), row("b", 0), row("c", 0)]);
        assert_eq!(
            state.anchor(),
            TranscriptAnchor::Parked {
                row_id: "a".into(),
                offset_in_row: 0.0
            }
        );
    }
    #[test]
    fn thousand_rows_are_registered_without_measure_all() {
        let rows = (0..1000)
            .map(|i| row(&format!("r{i}"), 0))
            .collect::<Vec<_>>();
        let state = ChatTranscriptState::new(&rows);
        assert_eq!(state.list.item_count(), 1000);
        assert_eq!(state.visible_range(), 1000..1000);
    }
    #[test]
    fn modeled_heights_cover_both_required_widths() {
        let narrow = row("x", 0).estimated_height(220.0);
        let wide = row("x", 0).estimated_height(560.0);
        assert_eq!(narrow, wide);
    }

    #[gpui::test]
    fn gpui_list_virtualizes_one_thousand_variable_rows_to_viewport_and_overdraw(
        cx: &mut gpui::TestAppContext,
    ) {
        use gpui::{Context, Render, TestAppContext as _, size};
        use std::collections::HashSet;
        struct Fixture {
            state: ListState,
            rendered: Rc<RefCell<HashSet<usize>>>,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let rendered = self.rendered.clone();
                list(self.state.clone(), move |index, _, _| {
                    rendered.borrow_mut().insert(index);
                    div()
                        .h(px(28.0 + (index % 3) as f32 * 8.0))
                        .w_full()
                        .into_any_element()
                })
                .size_full()
            }
        }
        let rendered = Rc::new(RefCell::new(HashSet::new()));
        let seen = rendered.clone();
        let (_, cx) = cx.add_window_view(move |_, _| Fixture {
            state: ListState::new(1_000, ListAlignment::Bottom, px(CHAT_TRANSCRIPT_OVERDRAW)),
            rendered: seen,
        });
        cx.simulate_resize(size(px(560.0), px(300.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        assert!(
            rendered.borrow().len() < 40,
            "rendered {} of 1000 rows",
            rendered.borrow().len()
        );
    }

    #[gpui::test]
    fn transcript_is_full_bleed_zero_padding_and_keyboard_focusable_in_both_themes(
        cx: &mut gpui::TestAppContext,
    ) {
        use gpui::{Context, Render, TestAppContext as _, size};
        struct Fixture {
            transcript: ChatTranscriptState,
            scrollbar: Entity<ScrollbarState>,
            focus: FocusHandle,
            rows: Rc<Vec<ChatTranscriptRow>>,
            theme: Theme,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                ChatTranscript {
                    id: "tested-transcript".into(),
                    theme: self.theme,
                    state: self.transcript.clone(),
                    scrollbar: self.scrollbar.clone(),
                    rows: self.rows.clone(),
                    focus: Some(self.focus.clone()),
                }
            }
        }
        for theme in [Theme::light(), Theme::dark()] {
            let rows = Rc::new(
                (0..1000)
                    .map(|index| row(&format!("r{index}"), 0))
                    .collect::<Vec<_>>(),
            );
            let transcript = ChatTranscriptState::new(&rows);
            let owned = transcript.clone();
            let (view, cx) = cx.add_window_view(move |_, cx| Fixture {
                transcript: transcript.clone(),
                scrollbar: cx.new(|_| {
                    ScrollbarState::vertical_list(
                        super::super::scrollbar::ScrollbarAppearance::Automatic,
                        super::super::scrollbar::ScrollbarPlacement::Overlay,
                        transcript.list_state(),
                    )
                }),
                focus: cx.focus_handle(),
                rows,
                theme,
            });
            cx.simulate_resize(size(px(220.0), px(160.0)));
            cx.run_until_parked();
            let root = cx.debug_bounds("tested-transcript.root").unwrap();
            let viewport = cx.debug_bounds("tested-transcript.viewport").unwrap();
            assert_eq!(root, viewport, "full-bleed viewport has no spacing");
            assert_eq!(root.size, size(px(220.0), px(160.0)));
            cx.update(|window, app| view.read(app).focus.focus(window));
            assert!(cx.update(|window, app| view.read(app).focus.is_focused(window)));
            assert_eq!(owned.list_state().item_count(), 1000);
            assert!(cx.debug_bounds("transcript-row-r999").is_some());
            assert!(cx.debug_bounds("transcript-row-r0").is_none());
            assert_eq!(
                cx.debug_bounds("tested-transcript.scrollbar.track")
                    .unwrap()
                    .size
                    .width,
                px(CHAT_TRANSCRIPT_SCROLLBAR_TRACK)
            );
        }
    }

    #[gpui::test]
    fn rendered_fractional_anchor_survives_prepend_revision_resize_and_following_append(
        cx: &mut gpui::TestAppContext,
    ) {
        use gpui::{Context, Render, size};
        struct Fixture {
            transcript: ChatTranscriptState,
            scrollbar: Entity<ScrollbarState>,
            rows: Rc<Vec<ChatTranscriptRow>>,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                ChatTranscript {
                    id: "anchor-transcript".into(),
                    theme: Theme::light(),
                    state: self.transcript.clone(),
                    scrollbar: self.scrollbar.clone(),
                    rows: self.rows.clone(),
                    focus: None,
                }
            }
        }
        fn notice(id: &str, tall: bool, revision: u64) -> ChatTranscriptRow {
            ChatTranscriptRow {
                id: id.to_owned().into(),
                revision,
                content: ChatTranscriptContent::Notice(NoticeRowModel {
                    id: id.to_owned().into(),
                    title: tall.then(|| format!("title-{id}").into()),
                    text: format!("body-{id}").into(),
                    tone: super::super::chat_message::SemanticTone::Neutral,
                }),
            }
        }
        let initial = Rc::new(vec![
            notice("a", true, 0),
            notice("b", false, 0),
            notice("c", true, 0),
            notice("d", false, 0),
            notice("e", true, 0),
            notice("f", false, 0),
        ]);
        let transcript = ChatTranscriptState::new(&initial);
        let owned = transcript.clone();
        let (view, cx) = cx.add_window_view(move |_, cx| Fixture {
            transcript: transcript.clone(),
            scrollbar: cx.new(|_| {
                ScrollbarState::vertical_list(
                    super::super::scrollbar::ScrollbarAppearance::Automatic,
                    super::super::scrollbar::ScrollbarPlacement::Overlay,
                    transcript.list_state(),
                )
            }),
            rows: initial,
        });
        cx.simulate_resize(size(px(560.0), px(120.0)));
        cx.run_until_parked();
        // Park only after the lazy variable-height list has real measurements,
        // matching a user scroll rather than an unmeasured restore fixture.
        owned.park_at("c", 7.25);
        view.update(cx, |_, cx| cx.notify());
        cx.run_until_parked();
        let viewport = cx.debug_bounds("anchor-transcript.viewport").unwrap();
        let before = cx.debug_bounds("transcript-row-c").unwrap().top() - viewport.top();

        let prepended = Rc::new(vec![
            notice("new", true, 0),
            notice("a", true, 0),
            notice("b", false, 0),
            notice("c", true, 1),
            notice("d", false, 0),
            notice("e", true, 0),
            notice("f", false, 0),
        ]);
        owned.reconcile(&prepended);
        view.update(cx, |fixture, cx| {
            fixture.rows = prepended;
            cx.notify();
        });
        cx.run_until_parked();
        let after = cx.debug_bounds("transcript-row-c").unwrap().top()
            - cx.debug_bounds("anchor-transcript.viewport").unwrap().top();
        assert_eq!(
            after, before,
            "fractional parked offset changed after prepend/revision"
        );

        cx.simulate_resize(size(px(560.0), px(128.0)));
        owned.composer_resized();
        cx.run_until_parked();
        let resized = cx.debug_bounds("transcript-row-c").unwrap().top()
            - cx.debug_bounds("anchor-transcript.viewport").unwrap().top();
        assert_eq!(
            resized, before,
            "composer resize introduced a correction frame"
        );

        owned.follow();
        let appended = Rc::new(vec![
            notice("new", true, 0),
            notice("a", true, 0),
            notice("b", false, 0),
            notice("c", true, 1),
            notice("d", false, 0),
            notice("e", true, 0),
            notice("f", false, 0),
            notice("last", true, 0),
        ]);
        owned.reconcile(&appended);
        view.update(cx, |fixture, cx| {
            fixture.rows = appended;
            cx.notify();
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("transcript-row-last").unwrap().bottom(),
            cx.debug_bounds("anchor-transcript.viewport")
                .unwrap()
                .bottom(),
            "following must stay pixel-pinned in the append frame",
        );
    }
}
