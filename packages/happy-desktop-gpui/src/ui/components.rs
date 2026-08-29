use gpui::{
    AnyElement, App, CursorStyle, Entity, FocusHandle, Focusable, FontWeight, Hsla, IntoElement,
    KeyBinding, MouseButton, Pixels, Point, RenderOnce, SharedString, Window, actions, canvas, div,
    prelude::*, px, quad, transparent_black,
};
use std::{cell::Cell, rc::Rc};

use super::icon::{Icon, IconName};
use super::{
    scrollbar::{Scrollbar, ScrollbarState},
    text_input::TextInput,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

actions!(
    happy_modal,
    [ModalFocusNext, ModalFocusPrevious, ModalDismiss]
);
const MODAL_KEY_CONTEXT: &str = "HappyModal";
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("tab", ModalFocusNext, Some(MODAL_KEY_CONTEXT)),
        KeyBinding::new("shift-tab", ModalFocusPrevious, Some(MODAL_KEY_CONTEXT)),
        KeyBinding::new("escape", ModalDismiss, Some(MODAL_KEY_CONTEXT)),
    ]);
}

fn part(id: impl Into<SharedString>, name: &'static str) -> impl Fn() -> String {
    let id = id.into();
    move || format!("{id}.{name}")
}

#[derive(Clone, Copy)]
pub enum ControlSize {
    Small,
    Medium,
    Large,
}
impl ControlSize {
    pub const fn height(self) -> f32 {
        match self {
            Self::Small => 28.0,
            Self::Medium => 36.0,
            Self::Large => 44.0,
        }
    }
    pub const fn font(self) -> f32 {
        match self {
            Self::Small => 12.0,
            Self::Medium => 13.0,
            Self::Large => 14.0,
        }
    }
    pub const fn icon(self) -> f32 {
        match self {
            Self::Small => 14.0,
            Self::Medium => 16.0,
            Self::Large => 18.0,
        }
    }
}

#[derive(Clone, Copy)]
pub enum ButtonVariant {
    Primary,
    Secondary,
    Ghost,
    Danger,
    Success,
}

pub type ActivateHandler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Button {
    pub id: SharedString,
    pub theme: Theme,
    pub label: SharedString,
    pub size: ControlSize,
    pub variant: ButtonVariant,
    pub icon: Option<IconName>,
    pub icon_only: bool,
    pub disabled: bool,
    pub force_focused: bool,
    pub focus_handle: Option<FocusHandle>,
    pub on_activate: Option<ActivateHandler>,
}
impl RenderOnce for Button {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let h = self.size.height();
        let xpad = match self.size {
            ControlSize::Small => 10.0,
            ControlSize::Medium => 14.0,
            ControlSize::Large => 18.0,
        };
        let (background, text, border): (Hsla, Hsla, Hsla) = match self.variant {
            ButtonVariant::Primary => (
                theme.role(ThemeRole::ButtonPrimaryBackground).into(),
                theme.role(ThemeRole::ButtonPrimaryTint).into(),
                transparent_black(),
            ),
            ButtonVariant::Secondary => (
                theme.role(ThemeRole::SurfaceHigh).into(),
                theme.role(ThemeRole::Text).into(),
                theme.role(ThemeRole::Divider).into(),
            ),
            ButtonVariant::Ghost => (
                transparent_black(),
                theme.role(ThemeRole::TextSecondary).into(),
                transparent_black(),
            ),
            ButtonVariant::Danger => (
                theme.role(ThemeRole::BoxErrorBackground).into(),
                theme.role(ThemeRole::BoxErrorText).into(),
                transparent_black(),
            ),
            ButtonVariant::Success => (
                theme.role(ThemeRole::Success).into(),
                theme.role(ThemeRole::ButtonPrimaryTint).into(),
                transparent_black(),
            ),
        };
        let id = self.id.clone();
        let visible_label = self.label;
        let accessible_label = visible_label.clone();
        let ring_id: SharedString = format!("{}-focus-ring", self.id).into();
        let handler = if self.disabled {
            None
        } else {
            self.on_activate
        };
        let interactive = handler.is_some();
        div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "root"))
            .relative()
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .h(px(h))
            .when(self.icon_only, |v| v.w(px(h)))
            .when(!self.icon_only, |v| v.px(px(xpad)))
            .border_1()
            .border_color(border)
            .rounded_full()
            .bg(background)
            .font_family(fonts::UI_FAMILY)
            .text_size(px(self.size.font()))
            .font_weight(FontWeight::BOLD)
            .text_color(text)
            .opacity(if self.disabled { 0.48 } else { 1.0 })
            .when(interactive, |v| v.tab_index(0))
            .when_some(self.focus_handle, |v, focus| {
                v.track_focus(&focus.tab_index(0).tab_stop(interactive))
            })
            .when_some(handler, |v, activate| {
                let keyboard = activate.clone();
                v.on_click(move |_, window, cx| activate(window, cx))
                    .on_key_down(move |event, window, cx| {
                        if !event.is_held
                            && matches!(event.keystroke.key.as_str(), "enter" | "space")
                        {
                            cx.stop_propagation();
                            keyboard(window, cx);
                        }
                    })
            })
            .child(
                div()
                    .id(ring_id)
                    .debug_selector(part(id.clone(), "focus-ring"))
                    .absolute()
                    .top(px(-5.0))
                    .right(px(-5.0))
                    .bottom(px(-5.0))
                    .left(px(-5.0))
                    .border_2()
                    .border_color(theme.role(ThemeRole::RadioActive))
                    .rounded_full()
                    .opacity(if self.force_focused { 1.0 } else { 0.0 })
                    .in_focus(|style| style.opacity(1.0)),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "content"))
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .children(self.icon.map(|name| {
                        Icon::decorative(name, self.size.icon(), text, format!("{}.icon", id))
                    }))
                    .when(!self.icon_only, |v| {
                        v.child(
                            div()
                                .debug_selector(part(id.clone(), "label"))
                                .child(visible_label),
                        )
                    })
                    .when(self.icon_only, |v| {
                        v.child(
                            div()
                                .debug_selector(part(id, "accessible-label"))
                                .absolute()
                                .size(px(0.0))
                                .overflow_hidden()
                                .child(accessible_label),
                        )
                    }),
            )
    }
}
#[derive(IntoElement)]
pub struct TextField {
    pub id: SharedString,
    pub theme: Theme,
    pub label: Option<SharedString>,
    pub input: Entity<TextInput>,
    pub size: ControlSize,
    pub width: Option<f32>,
    pub icon: Option<IconName>,
    pub hint: Option<SharedString>,
    pub invalid: bool,
    pub force_focused: bool,
}
impl RenderOnce for TextField {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let id = self.id.clone();
        let xpad = match self.size {
            ControlSize::Small => 10.0,
            ControlSize::Medium => 12.0,
            ControlSize::Large => 14.0,
        };
        let focus = self.input.read(cx).focus_handle(cx);
        let ring_color: Hsla = if self.invalid {
            theme.role(ThemeRole::BoxErrorText)
        } else {
            theme.role(ThemeRole::RadioActive)
        }
        .into();
        let border_color = if self.invalid {
            theme.role(ThemeRole::BoxErrorText)
        } else {
            theme.role(ThemeRole::Divider)
        };
        let force_focused = self.force_focused;
        let ring = canvas(
            |bounds, _, _| bounds,
            move |_, bounds, window, _| {
                if force_focused || focus.is_focused(window) {
                    window.paint_quad(quad(
                        bounds,
                        px(9.0),
                        transparent_black(),
                        px(2.0),
                        ring_color,
                        Default::default(),
                    ));
                }
            },
        )
        .size_full();
        div()
            .debug_selector(part(id.clone(), "root"))
            .w_full()
            .when_some(self.width, |v, width| v.w(px(width)))
            .flex()
            .flex_col()
            .gap(px(6.0))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .children(self.label.map(|label| {
                div()
                    .debug_selector(part(id.clone(), "label"))
                    .h(px(16.0))
                    .flex()
                    .items_center()
                    .text_size(px(13.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(label)
            }))
            .child(
                div()
                    .debug_selector(part(id.clone(), "control"))
                    .relative()
                    .w_full()
                    .h(px(self.size.height()))
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(xpad))
                    .border_1()
                    .border_color(border_color)
                    .rounded(px(6.0))
                    .bg(theme.role(ThemeRole::InputBackground))
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "focus-ring"))
                            .absolute()
                            .top(px(-4.0))
                            .right(px(-4.0))
                            .bottom(px(-4.0))
                            .left(px(-4.0))
                            .child(ring),
                    )
                    .children(self.icon.map(|name| {
                        Icon::decorative(
                            name,
                            self.size.icon(),
                            theme.role(ThemeRole::InputPlaceholder).into(),
                            format!("{}.icon", id),
                        )
                    }))
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "input"))
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .flex()
                            .items_center()
                            .text_size(px(self.size.font()))
                            .line_height(px(self.size.font() + 5.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.role(ThemeRole::Text))
                            .child(self.input),
                    ),
            )
            .children(self.hint.map(|hint| {
                div()
                    .debug_selector(part(id, "message"))
                    .h(px(16.0))
                    .flex()
                    .items_center()
                    .text_size(px(12.0))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if self.invalid {
                        theme.role(ThemeRole::BoxErrorText)
                    } else {
                        theme.role(ThemeRole::TextSecondary)
                    })
                    .child(hint)
            }))
    }
}

#[derive(IntoElement)]
pub struct ListRow {
    pub id: SharedString,
    pub theme: Theme,
    pub label: SharedString,
    pub width: f32,
    pub horizontal_padding: f32,
    pub gap: f32,
    pub icon: Option<IconName>,
    pub trailing: Option<SharedString>,
    pub selected: bool,
    pub disabled: bool,
    pub focus_handle: Option<FocusHandle>,
    pub on_activate: Option<ActivateHandler>,
}
impl RenderOnce for ListRow {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let id = self.id.clone();
        let ring_id: SharedString = format!("{}-focus-ring", id).into();
        let handler = if self.disabled {
            None
        } else {
            self.on_activate
        };
        let interactive = handler.is_some();
        div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "root"))
            .relative()
            .w(px(self.width))
            .h(px(32.0))
            .flex()
            .items_center()
            .gap(px(self.gap))
            .px(px(self.horizontal_padding))
            .rounded(px(6.0))
            .when(self.selected, |v| {
                v.bg(theme.role(ThemeRole::SurfaceSelected))
            })
            .font_family(fonts::UI_FAMILY)
            .text_size(px(13.0))
            .font_weight(FontWeight::MEDIUM)
            .opacity(if self.disabled { 0.48 } else { 1.0 })
            .when(interactive, |v| v.tab_index(0))
            .when_some(self.focus_handle, |v, focus| {
                v.track_focus(&focus.tab_index(0).tab_stop(interactive))
            })
            .when_some(handler, |v, activate| {
                let keyboard = activate.clone();
                v.on_click(move |_, window, cx| activate(window, cx))
                    .on_key_down(move |event, window, cx| {
                        if !event.is_held
                            && matches!(event.keystroke.key.as_str(), "enter" | "space")
                        {
                            cx.stop_propagation();
                            keyboard(window, cx);
                        }
                    })
            })
            .child(
                div()
                    .id(ring_id)
                    .debug_selector(part(id.clone(), "focus-ring"))
                    .absolute()
                    .top_0()
                    .right_0()
                    .bottom_0()
                    .left_0()
                    .border_2()
                    .border_color(theme.role(ThemeRole::RadioActive))
                    .rounded(px(6.0))
                    .opacity(0.0)
                    .in_focus(|style| style.opacity(1.0)),
            )
            .children(self.icon.map(|name| {
                Icon::decorative(
                    name,
                    16.0,
                    theme.role(ThemeRole::TextSecondary).into(),
                    format!("{}.icon", id),
                )
            }))
            .child(
                div()
                    .debug_selector(part(id.clone(), "label"))
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .child(self.label),
            )
            .children(self.trailing.map(|text| {
                div()
                    .debug_selector(part(id, "trailing"))
                    .flex_none()
                    .font_family(fonts::MONO_FAMILY)
                    .text_size(px(11.0))
                    .text_color(theme.role(ThemeRole::TextSecondary))
                    .child(text)
            }))
    }
}

