use std::{rc::Rc, sync::Arc};

use gpui::{
    AnyElement, App, CursorStyle, Entity, FocusHandle, FontWeight, Image, IntoElement, MouseButton,
    ObjectFit, RenderOnce, SharedString, Window, div, img, prelude::*, px, relative,
    transparent_black,
};

use super::{
    components::ScrollSurface,
    icon::{Icon, IconName},
    scrollbar::ScrollbarState,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub type ComposerHandler = Rc<dyn Fn(&mut Window, &mut App)>;
pub type IdHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type IndexHandler = Rc<dyn Fn(usize, &mut Window, &mut App)>;

pub const COMPACT_CONTROL_WIDTH: f32 = 104.0;
pub const MODEL_EFFORT_CONTROL_WIDTH: f32 = COMPACT_CONTROL_WIDTH * 2.0 + 4.0;
pub const AUDIENCE_UNAVAILABLE_WIDTH: f32 = COMPACT_CONTROL_WIDTH + 8.0 + 112.0;
pub const CONTEXT_METER_WIDTH: f32 = 112.0;

fn selector(id: SharedString, part: &'static str) -> impl Fn() -> String {
    move || format!("{id}.{part}")
}
fn named_selector(id: SharedString, part: SharedString) -> impl Fn() -> String {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttachmentKind {
    Image,
    Video,
    File,
}

#[derive(Clone, Debug)]
pub struct AttachmentPreviewItem {
    pub id: SharedString,
    pub name: SharedString,
    pub kind: AttachmentKind,
    pub image: Option<Arc<Image>>,
    /// Explicit caller-owned upload error. Its presence marks failure and exposes retry when handled.
    pub error: Option<SharedString>,
    pub open_focus: FocusHandle,
    pub remove_focus: FocusHandle,
    pub retry_focus: FocusHandle,
}

/// Ordered, inline draft media. Every item is exactly 56×56 and its remove target is 18×18.
#[derive(IntoElement)]
pub struct AttachmentPreviews {
    pub id: SharedString,
    pub theme: Theme,
    pub items: Vec<AttachmentPreviewItem>,
    pub disabled: bool,
    /// Caller-owned two-axis scroll states. Both must share one SharedScrollHandle identity.
    pub horizontal_scrollbar: Entity<ScrollbarState>,
    pub vertical_scrollbar: Entity<ScrollbarState>,
    pub on_open: Option<IdHandler>,
    pub on_remove: Option<IdHandler>,
    pub on_retry: Option<IdHandler>,
}

impl RenderOnce for AttachmentPreviews {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let disabled = self.disabled;
        let on_open = self.on_open;
        let on_remove = self.on_remove;
        let on_retry = self.on_retry;
        let content_width = self
            .items
            .iter()
            .map(|item| if item.error.is_some() { 304.0 } else { 56.0 })
            .sum::<f32>()
            + self.items.len().saturating_sub(1) as f32 * 8.0;
        let mut item_x = 0.0;
        let mut focus_targets = Vec::new();
        for item in &self.items {
            let right = item_x + 56.0;
            if item.error.is_none() && !disabled && on_open.is_some() {
                focus_targets.push((item.open_focus.clone(), item_x, right));
            }
            if !disabled && on_remove.is_some() {
                focus_targets.push((item.remove_focus.clone(), item_x, right));
            }
            if item.error.is_some() && !disabled && on_retry.is_some() {
                focus_targets.push((item.retry_focus.clone(), item_x, right));
            }
            item_x += if item.error.is_some() { 312.0 } else { 64.0 };
        }
        let horizontal_scrollbar = self.horizontal_scrollbar;
        let horizontal_handle = horizontal_scrollbar.read(cx).scroll_handle().clone();
        let vertical_scrollbar = self.vertical_scrollbar;
        let content_id = id.clone();
        let content = div()
            .debug_selector(selector(id.clone(), "content"))
            .w(px(content_width))
            .flex_none()
            .flex()
            .items_start()
            .gap(px(8.0))
            .children(self.items.into_iter().map(move |item| {
                let id = content_id.clone();
                let item_id = item.id.clone();
                let open = on_open.clone();
                let remove = on_remove.clone();
                let retry = on_retry.clone();
                let open_focus = item.open_focus.clone();
                let remove_focus = item.remove_focus.clone();
                let retry_focus = item.retry_focus.clone();
                let error = item.error.clone();
                let failed = error.is_some();
                let clickable = !failed && !disabled && open.is_some();
                let key_open = open.clone();
                let click_item_id = item_id.clone();
                let key_item_id = item_id.clone();
                let preview = div()
                    .id(SharedString::from(format!("{id}-item-{item_id}")))
                    .debug_selector(named_selector(id.clone(), format!("item-{item_id}").into()))
                    .relative()
                    .size(px(56.0))
                    .flex_none()
                    .overflow_hidden()
                    .rounded(px(8.0))
                    .border_1()
                    .border_color(theme.role(if failed {
                        ThemeRole::TextDestructive
                    } else {
                        ThemeRole::Divider
                    }))
                    .bg(theme.role(ThemeRole::SurfaceHigh))
                    .track_focus(&open_focus.tab_index(0).tab_stop(clickable))
                    .when(clickable, |v| {
                        v.cursor(CursorStyle::PointingHand)
                            .focus(|style| style.border_color(theme.role(ThemeRole::TextLink)))
                            .on_click(move |_, w, cx| {
                                if let Some(handler) = &open {
                                    handler(click_item_id.clone(), w, cx);
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
                                    if let Some(handler) = &key_open {
                                        handler(key_item_id.clone(), w, cx);
                                    }
                                }
                            })
                    })
                    .child(match item.image {
                        Some(image) if item.kind == AttachmentKind::Image => img(image)
                            .size_full()
                            .object_fit(ObjectFit::Cover)
                            .into_any_element(),
                        _ => div()
                            .size_full()
                            .flex()
                            .flex_col()
                            .items_center()
                            .justify_center()
                            .gap(px(2.0))
                            .child(Icon::decorative(
                                match item.kind {
                                    AttachmentKind::Image => IconName::Image,
                                    AttachmentKind::Video => IconName::Play,
                                    AttachmentKind::File => IconName::Doc,
                                },
                                20.0,
                                theme.role(ThemeRole::TextSecondary).into(),
                                format!("{id}.kind-{item_id}"),
                            ))
                            .child(
                                div()
                                    .w_full()
                                    .px(px(4.0))
                                    .truncate()
                                    .text_center()
                                    .font_family(fonts::UI_FAMILY)
                                    .text_size(px(9.0))
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(item.name.clone()),
                            )
                            .into_any_element(),
                    })
                    .when(!disabled && remove.is_some(), |v| {
                        let remove_id = item.id.clone();
                        let key_remove_id = item.id.clone();
                        let key_remove = remove.clone();
                        v.child(
                            div()
                                .id(SharedString::from(format!("{id}-remove-{item_id}")))
                                .debug_selector(selector(id.clone(), "remove"))
                                .absolute()
                                .top(px(2.0))
                                .right(px(2.0))
                                .size(px(18.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded_full()
                                .bg(theme.role(ThemeRole::ButtonPrimaryBackground))
                                .border_1()
                                .border_color(theme.role(ThemeRole::ButtonPrimaryBackground))
                                .track_focus(&remove_focus.tab_index(0).tab_stop(true))
                                .focus(|style| style.border_color(theme.role(ThemeRole::TextLink)))
                                .cursor(CursorStyle::PointingHand)
                                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                                .on_click(move |_, w, cx| {
                                    if let Some(handler) = &remove {
                                        handler(remove_id.clone(), w, cx);
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
                                        if let Some(handler) = &key_remove {
                                            handler(key_remove_id.clone(), w, cx);
                                        }
                                    }
                                })
                                .child(Icon::labelled(
                                    IconName::Close,
                                    format!("Remove {}", item.name),
                                    11.0,
                                    theme.role(ThemeRole::ButtonPrimaryTint).into(),
                                    format!("{id}.remove-icon-{item_id}"),
                                )),
                        )
                    })
                    .when(failed && !disabled && retry.is_some(), |v| {
                        let pointer = retry.clone();
                        let keyboard = retry.clone();
                        let mouse_down_focus = retry_focus.clone();
                        let mouse_up_focus = retry_focus.clone();
                        let pointer_id = item_id.clone();
                        let keyboard_id = item_id.clone();
                        v.child(
                            div()
                                .id(SharedString::from(format!("{id}-retry-{item_id}")))
                                .debug_selector(selector(id.clone(), "retry"))
                                .absolute()
                                .left(px(2.0))
                                .right(px(2.0))
                                .bottom(px(2.0))
                                .h(px(20.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(px(4.0))
                                .border_1()
                                .border_color(theme.role(ThemeRole::TextDestructive))
                                .bg(theme.role(ThemeRole::Surface))
                                .font_family(fonts::UI_FAMILY)
                                .text_size(px(10.0))
                                .text_color(theme.role(ThemeRole::TextDestructive))
                                .track_focus(&retry_focus.tab_index(0).tab_stop(true))
                                .focus(|style| style.border_color(theme.role(ThemeRole::TextLink)))
                                .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                    cx.stop_propagation();
                                    mouse_down_focus.focus(window);
                                })
                                .cursor(CursorStyle::PointingHand)
                                .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                    cx.stop_propagation();
                                    mouse_up_focus.focus(window);
                                    pointer.clone().unwrap()(pointer_id.clone(), window, cx);
                                })
                                .on_key_down(move |event, window, cx| {
                                    if !event.is_held
                                        && matches!(
                                            event.keystroke.key.as_str(),
                                            "enter" | "space" | " "
                                        )
                                    {
                                        cx.stop_propagation();
                                        keyboard.clone().unwrap()(keyboard_id.clone(), window, cx);
                                    }
                                })
                                .child("Retry"),
                        )
                    });
                div()
                    .debug_selector(selector(id.clone(), "item-stack"))
                    .w(px(if failed { 304.0 } else { 56.0 }))
                    .flex_none()
                    .flex()
                    .items_start()
                    .gap(px(8.0))
                    .child(preview)
                    .children(error.map(|error| {
                        div()
                            .debug_selector(selector(id.clone(), "error"))
                            .w(px(240.0))
                            .flex_none()
                            .font_family(fonts::UI_FAMILY)
                            .text_size(px(9.0))
                            .line_height(px(12.0))
                            .text_color(theme.role(ThemeRole::TextDestructive))
                            .child(format!("{}: {error}", item.name))
                    }))
            }));
        div()
            .debug_selector(selector(id.clone(), "root"))
            .w_full()
            .h(px(64.0))
            .flex_none()
            .capture_key_down(move |event, window, cx| {
                if event.is_held || event.keystroke.key.as_str() != "tab" {
                    return;
                }
                let Some(current) = window.focused(cx) else {
                    return;
                };
                let Some(index) = focus_targets
                    .iter()
                    .position(|(focus, _, _)| focus == &current)
                else {
                    return;
                };
                let target = if event.keystroke.modifiers.shift {
                    index.checked_sub(1)
                } else if index + 1 < focus_targets.len() {
                    Some(index + 1)
                } else {
                    None
                };
                if let Some(target) = target {
                    let (focus, left, right) = &focus_targets[target];
                    if reveal_horizontal(&horizontal_handle, *left, *right) {
                        window.refresh();
                    }
                    focus.focus(window);
                    cx.stop_propagation();
                }
            })
            .child(ScrollSurface {
                id: format!("{id}-scroll").into(),
                theme,
                width: None,
                height: Some(64.0),
                vertical: Some(vertical_scrollbar),
                horizontal: Some(horizontal_scrollbar),
                content: content.into_any_element(),
            })
    }
}

pub(super) fn compact_control(
    id: SharedString,
    theme: Theme,
    label: SharedString,
    disabled: bool,
    handler: Option<ComposerHandler>,
    focus_handle: FocusHandle,
    icon: Option<IconName>,
) -> AnyElement {
    let active = !disabled && handler.is_some();
    let click_handler = handler.clone();
    let key_handler = handler;
    div()
        .id(id.clone())
        .debug_selector(selector(id.clone(), "root"))
        .w(px(COMPACT_CONTROL_WIDTH))
        .h(px(28.0))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(5.0))
        .px(px(8.0))
        .rounded(px(6.0))
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .bg(transparent_black())
        .font_family(fonts::UI_FAMILY)
        .text_size(px(12.0))
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme.role(ThemeRole::TextSecondary))
        .opacity(if disabled { 0.48 } else { 1.0 })
        .track_focus(&focus_handle.tab_index(0).tab_stop(active))
        .focus(|style| style.border_color(theme.role(ThemeRole::TextLink)))
        .when(active, |v| {
            v.cursor(CursorStyle::PointingHand)
                .on_click(move |_, w, cx| {
                    if let Some(h) = &click_handler {
                        h(w, cx);
                    }
                })
                .on_key_down(move |event, w, cx| {
                    if !event.is_held && matches!(event.keystroke.key.as_str(), "enter" | "space") {
                        cx.stop_propagation();
                        if let Some(h) = &key_handler {
                            h(w, cx);
                        }
                    }
                })
        })
        .children(icon.map(|name| {
            Icon::decorative(
                name,
                13.0,
                theme.role(ThemeRole::TextSecondary).into(),
                format!("{id}.icon"),
            )
        }))
        .child(div().flex_1().min_w_0().truncate().child(label))
        .into_any_element()
}

