//! Props-only inspector tabs with caller-owned focus and scroll identity.

use std::{rc::Rc, sync::Arc};

use gpui::{
    App, ElementId, Entity, FocusHandle, FontWeight, IntoElement, MouseButton, RenderOnce,
    SharedString, Window, div, prelude::*, px,
};

use super::components::ScrollSurface;
use super::{Icon, IconName, ScrollbarState, theme_roles::ThemeRole};
use crate::{fonts, theme::Theme};

pub const WORKSPACE_INSPECTOR_TABS_HEIGHT: f32 = 36.0;

fn child_id(root: &SharedString, kind: &'static str, id: &SharedString) -> ElementId {
    ElementId::NamedChild(
        Box::new(ElementId::Name(root.clone())),
        format!("{kind}:{id}").into(),
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceInspectorTabKind {
    Files,
    Activity,
    Usage,
    Preview,
    Terminal,
    Browser,
}
impl WorkspaceInspectorTabKind {
    fn icon(self) -> IconName {
        match self {
            Self::Files => IconName::Files,
            Self::Activity => IconName::Zap,
            Self::Usage => IconName::Clock,
            Self::Preview => IconName::Eye,
            Self::Terminal => IconName::Terminal,
            Self::Browser => IconName::Globe,
        }
    }
}

#[derive(Clone)]
pub struct WorkspaceInspectorTabItem {
    pub id: SharedString,
    pub label: SharedString,
    pub kind: WorkspaceInspectorTabKind,
    pub selected: bool,
    pub focus: FocusHandle,
    pub close_focus: Option<FocusHandle>,
    pub transfer_focus: Option<FocusHandle>,
}

pub type WorkspaceInspectorTabHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceInspectorTabMove {
    Previous,
    Next,
}

pub type WorkspaceInspectorTabMoveHandler =
    Rc<dyn Fn(SharedString, WorkspaceInspectorTabMove, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct WorkspaceInspectorTabs {
    pub id: SharedString,
    pub theme: Theme,
    pub items: Arc<Vec<WorkspaceInspectorTabItem>>,
    pub scrollbar: Entity<ScrollbarState>,
    pub on_select: WorkspaceInspectorTabHandler,
    pub on_close: WorkspaceInspectorTabHandler,
    pub on_transfer: WorkspaceInspectorTabHandler,
    pub on_move: WorkspaceInspectorTabMoveHandler,
}

impl RenderOnce for WorkspaceInspectorTabs {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let enabled: Vec<_> = self
            .items
            .iter()
            .map(|item| (item.id.clone(), item.focus.clone()))
            .collect();
        let root_id = self.id;
        let theme = self.theme;
        let on_select = self.on_select;
        let on_close = self.on_close;
        let on_transfer = self.on_transfer;
        let on_move = self.on_move;
        let content = div()
            .h(px(WORKSPACE_INSPECTOR_TABS_HEIGHT))
            .flex()
            .items_center()
            .children(self.items.iter().cloned().enumerate().map(|(index, item)| {
                let id = item.id.clone();
                let pointer_id = id.clone();
                let keyboard_id = id.clone();
                let focus = item.focus.clone();
                let select_pointer = on_select.clone();
                let select_keyboard = on_select.clone();
                let move_keyboard = on_move.clone();
                let keyboard_items = enabled.clone();
                let selected = item.selected;
                let movable = item.transfer_focus.is_some();
                let row = div()
                    .id(child_id(&root_id, "tab", &id))
                    .h(px(WORKSPACE_INSPECTOR_TABS_HEIGHT))
                    .max_w(px(180.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(10.0))
                    .track_focus(&focus.clone().tab_index(0).tab_stop(selected))
                    .font_family(fonts::UI_FAMILY)
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(if selected {
                        theme.role(ThemeRole::Text)
                    } else {
                        theme.role(ThemeRole::TextSecondary)
                    })
                    .bg(if selected {
                        theme.role(ThemeRole::SurfaceSelected)
                    } else {
                        theme.role(ThemeRole::Surface)
                    })
                    .cursor_pointer()
                    .on_mouse_down(MouseButton::Left, move |_, window, _| focus.focus(window))
                    .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                        select_pointer(pointer_id.clone(), window, cx)
                    })
                    .on_key_down(move |event, window, cx| {
                        if event.is_held {
                            return;
                        }
                        let key = event.keystroke.key.as_str();
                        if event.keystroke.modifiers.shift
                            && movable
                            && matches!(key, "left" | "right")
                        {
                            cx.stop_propagation();
                            move_keyboard(
                                keyboard_id.clone(),
                                if key == "left" {
                                    WorkspaceInspectorTabMove::Previous
                                } else {
                                    WorkspaceInspectorTabMove::Next
                                },
                                window,
                                cx,
                            );
                            return;
                        }
                        if matches!(key, "enter" | "space" | " ") {
                            cx.stop_propagation();
                            select_keyboard(keyboard_id.clone(), window, cx);
                            return;
                        }
                        let target = match key {
                            "left" if !keyboard_items.is_empty() => {
                                Some((index + keyboard_items.len() - 1) % keyboard_items.len())
                            }
                            "right" if !keyboard_items.is_empty() => {
                                Some((index + 1) % keyboard_items.len())
                            }
                            "home" if !keyboard_items.is_empty() => Some(0),
                            "end" if !keyboard_items.is_empty() => Some(keyboard_items.len() - 1),
                            _ => None,
                        };
                        if let Some(target) = target {
                            cx.stop_propagation();
                            let (id, focus) = &keyboard_items[target];
                            focus.focus(window);
                            select_keyboard(id.clone(), window, cx);
                        }
                    })
                    .child(Icon::decorative(
                        item.kind.icon(),
                        14.0,
                        theme.role(ThemeRole::TextSecondary).into(),
                        format!("{root_id}.tab-{id}.icon"),
                    ))
                    .child(
                        div()
                            .min_w_0()
                            .overflow_hidden()
                            .text_ellipsis()
                            .child(item.label),
                    );
                let row = if let Some(transfer_focus) = item.transfer_focus {
                    let transfer_pointer = on_transfer.clone();
                    let transfer_keyboard = on_transfer.clone();
                    let transfer_pointer_id = id.clone();
                    let transfer_keyboard_id = id.clone();
                    let pointer_focus = transfer_focus.clone();
                    row.child(
                        div()
                            .id(child_id(&root_id, "transfer", &id))
                            .track_focus(&transfer_focus.tab_index(0).tab_stop(true))
                            .flex_none()
                            .child(Icon::decorative(
                                IconName::PanelExpand,
                                12.0,
                                theme.role(ThemeRole::TextSecondary).into(),
                                format!("{root_id}.tab-{id}.transfer-icon"),
                            ))
                            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                cx.stop_propagation();
                                pointer_focus.focus(window);
                            })
                            .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                cx.stop_propagation();
                                transfer_pointer(transfer_pointer_id.clone(), window, cx);
                            })
                            .on_key_down(move |event, window, cx| {
                                if !event.is_held
                                    && matches!(
                                        event.keystroke.key.as_str(),
                                        "enter" | "space" | " "
                                    )
                                {
                                    cx.stop_propagation();
                                    transfer_keyboard(transfer_keyboard_id.clone(), window, cx);
                                }
                            }),
                    )
                } else {
                    row
                };
                if let Some(close_focus) = item.close_focus {
                    let close_pointer = on_close.clone();
                    let close_keyboard = on_close.clone();
                    let close_pointer_id = id.clone();
                    let close_keyboard_id = id.clone();
                    let pointer_focus = close_focus.clone();
                    row.child(
                        div()
                            .id(child_id(&root_id, "close", &id))
                            .track_focus(&close_focus.tab_index(0).tab_stop(true))
                            .flex_none()
                            .child(Icon::decorative(
                                IconName::Close,
                                12.0,
                                theme.role(ThemeRole::TextSecondary).into(),
                                format!("{root_id}.tab-{id}.close-icon"),
                            ))
                            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                cx.stop_propagation();
                                pointer_focus.focus(window);
                            })
                            .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                cx.stop_propagation();
                                close_pointer(close_pointer_id.clone(), window, cx);
                            })
                            .on_key_down(move |event, window, cx| {
                                if !event.is_held
                                    && matches!(
                                        event.keystroke.key.as_str(),
                                        "enter" | "space" | " "
                                    )
                                {
                                    cx.stop_propagation();
                                    close_keyboard(close_keyboard_id.clone(), window, cx);
                                }
                            }),
                    )
                } else {
                    row
                }
            }));
        div()
            .h(px(WORKSPACE_INSPECTOR_TABS_HEIGHT))
            .flex_none()
            .border_b_1()
            .border_color(theme.role(ThemeRole::Divider))
            .child(ScrollSurface {
                id: root_id,
                theme,
                width: None,
                height: None,
                vertical: None,
                horizontal: Some(self.scrollbar),
                content: content.into_any_element(),
            })
    }
}