#[derive(IntoElement)]
pub struct FileRow {
    pub id: SharedString,
    pub theme: Theme,
    pub status: SharedString,
    pub path: SharedString,
    pub changes: SharedString,
    pub status_color: gpui::Rgba,
}
impl RenderOnce for FileRow {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        div()
            .debug_selector(part(id.clone(), "root"))
            .w_full()
            .h(px(32.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(8.0))
            .rounded(px(6.0))
            .hover(|row| row.bg(self.theme.role(ThemeRole::InputBackground)))
            .child(
                div()
                    .debug_selector(part(id.clone(), "status"))
                    .w(px(14.0))
                    .flex_none()
                    .font_family(fonts::MONO_FAMILY)
                    .text_size(px(11.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(self.status_color)
                    .child(self.status),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "label"))
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(12.0))
                    .child(self.path),
            )
            .child(
                div()
                    .debug_selector(part(id, "changes"))
                    .flex_none()
                    .font_family(fonts::MONO_FAMILY)
                    .text_size(px(10.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child(self.changes),
            )
    }
}

#[derive(Clone, Copy)]
pub enum BadgeVariant {
    Neutral,
    Accent,
    Success,
    Warning,
    Danger,
    Info,
    Outline,
}
#[derive(IntoElement)]
pub struct Badge {
    pub id: SharedString,
    pub theme: Theme,
    pub label: SharedString,
    pub variant: BadgeVariant,
}
impl RenderOnce for Badge {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let (bg, color): (Hsla, Hsla) = match self.variant {
            BadgeVariant::Neutral => (
                theme.role(ThemeRole::InputBackground).into(),
                theme.role(ThemeRole::TextSecondary).into(),
            ),
            BadgeVariant::Accent => (
                theme.role(ThemeRole::SurfaceSelected).into(),
                theme.role(ThemeRole::TextLink).into(),
            ),
            BadgeVariant::Success => (
                theme.role(ThemeRole::SurfaceHigh).into(),
                theme.role(ThemeRole::Success).into(),
            ),
            BadgeVariant::Warning => (
                theme.role(ThemeRole::BoxErrorBackground).into(),
                theme.role(ThemeRole::BoxWarningBorder).into(),
            ),
            BadgeVariant::Danger => (
                theme.role(ThemeRole::BoxErrorBackground).into(),
                theme.role(ThemeRole::BoxErrorText).into(),
            ),
            BadgeVariant::Info => (
                theme.role(ThemeRole::SurfaceHigh).into(),
                theme.role(ThemeRole::RadioActive).into(),
            ),
            BadgeVariant::Outline => (
                transparent_black(),
                theme.role(ThemeRole::TextSecondary).into(),
            ),
        };
        div()
            .debug_selector(part(self.id.clone(), "root"))
            .h(px(18.0))
            .flex()
            .items_center()
            .gap(px(4.0))
            .px(px(if matches!(self.variant, BadgeVariant::Outline) {
                5.0
            } else {
                6.0
            }))
            .when(matches!(self.variant, BadgeVariant::Outline), |v| {
                v.border_1().border_color(theme.role(ThemeRole::Divider))
            })
            .rounded(px(4.0))
            .bg(bg)
            .text_color(color)
            .font_family(fonts::MONO_FAMILY)
            .text_size(px(10.0))
            .font_weight(FontWeight::BOLD)
            .child(
                div()
                    .debug_selector(part(self.id.clone(), "label"))
                    .child(self.label.to_uppercase()),
            )
    }
}

#[derive(Clone, Copy)]
pub enum AvatarSize {
    Xs,
    Sm,
    Md,
    Lg,
}
#[derive(IntoElement)]
pub struct Avatar {
    pub id: SharedString,
    pub theme: Theme,
    pub initials: SharedString,
    pub icon: Option<IconName>,
    pub size: AvatarSize,
    pub agent: bool,
    pub online: bool,
}
impl RenderOnce for Avatar {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let (size, font, radius) = match self.size {
            AvatarSize::Xs => (20.0, 8.0, 6.0),
            AvatarSize::Sm => (28.0, 10.0, 7.0),
            AvatarSize::Md => (36.0, 12.0, 9.0),
            AvatarSize::Lg => (44.0, 14.0, 10.0),
        };
        let presence = if matches!(self.size, AvatarSize::Lg) {
            10.0
        } else {
            8.0
        };
        div()
            .debug_selector(part(self.id.clone(), "root"))
            .relative()
            .size(px(size))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(if self.agent { px(radius) } else { px(999.0) })
            .bg(theme.role(ThemeRole::SurfaceRipple))
            .text_color(theme.role(ThemeRole::TextSecondary))
            .font_family(fonts::UI_FAMILY)
            .text_size(px(font))
            .font_weight(FontWeight::BOLD)
            .children(self.icon.map(|name| {
                Icon::decorative(
                    name,
                    font + 4.0,
                    theme.role(ThemeRole::TextSecondary).into(),
                    format!("{}.icon", self.id),
                )
            }))
            .when(self.icon.is_none(), |v| {
                v.child(
                    div()
                        .debug_selector(part(self.id.clone(), "initials"))
                        .child(self.initials),
                )
            })
            .when(self.online, |v| {
                v.child(
                    div()
                        .debug_selector(part(self.id.clone(), "presence"))
                        .absolute()
                        .right(px(-1.0))
                        .bottom(px(-1.0))
                        .size(px(presence))
                        .border_2()
                        .border_color(theme.role(ThemeRole::GrouppedBackground))
                        .rounded_full()
                        .bg(theme.role(ThemeRole::Success)),
                )
            })
    }
}

#[derive(IntoElement)]
pub struct TitleBar {
    pub id: SharedString,
    pub theme: Theme,
    pub title: SharedString,
}
impl RenderOnce for TitleBar {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        div()
            .debug_selector(part(id, "root"))
            .w_full()
            .h(px(40.0))
            .flex_none()
            .flex()
            .items_center()
            .px(px(12.0))
            .border_b_1()
            .border_color(self.theme.role(ThemeRole::Divider))
            .font_weight(FontWeight::SEMIBOLD)
            .text_size(px(13.0))
            .child(self.title)
    }
}

#[derive(IntoElement)]
pub struct SectionLabel {
    pub id: SharedString,
    pub theme: Theme,
    pub label: SharedString,
}
impl RenderOnce for SectionLabel {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        div()
            .debug_selector(part(self.id, "root"))
            .w_full()
            .h(px(28.0))
            .flex()
            .items_center()
            .px(px(14.0))
            .text_size(px(11.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(self.theme.role(ThemeRole::TextSecondary))
            .child(self.label)
    }
}

#[derive(IntoElement)]
pub struct Toolbar {
    pub id: SharedString,
    pub theme: Theme,
    pub title: SharedString,
    pub subtitle: Option<SharedString>,
    pub width: Option<f32>,
    pub height: f32,
    pub leading_icon: Option<IconName>,
    pub search: Option<AnyElement>,
    pub trailing: Option<AnyElement>,
}
impl RenderOnce for Toolbar {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let id = self.id.clone();
        div()
            .debug_selector(part(id.clone(), "root"))
            .w_full()
            .when_some(self.width, |v, width| v.w(px(width)))
            .h(px(self.height))
            .flex()
            .items_center()
            .gap(px(12.0))
            .px(px(16.0))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .children(self.leading_icon.map(|name| {
                Icon::decorative(
                    name,
                    16.0,
                    theme.role(ThemeRole::TextSecondary).into(),
                    format!("{}.leading", id),
                )
            }))
            .child(
                div()
                    .debug_selector(part(id.clone(), "heading"))
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .justify_center()
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "title"))
                            .h(px(20.0))
                            .truncate()
                            .text_size(px(15.0))
                            .font_weight(FontWeight::BOLD)
                            .child(self.title),
                    )
                    .children(self.subtitle.map(|subtitle| {
                        div()
                            .debug_selector(part(id.clone(), "subtitle"))
                            .h(px(16.0))
                            .truncate()
                            .text_size(px(12.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(subtitle)
                    })),
            )
            .children(self.search)
            .children(self.trailing)
    }
}

#[derive(IntoElement)]
pub struct ScrollSurface {
    pub id: SharedString,
    pub theme: Theme,
    pub width: Option<f32>,
    pub height: Option<f32>,
    pub vertical: Option<Entity<ScrollbarState>>,
    pub horizontal: Option<Entity<ScrollbarState>>,
    pub content: AnyElement,
}
impl RenderOnce for ScrollSurface {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let vertical = self.vertical;
        let horizontal = self.horizontal;
        let handle = vertical
            .as_ref()
            .or(horizontal.as_ref())
            .expect("ScrollSurface requires at least one shared scrollbar")
            .read(cx)
            .scroll_handle()
            .clone();
        if let (Some(v), Some(h)) = (&vertical, &horizontal) {
            assert!(
                v.read(cx).shares_handle(h.read(cx)),
                "both axes must share one SharedScrollHandle clone"
            );
        }
        let states: Vec<Entity<ScrollbarState>> =
            vertical.iter().chain(horizontal.iter()).cloned().collect();
        let has_perpendicular_axis = states.len() > 1;
        let wheel_states = states.clone();
        let hover_states = states.clone();
        let move_states = states.clone();
        let up_states = states.clone();
        let up_out_states = states.clone();
        let axis = match (vertical.is_some(), horizontal.is_some()) {
            (true, true) => 2,
            (true, false) => 1,
            (false, true) => 0,
            (false, false) => unreachable!(),
        };
        let color: Hsla = self.theme.role(ThemeRole::HappyScrollbarColor).into();
        let viewport = div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "viewport"))
            .flex_1()
            .min_w_0()
            .min_h_0()
            .size_full()
            .when(axis == 2, |v| v.overflow_scroll())
            .when(axis == 1, |v| v.overflow_y_scroll())
            .when(axis == 0, |v| v.overflow_x_scroll())
            .track_scroll(&handle)
            .on_scroll_wheel(move |event, window, cx| {
                let line_height = window.line_height();
                let mut accepted = false;
                for state in &wheel_states {
                    accepted |= state.update(cx, |state, cx| {
                        state.trusted_wheel(event, has_perpendicular_axis, line_height, cx)
                    });
                }
                if accepted {
                    cx.stop_propagation();
                }
            })
            .on_hover(move |hovered, _, cx| {
                for state in &hover_states {
                    state.update(cx, |state, cx| state.surface_hover(*hovered, cx));
                }
            })
            .child(self.content);
        let row = div()
            .relative()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .child(viewport)
            .children(vertical.map(|state| Scrollbar::new(id.clone(), state, color)));
        div()
            .debug_selector(part(id.clone(), "root"))
            .relative()
            .w_full()
            .h_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .when_some(self.width, |v, width| v.w(px(width)).flex_none())
            .when_some(self.height, |v, height| v.h(px(height)).flex_none())
            .on_mouse_move(move |event, _, cx| {
                for state in &move_states {
                    state.update(cx, |state, cx| state.pointer_move(event, cx));
                }
            })
            .on_mouse_up(MouseButton::Left, move |event, _, cx| {
                for state in &up_states {
                    state.update(cx, |state, cx| state.pointer_up(event, cx));
                }
            })
            .on_mouse_up_out(MouseButton::Left, move |event, _, cx| {
                for state in &up_out_states {
                    state.update(cx, |state, cx| state.pointer_up(event, cx));
                }
            })
            .child(row)
            .children(
                horizontal.map(|state| Scrollbar::new(format!("{}-horizontal", id), state, color)),
            )
    }
}

