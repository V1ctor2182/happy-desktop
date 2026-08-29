//! Props-only project context header for the native workspace.

use std::{collections::HashMap, rc::Rc};

use gpui::{
    App, ElementId, FocusHandle, FontWeight, Global, IntoElement, MouseButton, RenderOnce,
    SharedString, WeakFocusHandle, Window, div, prelude::*, px,
};

use super::{
    icon::{Icon, IconName},
    metrics::SURFACE_HEADER_HEIGHT,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const PROJECT_HEADER_HEIGHT: f32 = SURFACE_HEADER_HEIGHT;
pub const PROJECT_HEADER_ACTION_SIZE: f32 = 28.0;

fn part(id: SharedString, name: impl Into<SharedString>) -> impl Fn() -> String {
    let name = name.into();
    move || format!("{id}.{name}")
}

fn child_id(root: &SharedString, kind: &'static str, id: &SharedString) -> ElementId {
    ElementId::NamedChild(
        Box::new(ElementId::Name(root.clone())),
        format!("{kind}:{id}").into(),
    )
}

#[derive(Default)]
struct ProjectHeaderFocusRegistry {
    handles: HashMap<String, WeakFocusHandle>,
}
impl Global for ProjectHeaderFocusRegistry {}

fn stable_focus(cx: &mut App, key: String) -> FocusHandle {
    if let Some(handle) = cx
        .default_global::<ProjectHeaderFocusRegistry>()
        .handles
        .get(&key)
        .and_then(WeakFocusHandle::upgrade)
    {
        return handle;
    }
    let handle = cx.focus_handle();
    cx.default_global::<ProjectHeaderFocusRegistry>()
        .handles
        .insert(key, handle.downgrade());
    handle
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectStatusTone {
    Neutral,
    Available,
    Connecting,
    Unavailable,
    Error,
}

impl ProjectStatusTone {
    fn role(self) -> ThemeRole {
        match self {
            Self::Neutral => ThemeRole::StatusDefault,
            Self::Available => ThemeRole::StatusConnected,
            Self::Connecting => ThemeRole::StatusConnecting,
            Self::Unavailable => ThemeRole::StatusDisconnected,
            Self::Error => ThemeRole::StatusError,
        }
    }
}

#[derive(Clone)]
pub struct ProjectHeaderStatus {
    /// Caller-authored status text. The component never infers a reason.
    pub label: SharedString,
    pub tone: ProjectStatusTone,
}

#[derive(Clone)]
pub struct ProjectHeaderAction {
    /// Stable action identity, independent of its current label.
    pub id: SharedString,
    pub label: SharedString,
    pub icon: IconName,
    pub disabled: bool,
    pub selected: bool,
}

pub type ProjectHeaderActionHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

/// Exact 56px workspace heading. All product data and actions arrive as props.
#[derive(IntoElement)]
pub struct ProjectHeader {
    pub id: SharedString,
    pub theme: Theme,
    pub title: SharedString,
    pub location: Option<SharedString>,
    pub status: Option<ProjectHeaderStatus>,
    pub actions: Vec<ProjectHeaderAction>,
    pub on_action: Option<ProjectHeaderActionHandler>,
}

impl RenderOnce for ProjectHeader {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let root_id = self.id;
        let theme = self.theme;
        let action_enabled = self.on_action.is_some();
        let action_focus: HashMap<SharedString, FocusHandle> = self
            .actions
            .iter()
            .filter(|action| action_enabled && !action.disabled)
            .map(|action| {
                (
                    action.id.clone(),
                    stable_focus(cx, format!("project-header:{root_id}:{}", action.id)),
                )
            })
            .collect();

        div()
            .id(root_id.clone())
            .debug_selector(part(root_id.clone(), "root"))
            .w_full()
            .h(px(PROJECT_HEADER_HEIGHT))
            .flex_none()
            .flex()
            .items_center()
            .gap(px(12.0))
            .px(px(16.0))
            .border_b_1()
            .border_color(theme.role(ThemeRole::Divider))
            .bg(theme.role(ThemeRole::HeaderBackground))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "context"))
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .debug_selector(part(root_id.clone(), "title"))
                            .flex_1()
                            .min_w_0()
                            .max_w(px(280.0))
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .text_size(px(15.0))
                            .line_height(px(20.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(self.title),
                    )
                    .children(self.location.map(|location| {
                        div()
                            .debug_selector(part(root_id.clone(), "location"))
                            .min_w_0()
                            .flex_1()
                            .overflow_hidden()
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .font_family(fonts::MONO_FAMILY)
                            .text_size(px(11.0))
                            .line_height(px(16.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(Icon::decorative(
                                IconName::Branch,
                                14.0,
                                theme.role(ThemeRole::TextSecondary).into(),
                                format!("{root_id}.location-icon"),
                            ))
                            .child(
                                div()
                                    .debug_selector(part(root_id.clone(), "location-label"))
                                    .flex_1()
                                    .min_w_0()
                                    .overflow_hidden()
                                    .whitespace_nowrap()
                                    .text_ellipsis()
                                    .child(location),
                            )
                    }))
                    .children(self.status.map(|status| {
                        let color = theme.role(status.tone.role());
                        div()
                            .debug_selector(part(root_id.clone(), "status"))
                            .flex_none()
                            .h(px(24.0))
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .px(px(8.0))
                            .rounded_full()
                            .bg(theme.role(ThemeRole::SurfaceHigh))
                            .text_size(px(11.0))
                            .line_height(px(16.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(Icon::labelled(
                                IconName::Dot,
                                status.label.clone(),
                                8.0,
                                color.into(),
                                format!("{root_id}.status-icon"),
                            ))
                            .child(status.label)
                    })),
            )
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "actions"))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .children(self.actions.into_iter().map(|action| {
                        let action_id = action.id.clone();
                        let selector = format!("action-{action_id}");
                        let focus = action_focus.get(&action_id).cloned();
                        let callback = self.on_action.clone();
                        let enabled = callback.is_some() && !action.disabled;
                        let pointer_id = action_id.clone();
                        let keyboard_id = action_id.clone();
                        let label = action.label.clone();
                        div()
                            .id(child_id(&root_id, "action", &action_id))
                            .debug_selector(part(root_id.clone(), selector))
                            .relative()
                            .size(px(PROJECT_HEADER_ACTION_SIZE))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(6.0))
                            .bg(if action.selected {
                                theme.role(ThemeRole::SurfaceSelected)
                            } else {
                                theme.role(ThemeRole::HeaderBackground)
                            })
                            .opacity(if action.disabled { 0.48 } else { 1.0 })
                            .when_some(focus, |button, focus| {
                                let pointer_focus = focus.clone();
                                button
                                    .track_focus(&focus.tab_index(0).tab_stop(enabled))
                                    .focus(|style| {
                                        style
                                            .border_2()
                                            .border_color(theme.role(ThemeRole::RadioActive))
                                    })
                                    .cursor_pointer()
                                    .on_mouse_down(MouseButton::Left, move |_, window, _| {
                                        pointer_focus.focus(window);
                                    })
                            })
                            .when(enabled, |button| {
                                let pointer = callback.clone().unwrap();
                                let keyboard = callback.clone().unwrap();
                                button
                                    .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                        pointer(pointer_id.clone(), window, cx);
                                    })
                                    .on_key_down(move |event, window, cx| {
                                        if !event.is_held
                                            && matches!(
                                                event.keystroke.key.as_str(),
                                                "enter" | "space" | " "
                                            )
                                        {
                                            cx.stop_propagation();
                                            keyboard(keyboard_id.clone(), window, cx);
                                        }
                                    })
                            })
                            .child(Icon::labelled(
                                action.icon,
                                label,
                                16.0,
                                theme.role(ThemeRole::HeaderTintSecondary).into(),
                                format!("{root_id}.action-{action_id}.icon"),
                            ))
                    })),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        App, Bounds, Context, Pixels, Render, TestAppContext, VisualTestContext, Window, px, size,
    };

    struct Fixture {
        theme: Theme,
        width: f32,
    }
    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            div().w(px(self.width)).child(ProjectHeader {
                id: "project-header".into(),
                theme: self.theme,
                title: "A project title that must truncate before actions move".into(),
                location: Some("~/Developer/happy/a/very/long/worktree/location".into()),
                status: Some(ProjectHeaderStatus {
                    label: "Reconnecting".into(),
                    tone: ProjectStatusTone::Connecting,
                }),
                actions: vec![
                    ProjectHeaderAction {
                        id: "open".into(),
                        label: "Open in".into(),
                        icon: IconName::ArrowRight,
                        disabled: false,
                        selected: false,
                    },
                    ProjectHeaderAction {
                        id: "panel".into(),
                        label: "Show panel".into(),
                        icon: IconName::PanelExpand,
                        disabled: false,
                        selected: false,
                    },
                ],
                on_action: Some(Rc::new(|_, _, _| {})),
            })
        }
    }
    fn render(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        theme: Theme,
    ) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let (_, cx) = cx.add_window_view(move |_, _| Fixture { theme, width });
        cx.simulate_resize(size(px(width.max(720.0)), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }
    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector).unwrap()
    }

    #[gpui::test]
    fn project_header_keeps_exact_geometry_in_reference_light(cx: &mut TestAppContext) {
        let cx = render(cx, 1280.0, 800.0, Theme::light());
        let root = bounds(cx, "project-header.root");
        assert_eq!(root.size, size(px(1280.0), px(56.0)));
        assert_eq!(bounds(cx, "project-header.actions").size.height, px(28.0));
        assert_eq!(
            bounds(cx, "project-header.action-panel").size,
            size(px(28.0), px(28.0))
        );
    }

    #[gpui::test]
    fn project_header_truncates_at_minimum_dark_and_at_220_main_width(cx: &mut TestAppContext) {
        let cx = render(cx, 220.0, 480.0, Theme::dark());
        let root = bounds(cx, "project-header.root");
        let context = bounds(cx, "project-header.context");
        let actions = bounds(cx, "project-header.actions");
        assert_eq!(root.size, size(px(220.0), px(56.0)));
        assert!(
            context.right() <= actions.origin.x,
            "context truncates before fixed actions"
        );
        assert_eq!(actions.size.width, px(60.0));
        for selector in [
            "project-header.title",
            "project-header.location",
            "project-header.location-label",
        ] {
            let descendant = bounds(cx, selector);
            assert!(
                descendant.right() <= actions.origin.x,
                "{selector} stays before fixed actions: {descendant:?} vs {actions:?}"
            );
        }
    }
}
