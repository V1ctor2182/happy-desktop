use gpui::{
    AnyElement, App, CursorStyle, Entity, FocusHandle, Focusable, FontWeight, IntoElement,
    RenderOnce, SharedString, Window, div, prelude::*, px, relative,
};

use super::{
    components::ScrollSurface,
    composer_controls::ComposerHandler,
    icon::{Icon, IconName},
    scrollbar::ScrollbarState,
    text_area::TextArea,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

fn selector(id: SharedString, part: &'static str) -> impl Fn() -> String {
    move || format!("{id}.{part}")
}

fn reveal_horizontal(handle: &gpui::ScrollHandle, left: f32, right: f32) -> bool {
    let viewport_width = f32::from(handle.bounds().size.width);
    let visible_left = f32::from(-handle.offset().x);
    let next_left = if left < visible_left {
        left
    } else if right > visible_left + viewport_width {
        (right - viewport_width).max(0.0)
    } else {
        return false;
    };
    handle.set_offset(gpui::point(px(-next_left), handle.offset().y));
    true
}

/// Failed-submit status shown above a composer. Retry is controlled by the caller.
#[derive(IntoElement)]
pub struct ComposerFailureBanner {
    pub id: SharedString,
    pub theme: Theme,
    pub message: SharedString,
    pub retry_disabled: bool,
    pub on_retry: Option<ComposerHandler>,
}
impl RenderOnce for ComposerFailureBanner {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id;
        let retry = self.on_retry;
        let active = !self.retry_disabled && retry.is_some();
        div()
            .debug_selector(selector(id.clone(), "root"))
            .w_full()
            .min_h(px(40.0))
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(12.0))
            .rounded(px(8.0))
            .border_1()
            .border_color(self.theme.role(ThemeRole::BoxErrorBorder))
            .bg(self.theme.role(ThemeRole::BoxErrorBackground))
            .font_family(fonts::UI_FAMILY)
            .text_size(px(12.0))
            .text_color(self.theme.role(ThemeRole::BoxErrorText))
            .child(Icon::decorative(
                IconName::Alert,
                16.0,
                self.theme.role(ThemeRole::BoxErrorText).into(),
                format!("{id}.icon"),
            ))
            .child(div().flex_1().min_w_0().child(self.message))
            .child(
                div()
                    .id(SharedString::from(format!("{id}-retry")))
                    .debug_selector(selector(id.clone(), "retry"))
                    .h(px(28.0))
                    .flex()
                    .items_center()
                    .px(px(9.0))
                    .rounded(px(6.0))
                    .border_1()
                    .border_color(self.theme.role(ThemeRole::BoxErrorBorder))
                    .font_weight(FontWeight::SEMIBOLD)
                    .opacity(if self.retry_disabled { 0.48 } else { 1.0 })
                    .when(active, |v| {
                        let key_retry = retry.clone();
                        v.tab_index(0)
                            .cursor(CursorStyle::PointingHand)
                            .focus(|style| style.border_color(self.theme.role(ThemeRole::TextLink)))
                            .on_click(move |_, w, cx| {
                                if let Some(h) = &retry {
                                    h(w, cx)
                                }
                            })
                            .on_key_down(move |event, w, cx| {
                                if !event.is_held
                                    && matches!(
                                        event.keystroke.key.as_str(),
                                        "enter" | "space" | " "
                                    )
                                {
                                    cx.stop_propagation();
                                    if let Some(h) = &key_retry {
                                        h(w, cx)
                                    }
                                }
                            })
                    })
                    .child("Retry"),
            )
    }
}

pub struct ComposerToolbarFocusTarget {
    handle: FocusHandle,
    left: f32,
    right: f32,
}
impl ComposerToolbarFocusTarget {
    pub fn new(handle: FocusHandle, left: f32, right: f32) -> Self {
        assert!(
            left.is_finite() && right.is_finite() && left >= 0.0 && right > left,
            "composer toolbar focus span must be finite and nonempty"
        );
        Self {
            handle,
            left,
            right,
        }
    }
}

pub struct ComposerToolbarItem {
    width: f32,
    focus_targets: Vec<ComposerToolbarFocusTarget>,
    element: AnyElement,
}
impl ComposerToolbarItem {
    pub fn new(
        width: f32,
        focus_targets: Vec<ComposerToolbarFocusTarget>,
        element: AnyElement,
    ) -> Self {
        assert!(
            width.is_finite() && (28.0..=512.0).contains(&width),
            "ComposerToolbarItem width must be finite and within 28..=512px"
        );
        assert!(
            focus_targets.iter().all(|target| target.right <= width),
            "composer toolbar focus spans must stay inside the declared item width"
        );
        Self {
            width,
            focus_targets,
            element,
        }
    }
}