/// Controlled model and effort selector. The caller owns both values and both menus.
#[derive(IntoElement)]
pub struct ModelEffortControl {
    pub id: SharedString,
    pub theme: Theme,
    pub model: SharedString,
    pub effort: SharedString,
    pub disabled: bool,
    pub model_focus: FocusHandle,
    pub effort_focus: FocusHandle,
    pub on_model: Option<ComposerHandler>,
    pub on_effort: Option<ComposerHandler>,
}
impl RenderOnce for ModelEffortControl {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id;
        div()
            .debug_selector(selector(id.clone(), "root"))
            .w(px(MODEL_EFFORT_CONTROL_WIDTH))
            .flex_none()
            .flex()
            .items_center()
            .gap(px(4.0))
            .child(compact_control(
                format!("{id}-model").into(),
                self.theme,
                self.model,
                self.disabled,
                self.on_model,
                self.model_focus,
                Some(IconName::Spark),
            ))
            .child(compact_control(
                format!("{id}-effort").into(),
                self.theme,
                self.effort,
                self.disabled,
                self.on_effort,
                self.effort_focus,
                Some(IconName::Zap),
            ))
    }
}

/// Controlled permission mode selector. It never starts an approval or invents a permission.
#[derive(IntoElement)]
pub struct PermissionControl {
    pub id: SharedString,
    pub theme: Theme,
    pub label: SharedString,
    pub disabled: bool,
    pub focus_handle: FocusHandle,
    pub on_activate: Option<ComposerHandler>,
}
impl RenderOnce for PermissionControl {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        compact_control(
            self.id,
            self.theme,
            self.label,
            self.disabled,
            self.on_activate,
            self.focus_handle,
            Some(IconName::Shield),
        )
    }
}