#[derive(Default)]
struct SplitterDragInner {
    active: Cell<bool>,
    mounts: Cell<usize>,
}
#[derive(Clone, Default)]
pub struct SplitterDragState(Rc<SplitterDragInner>);
struct SplitterMountLease(Rc<SplitterDragInner>);
impl Drop for SplitterMountLease {
    fn drop(&mut self) {
        let next = self.0.mounts.get().saturating_sub(1);
        self.0.mounts.set(next);
        if next == 0 {
            self.0.active.set(false);
        }
    }
}
impl SplitterDragState {
    pub fn new() -> Self {
        Self::default()
    }
    fn lease(&self) -> SplitterMountLease {
        self.0.mounts.set(self.0.mounts.get() + 1);
        SplitterMountLease(self.0.clone())
    }
    fn begin(&self) -> bool {
        !self.0.active.replace(true)
    }
    fn active(&self) -> bool {
        self.0.active.get()
    }
    fn end(&self) -> bool {
        self.0.active.replace(false)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SplitterEvent {
    DragStarted(Point<Pixels>),
    DragMoved(Point<Pixels>),
    DragEnded(Point<Pixels>),
}
pub type SplitterHandler = Rc<dyn Fn(SplitterEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Splitter {
    pub id: SharedString,
    pub theme: Theme,
    pub width: f32,
    pub height: f32,
    pub primary_size: f32,
    pub drag_state: SplitterDragState,
    pub first: AnyElement,
    pub second: AnyElement,
    pub on_event: Option<SplitterHandler>,
}
impl RenderOnce for Splitter {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let handler = self.on_event;
        let move_state = self.drag_state.clone();
        let mount_lease = self.drag_state.lease();
        let up_state = self.drag_state.clone();
        let up_out_state = self.drag_state.clone();
        div()
            .debug_selector(part(id.clone(), "root"))
            .w(px(self.width))
            .h(px(self.height))
            .flex()
            .flex_col()
            .when_some(handler.clone(), |root, output| {
                let ended = output.clone();
                let ended_out = output.clone();
                root.on_mouse_move(move |event, window, cx| {
                    let _keep_mounted = &mount_lease;
                    if move_state.active() && event.dragging() {
                        output(SplitterEvent::DragMoved(event.position), window, cx);
                    }
                })
                .on_mouse_up(MouseButton::Left, move |event, window, cx| {
                    if up_state.end() {
                        ended(SplitterEvent::DragEnded(event.position), window, cx);
                    }
                })
                .on_mouse_up_out(MouseButton::Left, move |event, window, cx| {
                    if up_out_state.end() {
                        ended_out(SplitterEvent::DragEnded(event.position), window, cx);
                    }
                })
            })
            .child(
                div()
                    .debug_selector(part(id.clone(), "top"))
                    .h(px(self.primary_size))
                    .flex_none()
                    .min_h_0()
                    .overflow_hidden()
                    .child(self.first),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{}-handle", id)))
                    .debug_selector(part(id.clone(), "handle"))
                    .h(px(8.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .cursor(CursorStyle::ResizeUpDown)
                    .when_some(handler, |handle, output| {
                        let state = self.drag_state.clone();
                        handle.on_mouse_down(MouseButton::Left, move |event, window, cx| {
                            cx.stop_propagation();
                            if state.begin() {
                                output(SplitterEvent::DragStarted(event.position), window, cx);
                            }
                        })
                    })
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "line"))
                            .w_full()
                            .h(px(1.0))
                            .bg(self.theme.role(ThemeRole::Divider)),
                    ),
            )
            .child(
                div()
                    .debug_selector(part(id, "bottom"))
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .child(self.second),
            )
    }
}

#[derive(IntoElement)]
pub struct MessageRow {
    pub id: SharedString,
    pub author: SharedString,
    pub avatar: Avatar,
    pub content: AnyElement,
}
impl RenderOnce for MessageRow {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        div()
            .debug_selector(part(id.clone(), "root"))
            .w_full()
            .flex()
            .gap(px(10.0))
            .child(self.avatar)
            .child(
                div()
                    .debug_selector(part(id.clone(), "content"))
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(5.0))
                    .child(
                        div()
                            .debug_selector(part(id, "author"))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(self.author),
                    )
                    .child(self.content),
            )
    }
}

#[derive(IntoElement)]
pub struct Composer {
    pub id: SharedString,
    pub theme: Theme,
    pub input: Entity<TextInput>,
    pub width: Option<f32>,
    pub metadata: Vec<SharedString>,
    pub on_submit: ActivateHandler,
}
impl RenderOnce for Composer {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        div()
            .debug_selector(part(id.clone(), "card"))
            .w_full()
            .when_some(self.width, |v, width| v.w(px(width)))
            .h(px(92.0))
            .flex()
            .flex_col()
            .justify_between()
            .p(px(12.0))
            .rounded(px(10.0))
            .border_1()
            .border_color(theme.role(ThemeRole::Divider))
            .bg(theme.role(ThemeRole::GrouppedBackground))
            .child(
                div()
                    .debug_selector(part(id.clone(), "input"))
                    .h(px(36.0))
                    .w_full()
                    .min_w_0()
                    .text_size(px(14.0))
                    .line_height(px(20.0))
                    .text_color(theme.role(ThemeRole::Text))
                    .child(self.input),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .debug_selector(part(id, "metadata"))
                            .flex()
                            .gap(px(12.0))
                            .text_size(px(11.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .children(self.metadata.into_iter().map(|item| div().child(item))),
                    )
                    .child(Button {
                        id: "composer-submit".into(),
                        theme,
                        label: "Send".into(),
                        size: ControlSize::Small,
                        variant: ButtonVariant::Primary,
                        icon: Some(IconName::ArrowUp),
                        icon_only: true,
                        disabled: false,
                        force_focused: false,
                        focus_handle: None,
                        on_activate: Some(self.on_submit),
                    }),
            )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModalSize {
    Small,
    Medium,
    Large,
}
impl ModalSize {
    pub const fn width(self) -> f32 {
        match self {
            Self::Small => 360.0,
            Self::Medium => 480.0,
            Self::Large => 640.0,
        }
    }
}

#[derive(IntoElement)]
pub struct Modal {
    pub id: SharedString,
    pub theme: Theme,
    pub size: ModalSize,
    pub icon: Option<IconName>,
    pub title: SharedString,
    pub body: AnyElement,
    pub body_scrollbar: Entity<ScrollbarState>,
    pub body_height: f32,
    pub footer: Vec<AnyElement>,
}
impl RenderOnce for Modal {
    fn render(self, window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let id = self.id.clone();
        let top_safe = (window.viewport_size().height - px(552.0)).clamp(px(48.0), px(128.0));
        let available = (window.viewport_size().height - top_safe - px(24.0)).max(px(208.0));
        let fixed = 60.0 + if self.footer.is_empty() { 0.0 } else { 68.0 };
        let body_height =
            px(self.body_height.clamp(80.0, 552.0)).min((available - px(fixed)).max(px(80.0)));
        div()
            .debug_selector(part(id.clone(), "dialog"))
            .w(px(self.size.width()))
            .max_h(available)
            .flex()
            .flex_col()
            .overflow_hidden()
            .border_1()
            .border_color(theme.role(ThemeRole::ModalBorder))
            .rounded(px(14.0))
            .bg(theme.role(ThemeRole::SurfaceHigh))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .child(
                div()
                    .debug_selector(part(id.clone(), "header"))
                    .h(px(60.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .pt(px(16.0))
                    .pb(px(16.0))
                    .pl(px(20.0))
                    .pr(px(16.0))
                    .children(self.icon.map(|name| {
                        div()
                            .debug_selector(part(id.clone(), "icon-chip"))
                            .size(px(28.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(8.0))
                            .bg(theme.role(ThemeRole::SurfaceSelected))
                            .child(Icon::decorative(
                                name,
                                16.0,
                                theme.role(ThemeRole::Text).into(),
                                format!("{}.icon", id),
                            ))
                    }))
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "title"))
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(16.0))
                            .font_weight(FontWeight::BOLD)
                            .child(self.title),
                    ),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "body"))
                    .h(body_height)
                    .flex_none()
                    .child(ScrollSurface {
                        id: format!("{}-body-scroll", id).into(),
                        theme,
                        width: None,
                        height: None,
                        vertical: Some(self.body_scrollbar),
                        horizontal: None,
                        content: div()
                            .debug_selector(part(id.clone(), "body-content"))
                            .pt(px(4.0))
                            .px(px(20.0))
                            .pb(px(20.0))
                            .text_size(px(13.0))
                            .line_height(px(20.0))
                            .child(self.body)
                            .into_any_element(),
                    }),
            )
            .when(!self.footer.is_empty(), |dialog| {
                dialog.child(
                    div()
                        .debug_selector(part(id, "footer"))
                        .h(px(68.0))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_end()
                        .gap(px(8.0))
                        .px(px(20.0))
                        .py(px(16.0))
                        .border_t_1()
                        .border_color(theme.role(ThemeRole::Divider))
                        .children(self.footer),
                )
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayPlacement {
    Center,
    Top,
    Fill,
}

#[derive(Clone)]
pub struct ModalFocus {
    pub container: FocusHandle,
    pub initial: FocusHandle,
    pub first: FocusHandle,
    pub last: FocusHandle,
}

#[derive(IntoElement)]
pub struct ModalOverlay {
    pub id: SharedString,
    pub theme: Theme,
    pub placement: OverlayPlacement,
    pub content: AnyElement,
    pub focus: ModalFocus,
    pub on_dismiss: Option<ActivateHandler>,
}
impl RenderOnce for ModalOverlay {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let placement = self.placement;
        let dismiss = self.on_dismiss;
        let focus = self.focus;
        let viewport = window.viewport_size();
        let top = (viewport.height - px(552.0)).clamp(px(48.0), px(128.0));
        if !focus.container.contains_focused(window, cx) {
            focus.initial.focus(window);
        }
        let keyboard_dismiss = dismiss.clone();
        let keyboard_focus = focus.clone();
        let overlay_focus = focus.container.clone();
        div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "overlay"))
            .absolute()
            .top_0()
            .right_0()
            .bottom_0()
            .left_0()
            .flex()
            .items_center()
            .when(self.placement == OverlayPlacement::Center, |v| {
                v.justify_center().p(px(24.0))
            })
            .when(self.placement == OverlayPlacement::Top, |v| {
                v.items_start()
                    .justify_center()
                    .pt(top)
                    .px(px(24.0))
                    .pb(px(24.0))
            })
            .when(self.placement == OverlayPlacement::Fill, |v| {
                v.items_start().justify_start()
            })
            .bg(self.theme.role(ThemeRole::OverlayBackdrop))
            .tab_index(0)
            .tab_stop(false)
            .tab_group()
            .track_focus(&overlay_focus.tab_index(0).tab_stop(false))
            .when_some(dismiss, |v, dismiss| {
                v.on_click(move |_, w, cx| dismiss(w, cx))
            })
            .key_context(MODAL_KEY_CONTEXT)
            .on_action(move |_: &ModalFocusNext, window, cx| {
                window.focus_next();
                if !keyboard_focus.container.contains_focused(window, cx) {
                    keyboard_focus.first.focus(window);
                }
            })
            .on_action({
                let focus = focus.clone();
                move |_: &ModalFocusPrevious, window, cx| {
                    window.focus_prev();
                    if !focus.container.contains_focused(window, cx) {
                        focus.last.focus(window);
                    }
                }
            })
            .on_action(move |_: &ModalDismiss, window, cx| {
                if let Some(dismiss) = &keyboard_dismiss {
                    dismiss(window, cx);
                }
            })
            .child(
                div()
                    .id(SharedString::from(format!("{}-content", id)))
                    .debug_selector(part(id, "content"))
                    .tab_group()
                    .when(self.placement == OverlayPlacement::Fill, |v| {
                        v.w(viewport.width).h(viewport.height).flex_none()
                    })
                    .when(placement != OverlayPlacement::Fill, |content| {
                        content.on_click(|_, _, cx| cx.stop_propagation())
                    })
                    .child(self.content),
            )
    }
}