/// Props-only composer card. The stable TextArea entity is owned by the caller.
///
/// Escape first closes the controlled picker, then aborts a run without changing
/// the draft. The caller-owned TextArea command handler must bridge editor Tab
/// entry because TextArea consumes its focus actions before raw key capture.
/// Submission can be disabled independently from editing, so an offline draft
/// remains editable.
#[derive(IntoElement)]
pub struct ComposerCard {
    pub id: SharedString,
    pub theme: Theme,
    pub text_area: Entity<TextArea>,
    pub disabled: bool,
    pub pending: bool,
    pub submit_disabled: bool,
    pub send_enabled: bool,
    pub running: bool,
    pub picker_open: bool,
    pub attachment_previews: Option<AnyElement>,
    pub leading_controls: Vec<ComposerToolbarItem>,
    pub trailing_controls: Vec<ComposerToolbarItem>,
    /// Caller-owned horizontal state for the nonshrinking control lane.
    pub toolbar_scrollbar: Entity<ScrollbarState>,
    pub submit_focus: FocusHandle,
    pub picker: Option<AnyElement>,
    pub on_picker_previous: Option<ComposerHandler>,
    pub on_picker_next: Option<ComposerHandler>,
    pub on_picker_commit: Option<ComposerHandler>,
    pub on_picker_dismiss: Option<ComposerHandler>,
    pub on_send: Option<ComposerHandler>,
    pub on_abort: Option<ComposerHandler>,
}
impl RenderOnce for ComposerCard {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let theme = self.theme;
        let text_focus = self.text_area.read(cx).focus_handle(cx);
        let can_send = !self.disabled
            && !self.pending
            && !self.submit_disabled
            && self.send_enabled
            && !self.picker_open
            && self.on_send.is_some();
        let stop_shown = self.running
            && self.on_abort.is_some()
            && (!self.send_enabled || self.disabled || self.pending || self.submit_disabled);
        let key_picker_previous = self.on_picker_previous.clone();
        let key_picker_next = self.on_picker_next.clone();
        let key_picker_commit = self.on_picker_commit.clone();
        let key_picker_dismiss = self.on_picker_dismiss.clone();
        let key_abort = self.on_abort.clone();
        let key_send = self.on_send.clone();
        let focus_for_key = text_focus.clone();
        let button_handler: Option<ComposerHandler> = if stop_shown {
            self.on_abort.clone()
        } else {
            self.on_send.clone()
        };
        let button_active = if stop_shown {
            !self.disabled && button_handler.is_some()
        } else {
            can_send
        };
        let keyboard_button_handler = button_handler.clone();
        let keyboard_focus_after = text_focus.clone();
        let focus_after_click = text_focus.clone();
        let control_count = self.leading_controls.len() + self.trailing_controls.len();
        let mut toolbar_x = 0.0;
        let mut toolbar_focus_targets = Vec::new();
        for item in self
            .leading_controls
            .iter()
            .chain(self.trailing_controls.iter())
        {
            for target in &item.focus_targets {
                toolbar_focus_targets.push((
                    target.handle.clone(),
                    toolbar_x + target.left,
                    toolbar_x + target.right,
                ));
            }
            toolbar_x += item.width + 8.0;
        }
        let toolbar_content_width = if control_count == 0 {
            0.0
        } else {
            toolbar_x - 8.0
        };
        let toolbar_scroll_handle = self.toolbar_scrollbar.read(cx).scroll_handle().clone();
        let toolbar_focus_for_root = toolbar_focus_targets.clone();
        let toolbar_scroll_for_root = toolbar_scroll_handle.clone();
        let text_focus_for_tab = text_focus.clone();
        let submit_focus_for_tab = self.submit_focus.clone();
        let toolbar_controls = self
            .leading_controls
            .into_iter()
            .chain(self.trailing_controls)
            .map(|item| {
                div()
                    .w(px(item.width))
                    .h(px(28.0))
                    .flex_none()
                    .overflow_hidden()
                    .child(item.element)
            })
            .collect::<Vec<_>>();
        div()
            .debug_selector(selector(id.clone(), "root"))
            .relative()
            .w_full()
            .flex()
            .flex_col()
            .border_1()
            .border_color(theme.role(ThemeRole::Divider))
            .rounded(px(16.0))
            .bg(theme.role(ThemeRole::InputBackground))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .capture_key_down(move |event, window, cx| {
                if event.is_held || event.keystroke.key.as_str() != "tab" {
                    return;
                }
                let Some(current) = window.focused(cx) else {
                    return;
                };
                let shift = event.keystroke.modifiers.shift;
                let mut direct_focus = None;
                let target = if current == text_focus_for_tab && !shift {
                    (!toolbar_focus_for_root.is_empty()).then_some(0)
                } else if current == submit_focus_for_tab && shift {
                    toolbar_focus_for_root.len().checked_sub(1)
                } else if let Some(index) = toolbar_focus_for_root
                    .iter()
                    .position(|(focus, _, _)| focus == &current)
                {
                    if shift {
                        if index == 0 {
                            direct_focus = Some(text_focus_for_tab.clone());
                            None
                        } else {
                            Some(index - 1)
                        }
                    } else if index + 1 < toolbar_focus_for_root.len() {
                        Some(index + 1)
                    } else {
                        if button_active {
                            direct_focus = Some(submit_focus_for_tab.clone());
                        }
                        None
                    }
                } else {
                    None
                };
                if let Some(target) = target {
                    let (focus, left, right) = &toolbar_focus_for_root[target];
                    if reveal_horizontal(&toolbar_scroll_for_root, *left, *right) {
                        window.refresh();
                    }
                    focus.focus(window);
                    cx.stop_propagation();
                } else if let Some(focus) = direct_focus {
                    focus.focus(window);
                    cx.stop_propagation();
                }
            })
            .on_key_down(move |event, w, cx| {
                if event.is_held {
                    return;
                }
                let key = event.keystroke.key.as_str();
                if self.picker_open {
                    let picker_handler = match key {
                        "up" => key_picker_previous.as_ref(),
                        "down" => key_picker_next.as_ref(),
                        "enter" if !event.keystroke.modifiers.shift => key_picker_commit.as_ref(),
                        "escape" => key_picker_dismiss.as_ref(),
                        _ => return,
                    };
                    cx.stop_propagation();
                    if let Some(handler) = picker_handler {
                        handler(w, cx);
                    }
                } else if key == "escape" && self.running {
                    if let Some(h) = &key_abort {
                        cx.stop_propagation();
                        h(w, cx)
                    }
                } else if key == "enter" && !event.keystroke.modifiers.shift && can_send {
                    if let Some(h) = &key_send {
                        cx.stop_propagation();
                        h(w, cx);
                        w.focus(&focus_for_key)
                    }
                }
            })
            .children(self.attachment_previews.map(|attachments| {
                div()
                    .debug_selector(selector(id.clone(), "attachments"))
                    .w_full()
                    .pt(px(12.0))
                    .px(px(15.0))
                    .child(attachments)
            }))
            .child(
                div()
                    .debug_selector(selector(id.clone(), "input"))
                    .w_full()
                    .pt(px(20.0))
                    .px(px(18.0))
                    .pb(px(24.0))
                    .child(self.text_area),
            )
            .children(self.picker.map(|picker| {
                div()
                    .debug_selector(selector(id.clone(), "picker"))
                    .absolute()
                    .left(px(-1.0))
                    .right(px(-1.0))
                    .bottom(relative(1.0))
                    .mb(px(9.0))
                    .child(picker)
            }))
            .child(
                div()
                    .debug_selector(selector(id.clone(), "toolbar"))
                    .w_full()
                    .h(px(40.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(15.0))
                    .child(
                        div().h(px(36.0)).min_w_0().flex_1().child(ScrollSurface {
                            id: format!("{id}-toolbar-scroll").into(),
                            theme,
                            width: None,
                            height: Some(36.0),
                            vertical: None,
                            horizontal: Some(self.toolbar_scrollbar),
                            content: div()
                                .debug_selector(selector(id.clone(), "toolbar-content"))
                                .w(px(toolbar_content_width))
                                .h(px(28.0))
                                .flex_none()
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .children(toolbar_controls)
                                .into_any_element(),
                        }),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("{id}-submit")))
                            .debug_selector(selector(id.clone(), "submit"))
                            .size(px(32.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .bg(if button_active {
                                theme.role(ThemeRole::ButtonPrimaryBackground)
                            } else {
                                theme.role(ThemeRole::ButtonPrimaryDisabled)
                            })
                            .text_color(theme.role(ThemeRole::ButtonPrimaryTint))
                            .opacity(if button_active { 1.0 } else { 0.56 })
                            .track_focus(&self.submit_focus.tab_index(0).tab_stop(button_active))
                            .when(button_active, |v| {
                                v.cursor(CursorStyle::PointingHand)
                                    .focus(|style| {
                                        style
                                            .border_1()
                                            .border_color(theme.role(ThemeRole::TextLink))
                                    })
                                    .on_click(move |_, w, cx| {
                                        if let Some(h) = &button_handler {
                                            h(w, cx);
                                            w.focus(&focus_after_click)
                                        }
                                    })
                                    .on_key_down(move |event, w, cx| {
                                        if !event.is_held
                                            && matches!(
                                                event.keystroke.key.as_str(),
                                                "enter" | "space" | " "
                                            )
                                        {
                                            cx.stop_propagation();
                                            if let Some(h) = &keyboard_button_handler {
                                                h(w, cx);
                                                w.focus(&keyboard_focus_after)
                                            }
                                        }
                                    })
                            })
                            .child(Icon::labelled(
                                if stop_shown {
                                    IconName::Stop
                                } else {
                                    IconName::ArrowUp
                                },
                                if stop_shown {
                                    "Stop the agent"
                                } else {
                                    "Send message"
                                },
                                if stop_shown { 11.0 } else { 16.0 },
                                theme.role(ThemeRole::ButtonPrimaryTint).into(),
                                format!("{id}.submit-icon"),
                            )),
                    ),
            )
    }
}