/// Controlled account/tier selector.
#[derive(IntoElement)]
pub struct TierControl {
    pub id: SharedString,
    pub theme: Theme,
    pub label: SharedString,
    pub disabled: bool,
    pub focus_handle: FocusHandle,
    pub on_activate: Option<ComposerHandler>,
}
impl RenderOnce for TierControl {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        compact_control(
            self.id,
            self.theme,
            self.label,
            self.disabled,
            self.on_activate,
            self.focus_handle,
            Some(IconName::Star),
        )
    }
}

/// Explicit audience status. Product use must keep this disabled until the protocol supports audience routing.
#[derive(IntoElement)]
pub struct AudienceControl {
    pub id: SharedString,
    pub theme: Theme,
    pub label: SharedString,
    pub protocol_available: bool,
    pub disabled: bool,
    pub focus_handle: FocusHandle,
    pub on_activate: Option<ComposerHandler>,
}
impl RenderOnce for AudienceControl {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let unavailable = !self.protocol_available;
        let disabled = self.disabled || unavailable;
        let visible_label: SharedString = if unavailable {
            "Audience off".into()
        } else {
            self.label.clone()
        };
        let control = compact_control(
            self.id.clone(),
            self.theme,
            visible_label,
            disabled,
            self.on_activate,
            self.focus_handle,
            Some(IconName::Users),
        );
        div()
            .debug_selector(selector(self.id.clone(), "status"))
            .w(px(AUDIENCE_UNAVAILABLE_WIDTH))
            .h(px(28.0))
            .flex_none()
            .flex()
            .items_center()
            .gap(px(8.0))
            .child(control)
            .children(unavailable.then(|| {
                div()
                    .debug_selector(selector(self.id, "explanation"))
                    .w(px(112.0))
                    .h(px(28.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .font_family(fonts::UI_FAMILY)
                    .text_size(px(9.0))
                    .line_height(px(14.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child("Protocol 23: no audience.")
            }))
            .into_any_element()
    }
}

/// Compact, controlled context usage presentation.
#[derive(IntoElement)]
pub struct ContextMeter {
    pub id: SharedString,
    pub theme: Theme,
    pub used: u64,
    pub limit: u64,
    pub label: SharedString,
}
impl RenderOnce for ContextMeter {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let ratio = if self.limit == 0 {
            0.0
        } else {
            (self.used as f32 / self.limit as f32).clamp(0.0, 1.0)
        };
        let id = self.id;
        div()
            .debug_selector(selector(id.clone(), "root"))
            .w(px(CONTEXT_METER_WIDTH))
            .h(px(28.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .font_family(fonts::MONO_FAMILY)
            .text_size(px(10.0))
            .text_color(self.theme.role(ThemeRole::TextSecondary))
            .child(
                div()
                    .debug_selector(selector(id.clone(), "track"))
                    .w(px(64.0))
                    .h(px(4.0))
                    .rounded_full()
                    .bg(self.theme.role(ThemeRole::Divider))
                    .child(
                        div()
                            .debug_selector(selector(id.clone(), "fill"))
                            .h_full()
                            .w(relative(ratio))
                            .rounded_full()
                            .bg(if ratio >= 0.9 {
                                self.theme.role(ThemeRole::Warning)
                            } else {
                                self.theme.role(ThemeRole::RadioActive)
                            }),
                    ),
            )
            .child(div().flex_1().min_w_0().truncate().child(self.label))
    }
}

#[derive(Clone, Debug)]
pub struct CommandPickerItem {
    pub id: SharedString,
    pub slash: SharedString,
    pub description: SharedString,
    pub icon: IconName,
}

/// A controlled command list. Rows are 32px; Up/Down move, Tab/Enter choose, Escape dismisses.
#[derive(IntoElement)]
pub struct CommandPicker {
    pub id: SharedString,
    pub theme: Theme,
    pub items: Vec<CommandPickerItem>,
    pub active: usize,
    pub focus_handle: Option<FocusHandle>,
    pub on_active: Option<IndexHandler>,
    pub on_select: Option<IdHandler>,
    pub on_dismiss: Option<ComposerHandler>,
    pub restore_focus: Option<FocusHandle>,
}
impl RenderOnce for CommandPicker {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id;
        let count = self.items.len();
        let active = self.active.min(count.saturating_sub(1));
        let on_key_active = self.on_active.clone();
        let on_key_select = self.on_select.clone();
        let on_dismiss = self.on_dismiss.clone();
        let active_id = self.items.get(active).map(|v| v.id.clone());
        let key_restore = self.restore_focus.clone();
        let click_restore = self.restore_focus.clone();
        div()
            .debug_selector(selector(id.clone(), "root"))
            .w_full()
            .p(px(6.0))
            .flex()
            .flex_col()
            .rounded(px(16.0))
            .border_1()
            .border_color(self.theme.role(ThemeRole::Divider))
            .bg(self.theme.role(ThemeRole::Surface))
            .when_some(self.focus_handle, |v, f| {
                v.track_focus(&f.tab_index(0).tab_stop(true))
            })
            .on_key_down(move |event, w, cx| {
                if event.is_held {
                    return;
                }
                if event.keystroke.key.as_str() == "escape" {
                    cx.stop_propagation();
                    if let Some(h) = &on_dismiss {
                        h(w, cx);
                    }
                    if let Some(focus) = &key_restore {
                        w.focus(focus);
                    }
                    return;
                }
                if count == 0 {
                    return;
                }
                match event.keystroke.key.as_str() {
                    "down" => {
                        cx.stop_propagation();
                        if let Some(h) = &on_key_active {
                            h((active + 1) % count, w, cx);
                        }
                    }
                    "up" => {
                        cx.stop_propagation();
                        if let Some(h) = &on_key_active {
                            h((active + count - 1) % count, w, cx);
                        }
                    }
                    "tab" | "enter" => {
                        cx.stop_propagation();
                        if let (Some(h), Some(item)) = (&on_key_select, &active_id) {
                            h(item.clone(), w, cx);
                            if let Some(focus) = &key_restore {
                                w.focus(focus);
                            }
                        }
                    }
                    _ => {}
                }
            })
            .children(
                self.items
                    .into_iter()
                    .enumerate()
                    .map(move |(index, item)| {
                        let selected = index == active;
                        let choose = self.on_select.clone();
                        let item_id = item.id.clone();
                        let restore = click_restore.clone();
                        div()
                            .id(SharedString::from(format!("{id}-row-{index}")))
                            .debug_selector(selector(id.clone(), "row"))
                            .h(px(32.0))
                            .w_full()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .px(px(10.0))
                            .rounded(px(9.0))
                            .when(selected, |v| {
                                v.bg(self.theme.role(ThemeRole::SurfaceSelected))
                            })
                            .cursor(CursorStyle::PointingHand)
                            .on_click(move |_, w, cx| {
                                if let Some(h) = &choose {
                                    h(item_id.clone(), w, cx);
                                    if let Some(focus) = &restore {
                                        w.focus(focus);
                                    }
                                }
                            })
                            .child(Icon::decorative(
                                item.icon,
                                14.0,
                                self.theme.role(ThemeRole::TextSecondary).into(),
                                format!("{id}.row-icon-{index}"),
                            ))
                            .child(
                                div()
                                    .flex_none()
                                    .font_family(fonts::MONO_FAMILY)
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(item.slash),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .font_family(fonts::UI_FAMILY)
                                    .text_size(px(12.0))
                                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                                    .child(item.description),
                            )
                    }),
            )
    }
}

#[derive(Clone, Debug)]
pub struct EmojiItem {
    pub id: SharedString,
    pub glyph: SharedString,
    pub name: SharedString,
}

/// Fixed emoji grid. Each cell is 36×36 and each local font glyph slot is 24×24.
#[derive(IntoElement)]
pub struct EmojiPicker {
    pub id: SharedString,
    pub theme: Theme,
    pub items: Vec<EmojiItem>,
    pub columns: usize,
    /// Caller-owned active descendant. Keep this value stable across parent renders.
    pub active: usize,
    /// Caller-owned focus for the composite grid.
    pub focus_handle: FocusHandle,
    pub on_active: Option<IndexHandler>,
    pub on_select: Option<IdHandler>,
    pub on_dismiss: Option<ComposerHandler>,
    pub restore_focus: Option<FocusHandle>,
}
impl RenderOnce for EmojiPicker {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id;
        let columns = self.columns.max(1);
        let width = columns as f32 * 36.0 + 18.0;
        let count = self.items.len();
        let active = self.active.min(count.saturating_sub(1));
        let active_id = self.items.get(active).map(|item| item.id.clone());
        let on_key_active = self.on_active.clone();
        let on_key_select = self.on_select.clone();
        let on_dismiss = self.on_dismiss.clone();
        let key_restore = self.restore_focus.clone();
        let click_restore = self.restore_focus.clone();
        div()
            .debug_selector(selector(id.clone(), "root"))
            .w(px(width))
            .p(px(8.0))
            .flex()
            .flex_wrap()
            .rounded(px(16.0))
            .border_1()
            .border_color(self.theme.role(ThemeRole::Divider))
            .bg(self.theme.role(ThemeRole::Surface))
            .track_focus(&self.focus_handle.tab_index(0).tab_stop(true))
            .focus(|style| style.border_color(self.theme.role(ThemeRole::TextLink)))
            .on_key_down(move |event, window, cx| {
                if event.is_held {
                    return;
                }
                let key = event.keystroke.key.as_str();
                if key == "escape" {
                    cx.stop_propagation();
                    if let Some(handler) = &on_dismiss {
                        handler(window, cx);
                    }
                    if let Some(focus) = &key_restore {
                        window.focus(focus);
                    }
                    return;
                }
                if count == 0 {
                    return;
                }
                let column = active % columns;
                let row_start = active - column;
                let target = match key {
                    "left" => Some(if column == 0 {
                        (row_start + columns - 1).min(count - 1)
                    } else {
                        active - 1
                    }),
                    "right" => Some(if column + 1 == columns || active + 1 == count {
                        row_start
                    } else {
                        active + 1
                    }),
                    "up" => Some(if active >= columns {
                        active - columns
                    } else {
                        let mut target = ((count - 1) / columns) * columns + column;
                        if target >= count {
                            target = target.saturating_sub(columns);
                        }
                        target
                    }),
                    "down" => Some(if active + columns < count {
                        active + columns
                    } else {
                        column.min(count - 1)
                    }),
                    "home" => Some(0),
                    "end" => Some(count - 1),
                    _ => None,
                };
                if let Some(target) = target {
                    cx.stop_propagation();
                    if let Some(handler) = &on_key_active {
                        handler(target, window, cx);
                    }
                } else if matches!(key, "enter" | "space" | " ") {
                    cx.stop_propagation();
                    if let (Some(handler), Some(item)) = (&on_key_select, &active_id) {
                        handler(item.clone(), window, cx);
                    }
                    if let Some(focus) = &key_restore {
                        window.focus(focus);
                    }
                }
            })
            .children(
                self.items
                    .into_iter()
                    .enumerate()
                    .map(move |(index, item)| {
                        let choose = self.on_select.clone();
                        let activate = self.on_active.clone();
                        let item_id = item.id.clone();
                        let restore = click_restore.clone();
                        div()
                            .id(SharedString::from(format!("{id}-cell-{index}")))
                            .debug_selector(selector(id.clone(), "cell"))
                            .size(px(36.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(6.0))
                            .when(index == active, |cell| {
                                cell.bg(self.theme.role(ThemeRole::SurfaceSelected))
                            })
                            .cursor(CursorStyle::PointingHand)
                            .on_click(move |_, window, cx| {
                                if let Some(handler) = &activate {
                                    handler(index, window, cx);
                                }
                                if let Some(handler) = &choose {
                                    handler(item_id.clone(), window, cx);
                                }
                                if let Some(focus) = &restore {
                                    window.focus(focus);
                                }
                            })
                            .child(
                                div()
                                    .debug_selector(selector(id.clone(), "glyph"))
                                    .size(px(24.0))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .text_size(px(20.0))
                                    .line_height(px(24.0))
                                    .child(item.glyph),
                            )
                            .child(
                                div()
                                    .absolute()
                                    .size(px(0.0))
                                    .overflow_hidden()
                                    .child(item.name.clone()),
                            )
                    }),
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
    use std::cell::{Cell, RefCell};

    struct Fixture {
        width: f32,
        dark: bool,
        show_attachment_error: bool,
        retried: Rc<RefCell<Vec<SharedString>>>,
        opened: Rc<RefCell<Vec<SharedString>>>,
        emoji_active: usize,
        emoji_focus: FocusHandle,
        composer_focus: FocusHandle,
        emoji_selected: Rc<RefCell<Vec<SharedString>>>,
        emoji_dismissed: Rc<Cell<usize>>,
        attachment_horizontal_scrollbar: Entity<ScrollbarState>,
        attachment_vertical_scrollbar: Entity<ScrollbarState>,
        attachment_focus: Vec<(FocusHandle, FocusHandle, FocusHandle)>,
        control_focus: Vec<FocusHandle>,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            let theme = if self.dark {
                Theme::dark()
            } else {
                Theme::light()
            };
            let retried = self.retried.clone();
            let opened = self.opened.clone();
            let fixture = cx.entity().downgrade();
            let emoji_selected = self.emoji_selected.clone();
            let emoji_dismissed = self.emoji_dismissed.clone();
            div().size_full().p(px(10.0)).child(
                div()
                    .w(px(self.width))
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .child(AttachmentPreviews {
                        id: "attachments".into(),
                        theme,
                        items: (0..32)
                            .map(|index| AttachmentPreviewItem {
                                id: if index == 0 {
                                    "a".into()
                                } else {
                                    format!("{index}").into()
                                },
                                name: format!("attachment-{index}.png").into(),
                                kind: AttachmentKind::Image,
                                image: None,
                                error: (self.show_attachment_error && index == 0).then(|| {
                                    "Upload failed after the connection closed while the full attachment payload was still being transferred. "
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
                        on_open: Some(Rc::new(move |id, _, _| opened.borrow_mut().push(id))),
                        on_remove: Some(Rc::new(|_, _, _| {})),
                        on_retry: Some(Rc::new(move |id, _, _| retried.borrow_mut().push(id))),
                    })
                    .child(ModelEffortControl {
                        id: "model-effort".into(),
                        theme,
                        model: "Claude".into(),
                        effort: "High".into(),
                        disabled: false,
                            model_focus: self.control_focus[0].clone(),
                            effort_focus: self.control_focus[1].clone(),
                        on_model: None,
                        on_effort: None,
                    })
                    .child(PermissionControl {
                        id: "permission".into(),
                        theme,
                        label: "Accept edits".into(),
                        disabled: true,
                            focus_handle: self.control_focus[2].clone(),
                        on_activate: None,
                    })
                    .child(TierControl {
                        id: "tier".into(),
                        theme,
                        label: "Pro".into(),
                        disabled: false,
                            focus_handle: self.control_focus[3].clone(),
                        on_activate: None,
                    })
                    .child(AudienceControl {
                        id: "audience".into(),
                        theme,
                        label: "Talk to people".into(),
                        protocol_available: false,
                        disabled: false,
                        focus_handle: self.control_focus[4].clone(),
                        on_activate: None,
                    })
                    .child(ContextMeter {
                        id: "context".into(),
                        theme,
                        used: 80,
                        limit: 100,
                        label: "80% context".into(),
                    })
                    .child(CommandPicker {
                        id: "commands".into(),
                        theme,
                        items: vec![CommandPickerItem {
                            id: "compact".into(),
                            slash: "/compact".into(),
                            description: "Compact context".into(),
                            icon: IconName::Braces,
                        }],
                        active: 0,
                        focus_handle: None,
                        on_active: None,
                        on_select: None,
                        on_dismiss: None,
                        restore_focus: None,
                    })
                    .child(EmojiPicker {
                        id: "emoji".into(),
                        theme,
                        items: (0..10)
                            .map(|i| EmojiItem {
                                id: format!("e{i}").into(),
                                glyph: "🙂".into(),
                                name: "smile".into(),
                            })
                            .collect(),
                        columns: 5,
                        active: self.emoji_active,
                        focus_handle: self.emoji_focus.clone(),
                        on_active: Some(Rc::new(move |active, _, cx| {
                            fixture
                                .update(cx, |fixture, cx| {
                                    fixture.emoji_active = active;
                                    cx.notify();
                                })
                                .ok();
                        })),
                        on_select: Some(Rc::new(move |id, _, _| {
                            emoji_selected.borrow_mut().push(id)
                        })),
                        on_dismiss: Some(Rc::new(move |_, _| {
                            emoji_dismissed.set(emoji_dismissed.get() + 1)
                        })),
                        restore_focus: Some(self.composer_focus.clone()),
                    }),
            )
        }
    }
    fn render(
        cx: &mut TestAppContext,
        width: f32,
        retried: Rc<RefCell<Vec<SharedString>>>,
    ) -> (Entity<Fixture>, &mut VisualTestContext) {
        let (fixture, cx) = cx.add_window_view(move |_, cx| {
            let handle = super::super::scrollbar::SharedScrollHandle::new();
            let horizontal_handle = handle.clone();
            let attachment_horizontal_scrollbar = cx.new(|_| {
                ScrollbarState::horizontal(
                    super::super::scrollbar::ScrollbarAppearance::Always,
                    super::super::scrollbar::ScrollbarPlacement::Overlay,
                    horizontal_handle,
                )
            });
            let attachment_vertical_scrollbar = cx.new(|_| {
                ScrollbarState::vertical(
                    super::super::scrollbar::ScrollbarAppearance::Always,
                    super::super::scrollbar::ScrollbarPlacement::Overlay,
                    handle,
                )
            });
            Fixture {
                width,
                dark: false,
                show_attachment_error: true,
                retried,
                opened: Rc::new(RefCell::new(Vec::new())),
                emoji_active: 0,
                emoji_focus: cx.focus_handle(),
                composer_focus: cx.focus_handle(),
                emoji_selected: Rc::new(RefCell::new(Vec::new())),
                emoji_dismissed: Rc::new(Cell::new(0)),
                attachment_horizontal_scrollbar,
                attachment_vertical_scrollbar,
                attachment_focus: (0..32)
                    .map(|_| (cx.focus_handle(), cx.focus_handle(), cx.focus_handle()))
                    .collect(),
                control_focus: (0..5).map(|_| cx.focus_handle()).collect(),
            }
        });
        cx.simulate_resize(size(px(620.0), px(760.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|w, _| w.scale_factor()), 2.0);
        (fixture, cx)
    }
    #[gpui::test]
    fn every_control_uses_real_layout_at_220_and_560(cx: &mut TestAppContext) {
        let retried = Rc::new(RefCell::new(Vec::new()));
        let (fixture, cx) = render(cx, 220.0, retried.clone());
        assert_eq!(
            cx.debug_bounds("attachments.item-a").unwrap().size,
            size(px(56.0), px(56.0))
        );
        assert_eq!(
            cx.debug_bounds("attachments.remove").unwrap().size,
            size(px(18.0), px(18.0))
        );
        assert_eq!(
            cx.debug_bounds("attachments.retry").unwrap().size.height,
            px(20.0)
        );
        let error = cx.debug_bounds("attachments.error").unwrap();
        assert_eq!(error.size.width, px(240.0));
        assert!(error.size.height > px(112.0));
        assert_eq!(
            cx.debug_bounds("attachments.root").unwrap().size,
            size(px(220.0), px(64.0))
        );
        let failed_center = cx.debug_bounds("attachments.item-a").unwrap().center();
        cx.simulate_click(failed_center, Modifiers::default());
        assert!(fixture.read_with(cx, |fixture, _| fixture.opened.borrow().is_empty()));
        let retry_center = cx.debug_bounds("attachments.retry").unwrap().center();
        cx.simulate_click(retry_center, Modifiers::default());
        assert_eq!(retried.borrow().as_slice(), ["a"]);
        retried.borrow_mut().clear();
        cx.simulate_keystrokes("enter space");
        assert_eq!(retried.borrow().as_slice(), ["a", "a"]);

        fixture.update(cx, |fixture, cx| {
            fixture.width = 188.0;
            cx.notify();
        });
        cx.run_until_parked();
        let viewport = cx.debug_bounds("attachments-scroll.viewport").unwrap();
        assert_eq!(viewport.size, size(px(188.0), px(64.0)));
        assert!(cx.debug_bounds("attachments.item-31").unwrap().right() > viewport.right());
        let handle = fixture.read_with(cx, |fixture, cx| {
            fixture
                .attachment_horizontal_scrollbar
                .read(cx)
                .scroll_handle()
                .clone()
        });
        let maximum = handle.max_offset();
        assert!(maximum.width > px(0.0));
        assert!(maximum.height > px(0.0));
        let (item_30_remove, item_31_open, item_1_open, first_retry) =
            fixture.read_with(cx, |fixture, _| {
                (
                    fixture.attachment_focus[30].1.clone(),
                    fixture.attachment_focus[31].0.clone(),
                    fixture.attachment_focus[1].0.clone(),
                    fixture.attachment_focus[0].2.clone(),
                )
            });
        cx.update(|window, _| window.focus(&item_30_remove));
        handle.set_offset(point(px(0.0), px(0.0)));
        cx.simulate_keystrokes("tab");
        cx.run_until_parked();
        assert!(cx.update(|window, _| item_31_open.is_focused(window)));
        let last_by_tab = cx.debug_bounds("attachments.item-31").unwrap();
        assert!(last_by_tab.origin.x >= viewport.origin.x);
        assert!(last_by_tab.right() <= viewport.right());

        cx.update(|window, _| window.focus(&item_1_open));
        handle.set_offset(point(-maximum.width, px(0.0)));
        cx.simulate_keystrokes("shift-tab");
        cx.run_until_parked();
        assert!(cx.update(|window, _| first_retry.is_focused(window)));
        let first_by_shift_tab = cx.debug_bounds("attachments.item-a").unwrap();
        assert!(first_by_shift_tab.origin.x >= viewport.origin.x);
        assert!(first_by_shift_tab.right() <= viewport.right());

        cx.simulate_event(ScrollWheelEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(-maximum.width, px(0.0))),
            ..Default::default()
        });
        cx.run_until_parked();
        let last = cx.debug_bounds("attachments.item-31").unwrap();
        assert!(last.origin.x >= viewport.origin.x);
        assert!(
            last.right() <= viewport.right(),
            "last attachment must enter viewport: last={last:?}, viewport={viewport:?}, maximum={maximum:?}, offset={:?}",
            handle.offset(),
        );
        assert!(cx.debug_bounds("attachments.item-a").unwrap().right() < viewport.origin.x);

        cx.simulate_event(ScrollWheelEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(maximum.width, px(0.0))),
            ..Default::default()
        });
        cx.simulate_event(ScrollWheelEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), -maximum.height)),
            ..Default::default()
        });
        cx.run_until_parked();
        let scrolled_error = cx.debug_bounds("attachments.error").unwrap();
        assert!(
            scrolled_error.bottom() <= viewport.bottom(),
            "long error must reach the viewport bottom: error={scrolled_error:?}, viewport={viewport:?}, offset={:?}, maximum={maximum:?}",
            handle.offset(),
        );
        assert!(scrolled_error.bottom() > viewport.origin.y);

        fixture.update(cx, |fixture, cx| {
            fixture.show_attachment_error = false;
            cx.notify();
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("attachments.root").unwrap().size,
            size(px(188.0), px(64.0)),
            "all-ready previews use only the 56px tile plus 8px scrollbar lane",
        );

        assert_eq!(
            cx.debug_bounds("permission.root").unwrap().size.height,
            px(28.0)
        );
        assert_eq!(cx.debug_bounds("tier.root").unwrap().size.height, px(28.0));
        assert_eq!(
            cx.debug_bounds("audience.root").unwrap().size.height,
            px(28.0)
        );
        assert_eq!(
            cx.debug_bounds("context.root").unwrap().size.height,
            px(28.0)
        );
        assert_eq!(
            cx.debug_bounds("commands.row").unwrap().size.height,
            px(32.0)
        );
        assert_eq!(
            cx.debug_bounds("emoji.cell").unwrap().size,
            size(px(36.0), px(36.0))
        );
        assert_eq!(
            cx.debug_bounds("emoji.glyph").unwrap().size,
            size(px(24.0), px(24.0))
        );
        fixture.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            fixture.dark = true;
            cx.notify()
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("attachments.root").unwrap().size.width,
            px(560.0)
        );
        assert_eq!(
            cx.debug_bounds("commands.root").unwrap().size.width,
            px(560.0)
        );
    }
    #[gpui::test]
    fn emoji_grid_keyboard_select_dismiss_and_focus_restore_at_real_widths(
        cx: &mut TestAppContext,
    ) {
        let retried = Rc::new(RefCell::new(Vec::new()));
        let (fixture, cx) = render(cx, 220.0, retried);
        let (emoji_focus, composer_focus, selected, dismissed) =
            fixture.read_with(cx, |fixture, _| {
                (
                    fixture.emoji_focus.clone(),
                    fixture.composer_focus.clone(),
                    fixture.emoji_selected.clone(),
                    fixture.emoji_dismissed.clone(),
                )
            });
        cx.update(|window, _| window.focus(&emoji_focus));
        cx.simulate_keystrokes("right");
        cx.run_until_parked();
        assert_eq!(fixture.read_with(cx, |fixture, _| fixture.emoji_active), 1);
        cx.simulate_keystrokes("down");
        cx.run_until_parked();
        assert_eq!(fixture.read_with(cx, |fixture, _| fixture.emoji_active), 6);
        cx.simulate_keystrokes("space");
        assert_eq!(selected.borrow().as_slice(), ["e6"]);
        assert!(cx.update(|window, _| composer_focus.is_focused(window)));

        fixture.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            fixture.dark = true;
            cx.notify();
        });
        cx.run_until_parked();
        cx.update(|window, _| window.focus(&emoji_focus));
        cx.simulate_keystrokes("left");
        cx.run_until_parked();
        assert_eq!(fixture.read_with(cx, |fixture, _| fixture.emoji_active), 5);
        cx.simulate_keystrokes("enter");
        assert_eq!(
            selected.borrow().last().map(SharedString::as_ref),
            Some("e5")
        );
        assert!(cx.update(|window, _| composer_focus.is_focused(window)));
        cx.update(|window, _| window.focus(&emoji_focus));
        cx.simulate_keystrokes("escape");
        assert_eq!(dismissed.get(), 1);
        assert!(cx.update(|window, _| composer_focus.is_focused(window)));
    }
}