#[cfg(test)]
mod geometry_tests {
    use super::*;
    use crate::ui::{
        Menu, MenuItem, ScrollbarAppearance, ScrollbarPlacement, SharedScrollHandle, TabItem, Tabs,
        TabsSize,
    };
    use gpui::{
        AnyElement, App, Bounds, Context, Focusable, Modifiers, MouseDownEvent, MouseMoveEvent,
        MouseUpEvent, Pixels, Render, ScrollDelta, ScrollWheelEvent, TestAppContext,
        VisualTestContext, Window, point, px, size,
    };
    use std::{cell::RefCell, rc::Rc};

    #[derive(Clone, Copy)]
    enum FixtureKind {
        ButtonSmall,
        ButtonMedium,
        ButtonLarge,
        Field,
        Row,
        Badge,
        Avatar,
        Tabs,
        Menu,
        Toolbar,
        TitleBar,
        SectionLabel,
        FileRow,
        MessageRow,
        Composer,
        Scroll,
        Splitter,
        Modal,
    }
    struct Fixture {
        kind: FixtureKind,
        input: Entity<TextInput>,
        scrollbar: Entity<ScrollbarState>,
        modal_focus: ModalFocus,
        splitter_drag: SplitterDragState,
    }
    impl Fixture {
        fn element(&self) -> AnyElement {
            let theme = Theme::light();
            match self.kind {
                FixtureKind::ButtonSmall => Button {
                    id: "test-button".into(),
                    theme,
                    label: "Create".into(),
                    size: ControlSize::Small,
                    variant: ButtonVariant::Primary,
                    icon: Some(IconName::Plus),
                    icon_only: false,
                    disabled: false,
                    force_focused: false,
                    focus_handle: None,
                    on_activate: None,
                }
                .into_any_element(),
                FixtureKind::ButtonMedium => Button {
                    id: "test-button".into(),
                    theme,
                    label: "Create".into(),
                    size: ControlSize::Medium,
                    variant: ButtonVariant::Secondary,
                    icon: Some(IconName::Plus),
                    icon_only: false,
                    disabled: false,
                    force_focused: true,
                    focus_handle: None,
                    on_activate: None,
                }
                .into_any_element(),
                FixtureKind::ButtonLarge => Button {
                    id: "test-button".into(),
                    theme,
                    label: "Create".into(),
                    size: ControlSize::Large,
                    variant: ButtonVariant::Primary,
                    icon: Some(IconName::Plus),
                    icon_only: false,
                    disabled: false,
                    force_focused: false,
                    focus_handle: None,
                    on_activate: None,
                }
                .into_any_element(),
                FixtureKind::Field => TextField {
                    id: "test-field".into(),
                    theme,
                    label: Some("Project".into()),
                    input: self.input.clone(),
                    size: ControlSize::Medium,
                    width: Some(240.0),
                    icon: Some(IconName::Search),
                    hint: Some("Workspace name".into()),
                    invalid: false,
                    force_focused: true,
                }
                .into_any_element(),
                FixtureKind::Row => ListRow {
                    id: "test-row".into(),
                    theme,
                    label: "happy-desktop".into(),
                    width: 280.0,
                    horizontal_padding: 10.0,
                    gap: 8.0,
                    icon: Some(IconName::Files),
                    trailing: Some("+12".into()),
                    selected: true,
                    disabled: false,
                    focus_handle: None,
                    on_activate: None,
                }
                .into_any_element(),
                FixtureKind::Badge => Badge {
                    id: "test-badge".into(),
                    theme,
                    label: "Active".into(),
                    variant: BadgeVariant::Outline,
                }
                .into_any_element(),
                FixtureKind::Avatar => Avatar {
                    id: "test-avatar".into(),
                    theme,
                    initials: "AI".into(),
                    icon: None,
                    size: AvatarSize::Lg,
                    agent: true,
                    online: true,
                }
                .into_any_element(),
                FixtureKind::Tabs => Tabs {
                    id: "test-tabs".into(),
                    theme,
                    size: TabsSize::Medium,
                    items: vec![
                        TabItem {
                            id: "activity".into(),
                            label: "Activity".into(),
                            icon: Some(IconName::History),
                            selected: true,
                            disabled: false,
                        },
                        TabItem {
                            id: "files".into(),
                            label: "Files".into(),
                            icon: Some(IconName::Files),
                            selected: false,
                            disabled: false,
                        },
                        TabItem {
                            id: "disabled".into(),
                            label: "Disabled".into(),
                            icon: None,
                            selected: false,
                            disabled: true,
                        },
                    ],
                    on_select: Rc::new(|_, _, _| {}),
                }
                .into_any_element(),
                FixtureKind::Menu => Menu {
                    id: "test-menu".into(),
                    theme,
                    items: vec![
                        MenuItem {
                            id: "open".into(),
                            label: "Open".into(),
                            icon: Some(IconName::Files),
                            selected: false,
                            disabled: false,
                        },
                        MenuItem {
                            id: "rename".into(),
                            label: "Rename".into(),
                            icon: Some(IconName::Edit),
                            selected: true,
                            disabled: false,
                        },
                        MenuItem {
                            id: "delete".into(),
                            label: "Delete".into(),
                            icon: Some(IconName::Trash),
                            selected: false,
                            disabled: true,
                        },
                    ],
                    on_activate: Rc::new(|_, _, _| {}),
                    on_dismiss: None,
                }
                .into_any_element(),
                FixtureKind::Toolbar => Toolbar {
                    id: "test-toolbar".into(),
                    theme,
                    title: "Project tools".into(),
                    subtitle: Some("happy-desktop".into()),
                    width: Some(640.0),
                    height: 48.0,
                    leading_icon: Some(IconName::Home),
                    search: Some(
                        TextField {
                            id: "test-toolbar-search".into(),
                            theme,
                            label: None,
                            input: self.input.clone(),
                            size: ControlSize::Small,
                            width: Some(220.0),
                            icon: Some(IconName::Search),
                            hint: None,
                            invalid: false,
                            force_focused: false,
                        }
                        .into_any_element(),
                    ),
                    trailing: None,
                }
                .into_any_element(),
                FixtureKind::TitleBar => TitleBar {
                    id: "test-title".into(),
                    theme,
                    title: "Dynamic title".into(),
                }
                .into_any_element(),
                FixtureKind::SectionLabel => SectionLabel {
                    id: "test-section".into(),
                    theme,
                    label: "PROJECTS".into(),
                }
                .into_any_element(),
                FixtureKind::FileRow => FileRow {
                    id: "test-file".into(),
                    theme,
                    status: "M".into(),
                    path: "src/main.rs".into(),
                    changes: "+12 −1".into(),
                    status_color: theme.role(ThemeRole::BoxWarningBorder),
                }
                .into_any_element(),
                FixtureKind::MessageRow => MessageRow {
                    id: "test-message".into(),
                    author: "Happy".into(),
                    avatar: Avatar {
                        id: "test-message-avatar".into(),
                        theme,
                        initials: "H".into(),
                        icon: Some(IconName::Terminal),
                        size: AvatarSize::Sm,
                        agent: true,
                        online: true,
                    },
                    content: div()
                        .text_size(px(14.0))
                        .line_height(px(20.0))
                        .child("Dynamic message body")
                        .into_any_element(),
                }
                .into_any_element(),
                FixtureKind::Composer => Composer {
                    id: "test-composer".into(),
                    theme,
                    input: self.input.clone(),
                    width: Some(320.0),
                    metadata: vec!["Codex".into(), "High".into()],
                    on_submit: Rc::new(|_, _| {}),
                }
                .into_any_element(),
                FixtureKind::Scroll => ScrollSurface {
                    id: "test-scroll".into(),
                    theme,
                    width: Some(320.0),
                    height: Some(160.0),
                    vertical: Some(self.scrollbar.clone()),
                    horizontal: None,
                    content: div()
                        .debug_selector(|| "test-scroll.content".into())
                        .w_full()
                        .h(px(480.0))
                        .flex_none()
                        .p(px(16.0))
                        .child(ListRow {
                            id: "scroll-row".into(),
                            theme,
                            label: "Scrollable row".into(),
                            width: 280.0,
                            horizontal_padding: 10.0,
                            gap: 8.0,
                            icon: Some(IconName::Files),
                            trailing: Some("+12".into()),
                            selected: true,
                            disabled: false,
                            focus_handle: None,
                            on_activate: None,
                        })
                        .into_any_element(),
                }
                .into_any_element(),
                FixtureKind::Splitter => Splitter {
                    id: "test-splitter".into(),
                    theme,
                    width: 320.0,
                    height: 160.0,
                    primary_size: 88.0,
                    drag_state: self.splitter_drag.clone(),
                    first: div()
                        .size_full()
                        .bg(theme.role(ThemeRole::SurfaceHigh))
                        .into_any_element(),
                    second: div()
                        .size_full()
                        .bg(theme.role(ThemeRole::InputBackground))
                        .into_any_element(),
                    on_event: None,
                }
                .into_any_element(),
                FixtureKind::Modal => ModalOverlay {
                    id: "test-modal".into(),
                    theme,
                    placement: OverlayPlacement::Center,
                    focus: self.modal_focus.clone(),
                    on_dismiss: None,
                    content: Modal {
                        id: "test-modal".into(),
                        theme,
                        size: ModalSize::Small,
                        icon: Some(IconName::Settings),
                        title: "Native settings".into(),
                        body: div()
                            .debug_selector(|| "test-modal.body-text".into())
                            .child("Reusable GPUI dialog content.")
                            .into_any_element(),
                        body_scrollbar: self.scrollbar.clone(),
                        body_height: 80.0,
                        footer: vec![
                            Button {
                                id: "test-modal-cancel".into(),
                                theme,
                                label: "Cancel".into(),
                                size: ControlSize::Medium,
                                variant: ButtonVariant::Secondary,
                                icon: None,
                                icon_only: false,
                                disabled: false,
                                force_focused: false,
                                focus_handle: None,
                                on_activate: None,
                            }
                            .into_any_element(),
                            Button {
                                id: "test-modal-save".into(),
                                theme,
                                label: "Save".into(),
                                size: ControlSize::Medium,
                                variant: ButtonVariant::Primary,
                                icon: None,
                                icon_only: false,
                                disabled: false,
                                force_focused: false,
                                focus_handle: None,
                                on_activate: None,
                            }
                            .into_any_element(),
                        ],
                    }
                    .into_any_element(),
                }
                .into_any_element(),
            }
        }
    }
    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .flex()
                .flex_col()
                .items_start()
                .child(self.element())
        }
    }
    fn render(
        cx: &mut TestAppContext,
        kind: FixtureKind,
        width: f32,
        height: f32,
    ) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| {
            crate::fonts::register(cx);
            crate::ui::text_input::init(cx);
            super::init(cx);
        });
        let (_, cx) = cx.add_window_view(move |_, cx| {
            let scroll_handle = SharedScrollHandle::new();
            let scrollbar = cx.new(|_| {
                ScrollbarState::vertical(
                    super::super::scrollbar::ScrollbarAppearance::Automatic,
                    super::super::scrollbar::ScrollbarPlacement::BesideWhenOverflowing,
                    scroll_handle.clone(),
                )
            });
            let container = cx.focus_handle();
            let first = cx.focus_handle();
            let last = cx.focus_handle();
            Fixture {
                kind,
                input: cx.new(|cx| {
                    TextInput::new(
                        "fixture-input",
                        "happy-desktop",
                        "Workspace",
                        Theme::light(),
                        cx,
                    )
                }),
                scrollbar,
                modal_focus: ModalFocus {
                    container,
                    initial: first.clone(),
                    first,
                    last,
                },
                splitter_drag: SplitterDragState::new(),
            }
        });
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }
    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector)
            .unwrap_or_else(|| panic!("missing rendered geometry for {selector}"))
    }
    fn assert_rect(actual: Bounds<Pixels>, x: f32, y: f32, width: f32, height: f32) {
        assert_eq!(actual.origin.x, px(x), "resolved x");
        assert_eq!(actual.origin.y, px(y), "resolved y");
        assert_eq!(actual.size.width, px(width), "resolved width");
        assert_eq!(actual.size.height, px(height), "resolved height");
    }

    #[gpui::test]
    fn button_resolves_all_heights_padding_gap_and_focus_clearance(cx: &mut TestAppContext) {
        for (kind, height, padding, icon) in [
            (FixtureKind::ButtonSmall, 28.0, 11.0, 14.0),
            (FixtureKind::ButtonMedium, 36.0, 15.0, 16.0),
            (FixtureKind::ButtonLarge, 44.0, 19.0, 18.0),
        ] {
            let cx = render(cx, kind, 320.0, 80.0);
            let root = bounds(cx, "test-button.root");
            let content = bounds(cx, "test-button.content");
            let glyph = bounds(cx, "test-button.icon");
            let label = bounds(cx, "test-button.label");
            assert_eq!(root.size.height, px(height));
            assert_eq!(
                content.origin.x - root.origin.x,
                px(padding),
                "1px border plus declared x padding"
            );
            assert_eq!(glyph.size, size(px(icon), px(icon)));
            assert_eq!(label.origin.x - glyph.right(), px(6.0), "icon-label gap");
            if matches!(kind, FixtureKind::ButtonMedium) {
                let ring = bounds(cx, "test-button.focus-ring");
                assert_eq!(
                    root.origin.x - ring.origin.x,
                    px(4.0),
                    "2px ring plus 2px offset"
                );
                assert_eq!(
                    ring.right() - root.right(),
                    px(4.0),
                    "focus clearance is symmetric"
                );
            }
        }
    }

    #[gpui::test]
    fn button_and_list_row_activate_with_pointer_enter_and_space_but_disabled_controls_do_not(
        cx: &mut TestAppContext,
    ) {
        struct Actions {
            log: Rc<RefCell<Vec<&'static str>>>,
        }
        impl Render for Actions {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let theme = Theme::light();
                let a = self.log.clone();
                let b = self.log.clone();
                div()
                    .flex()
                    .gap(px(12.0))
                    .child(Button {
                        id: "action-button".into(),
                        theme,
                        label: "Action".into(),
                        size: ControlSize::Medium,
                        variant: ButtonVariant::Primary,
                        icon: None,
                        icon_only: false,
                        disabled: false,
                        force_focused: false,
                        focus_handle: None,
                        on_activate: Some(Rc::new(move |_, _| a.borrow_mut().push("button"))),
                    })
                    .child(ListRow {
                        id: "action-row".into(),
                        theme,
                        label: "Row".into(),
                        width: 120.0,
                        horizontal_padding: 10.0,
                        gap: 8.0,
                        icon: None,
                        trailing: None,
                        selected: false,
                        disabled: false,
                        focus_handle: None,
                        on_activate: Some(Rc::new(move |_, _| b.borrow_mut().push("row"))),
                    })
                    .child(Button {
                        id: "disabled-button".into(),
                        theme,
                        label: "Disabled".into(),
                        size: ControlSize::Medium,
                        variant: ButtonVariant::Secondary,
                        icon: Some(IconName::Lock),
                        icon_only: true,
                        disabled: true,
                        force_focused: false,
                        focus_handle: None,
                        on_activate: Some(Rc::new(|_, _| panic!("disabled"))),
                    })
            }
        }
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let log = Rc::new(RefCell::new(Vec::new()));
        let fixture_log = log.clone();
        let (_, cx) = cx.add_window_view(move |_, _| Actions { log: fixture_log });
        cx.simulate_resize(size(px(500.0), px(100.0)));
        cx.run_until_parked();
        let button_center = bounds(cx, "action-button.root").center();
        cx.simulate_click(button_center, Modifiers::default());
        cx.simulate_keystrokes("enter space");
        let row_center = bounds(cx, "action-row.root").center();
        cx.simulate_click(row_center, Modifiers::default());
        cx.simulate_keystrokes("enter space");
        let disabled_center = bounds(cx, "disabled-button.root").center();
        cx.simulate_click(disabled_center, Modifiers::default());
        assert_eq!(
            bounds(cx, "disabled-button.accessible-label").size,
            size(px(0.0), px(0.0))
        );
        assert_eq!(
            log.borrow().as_slice(),
            ["button", "button", "button", "row", "row", "row"]
        );
    }

    #[gpui::test]
    fn text_field_resolves_label_control_message_and_inner_padding(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Field, 320.0, 120.0);
        assert_rect(bounds(cx, "test-field.root"), 0.0, 0.0, 240.0, 80.0);
        assert_rect(bounds(cx, "test-field.label"), 0.0, 0.0, 240.0, 16.0);
        assert_rect(bounds(cx, "test-field.control"), 0.0, 22.0, 240.0, 36.0);
        assert_rect(bounds(cx, "test-field.message"), 0.0, 64.0, 240.0, 16.0);
        let control = bounds(cx, "test-field.control");
        let icon = bounds(cx, "test-field.icon");
        let input = bounds(cx, "test-field.input");
        assert_eq!(
            icon.origin.x - control.origin.x,
            px(13.0),
            "border plus 12px control padding"
        );
        assert_eq!(input.origin.x - icon.right(), px(8.0), "icon-input gap");
        let ring = bounds(cx, "test-field.focus-ring");
        assert_eq!(
            control.origin.x - ring.origin.x,
            px(3.0),
            "2px ring plus 1px offset"
        );
    }

    #[gpui::test]
    fn list_row_resolves_height_lanes_gap_and_padding(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Row, 320.0, 64.0);
        let row = bounds(cx, "test-row.root");
        assert_rect(row, 0.0, 0.0, 280.0, 32.0);
        let icon = bounds(cx, "test-row.icon");
        let label = bounds(cx, "test-row.label");
        let trailing = bounds(cx, "test-row.trailing");
        assert_eq!(icon.origin.x - row.origin.x, px(10.0));
        assert_eq!(label.origin.x - icon.right(), px(8.0));
        assert_eq!(row.right() - trailing.right(), px(10.0));
    }

    #[gpui::test]
    fn badge_resolves_18px_height_border_and_visual_padding(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Badge, 200.0, 40.0);
        let root = bounds(cx, "test-badge.root");
        let label = bounds(cx, "test-badge.label");
        assert_eq!(root.size.height, px(18.0));
        assert_eq!(
            label.origin.x - root.origin.x,
            px(6.0),
            "1px border plus 5px padding"
        );
        assert_eq!(root.right() - label.right(), px(6.0));
    }

    #[gpui::test]
    fn avatar_resolves_declared_box_initials_and_presence(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Avatar, 100.0, 80.0);
        assert_rect(bounds(cx, "test-avatar.root"), 0.0, 0.0, 44.0, 44.0);
        let initials = bounds(cx, "test-avatar.initials");
        let avatar = bounds(cx, "test-avatar.root");
        assert_eq!(
            initials.origin.y + initials.size.height / 2.0,
            avatar.origin.y + avatar.size.height / 2.0
        );
        assert_rect(bounds(cx, "test-avatar.presence"), 35.0, 35.0, 10.0, 10.0);
    }

    #[gpui::test]
    fn tabs_resolve_bar_tabs_leading_lane_padding_and_indicator(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Tabs, 480.0, 80.0);
        assert_rect(bounds(cx, "test-tabs.root"), 0.0, 0.0, 480.0, 40.0);
        let active = bounds(cx, "test-tabs.item-activity");
        let icon = bounds(cx, "test-tabs.item-activity.icon");
        let label = bounds(cx, "test-tabs.item-activity.label");
        assert_eq!(icon.origin.x - active.origin.x, px(14.0));
        assert_eq!(label.origin.x - icon.right(), px(8.0));
        assert_eq!(active.right() - label.right(), px(14.0));
        let underline = bounds(cx, "test-tabs.item-activity.underline");
        assert_eq!(underline.origin.x, active.origin.x);
        assert_eq!(underline.origin.y, px(39.0));
        assert_eq!(underline.size.width, active.size.width);
        assert_eq!(underline.size.height, px(2.0));
    }

    #[gpui::test]
    fn menu_resolves_card_inset_parallel_rows_and_item_padding(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Menu, 300.0, 180.0);
        let root = bounds(cx, "test-menu.root");
        let item = bounds(cx, "test-menu.item-open");
        assert_eq!(root.size.width, px(220.0));
        assert_eq!(
            item.origin.x - root.origin.x,
            px(5.0),
            "1px border plus 4px list inset"
        );
        assert_eq!(item.size.height, px(28.0));
        assert_eq!(root.right() - item.right(), px(5.0));
        let icon = bounds(cx, "test-menu.item-open.icon");
        let label = bounds(cx, "test-menu.item-open.label");
        assert_eq!(icon.origin.x - item.origin.x, px(8.0));
        assert_eq!(label.origin.x - icon.right(), px(8.0));
    }

    #[gpui::test]
    fn toolbar_resolves_height_outer_padding_heading_and_search(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Toolbar, 700.0, 80.0);
        let root = bounds(cx, "test-toolbar.root");
        assert_rect(root, 0.0, 0.0, 640.0, 48.0);
        let leading = bounds(cx, "test-toolbar.leading");
        let heading = bounds(cx, "test-toolbar.heading");
        let search = bounds(cx, "test-toolbar-search.root");
        assert_eq!(leading.origin.x - root.origin.x, px(16.0));
        assert_eq!(heading.origin.x - leading.right(), px(12.0));
        assert_eq!(search.size, size(px(220.0), px(28.0)));
        assert_eq!(root.right() - search.right(), px(16.0));
    }

    #[gpui::test]
    fn shell_primitives_resolve_title_section_file_message_and_composer_geometry(
        cx: &mut TestAppContext,
    ) {
        let cx = render(cx, FixtureKind::TitleBar, 400.0, 80.0);
        assert_rect(bounds(cx, "test-title.root"), 0.0, 0.0, 400.0, 40.0);
        let cx = render(cx, FixtureKind::SectionLabel, 280.0, 80.0);
        assert_rect(bounds(cx, "test-section.root"), 0.0, 0.0, 280.0, 28.0);
        let cx = render(cx, FixtureKind::FileRow, 400.0, 80.0);
        let row = bounds(cx, "test-file.root");
        assert_rect(row, 0.0, 0.0, 400.0, 32.0);
        assert_eq!(
            bounds(cx, "test-file.status").origin.x - row.origin.x,
            px(8.0)
        );
        assert_eq!(
            row.right() - bounds(cx, "test-file.changes").right(),
            px(8.0)
        );
        let cx = render(cx, FixtureKind::MessageRow, 400.0, 100.0);
        let message = bounds(cx, "test-message.root");
        assert_eq!(message.size.width, px(400.0));
        assert_rect(bounds(cx, "test-message-avatar.root"), 0.0, 0.0, 28.0, 28.0);
        assert_eq!(bounds(cx, "test-message.content").origin.x, px(38.0));
        let cx = render(cx, FixtureKind::Composer, 400.0, 140.0);
        let composer = bounds(cx, "test-composer.card");
        assert_rect(composer, 0.0, 0.0, 320.0, 92.0);
        assert_eq!(
            bounds(cx, "test-composer.input").origin.x - composer.origin.x,
            px(13.0)
        );
        assert_eq!(
            composer.right() - bounds(cx, "composer-submit.root").right(),
            px(13.0)
        );
    }

    #[gpui::test]
    fn scroll_surface_keeps_full_bleed_viewport_and_inner_padding(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Scroll, 400.0, 220.0);
        let root = bounds(cx, "test-scroll.root");
        let viewport = bounds(cx, "test-scroll.viewport");
        assert_rect(root, 0.0, 0.0, 320.0, 160.0);
        assert_rect(viewport, 0.0, 0.0, 312.0, 160.0);
        let content = bounds(cx, "test-scroll.content");
        assert_eq!(content.origin, viewport.origin);
        assert_eq!(
            content.size,
            size(px(312.0), px(480.0)),
            "overflow content retains its full height"
        );
        let row = bounds(cx, "scroll-row.root");
        assert_eq!(
            row.origin.x - viewport.origin.x,
            px(16.0),
            "inner wrapper owns padding"
        );
        assert_rect(bounds(cx, "test-scroll.track"), 312.0, 0.0, 8.0, 160.0);
    }

    #[gpui::test]
    fn scroll_surface_dispatches_wheel_scroll_and_paints_a_proportional_thumb(
        cx: &mut TestAppContext,
    ) {
        cx.update(|cx: &mut App| {
            crate::fonts::register(cx);
            crate::ui::text_input::init(cx);
            super::init(cx);
        });
        let handle = SharedScrollHandle::new();
        let assertion_handle = handle.clone();
        let assertion_state_slot = Rc::new(RefCell::new(None));
        let slot = assertion_state_slot.clone();
        let (_, cx) = cx.add_window_view(move |_, cx| {
            let scrollbar = cx.new(|_| {
                ScrollbarState::vertical(
                    super::super::scrollbar::ScrollbarAppearance::Automatic,
                    super::super::scrollbar::ScrollbarPlacement::BesideWhenOverflowing,
                    handle.clone(),
                )
            });
            *slot.borrow_mut() = Some(scrollbar.clone());
            let container = cx.focus_handle();
            Fixture {
                kind: FixtureKind::Scroll,
                modal_focus: ModalFocus {
                    container: container.clone(),
                    initial: container.clone(),
                    first: container.clone(),
                    last: container,
                },
                splitter_drag: SplitterDragState::new(),
                input: cx.new(|cx| TextInput::new("scroll-test-input", "", "", Theme::light(), cx)),
                scrollbar,
            }
        });
        let assertion_state = assertion_state_slot.borrow().clone().unwrap();
        cx.simulate_resize(size(px(400.0), px(220.0)));
        cx.run_until_parked();
        assert_eq!(assertion_handle.bounds().size.height, px(160.0));
        assert_eq!(assertion_handle.max_offset().height, px(320.0));
        let track = bounds(cx, "test-scroll.track");
        let before = assertion_state
            .read_with(cx, |state, _| state.metrics())
            .thumb
            .expect("overflow paints a thumb");
        assert_eq!(before.size, size(px(6.0), px(53.333336)));
        cx.simulate_event(ScrollWheelEvent {
            position: point(px(10.0), px(10.0)),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-80.0))),
            ..Default::default()
        });
        assert_eq!(assertion_handle.offset().y, px(-80.0));
        let after = assertion_state
            .read_with(cx, |state, _| state.metrics())
            .thumb
            .unwrap();
        assert!(after.origin.y > before.origin.y);
        cx.simulate_event(ScrollWheelEvent {
            position: point(px(10.0), px(10.0)),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-1000.0))),
            ..Default::default()
        });
        assert_eq!(assertion_handle.offset().y, px(-320.0));
        assert_eq!(
            assertion_state
                .read_with(cx, |state, _| state.metrics())
                .thumb
                .unwrap()
                .bottom(),
            track.bottom()
        );
    }

    #[gpui::test]
    fn scroll_surface_hides_thumb_and_ignores_wheel_when_content_fits(cx: &mut TestAppContext) {
        struct Fit {
            state: Entity<ScrollbarState>,
        }
        impl Render for Fit {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                ScrollSurface {
                    id: "fit-scroll".into(),
                    theme: Theme::light(),
                    width: Some(320.0),
                    height: Some(160.0),
                    vertical: Some(self.state.clone()),
                    horizontal: None,
                    content: div().w_full().h(px(80.0)).flex_none().into_any_element(),
                }
            }
        }
        let handle = SharedScrollHandle::new();
        let assertion = handle.clone();
        let state_slot = Rc::new(RefCell::new(None));
        let slot = state_slot.clone();
        let (_, cx) = cx.add_window_view(move |_, cx| {
            let state = cx.new(|_| {
                ScrollbarState::vertical(
                    super::super::scrollbar::ScrollbarAppearance::Automatic,
                    super::super::scrollbar::ScrollbarPlacement::BesideWhenOverflowing,
                    handle,
                )
            });
            *slot.borrow_mut() = Some(state.clone());
            Fit { state }
        });
        cx.simulate_resize(size(px(400.0), px(220.0)));
        cx.run_until_parked();
        let state = state_slot.borrow().clone().unwrap();
        let track = bounds(cx, "fit-scroll.track");
        assert_eq!(
            track.size.width,
            px(0.0),
            "beside lane collapses without overflow"
        );
        assert_eq!(assertion.max_offset().height, px(0.0));
        assert!(
            state
                .read_with(cx, |state, _| state.metrics())
                .thumb
                .is_none()
        );
        cx.simulate_event(ScrollWheelEvent {
            position: point(px(10.0), px(10.0)),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-80.0))),
            ..Default::default()
        });
        assert_eq!(assertion.offset().y, px(0.0));
    }

    #[gpui::test]
    fn nested_scroll_surfaces_normalize_one_axis_wheels_and_chain_at_boundaries(
        cx: &mut TestAppContext,
    ) {
        struct Nested {
            outer: Entity<ScrollbarState>,
            inner: Entity<ScrollbarState>,
        }
        impl Render for Nested {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                ScrollSurface {
                    id: "nested-outer".into(),
                    theme: Theme::light(),
                    width: Some(320.0),
                    height: Some(180.0),
                    vertical: Some(self.outer.clone()),
                    horizontal: None,
                    content: div()
                        .debug_selector(|| "nested-outer.content".into())
                        .w_full()
                        .h(px(500.0))
                        .flex_none()
                        .child(ScrollSurface {
                            id: "nested-inner".into(),
                            theme: Theme::light(),
                            width: Some(240.0),
                            height: Some(100.0),
                            vertical: Some(self.inner.clone()),
                            horizontal: None,
                            content: div()
                                .debug_selector(|| "nested-inner.content".into())
                                .w_full()
                                .h(px(300.0))
                                .flex_none()
                                .into_any_element(),
                        })
                        .into_any_element(),
                }
            }
        }

        let outer_handle = SharedScrollHandle::new();
        let inner_handle = SharedScrollHandle::new();
        let outer_assertion = outer_handle.clone();
        let inner_assertion = inner_handle.clone();
        let (nested, cx) = cx.add_window_view(move |_, cx| Nested {
            outer: cx.new(|_| {
                ScrollbarState::vertical(
                    ScrollbarAppearance::Always,
                    ScrollbarPlacement::Overlay,
                    outer_handle,
                )
            }),
            inner: cx.new(|_| {
                ScrollbarState::vertical(
                    ScrollbarAppearance::Always,
                    ScrollbarPlacement::Overlay,
                    inner_handle,
                )
            }),
        });
        cx.simulate_resize(size(px(400.0), px(240.0)));
        cx.run_until_parked();
        assert_eq!(inner_assertion.max_offset().height, px(200.0));
        assert_eq!(outer_assertion.max_offset().height, px(320.0));
        let pointer = bounds(cx, "nested-inner.viewport").center();
        let (outer_state, inner_state) =
            nested.read_with(cx, |nested, _| (nested.outer.clone(), nested.inner.clone()));

        // GPUI redirects perpendicular input for this vertical-only inner viewport.
        cx.simulate_event(ScrollWheelEvent {
            position: pointer,
            delta: ScrollDelta::Pixels(point(px(-40.0), px(0.0))),
            ..Default::default()
        });
        assert_eq!(inner_assertion.offset().y, px(-40.0));
        assert_eq!(outer_assertion.offset().y, px(0.0));
        assert_eq!(inner_state.read_with(cx, |state, _| state.opacity()), 0.50);
        assert_eq!(outer_state.read_with(cx, |state, _| state.opacity()), 0.32);

        // The event that reaches the end belongs to the inner viewport.
        cx.simulate_event(ScrollWheelEvent {
            position: pointer,
            delta: ScrollDelta::Pixels(point(px(0.0), px(-1000.0))),
            ..Default::default()
        });
        assert_eq!(inner_assertion.offset().y, px(-200.0));
        assert_eq!(outer_assertion.offset().y, px(0.0));

        // Once the inner axis is at its end, the next event chains to the ancestor.
        cx.simulate_event(ScrollWheelEvent {
            position: pointer,
            delta: ScrollDelta::Pixels(point(px(0.0), px(-40.0))),
            ..Default::default()
        });
        assert_eq!(inner_assertion.offset().y, px(-200.0));
        assert_eq!(outer_assertion.offset().y, px(-40.0));
        assert_eq!(inner_state.read_with(cx, |state, _| state.opacity()), 0.32);
        assert_eq!(outer_state.read_with(cx, |state, _| state.opacity()), 0.50);

        // The same boundary rule applies toward the start.
        inner_assertion.set_offset(point(px(0.0), px(0.0)));
        cx.simulate_event(ScrollWheelEvent {
            position: pointer,
            delta: ScrollDelta::Pixels(point(px(0.0), px(20.0))),
            ..Default::default()
        });
        assert_eq!(inner_assertion.offset().y, px(0.0));
        assert_eq!(outer_assertion.offset().y, px(-20.0));
    }

    #[gpui::test]
    fn splitter_emits_typed_drag_lifecycle_while_preserving_handle_geometry(
        cx: &mut TestAppContext,
    ) {
        struct Drag {
            log: Rc<RefCell<Vec<SplitterEvent>>>,
            state: SplitterDragState,
        }
        impl Render for Drag {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let log = self.log.clone();
                Splitter {
                    id: "drag-splitter".into(),
                    theme: Theme::light(),
                    width: 320.0,
                    height: 160.0,
                    primary_size: 88.0,
                    drag_state: self.state.clone(),
                    first: div().into_any_element(),
                    second: div().into_any_element(),
                    on_event: Some(Rc::new(move |event, _, _| log.borrow_mut().push(event))),
                }
            }
        }
        let log = Rc::new(RefCell::new(Vec::new()));
        let target = log.clone();
        let (_, cx) = cx.add_window_view(move |_, _| Drag {
            log: target,
            state: SplitterDragState::new(),
        });
        cx.simulate_resize(size(px(400.0), px(220.0)));
        cx.run_until_parked();
        let handle = bounds(cx, "drag-splitter.handle");
        let start = handle.center();
        cx.simulate_event(MouseMoveEvent {
            position: point(px(10.0), px(10.0)),
            pressed_button: Some(MouseButton::Left),
            ..Default::default()
        });
        cx.simulate_event(MouseUpEvent {
            button: MouseButton::Left,
            position: point(px(10.0), px(10.0)),
            ..Default::default()
        });
        assert!(
            log.borrow().is_empty(),
            "move/up without handle-down emit nothing"
        );
        cx.simulate_event(MouseDownEvent {
            button: MouseButton::Left,
            position: start,
            ..Default::default()
        });
        cx.simulate_event(MouseMoveEvent {
            position: point(start.x, start.y + px(12.0)),
            pressed_button: Some(MouseButton::Left),
            ..Default::default()
        });
        cx.simulate_event(MouseUpEvent {
            button: MouseButton::Left,
            position: point(start.x, start.y + px(12.0)),
            ..Default::default()
        });
        let events = log.borrow();
        assert!(
            matches!(
                events.as_slice(),
                [
                    SplitterEvent::DragStarted(_),
                    SplitterEvent::DragMoved(_),
                    SplitterEvent::DragEnded(_)
                ]
            ),
            "events: {events:?}"
        );
    }

    #[gpui::test]
    fn splitter_resolves_panes_eight_pixel_handle_and_hairline(cx: &mut TestAppContext) {
        let cx = render(cx, FixtureKind::Splitter, 400.0, 220.0);
        assert_rect(bounds(cx, "test-splitter.root"), 0.0, 0.0, 320.0, 160.0);
        assert_rect(bounds(cx, "test-splitter.top"), 0.0, 0.0, 320.0, 88.0);
        assert_rect(bounds(cx, "test-splitter.handle"), 0.0, 88.0, 320.0, 8.0);
        assert_rect(bounds(cx, "test-splitter.line"), 0.0, 91.5, 320.0, 1.0);
        assert_rect(bounds(cx, "test-splitter.bottom"), 0.0, 96.0, 320.0, 64.0);
    }

    #[gpui::test]
    fn modal_overlay_takes_initial_focus_and_traps_forward_and_reverse_tab(
        cx: &mut TestAppContext,
    ) {
        struct FocusModal {
            container: FocusHandle,
            first: FocusHandle,
            last: FocusHandle,
        }
        impl Render for FocusModal {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let theme = Theme::light();
                ModalOverlay {
                    id: "focus-modal".into(),
                    theme,
                    placement: OverlayPlacement::Center,
                    focus: ModalFocus {
                        container: self.container.clone(),
                        initial: self.first.clone(),
                        first: self.first.clone(),
                        last: self.last.clone(),
                    },
                    on_dismiss: None,
                    content: div()
                        .flex()
                        .gap(px(8.0))
                        .child(Button {
                            id: "focus-first".into(),
                            theme,
                            label: "First".into(),
                            size: ControlSize::Medium,
                            variant: ButtonVariant::Secondary,
                            icon: None,
                            icon_only: false,
                            disabled: false,
                            force_focused: false,
                            focus_handle: Some(self.first.clone()),
                            on_activate: Some(Rc::new(|_, _| {})),
                        })
                        .child(Button {
                            id: "focus-last".into(),
                            theme,
                            label: "Last".into(),
                            size: ControlSize::Medium,
                            variant: ButtonVariant::Primary,
                            icon: None,
                            icon_only: false,
                            disabled: false,
                            force_focused: false,
                            focus_handle: Some(self.last.clone()),
                            on_activate: Some(Rc::new(|_, _| {})),
                        })
                        .into_any_element(),
                }
            }
        }
        cx.update(super::init);
        let (view, cx) = cx.add_window_view(|_, cx| FocusModal {
            container: cx.focus_handle(),
            first: cx.focus_handle(),
            last: cx.focus_handle(),
        });
        cx.simulate_resize(size(px(400.0), px(300.0)));
        cx.run_until_parked();
        assert!(cx.update(|window, app| view.read(app).first.is_focused(window)));
        cx.update(|_, app| view.update(app, |_, cx| cx.notify()));
        cx.run_until_parked();
        assert!(
            cx.update(|window, app| view.read(app).first.is_focused(window)),
            "stable modal focus survives ordinary re-render"
        );
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, app| view.read(app).last.is_focused(window)));
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, app| view.read(app).first.is_focused(window)));
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, app| view.read(app).last.is_focused(window)));
    }

    #[gpui::test]
    fn modal_overlay_blocks_inner_click_and_dismisses_from_backdrop_or_escape(
        cx: &mut TestAppContext,
    ) {
        struct Overlay {
            dismissals: Rc<RefCell<usize>>,
            focus: ModalFocus,
        }
        impl Render for Overlay {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let count = self.dismissals.clone();
                ModalOverlay {
                    id: "dismiss-modal".into(),
                    theme: Theme::light(),
                    placement: OverlayPlacement::Center,
                    focus: self.focus.clone(),
                    content: div()
                        .debug_selector(|| "dismiss-modal.inner".into())
                        .size(px(100.0))
                        .into_any_element(),
                    on_dismiss: Some(Rc::new(move |_, _| *count.borrow_mut() += 1)),
                }
            }
        }
        cx.update(super::init);
        let count = Rc::new(RefCell::new(0));
        let fixture = count.clone();
        let (_, cx) = cx.add_window_view(move |_, cx| {
            let container = cx.focus_handle();
            Overlay {
                dismissals: fixture,
                focus: ModalFocus {
                    container: container.clone(),
                    initial: container.clone(),
                    first: container.clone(),
                    last: container,
                },
            }
        });
        cx.simulate_resize(size(px(400.0), px(300.0)));
        cx.run_until_parked();
        let inner = bounds(cx, "dismiss-modal.inner").center();
        cx.simulate_click(inner, Modifiers::default());
        assert_eq!(
            *count.borrow(),
            0,
            "dialog content blocks backdrop dismissal"
        );
        cx.simulate_click(point(px(4.0), px(4.0)), Modifiers::default());
        assert_eq!(*count.borrow(), 1);
        cx.simulate_keystrokes("escape");
        assert_eq!(*count.borrow(), 2);
    }

    #[gpui::test]
    fn modal_overlay_resolves_window_scrim_safe_gutter_card_and_content_insets(
        cx: &mut TestAppContext,
    ) {
        let cx = render(cx, FixtureKind::Modal, 720.0, 480.0);
        let overlay = bounds(cx, "test-modal.overlay");
        let dialog = bounds(cx, "test-modal.dialog");
        assert_rect(overlay, 0.0, 0.0, 720.0, 480.0);
        assert_eq!(dialog.size.width, px(360.0));
        assert!(dialog.origin.x >= px(24.0) && overlay.right() - dialog.right() >= px(24.0));
        let header = bounds(cx, "test-modal.header");
        assert_eq!(header.origin.x - dialog.origin.x, px(1.0));
        assert_eq!(header.origin.y - dialog.origin.y, px(1.0));
        assert_eq!(header.size, size(px(358.0), px(60.0)));
        let body = bounds(cx, "test-modal.body");
        let content = bounds(cx, "test-modal.body-content");
        let text = bounds(cx, "test-modal.body-text");
        assert_eq!(
            content.origin.x, body.origin.x,
            "full-bleed wrapper owns padding without moving its box"
        );
        assert_eq!(text.origin.x - body.origin.x, px(20.0));
        assert_eq!(text.origin.y - body.origin.y, px(4.0));
        let footer = bounds(cx, "test-modal.footer");
        let cancel = bounds(cx, "test-modal-cancel.root");
        assert_eq!(
            cancel.origin.y - footer.origin.y,
            px(16.5),
            "resolved border center plus 16px padding"
        );
        assert_eq!(
            footer.right() - bounds(cx, "test-modal-save.root").right(),
            px(20.0)
        );
    }

    #[gpui::test]
    fn text_fields_follow_keyboard_tab_order_without_duplicate_focus_stops(
        cx: &mut TestAppContext,
    ) {
        struct FieldPair {
            first: Entity<TextInput>,
            second: Entity<TextInput>,
        }
        impl Render for FieldPair {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let theme = Theme::light();
                div()
                    .tab_group()
                    .flex()
                    .gap(px(12.0))
                    .child(TextField {
                        id: "tab-field-first".into(),
                        theme,
                        label: None,
                        input: self.first.clone(),
                        size: ControlSize::Medium,
                        width: Some(200.0),
                        icon: None,
                        hint: None,
                        invalid: false,
                        force_focused: false,
                    })
                    .child(TextField {
                        id: "tab-field-second".into(),
                        theme,
                        label: None,
                        input: self.second.clone(),
                        size: ControlSize::Medium,
                        width: Some(200.0),
                        icon: None,
                        hint: None,
                        invalid: false,
                        force_focused: false,
                    })
            }
        }
        cx.update(|cx| {
            crate::fonts::register(cx);
            crate::ui::text_input::init(cx);
        });
        let (pair, cx) = cx.add_window_view(|_, cx| FieldPair {
            first: cx.new(|cx| TextInput::new("tab-input-first", "", "First", Theme::light(), cx)),
            second: cx
                .new(|cx| TextInput::new("tab-input-second", "", "Second", Theme::light(), cx)),
        });
        cx.simulate_resize(size(px(500.0), px(100.0)));
        cx.run_until_parked();
        let first_center = bounds(cx, "tab-input-first.root").center();
        cx.simulate_click(first_center, Modifiers::default());
        assert!(cx.update(|window, app| {
            pair.read(app)
                .first
                .read(app)
                .focus_handle(app)
                .is_focused(window)
        }));
        let control = bounds(cx, "tab-field-first.control");
        let ring = bounds(cx, "tab-field-first.focus-ring");
        assert_eq!(control.origin - ring.origin, point(px(3.0), px(3.0)));
        assert_eq!(
            ring.size,
            size(control.size.width + px(6.0), control.size.height + px(6.0)),
            "focused canvas fills the complete external ring box"
        );
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

    #[gpui::test]
    fn scroll_surface_renders_biaxial_overlay_and_reserved_lane_branches(cx: &mut TestAppContext) {
        struct Branches {
            vertical: Entity<ScrollbarState>,
            horizontal: Entity<ScrollbarState>,
            reserved: Entity<ScrollbarState>,
        }
        impl Render for Branches {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let theme = Theme::light();
                div()
                    .flex()
                    .gap(px(12.0))
                    .child(ScrollSurface {
                        id: "branch-both".into(),
                        theme,
                        width: Some(320.0),
                        height: Some(160.0),
                        vertical: Some(self.vertical.clone()),
                        horizontal: Some(self.horizontal.clone()),
                        content: div()
                            .debug_selector(|| "branch-both.content".into())
                            .size(px(640.0))
                            .flex_none()
                            .into_any_element(),
                    })
                    .child(ScrollSurface {
                        id: "branch-reserved".into(),
                        theme,
                        width: Some(320.0),
                        height: Some(160.0),
                        vertical: Some(self.reserved.clone()),
                        horizontal: None,
                        content: div()
                            .debug_selector(|| "branch-reserved.content".into())
                            .w_full()
                            .h(px(80.0))
                            .flex_none()
                            .into_any_element(),
                    })
            }
        }
        let (_, cx) = cx.add_window_view(|_, cx| {
            let shared = SharedScrollHandle::new();
            Branches {
                vertical: cx.new(|_| {
                    ScrollbarState::vertical(
                        ScrollbarAppearance::Automatic,
                        ScrollbarPlacement::Overlay,
                        shared.clone(),
                    )
                }),
                horizontal: cx.new(|_| {
                    ScrollbarState::horizontal(
                        ScrollbarAppearance::Automatic,
                        ScrollbarPlacement::Overlay,
                        shared,
                    )
                }),
                reserved: cx.new(|_| {
                    ScrollbarState::vertical(
                        ScrollbarAppearance::Always,
                        ScrollbarPlacement::Reserved,
                        SharedScrollHandle::new(),
                    )
                }),
            }
        });
        cx.simulate_resize(size(px(700.0), px(220.0)));
        cx.run_until_parked();
        let both = bounds(cx, "branch-both.viewport");
        assert_rect(both, 0.0, 0.0, 320.0, 160.0);
        assert_rect(bounds(cx, "branch-both.track"), 312.0, 0.0, 8.0, 160.0);
        assert_rect(
            bounds(cx, "branch-both-horizontal.track"),
            0.0,
            152.0,
            320.0,
            8.0,
        );
        assert_rect(
            bounds(cx, "branch-reserved.viewport"),
            332.0,
            0.0,
            312.0,
            160.0,
        );
        assert_rect(bounds(cx, "branch-reserved.track"), 644.0, 0.0, 8.0, 160.0);
        cx.simulate_event(ScrollWheelEvent {
            position: both.center(),
            delta: ScrollDelta::Pixels(point(px(-120.0), px(0.0))),
            ..Default::default()
        });
        assert!(bounds(cx, "branch-both.content").origin.x < px(0.0));
    }

    #[gpui::test]
    fn modal_top_adapts_between_compact_and_tall_windows(cx: &mut TestAppContext) {
        struct Top {
            focus: ModalFocus,
        }
        impl Render for Top {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                ModalOverlay {
                    id: "adaptive-top".into(),
                    theme: Theme::light(),
                    placement: OverlayPlacement::Top,
                    focus: self.focus.clone(),
                    on_dismiss: Some(Rc::new(|_, _| {})),
                    content: div()
                        .debug_selector(|| "adaptive-top.content".into())
                        .size(px(100.0))
                        .h(px(40.0))
                        .into_any_element(),
                }
            }
        }
        cx.update(super::init);
        let (_, cx) = cx.add_window_view(|_, cx| {
            let container = cx.focus_handle();
            Top {
                focus: ModalFocus {
                    container: container.clone(),
                    initial: container.clone(),
                    first: container.clone(),
                    last: container,
                },
            }
        });
        cx.simulate_resize(size(px(400.0), px(480.0)));
        cx.run_until_parked();
        assert_eq!(bounds(cx, "adaptive-top.content").origin.y, px(48.0));
        cx.simulate_resize(size(px(400.0), px(800.0)));
        cx.run_until_parked();
        assert_eq!(bounds(cx, "adaptive-top.content").origin.y, px(128.0));
    }

    #[gpui::test]
    fn maximum_modal_keeps_header_footer_and_scrolling_body_inside_720_by_480(
        cx: &mut TestAppContext,
    ) {
        struct Host {
            focus: ModalFocus,
            scrollbar: Entity<ScrollbarState>,
        }
        impl Render for Host {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let theme = Theme::light();
                ModalOverlay {
                    id: "max-modal".into(),
                    theme,
                    placement: OverlayPlacement::Center,
                    focus: self.focus.clone(),
                    on_dismiss: Some(Rc::new(|_, _| {})),
                    content: Modal {
                        id: "max-modal".into(),
                        theme,
                        size: ModalSize::Large,
                        icon: None,
                        title: "Bounded modal".into(),
                        body: div()
                            .debug_selector(|| "max-modal.long-body".into())
                            .h(px(900.0))
                            .flex_none()
                            .into_any_element(),
                        body_scrollbar: self.scrollbar.clone(),
                        body_height: 552.0,
                        footer: vec![
                            Button {
                                id: "max-modal-close".into(),
                                theme,
                                label: "Close".into(),
                                size: ControlSize::Medium,
                                variant: ButtonVariant::Primary,
                                icon: None,
                                icon_only: false,
                                disabled: false,
                                force_focused: false,
                                focus_handle: Some(self.focus.first.clone()),
                                on_activate: Some(Rc::new(|_, _| {})),
                            }
                            .into_any_element(),
                        ],
                    }
                    .into_any_element(),
                }
            }
        }
        cx.update(super::init);
        let (_, cx) = cx.add_window_view(|_, cx| {
            let container = cx.focus_handle();
            let first = cx.focus_handle();
            Host {
                focus: ModalFocus {
                    container,
                    initial: first.clone(),
                    first: first.clone(),
                    last: first,
                },
                scrollbar: cx.new(|_| {
                    ScrollbarState::vertical(
                        ScrollbarAppearance::Automatic,
                        ScrollbarPlacement::BesideWhenOverflowing,
                        SharedScrollHandle::new(),
                    )
                }),
            }
        });
        cx.simulate_resize(size(px(720.0), px(480.0)));
        cx.run_until_parked();
        let dialog = bounds(cx, "max-modal.dialog");
        assert!(
            dialog.top() >= px(24.0) && dialog.bottom() <= px(456.0),
            "dialog {dialog:?} stays inside overlay safe gutter"
        );
        assert_eq!(dialog.size.height, px(408.0));
        assert_eq!(bounds(cx, "max-modal.body").size.height, px(280.0));
        assert_eq!(
            bounds(cx, "max-modal-body-scroll.track").size.width,
            px(8.0)
        );
        let viewport = bounds(cx, "max-modal-body-scroll.viewport");
        let before = bounds(cx, "max-modal.body-content").origin.y;
        cx.simulate_event(ScrollWheelEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-80.0))),
            ..Default::default()
        });
        assert!(bounds(cx, "max-modal.body-content").origin.y < before);
    }
    #[test]
    fn splitter_mount_lease_clears_an_unmounted_drag_before_remount() {
        let state = SplitterDragState::new();
        let lease = state.lease();
        assert!(state.begin());
        assert!(state.active());
        drop(lease);
        assert!(
            !state.active(),
            "dropping the last rendered listener clears an interrupted drag"
        );
        let _remount = state.lease();
        assert!(
            state.begin(),
            "the same external state can start after remount"
        );
    }

    #[gpui::test]
    fn modal_fill_uses_the_complete_window_with_explicit_close_and_backdrop_dismissal(
        cx: &mut TestAppContext,
    ) {
        struct Fill {
            focus: ModalFocus,
            dismissed: Rc<RefCell<usize>>,
        }
        impl Render for Fill {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let count = self.dismissed.clone();
                let button_count = self.dismissed.clone();
                ModalOverlay {
                    id: "live-fill".into(),
                    theme: Theme::light(),
                    placement: OverlayPlacement::Fill,
                    focus: self.focus.clone(),
                    on_dismiss: Some(Rc::new(move |_, _| *count.borrow_mut() += 1)),
                    content: div()
                        .debug_selector(|| "live-fill.payload".into())
                        .size_full()
                        .relative()
                        .child(
                            div()
                                .id("live-fill-close-block")
                                .on_click(|_, _, cx| cx.stop_propagation())
                                .child(Button {
                                    id: "live-fill-close".into(),
                                    theme: Theme::light(),
                                    label: "Close".into(),
                                    size: ControlSize::Medium,
                                    variant: ButtonVariant::Secondary,
                                    icon: None,
                                    icon_only: false,
                                    disabled: false,
                                    force_focused: false,
                                    focus_handle: Some(self.focus.first.clone()),
                                    on_activate: Some(Rc::new(move |_, _| {
                                        *button_count.borrow_mut() += 1
                                    })),
                                }),
                        )
                        .into_any_element(),
                }
            }
        }
        cx.update(super::init);
        let dismissed = Rc::new(RefCell::new(0));
        let target = dismissed.clone();
        let (_, cx) = cx.add_window_view(move |_, cx| {
            let container = cx.focus_handle();
            let first = cx.focus_handle();
            Fill {
                focus: ModalFocus {
                    container,
                    initial: first.clone(),
                    first: first.clone(),
                    last: first,
                },
                dismissed: target,
            }
        });
        cx.simulate_resize(size(px(720.0), px(480.0)));
        cx.run_until_parked();
        assert_rect(bounds(cx, "live-fill.overlay"), 0.0, 0.0, 720.0, 480.0);
        assert_rect(bounds(cx, "live-fill.content"), 0.0, 0.0, 720.0, 480.0);
        let close = bounds(cx, "live-fill-close.root").center();
        cx.simulate_click(close, Modifiers::default());
        assert_eq!(*dismissed.borrow(), 1);
        cx.simulate_click(point(px(700.0), px(460.0)), Modifiers::default());
        assert_eq!(*dismissed.borrow(), 2);
    }
}