/// The reusable conversation write dock. It keeps one 880px measure, an optional
/// failure/agent row, a 28px footer, and 40px clear of the bottom window edge.
#[derive(IntoElement)]
pub struct ComposerDock {
    pub id: SharedString,
    pub theme: Theme,
    pub above: Option<AnyElement>,
    pub failure: Option<ComposerFailureBanner>,
    pub composer: ComposerCard,
    pub footer: Option<AnyElement>,
}
impl RenderOnce for ComposerDock {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id;
        div()
            .debug_selector(selector(id.clone(), "root"))
            .w_full()
            .flex()
            .justify_center()
            .px(px(16.0))
            .pb(px(40.0))
            .child(
                div()
                    .debug_selector(selector(id.clone(), "measure"))
                    .w_full()
                    .max_w(px(880.0))
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .children(self.above)
                    .children(self.failure)
                    .child(self.composer)
                    .children(self.footer.map(|footer| {
                        div()
                            .debug_selector(selector(id, "footer"))
                            .w_full()
                            .h(px(28.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .px(px(16.0))
                            .child(footer)
                    })),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        Context, Entity, Modifiers, Render, ScrollDelta, ScrollWheelEvent, TestAppContext,
        VisualTestContext, point, size,
    };
    use std::{cell::Cell, rc::Rc};

    fn toolbar_item(width: f32, element: AnyElement) -> ComposerToolbarItem {
        ComposerToolbarItem::new(width, Vec::new(), element)
    }
    fn toolbar_item_with_focus(
        width: f32,
        spans: Vec<(FocusHandle, f32, f32)>,
        element: AnyElement,
    ) -> ComposerToolbarItem {
        ComposerToolbarItem::new(
            width,
            spans
                .into_iter()
                .map(|(handle, left, right)| ComposerToolbarFocusTarget::new(handle, left, right))
                .collect(),
            element,
        )
    }

    struct Fixture {
        area: Entity<TextArea>,
        running: bool,
        picker: bool,
        failed: bool,
        dark: bool,
        aborts: Rc<Cell<usize>>,
        picker_previous: Rc<Cell<usize>>,
        picker_next: Rc<Cell<usize>>,
        picker_commits: Rc<Cell<usize>>,
        picker_dismisses: Rc<Cell<usize>>,
        picker_focus: FocusHandle,
        toolbar_scrollbar: Entity<ScrollbarState>,
        submit_focus: FocusHandle,
        sends: Rc<Cell<usize>>,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let theme = if self.dark {
                Theme::dark()
            } else {
                Theme::light()
            };
            let aborts = self.aborts.clone();
            let picker_previous = self.picker_previous.clone();
            let picker_next = self.picker_next.clone();
            let picker_commits = self.picker_commits.clone();
            let picker_dismisses = self.picker_dismisses.clone();
            let sends = self.sends.clone();
            let picker_focus = self.picker_focus.clone();
            let card = ComposerCard {
                id: "card".into(),
                theme,
                text_area: self.area.clone(),
                disabled: false,
                pending: false,
                submit_disabled: false,
                send_enabled: !self.area.read(cx).value().trim().is_empty(),
                running: self.running,
                picker_open: self.picker,
                attachment_previews: None,
                leading_controls: vec![],
                trailing_controls: vec![],
                toolbar_scrollbar: self.toolbar_scrollbar.clone(),
                submit_focus: self.submit_focus.clone(),
                picker: self.picker.then(|| {
                    div()
                        .h(px(32.0))
                        .track_focus(&picker_focus.tab_index(0).tab_stop(true))
                        .child("picker")
                        .into_any_element()
                }),
                on_picker_previous: Some(Rc::new(move |_, _| {
                    picker_previous.set(picker_previous.get() + 1)
                })),
                on_picker_next: Some(Rc::new(move |_, _| picker_next.set(picker_next.get() + 1))),
                on_picker_commit: Some(Rc::new(move |_, _| {
                    picker_commits.set(picker_commits.get() + 1)
                })),
                on_picker_dismiss: Some(Rc::new(move |_, _| {
                    picker_dismisses.set(picker_dismisses.get() + 1)
                })),
                on_send: Some(Rc::new(move |_, _| sends.set(sends.get() + 1))),
                on_abort: Some(Rc::new(move |_, _| aborts.set(aborts.get() + 1))),
            };
            div().size_full().flex().items_end().child(ComposerDock {
                id: "dock".into(),
                theme,
                above: None,
                failure: self.failed.then(|| ComposerFailureBanner {
                    id: "failure".into(),
                    theme,
                    message: "Could not send".into(),
                    retry_disabled: false,
                    on_retry: Some(Rc::new(|_, _| {})),
                }),
                composer: card,
                footer: Some(div().child("Audience unavailable").into_any_element()),
            })
        }
    }
    fn render<'a>(
        cx: &'a mut TestAppContext,
        window_size: gpui::Size<gpui::Pixels>,
        value: &str,
    ) -> (Entity<Fixture>, &'a mut VisualTestContext) {
        cx.update(super::super::text_area::init);
        let value = value.to_string();
        let (fixture, cx) = cx.add_window_view(move |_, cx| {
            let area =
                cx.new(|cx| TextArea::new("draft", value, "Write a message", Theme::light(), cx));
            Fixture {
                area,
                running: false,
                picker: false,
                failed: true,
                dark: false,
                aborts: Rc::new(Cell::new(0)),
                picker_previous: Rc::new(Cell::new(0)),
                picker_next: Rc::new(Cell::new(0)),
                picker_commits: Rc::new(Cell::new(0)),
                picker_dismisses: Rc::new(Cell::new(0)),
                picker_focus: cx.focus_handle(),
                toolbar_scrollbar: cx.new(|_| {
                    ScrollbarState::horizontal(
                        super::super::scrollbar::ScrollbarAppearance::Automatic,
                        super::super::scrollbar::ScrollbarPlacement::Overlay,
                        super::super::scrollbar::SharedScrollHandle::new(),
                    )
                }),
                submit_focus: cx.focus_handle(),
                sends: Rc::new(Cell::new(0)),
            }
        });
        cx.simulate_resize(window_size);
        cx.run_until_parked();
        assert_eq!(cx.update(|w, _| w.scale_factor()), 2.0);
        (fixture, cx)
    }
    #[gpui::test]
    fn dock_card_failure_footer_and_focus_have_real_reference_layout(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, size(px(1280.0), px(800.0)), "one line");
        assert_eq!(
            cx.debug_bounds("dock.measure").unwrap().size.width,
            px(880.0)
        );
        assert_eq!(
            cx.debug_bounds("card.toolbar").unwrap().size.height,
            px(40.0)
        );
        assert_eq!(
            cx.debug_bounds("card.submit").unwrap().size,
            size(px(32.0), px(32.0))
        );
        assert_eq!(
            cx.debug_bounds("dock.footer").unwrap().size.height,
            px(28.0)
        );
        assert!(cx.debug_bounds("failure.root").unwrap().size.height >= px(40.0));
        let card = cx.debug_bounds("card.root").unwrap();
        let draft = cx.debug_bounds("draft.root").unwrap();
        assert_eq!(draft.origin.x - card.origin.x, px(19.0));
        cx.simulate_click(draft.center(), Modifiers::default());
        let area = fixture.read_with(cx, |v, _| v.area.clone());
        assert!(cx.update(|w, app| area.read(app).focus_handle(app).is_focused(w)));
        fixture.update(cx, |v, cx| {
            v.failed = false;
            cx.notify()
        });
        cx.run_until_parked();
        assert!(cx.update(|w, app| area.read(app).focus_handle(app).is_focused(w)));

        cx.simulate_resize(size(px(720.0), px(480.0)));
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("dock.measure").unwrap().size.width,
            px(688.0)
        );
        let dock = cx.debug_bounds("dock.root").unwrap();
        let measure = cx.debug_bounds("dock.measure").unwrap();
        assert_eq!(dock.bottom() - measure.bottom(), px(40.0));
    }
    #[gpui::test]
    fn one_eight_overflow_lines_and_escape_abort_preserve_stable_area(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, size(px(720.0), px(480.0)), "one");
        let area = fixture.read_with(cx, |v, _| v.area.clone());
        assert_eq!(cx.debug_bounds("draft.root").unwrap().size.height, px(22.0));
        area.update(cx, |area, cx| {
            area.set_value(
                (0..8)
                    .map(|i| format!("line {i}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                cx,
            )
        });
        fixture.update(cx, |_, cx| cx.notify());
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("draft.root").unwrap().size.height,
            px(176.0)
        );
        area.update(cx, |area, cx| {
            area.set_value(
                (0..12)
                    .map(|i| format!("overflow {i}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                cx,
            )
        });
        fixture.update(cx, |_, cx| cx.notify());
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("draft.root").unwrap().size.height,
            px(176.0)
        );
        fixture.update(cx, |v, cx| {
            v.running = true;
            cx.notify()
        });
        cx.run_until_parked();
        let draft = cx.debug_bounds("draft.root").unwrap();
        cx.simulate_click(draft.center(), Modifiers::default());
        cx.simulate_keystrokes("escape");
        assert_eq!(fixture.read_with(cx, |v, _| v.aborts.get()), 1);
        assert!(area.read_with(cx, |a, _| a.value().contains("overflow 11")));
    }

    #[gpui::test]
    fn picker_control_focus_routes_card_callbacks_and_tab_transfers_from_editor(
        cx: &mut TestAppContext,
    ) {
        let (fixture, cx) = render(cx, size(px(720.0), px(480.0)), "query");
        fixture.update(cx, |fixture, cx| {
            fixture.picker = true;
            cx.notify();
        });
        cx.run_until_parked();
        let (area, picker_focus) = fixture.read_with(cx, |fixture, _| {
            (fixture.area.clone(), fixture.picker_focus.clone())
        });
        let editor_focus = area.read_with(cx, |area, cx| area.focus_handle(cx));

        cx.update(|window, _| window.focus(&picker_focus));
        cx.simulate_keystrokes("up down enter escape");
        assert_eq!(
            fixture.read_with(cx, |fixture, _| (
                fixture.picker_previous.get(),
                fixture.picker_next.get(),
                fixture.picker_commits.get(),
                fixture.picker_dismisses.get(),
            )),
            (1, 1, 1, 1),
        );
        assert_eq!(fixture.read_with(cx, |fixture, _| fixture.sends.get()), 0);
        assert!(cx.update(|window, _| picker_focus.is_focused(window)));
        assert_eq!(area.read_with(cx, |area, _| area.value().clone()), "query");

        cx.update(|window, _| window.focus(&editor_focus));
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, _| picker_focus.is_focused(window)));
        assert_eq!(
            fixture.read_with(cx, |fixture, _| (
                fixture.picker_previous.get(),
                fixture.picker_next.get(),
                fixture.picker_commits.get(),
                fixture.picker_dismisses.get(),
            )),
            (1, 1, 1, 1),
            "Tab transfers focus instead of fabricating picker navigation",
        );
    }

    struct CombinedControlsFixture {
        area: Entity<TextArea>,
        width: f32,
        dark: bool,
        toolbar_scrollbar: Entity<ScrollbarState>,
        submit_focus: FocusHandle,
        toolbar_focus: Vec<FocusHandle>,
    }
    impl Render for CombinedControlsFixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            use super::super::composer_controls::{
                COMPACT_CONTROL_WIDTH, CONTEXT_METER_WIDTH, ContextMeter,
                MODEL_EFFORT_CONTROL_WIDTH, ModelEffortControl, PermissionControl, TierControl,
            };
            let theme = if self.dark {
                Theme::dark()
            } else {
                Theme::light()
            };
            div().w(px(self.width)).child(ComposerCard {
                id: "combined-card".into(),
                theme,
                text_area: self.area.clone(),
                disabled: false,
                pending: false,
                submit_disabled: false,
                send_enabled: true,
                running: false,
                picker_open: false,
                attachment_previews: None,
                leading_controls: vec![
                    toolbar_item_with_focus(
                        MODEL_EFFORT_CONTROL_WIDTH,
                        vec![
                            (self.toolbar_focus[0].clone(), 0.0, 104.0),
                            (self.toolbar_focus[1].clone(), 108.0, 212.0),
                        ],
                        ModelEffortControl {
                            id: "combined-model-effort".into(),
                            theme,
                            model: "Claude".into(),
                            effort: "High".into(),
                            disabled: false,
                            model_focus: self.toolbar_focus[0].clone(),
                            effort_focus: self.toolbar_focus[1].clone(),
                            on_model: Some(Rc::new(|_, _| {})),
                            on_effort: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                    toolbar_item_with_focus(
                        COMPACT_CONTROL_WIDTH,
                        vec![(self.toolbar_focus[2].clone(), 0.0, 104.0)],
                        PermissionControl {
                            id: "combined-permission".into(),
                            theme,
                            label: "Accept edits".into(),
                            disabled: false,
                            focus_handle: self.toolbar_focus[2].clone(),
                            on_activate: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                    toolbar_item_with_focus(
                        COMPACT_CONTROL_WIDTH,
                        vec![(self.toolbar_focus[3].clone(), 0.0, 104.0)],
                        TierControl {
                            id: "combined-tier".into(),
                            theme,
                            label: "Pro".into(),
                            disabled: false,
                            focus_handle: self.toolbar_focus[3].clone(),
                            on_activate: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                ],
                trailing_controls: vec![toolbar_item(
                    CONTEXT_METER_WIDTH,
                    ContextMeter {
                        id: "combined-context".into(),
                        theme,
                        used: 80,
                        limit: 100,
                        label: "80% context".into(),
                    }
                    .into_any_element(),
                )],
                toolbar_scrollbar: self.toolbar_scrollbar.clone(),
                submit_focus: self.submit_focus.clone(),
                picker: None,
                on_picker_previous: None,
                on_picker_next: None,
                on_picker_commit: None,
                on_picker_dismiss: None,
                on_send: Some(Rc::new(|_, _| {})),
                on_abort: None,
            })
        }
    }

    struct NarrowCombinedDockFixture {
        area: Entity<TextArea>,
        attachment_horizontal_scrollbar: Entity<super::super::scrollbar::ScrollbarState>,
        attachment_vertical_scrollbar: Entity<super::super::scrollbar::ScrollbarState>,
        toolbar_scrollbar: Entity<ScrollbarState>,
        submit_focus: FocusHandle,
        toolbar_focus: Vec<FocusHandle>,
        attachment_focus: Vec<(FocusHandle, FocusHandle, FocusHandle)>,
    }
    impl Render for NarrowCombinedDockFixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            use super::super::composer_controls::{
                AUDIENCE_UNAVAILABLE_WIDTH, AttachmentKind, AttachmentPreviewItem,
                AttachmentPreviews, AudienceControl, COMPACT_CONTROL_WIDTH, CONTEXT_METER_WIDTH,
                ContextMeter, MODEL_EFFORT_CONTROL_WIDTH, ModelEffortControl, PermissionControl,
                TierControl, compact_control,
            };
            let theme = Theme::dark();
            let card = ComposerCard {
                id: "narrow-card".into(),
                theme,
                text_area: self.area.clone(),
                disabled: false,
                pending: false,
                submit_disabled: false,
                send_enabled: true,
                running: false,
                picker_open: false,
                attachment_previews: Some(AttachmentPreviews {
                    id: "narrow-attachments".into(),
                    theme,
                    items: (0..32)
                        .map(|index| AttachmentPreviewItem {
                            id: format!("{index}").into(),
                            name: format!("attachment-{index}.png").into(),
                            kind: AttachmentKind::Image,
                            image: None,
                            error: (index == 0).then(|| {
                                "Maximum length upload failure remains available through the bounded two-axis preview lane. "
                                    .repeat(32)
                                    .into()
                            }),
                            open_focus: self.attachment_focus[index].0.clone(),
                            remove_focus: self.attachment_focus[index].1.clone(),
                            retry_focus: self.attachment_focus[index].2.clone(),
                        })
                        .collect(),
                    disabled: false,
                    horizontal_scrollbar: self.attachment_horizontal_scrollbar.clone(),
                    vertical_scrollbar: self.attachment_vertical_scrollbar.clone(),
                    on_open: Some(Rc::new(|_, _, _| {})),
                    on_remove: Some(Rc::new(|_, _, _| {})),
                    on_retry: Some(Rc::new(|_, _, _| {})),
                }.into_any_element()),
                leading_controls: vec![
                    toolbar_item_with_focus(
                        COMPACT_CONTROL_WIDTH,
                        vec![(self.toolbar_focus[0].clone(), 0.0, 104.0)],
                        compact_control(
                            "narrow-attach".into(),
                            theme,
                            "Attach".into(),
                            false,
                            Some(Rc::new(|_, _| {})),
                            self.toolbar_focus[0].clone(),
                            Some(IconName::Paperclip),
                        ),
                    ),
                    toolbar_item_with_focus(
                        MODEL_EFFORT_CONTROL_WIDTH,
                        vec![
                            (self.toolbar_focus[1].clone(), 0.0, 104.0),
                            (self.toolbar_focus[2].clone(), 108.0, 212.0),
                        ],
                        ModelEffortControl {
                            id: "narrow-model-effort".into(),
                            theme,
                            model: "Claude".into(),
                            effort: "High".into(),
                            disabled: false,
                            model_focus: self.toolbar_focus[1].clone(),
                            effort_focus: self.toolbar_focus[2].clone(),
                            on_model: Some(Rc::new(|_, _| {})),
                            on_effort: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                    toolbar_item_with_focus(
                        COMPACT_CONTROL_WIDTH,
                        vec![(self.toolbar_focus[3].clone(), 0.0, 104.0)],
                        PermissionControl {
                            id: "narrow-permission".into(),
                            theme,
                            label: "Accept edits".into(),
                            disabled: false,
                            focus_handle: self.toolbar_focus[3].clone(),
                            on_activate: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                    toolbar_item_with_focus(
                        COMPACT_CONTROL_WIDTH,
                        vec![(self.toolbar_focus[4].clone(), 0.0, 104.0)],
                        TierControl {
                            id: "narrow-tier".into(),
                            theme,
                            label: "Pro".into(),
                            disabled: false,
                            focus_handle: self.toolbar_focus[4].clone(),
                            on_activate: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                    toolbar_item(
                        AUDIENCE_UNAVAILABLE_WIDTH,
                        AudienceControl {
                            id: "narrow-audience".into(),
                            theme,
                            label: "Audience".into(),
                            protocol_available: false,
                            disabled: false,
                            focus_handle: self.toolbar_focus[5].clone(),
                            on_activate: None,
                        }
                        .into_any_element(),
                    ),
                    toolbar_item_with_focus(
                        COMPACT_CONTROL_WIDTH,
                        vec![(self.toolbar_focus[6].clone(), 0.0, 104.0)],
                        compact_control(
                            "narrow-emoji".into(),
                            theme,
                            "Emoji".into(),
                            false,
                            Some(Rc::new(|_, _| {})),
                            self.toolbar_focus[6].clone(),
                            Some(IconName::Smile),
                        ),
                    ),
                ],
                trailing_controls: vec![toolbar_item(
                    CONTEXT_METER_WIDTH,
                    ContextMeter {
                        id: "narrow-context".into(),
                        theme,
                        used: 80,
                        limit: 100,
                        label: "80% context".into(),
                    }
                    .into_any_element(),
                )],
                toolbar_scrollbar: self.toolbar_scrollbar.clone(),
                submit_focus: self.submit_focus.clone(),
                picker: None,
                on_picker_previous: None,
                on_picker_next: None,
                on_picker_commit: None,
                on_picker_dismiss: None,
                on_send: Some(Rc::new(|_, _| {})),
                on_abort: None,
            };
            div().w(px(220.0)).child(ComposerDock {
                id: "narrow-dock".into(),
                theme,
                above: None,
                failure: None,
                composer: card,
                footer: None,
            })
        }
    }

    #[gpui::test]
    fn real_220_main_composes_every_control_inside_the_188_card_without_overlap(
        cx: &mut TestAppContext,
    ) {
        cx.update(super::super::text_area::init);
        let (fixture, cx) = cx.add_window_view(|_, cx| {
            let handle = super::super::scrollbar::SharedScrollHandle::new();
            let horizontal_handle = handle.clone();
            let toolbar_scrollbar = cx.new(|_| {
                ScrollbarState::horizontal(
                    super::super::scrollbar::ScrollbarAppearance::Automatic,
                    super::super::scrollbar::ScrollbarPlacement::Overlay,
                    super::super::scrollbar::SharedScrollHandle::new(),
                )
            });
            let toolbar_handle = toolbar_scrollbar.read(cx).scroll_handle().clone();
            let toolbar_focus: Vec<_> = (0..7).map(|_| cx.focus_handle()).collect();
            let first_toolbar_focus = toolbar_focus[0].clone();
            let area = cx.new(|cx| {
                TextArea::new(
                    "narrow-draft",
                    "line 1
line 2
line 3
line 4
line 5
line 6
line 7
line 8",
                    "Write a message",
                    Theme::dark(),
                    cx,
                )
            });
            area.update(cx, |area, _| {
                area.set_command_handler(Some(Rc::new(move |command, window, _| {
                    if command != super::super::text_area::TextAreaCommand::FocusNext {
                        return false;
                    }
                    toolbar_handle.set_offset(point(px(0.0), toolbar_handle.offset().y));
                    window.refresh();
                    first_toolbar_focus.focus(window);
                    true
                })));
            });
            NarrowCombinedDockFixture {
                area,
                attachment_horizontal_scrollbar: cx.new(|_| {
                    super::super::scrollbar::ScrollbarState::horizontal(
                        super::super::scrollbar::ScrollbarAppearance::Always,
                        super::super::scrollbar::ScrollbarPlacement::Overlay,
                        horizontal_handle,
                    )
                }),
                attachment_vertical_scrollbar: cx.new(|_| {
                    super::super::scrollbar::ScrollbarState::vertical(
                        super::super::scrollbar::ScrollbarAppearance::Always,
                        super::super::scrollbar::ScrollbarPlacement::Overlay,
                        handle,
                    )
                }),
                toolbar_scrollbar,
                submit_focus: cx.focus_handle(),
                toolbar_focus,
                attachment_focus: (0..32)
                    .map(|_| (cx.focus_handle(), cx.focus_handle(), cx.focus_handle()))
                    .collect(),
            }
        });
        cx.simulate_resize(size(px(720.0), px(480.0)));
        cx.run_until_parked();
        let card = cx.debug_bounds("narrow-card.root").unwrap();
        assert_eq!(card.size.width, px(188.0));
        let toolbar = cx.debug_bounds("narrow-card.toolbar").unwrap();
        let attachments = cx.debug_bounds("narrow-attachments.root").unwrap();
        assert!(
            card.size.height <= px(352.0),
            "minimum-window card with eight editor lines must fit below 56px header + 32px tabs: card={card:?}, attachments={attachments:?}, toolbar={toolbar:?}"
        );
        let dock = cx.debug_bounds("narrow-dock.root").unwrap();
        assert!(dock.size.height <= px(480.0));
        assert!(dock.bottom() <= px(480.0));
        assert_eq!(
            cx.debug_bounds("narrow-attachments.root").unwrap().size,
            size(px(156.0), px(64.0))
        );
        assert_eq!(
            cx.debug_bounds("narrow-draft.root").unwrap().size.height,
            px(176.0)
        );
        let toolbar_content = cx.debug_bounds("narrow-card.toolbar-content").unwrap();
        let toolbar_viewport = cx
            .debug_bounds("narrow-card-toolbar-scroll.viewport")
            .unwrap();
        assert_eq!(toolbar_content.size, size(px(1_012.0), px(28.0)));
        let selectors = [
            "narrow-attach.root",
            "narrow-model-effort-model.root",
            "narrow-model-effort-effort.root",
            "narrow-permission.root",
            "narrow-tier.root",
            "narrow-audience.root",
            "narrow-audience.explanation",
            "narrow-context.root",
            "narrow-emoji.root",
        ];
        let controls: Vec<_> = selectors
            .iter()
            .map(|selector| cx.debug_bounds(selector).unwrap())
            .collect();
        for (index, control) in controls.iter().enumerate() {
            assert_eq!(control.size.height, px(28.0));
            for other in &controls[index + 1..] {
                assert!(
                    !rectangles_overlap(*control, *other),
                    "220px main controls overlap: {control:?} and {other:?}"
                );
            }
        }
        let submit = cx.debug_bounds("narrow-card.submit").unwrap();
        assert!(submit.origin.x >= card.origin.x && submit.right() <= card.right());
        assert!(toolbar_viewport.right() <= submit.origin.x);
        let toolbar_handle = fixture.read_with(cx, |fixture, app| {
            fixture.toolbar_scrollbar.read(app).scroll_handle().clone()
        });
        let toolbar_maximum = toolbar_handle.max_offset().width;
        assert!(toolbar_maximum > px(0.0));
        let (
            editor_focus,
            first_toolbar_focus,
            model_focus,
            effort_focus,
            last_toolbar_focus,
            submit_focus,
        ) = fixture.read_with(cx, |fixture, app| {
            (
                fixture.area.read(app).focus_handle(app),
                fixture.toolbar_focus[0].clone(),
                fixture.toolbar_focus[1].clone(),
                fixture.toolbar_focus[2].clone(),
                fixture.toolbar_focus[6].clone(),
                fixture.submit_focus.clone(),
            )
        });
        toolbar_handle.set_offset(point(-toolbar_maximum, px(0.0)));
        cx.update(|window, _| window.focus(&editor_focus));
        cx.simulate_keystrokes("tab");
        cx.run_until_parked();
        assert!(cx.update(|window, _| first_toolbar_focus.is_focused(window)));
        let first_control = cx.debug_bounds("narrow-attach.root").unwrap();
        assert!(
            first_control.origin.x >= toolbar_viewport.origin.x
                && first_control.right() <= toolbar_viewport.right(),
            "editor Tab must reveal first toolbar control: first={first_control:?}, viewport={toolbar_viewport:?}, offset={:?}",
            toolbar_handle.offset(),
        );

        toolbar_handle.set_offset(point(-toolbar_maximum, px(0.0)));
        cx.update(|window, _| window.focus(&first_toolbar_focus));
        cx.simulate_keystrokes("tab");
        cx.run_until_parked();
        assert!(cx.update(|window, _| model_focus.is_focused(window)));
        let model_control = cx.debug_bounds("narrow-model-effort-model.root").unwrap();
        assert!(model_control.origin.x >= toolbar_viewport.origin.x);
        assert!(model_control.right() <= toolbar_viewport.right());

        cx.simulate_keystrokes("tab");
        cx.run_until_parked();
        assert!(cx.update(|window, _| effort_focus.is_focused(window)));
        let effort_control = cx.debug_bounds("narrow-model-effort-effort.root").unwrap();
        assert!(effort_control.origin.x >= toolbar_viewport.origin.x);
        assert!(effort_control.right() <= toolbar_viewport.right());

        toolbar_handle.set_offset(point(px(0.0), px(0.0)));
        cx.update(|window, _| window.focus(&submit_focus));
        cx.simulate_keystrokes("shift-tab");
        cx.run_until_parked();
        assert!(cx.update(|window, _| last_toolbar_focus.is_focused(window)));
        let last_focusable = cx.debug_bounds("narrow-emoji.root").unwrap();
        assert!(last_focusable.origin.x >= toolbar_viewport.origin.x);
        assert!(last_focusable.right() <= toolbar_viewport.right());

        cx.simulate_event(ScrollWheelEvent {
            position: toolbar_viewport.center(),
            delta: ScrollDelta::Pixels(point(-toolbar_maximum, px(0.0))),
            ..Default::default()
        });
        cx.run_until_parked();
        let last_control = cx.debug_bounds("narrow-context.root").unwrap();
        assert!(
            last_control.origin.x >= toolbar_viewport.origin.x
                && last_control.right() <= toolbar_viewport.right(),
            "the final atomic control must fully enter the viewport: last={last_control:?}, viewport={toolbar_viewport:?}, maximum={toolbar_maximum:?}, offset={:?}",
            toolbar_handle.offset(),
        );
    }

    fn rectangles_overlap(a: gpui::Bounds<gpui::Pixels>, b: gpui::Bounds<gpui::Pixels>) -> bool {
        a.origin.x < b.right()
            && a.right() > b.origin.x
            && a.origin.y < b.bottom()
            && a.bottom() > b.origin.y
    }

    #[gpui::test]
    fn combined_controls_wrap_without_overlap_at_220_560_and_880(cx: &mut TestAppContext) {
        cx.update(super::super::text_area::init);
        let (fixture, cx) = cx.add_window_view(|_, cx| CombinedControlsFixture {
            area: cx.new(|cx| {
                TextArea::new(
                    "combined-draft",
                    "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8",
                    "Write a message",
                    Theme::light(),
                    cx,
                )
            }),
            width: 220.0,
            dark: false,
            toolbar_scrollbar: cx.new(|_| {
                ScrollbarState::horizontal(
                    super::super::scrollbar::ScrollbarAppearance::Automatic,
                    super::super::scrollbar::ScrollbarPlacement::Overlay,
                    super::super::scrollbar::SharedScrollHandle::new(),
                )
            }),
            submit_focus: cx.focus_handle(),
            toolbar_focus: (0..4).map(|_| cx.focus_handle()).collect(),
        });
        cx.simulate_resize(size(px(900.0), px(600.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);

        for (width, dark) in [(220.0, false), (560.0, true), (880.0, false)] {
            fixture.update(cx, |fixture, cx| {
                fixture.width = width;
                fixture.dark = dark;
                cx.notify();
            });
            cx.run_until_parked();
            let card = cx.debug_bounds("combined-card.root").unwrap();
            let toolbar = cx.debug_bounds("combined-card.toolbar").unwrap();
            let toolbar_content = cx.debug_bounds("combined-card.toolbar-content").unwrap();
            let toolbar_viewport = cx
                .debug_bounds("combined-card-toolbar-scroll.viewport")
                .unwrap();
            assert_eq!(card.size.width, px(width));
            assert_eq!(toolbar.size.width, px(width - 2.0));
            assert_eq!(toolbar.size.height, px(40.0));
            let selectors = [
                "combined-model-effort-model.root",
                "combined-model-effort-effort.root",
                "combined-permission.root",
                "combined-tier.root",
                "combined-context.root",
            ];
            let controls: Vec<_> = selectors
                .iter()
                .map(|selector| cx.debug_bounds(selector).unwrap())
                .collect();
            assert_eq!(toolbar_content.size, size(px(556.0), px(28.0)));
            let submit = cx.debug_bounds("combined-card.submit").unwrap();
            assert!(toolbar_viewport.right() <= submit.origin.x);
            let toolbar_handle = fixture.read_with(cx, |fixture, app| {
                fixture.toolbar_scrollbar.read(app).scroll_handle().clone()
            });
            let maximum = toolbar_handle.max_offset().width;
            if width < 880.0 {
                assert_eq!(
                    maximum,
                    toolbar_content.size.width - toolbar_viewport.size.width
                );
                cx.simulate_event(ScrollWheelEvent {
                    position: toolbar_viewport.center(),
                    delta: ScrollDelta::Pixels(point(-maximum, px(0.0))),
                    ..Default::default()
                });
                cx.run_until_parked();
                let last = cx.debug_bounds("combined-context.root").unwrap();
                assert!(last.origin.x >= toolbar_viewport.origin.x);
                assert!(last.right() <= toolbar_viewport.right());
            } else {
                assert_eq!(maximum, px(0.0));
                for control in &controls {
                    assert!(control.origin.x >= toolbar_viewport.origin.x);
                    assert!(control.right() <= toolbar_viewport.right());
                }
            }
            for (index, control) in controls.iter().enumerate() {
                assert_eq!(control.size.height, px(28.0));
                for other in &controls[index + 1..] {
                    assert!(
                        !rectangles_overlap(*control, *other),
                        "combined controls overlap at {width}px: {control:?} and {other:?}"
                    );
                }
            }
        }
    }
}
