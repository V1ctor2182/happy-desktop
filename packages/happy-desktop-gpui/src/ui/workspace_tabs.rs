//! Ordered mixed workspace tabs and their create/recent affordances.

use std::{collections::HashMap, rc::Rc};

use gpui::{
    App, ElementId, Entity, FocusHandle, FontWeight, Global, IntoElement, MouseButton, RenderOnce,
    SharedString, WeakFocusHandle, Window, div, prelude::*, px,
};

use super::{
    components::ScrollSurface,
    icon::{Icon, IconName},
    scrollbar::ScrollbarState,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const WORKSPACE_TABS_HEIGHT: f32 = 32.0;
pub const WORKSPACE_TAB_MAX_WIDTH: f32 = 200.0;
pub const WORKSPACE_TAB_CONTROL_SIZE: f32 = 28.0;
pub const RECENT_SESSIONS_MENU_MAX_WIDTH: f32 = 300.0;
pub const RECENT_SESSIONS_MENU_MAX_HEIGHT: f32 = 320.0;

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
struct WorkspaceTabsFocusRegistry {
    handles: HashMap<String, WeakFocusHandle>,
}
impl Global for WorkspaceTabsFocusRegistry {}
fn stable_focus(cx: &mut App, key: String) -> FocusHandle {
    {
        let registry = cx.default_global::<WorkspaceTabsFocusRegistry>();
        registry.handles.retain(|_, weak| weak.upgrade().is_some());
        if let Some(handle) = registry
            .handles
            .get(&key)
            .and_then(WeakFocusHandle::upgrade)
        {
            return handle;
        }
    }
    let handle = cx.focus_handle();
    cx.default_global::<WorkspaceTabsFocusRegistry>()
        .handles
        .insert(key, handle.downgrade());
    handle
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceTabKind {
    Session,
    File,
    Terminal,
    Browser,
    Activity,
}
impl WorkspaceTabKind {
    fn icon(self) -> IconName {
        match self {
            Self::Session => IconName::Chat,
            Self::File => IconName::Doc,
            Self::Terminal => IconName::Terminal,
            Self::Browser => IconName::Globe,
            Self::Activity => IconName::Zap,
        }
    }
}

#[derive(Clone)]
pub struct WorkspaceTabItem {
    /// Stable product identity. Order is exactly the caller's vector order.
    pub id: SharedString,
    pub label: SharedString,
    pub kind: WorkspaceTabKind,
    pub active: bool,
    pub unread: bool,
    pub waiting: bool,
    pub running: bool,
    pub disabled: bool,
    pub closable: bool,
}

#[derive(Clone)]
pub struct RecentSessionItem {
    pub id: SharedString,
    pub label: SharedString,
    pub detail: Option<SharedString>,
    pub disabled: bool,
}

#[derive(Clone)]
pub struct RecentSessionsAffordance {
    pub label: SharedString,
    pub open: bool,
    /// These are only choices. This component never guesses archive/delete actions.
    pub items: Vec<RecentSessionItem>,
}

#[derive(Clone)]
pub struct WorkspaceCreateAffordance {
    pub label: SharedString,
    pub disabled: bool,
}

pub type WorkspaceTabHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceTabMove {
    Previous,
    Next,
}
pub type WorkspaceTabMoveHandler =
    Rc<dyn Fn(SharedString, WorkspaceTabMove, &mut Window, &mut App)>;
pub type WorkspaceTabsActionHandler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct WorkspaceTabs {
    pub id: SharedString,
    pub theme: Theme,
    pub tabs: Vec<WorkspaceTabItem>,
    pub create: Option<WorkspaceCreateAffordance>,
    pub recent: Option<RecentSessionsAffordance>,
    /// Caller-owned horizontal state. Its handle preserves the tab-strip position.
    pub tabs_scrollbar: Entity<ScrollbarState>,
    /// Caller-owned vertical state for the Recent menu. Required when Recent is open.
    pub recent_scrollbar: Option<Entity<ScrollbarState>>,
    pub on_select: Option<WorkspaceTabHandler>,
    pub on_close: Option<WorkspaceTabHandler>,
    /// Stable-ID reorder intent. Shift+Left/Right emits Previous/Next.
    pub on_move: Option<WorkspaceTabMoveHandler>,
    pub on_create: Option<WorkspaceTabsActionHandler>,
    pub on_recent_toggle: Option<WorkspaceTabsActionHandler>,
    pub on_recent_select: Option<WorkspaceTabHandler>,
}

impl RenderOnce for WorkspaceTabs {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let root_id = self.id;
        let theme = self.theme;
        let tabs_scrollbar = self.tabs_scrollbar.clone();
        let recent_scrollbar = self.recent_scrollbar.clone();
        let select_enabled = self.on_select.is_some();
        let focus_handles: Vec<Option<FocusHandle>> = self
            .tabs
            .iter()
            .map(|tab| {
                (select_enabled && !tab.disabled)
                    .then(|| stable_focus(cx, format!("workspace-tabs:{root_id}:tab:{}", tab.id)))
            })
            .collect();
        let enabled: Rc<Vec<(SharedString, FocusHandle)>> = Rc::new(
            self.tabs
                .iter()
                .zip(focus_handles.iter())
                .filter_map(|(tab, focus)| focus.clone().map(|focus| (tab.id.clone(), focus)))
                .collect(),
        );
        let entry_index = self
            .tabs
            .iter()
            .position(|tab| tab.active && !tab.disabled)
            .or_else(|| self.tabs.iter().position(|tab| !tab.disabled));
        let close_focus: HashMap<SharedString, FocusHandle> = self
            .tabs
            .iter()
            .filter(|tab| tab.closable && !tab.disabled && self.on_close.is_some())
            .map(|tab| {
                (
                    tab.id.clone(),
                    stable_focus(cx, format!("workspace-tabs:{root_id}:close:{}", tab.id)),
                )
            })
            .collect();
        let create_focus = self
            .create
            .as_ref()
            .map(|_| stable_focus(cx, format!("workspace-tabs:{root_id}:create")));
        let recent_focus = self
            .recent
            .as_ref()
            .map(|_| stable_focus(cx, format!("workspace-tabs:{root_id}:recent")));
        let recent_item_focus: HashMap<SharedString, FocusHandle> = self
            .recent
            .as_ref()
            .map(|recent| {
                recent
                    .items
                    .iter()
                    .filter(|item| !item.disabled && self.on_recent_select.is_some())
                    .map(|item| {
                        (
                            item.id.clone(),
                            stable_focus(
                                cx,
                                format!("workspace-tabs:{root_id}:recent-item:{}", item.id),
                            ),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();

        let tab_elements: Vec<_> = self
            .tabs
            .into_iter()
            .enumerate()
            .map(|(index, tab)| {
                let id = tab.id.clone();
                let selector: SharedString = format!("tab-{id}").into();
                let focus = focus_handles[index].clone();
                let enabled_position = enabled.iter().position(|(candidate, _)| candidate == &id);
                let select = self.on_select.clone();
                let close = self.on_close.clone();
                let move_tab = self.on_move.clone();
                let close_handle = close_focus.get(&id).cloned();
                let disabled = tab.disabled;
                let closable = tab.closable;
                let select_pointer_id = id.clone();
                let select_keyboard_id = id.clone();
                let close_pointer_id = id.clone();
                let close_keyboard_id = id.clone();
                let icon_color = if tab.active {
                    theme.role(ThemeRole::Text)
                } else {
                    theme.role(ThemeRole::TextSecondary)
                };
                div()
                    .id(child_id(&root_id, "tab", &id))
                    .debug_selector(part(root_id.clone(), selector.clone()))
                    .relative()
                    .h(px(WORKSPACE_TABS_HEIGHT))
                    .max_w(px(WORKSPACE_TAB_MAX_WIDTH))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(12.0))
                    .font_family(fonts::UI_FAMILY)
                    .text_size(px(12.0))
                    .line_height(px(16.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(if tab.active {
                        theme.role(ThemeRole::Text)
                    } else {
                        theme.role(ThemeRole::TextSecondary)
                    })
                    .opacity(if disabled { 0.48 } else { 1.0 })
                    .when_some(focus, |row, focus| {
                        let pointer_focus = focus.clone();
                        let keyboard_select = select.clone().unwrap();
                        let keyboard_enabled = enabled.clone();
                        let position = enabled_position.unwrap();
                        row.track_focus(&focus.tab_index(0).tab_stop(entry_index == Some(index)))
                            .focus(|style| style.bg(theme.role(ThemeRole::SurfaceSelected)))
                            .cursor_pointer()
                            .on_mouse_down(MouseButton::Left, move |_, window, _| {
                                pointer_focus.focus(window)
                            })
                            .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                select.clone().unwrap()(select_pointer_id.clone(), window, cx)
                            })
                            .on_key_down(move |event, window, cx| {
                                let key = event.keystroke.key.as_str();
                                if event.is_held {
                                    return;
                                }
                                if event.keystroke.modifiers.shift
                                    && matches!(key, "left" | "right")
                                {
                                    if let Some(move_tab) = &move_tab {
                                        cx.stop_propagation();
                                        move_tab(
                                            select_keyboard_id.clone(),
                                            if key == "left" {
                                                WorkspaceTabMove::Previous
                                            } else {
                                                WorkspaceTabMove::Next
                                            },
                                            window,
                                            cx,
                                        );
                                    }
                                    return;
                                }
                                if matches!(key, "enter" | "space" | " ") {
                                    cx.stop_propagation();
                                    keyboard_select(select_keyboard_id.clone(), window, cx);
                                    return;
                                }
                                let target = match key {
                                    "left" if !keyboard_enabled.is_empty() => Some(
                                        (position + keyboard_enabled.len() - 1)
                                            % keyboard_enabled.len(),
                                    ),
                                    "right" if !keyboard_enabled.is_empty() => {
                                        Some((position + 1) % keyboard_enabled.len())
                                    }
                                    "home" if !keyboard_enabled.is_empty() => Some(0),
                                    "end" if !keyboard_enabled.is_empty() => {
                                        Some(keyboard_enabled.len() - 1)
                                    }
                                    _ => None,
                                };
                                if let Some(target) = target {
                                    cx.stop_propagation();
                                    let (id, focus) = &keyboard_enabled[target];
                                    focus.focus(window);
                                    keyboard_select(id.clone(), window, cx);
                                }
                            })
                    })
                    .child(
                        div()
                            .debug_selector(part(root_id.clone(), format!("{selector}.leading")))
                            .relative()
                            .size(px(14.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(Icon::decorative(
                                tab.kind.icon(),
                                14.0,
                                icon_color.into(),
                                format!("{root_id}.{selector}.icon"),
                            ))
                            .when(tab.unread, |lane| {
                                lane.child(
                                    div()
                                        .debug_selector(part(
                                            root_id.clone(),
                                            format!("{selector}.unread"),
                                        ))
                                        .absolute()
                                        .top(px(-1.0))
                                        .right(px(-1.0))
                                        .size(px(6.0))
                                        .rounded_full()
                                        .bg(theme.role(ThemeRole::TextLink)),
                                )
                            }),
                    )
                    .child(
                        div()
                            .debug_selector(part(root_id.clone(), format!("{selector}.label")))
                            .min_w_0()
                            .truncate()
                            .child(tab.label),
                    )
                    .when(tab.running || tab.waiting, |row| {
                        row.child(Icon::labelled(
                            if tab.running {
                                IconName::Spark
                            } else {
                                IconName::Clock
                            },
                            if tab.running { "Running" } else { "Waiting" },
                            12.0,
                            theme
                                .role(if tab.running {
                                    ThemeRole::StatusConnected
                                } else {
                                    ThemeRole::Warning
                                })
                                .into(),
                            format!("{root_id}.{selector}.activity"),
                        ))
                    })
                    .when(closable, |row| {
                        let close_enabled = close.is_some() && !disabled;
                        row.child(
                            div()
                                .id(child_id(&root_id, "close", &id))
                                .debug_selector(part(root_id.clone(), format!("{selector}.close")))
                                .size(px(20.0))
                                .flex_none()
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded(px(4.0))
                                .opacity(if close_enabled { 1.0 } else { 0.48 })
                                .when_some(close_handle, |button, focus| {
                                    let pointer_focus = focus.clone();
                                    button
                                        .track_focus(&focus.tab_index(0).tab_stop(close_enabled))
                                        .focus(|style| {
                                            style
                                                .border_2()
                                                .border_color(theme.role(ThemeRole::RadioActive))
                                        })
                                        .cursor_pointer()
                                        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                            cx.stop_propagation();
                                            pointer_focus.focus(window);
                                        })
                                })
                                .when(close_enabled, |button| {
                                    let pointer = close.clone().unwrap();
                                    let keyboard = close.clone().unwrap();
                                    button
                                        .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                            cx.stop_propagation();
                                            pointer(close_pointer_id.clone(), window, cx);
                                        })
                                        .on_key_down(move |event, window, cx| {
                                            if !event.is_held
                                                && matches!(
                                                    event.keystroke.key.as_str(),
                                                    "enter" | "space" | " "
                                                )
                                            {
                                                cx.stop_propagation();
                                                keyboard(close_keyboard_id.clone(), window, cx);
                                            }
                                        })
                                })
                                .child(Icon::labelled(
                                    IconName::Close,
                                    format!("Close {}", id),
                                    12.0,
                                    theme.role(ThemeRole::TextSecondary).into(),
                                    format!("{root_id}.{selector}.close-icon"),
                                )),
                        )
                    })
                    .when(tab.active, |row| {
                        row.child(
                            div()
                                .debug_selector(part(
                                    root_id.clone(),
                                    format!("{selector}.underline"),
                                ))
                                .absolute()
                                .left_0()
                                .right_0()
                                .bottom(px(-1.0))
                                .h(px(2.0))
                                .bg(theme.role(ThemeRole::TextLink)),
                        )
                    })
            })
            .collect();

        let create = self.create.map(|create| {
            let enabled = !create.disabled && self.on_create.is_some();
            let pointer = self.on_create.clone();
            let keyboard = self.on_create.clone();
            div()
                .id(child_id(&root_id, "control", &"create".into()))
                .debug_selector(part(root_id.clone(), "create"))
                .size(px(WORKSPACE_TAB_CONTROL_SIZE))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.0))
                .opacity(if create.disabled { 0.48 } else { 1.0 })
                .when_some(create_focus, |button, focus| {
                    let pointer_focus = focus.clone();
                    button
                        .track_focus(&focus.tab_index(0).tab_stop(enabled))
                        .focus(|style| {
                            style
                                .border_2()
                                .border_color(theme.role(ThemeRole::RadioActive))
                        })
                        .when(enabled, |v| {
                            v.cursor_pointer()
                                .on_mouse_down(MouseButton::Left, move |_, window, _| {
                                    pointer_focus.focus(window)
                                })
                        })
                })
                .when(enabled, |button| {
                    button
                        .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                            pointer.clone().unwrap()(window, cx)
                        })
                        .on_key_down(move |event, window, cx| {
                            if !event.is_held
                                && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                            {
                                cx.stop_propagation();
                                keyboard.clone().unwrap()(window, cx);
                            }
                        })
                })
                .child(Icon::labelled(
                    IconName::Plus,
                    create.label,
                    14.0,
                    theme.role(ThemeRole::TextSecondary).into(),
                    format!("{root_id}.create.icon"),
                ))
        });

        let recent_open = self
            .recent
            .as_ref()
            .map(|recent| recent.open)
            .unwrap_or(false);
        let recent_menu = self
            .recent
            .as_ref()
            .filter(|recent| recent.open)
            .map(|recent| {
                let scrollbar = recent_scrollbar
                    .clone()
                    .expect("open Recent sessions requires recent_scrollbar");
                let rows = div()
                    .debug_selector(part(root_id.clone(), "recent-list-content"))
                    .w_full()
                    .flex()
                    .flex_col()
                    .p(px(4.0))
                    .children(recent.items.iter().cloned().map(|item| {
                        let item_id = item.id.clone();
                        let selector = format!("recent-{item_id}");
                        let callback = self.on_recent_select.clone();
                        let enabled = callback.is_some() && !item.disabled;
                        let pointer_id = item_id.clone();
                        let keyboard_id = item_id.clone();
                        let focus = recent_item_focus.get(&item_id).cloned();
                        div()
                            .id(child_id(&root_id, "recent", &item_id))
                            .debug_selector(part(root_id.clone(), selector.clone()))
                            .w_full()
                            .h(px(40.0))
                            .flex_none()
                            .flex()
                            .flex_col()
                            .justify_center()
                            .gap(px(2.0))
                            .px(px(8.0))
                            .rounded(px(6.0))
                            .opacity(if item.disabled { 0.48 } else { 1.0 })
                            .when_some(focus, |row, focus| {
                                let pointer_focus = focus.clone();
                                row.track_focus(&focus.tab_index(0).tab_stop(enabled))
                                    .focus(|style| style.bg(theme.role(ThemeRole::SurfaceSelected)))
                                    .cursor_pointer()
                                    .on_mouse_down(MouseButton::Left, move |_, window, _| {
                                        pointer_focus.focus(window)
                                    })
                            })
                            .when(enabled, |row| {
                                let pointer = callback.clone().unwrap();
                                let keyboard = callback.clone().unwrap();
                                row.on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                    pointer(pointer_id.clone(), window, cx)
                                })
                                .on_key_down(
                                    move |event, window, cx| {
                                        if !event.is_held
                                            && matches!(
                                                event.keystroke.key.as_str(),
                                                "enter" | "space" | " "
                                            )
                                        {
                                            cx.stop_propagation();
                                            keyboard(keyboard_id.clone(), window, cx);
                                        }
                                    },
                                )
                            })
                            .child(
                                div()
                                    .debug_selector(part(
                                        root_id.clone(),
                                        format!("{selector}.label"),
                                    ))
                                    .overflow_hidden()
                                    .text_size(px(12.0))
                                    .line_height(px(16.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(item.label),
                            )
                            .children(item.detail.map(|detail| {
                                div()
                                    .debug_selector(part(
                                        root_id.clone(),
                                        format!("{selector}.detail"),
                                    ))
                                    .overflow_hidden()
                                    .font_family(fonts::MONO_FAMILY)
                                    .text_size(px(10.0))
                                    .line_height(px(14.0))
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(detail)
                            }))
                    }));
                div()
                    .debug_selector(part(root_id.clone(), "recent-menu-position"))
                    .absolute()
                    .left(px(4.0))
                    .right(px(4.0))
                    .top(px(WORKSPACE_TABS_HEIGHT))
                    .h(px(RECENT_SESSIONS_MENU_MAX_HEIGHT))
                    .flex()
                    .justify_end()
                    .child(
                        div()
                            .debug_selector(part(root_id.clone(), "recent-menu"))
                            .w_full()
                            .h_full()
                            .max_w(px(RECENT_SESSIONS_MENU_MAX_WIDTH))
                            .max_h(px(RECENT_SESSIONS_MENU_MAX_HEIGHT))
                            .overflow_hidden()
                            .flex()
                            .flex_col()
                            .border_1()
                            .border_color(theme.role(ThemeRole::Divider))
                            .rounded(px(8.0))
                            .bg(theme.role(ThemeRole::OverlayPanel))
                            .child(
                                div()
                                    .debug_selector(part(root_id.clone(), "recent-heading"))
                                    .h(px(32.0))
                                    .flex_none()
                                    .flex()
                                    .items_center()
                                    .px(px(8.0))
                                    .text_size(px(12.0))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(recent.label.clone()),
                            )
                            .child(
                                div()
                                    .debug_selector(part(root_id.clone(), "recent-list"))
                                    .min_h_0()
                                    .flex_1()
                                    .child(ScrollSurface {
                                        id: format!("{root_id}-recent-scroll").into(),
                                        theme,
                                        width: None,
                                        height: None,
                                        vertical: Some(scrollbar),
                                        horizontal: None,
                                        content: rows.into_any_element(),
                                    }),
                            ),
                    )
            });

        let recent = self.recent.map(|recent| {
            let enabled = self.on_recent_toggle.is_some();
            let pointer = self.on_recent_toggle.clone();
            let keyboard = self.on_recent_toggle.clone();
            div()
                .id(child_id(&root_id, "control", &"recent".into()))
                .debug_selector(part(root_id.clone(), "recent"))
                .size(px(WORKSPACE_TAB_CONTROL_SIZE))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.0))
                .bg(if recent_open {
                    theme.role(ThemeRole::SurfaceSelected)
                } else {
                    theme.role(ThemeRole::HeaderBackground)
                })
                .when_some(recent_focus, |button, focus| {
                    let pointer_focus = focus.clone();
                    button
                        .track_focus(&focus.tab_index(0).tab_stop(enabled))
                        .focus(|style| {
                            style
                                .border_2()
                                .border_color(theme.role(ThemeRole::RadioActive))
                        })
                        .when(enabled, |v| {
                            v.cursor_pointer()
                                .on_mouse_down(MouseButton::Left, move |_, window, _| {
                                    pointer_focus.focus(window)
                                })
                        })
                })
                .when(enabled, |button| {
                    button
                        .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                            pointer.clone().unwrap()(window, cx)
                        })
                        .on_key_down(move |event, window, cx| {
                            if !event.is_held
                                && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                            {
                                cx.stop_propagation();
                                keyboard.clone().unwrap()(window, cx);
                            }
                        })
                })
                .child(Icon::labelled(
                    IconName::History,
                    recent.label,
                    12.0,
                    theme.role(ThemeRole::TextSecondary).into(),
                    format!("{root_id}.recent.icon"),
                ))
        });

        div()
            .id(root_id.clone())
            .debug_selector(part(root_id.clone(), "root"))
            .relative()
            .w_full()
            .h(px(WORKSPACE_TABS_HEIGHT))
            .flex_none()
            .flex()
            .items_center()
            .border_b_1()
            .border_color(theme.role(ThemeRole::Divider))
            .bg(theme.role(ThemeRole::HeaderBackground))
            .font_family(fonts::UI_FAMILY)
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "viewport"))
                    .h_full()
                    .min_w_0()
                    .flex_1()
                    .child(ScrollSurface {
                        id: format!("{root_id}-tabs-scroll").into(),
                        theme,
                        width: None,
                        height: None,
                        vertical: None,
                        horizontal: Some(tabs_scrollbar),
                        content: div()
                            .debug_selector(part(root_id.clone(), "tab-content"))
                            .h_full()
                            .flex()
                            .children(tab_elements)
                            .into_any_element(),
                    }),
            )
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "actions"))
                    .h_full()
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .pr(px(8.0))
                    .children(create)
                    .children(recent),
            )
            .children(recent_menu)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        App, Bounds, Context, Modifiers, Pixels, Render, TestAppContext, VisualTestContext, Window,
        px, size,
    };
    use std::{cell::RefCell, rc::Rc};

    struct Fixture {
        theme: Theme,
        width: f32,
        selected: Rc<RefCell<Vec<SharedString>>>,
        closed: Rc<RefCell<Vec<SharedString>>>,
        moved: Rc<RefCell<Vec<(SharedString, WorkspaceTabMove)>>>,
        tabs_scrollbar: Entity<ScrollbarState>,
        recent_scrollbar: Entity<ScrollbarState>,
    }
    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let selected = self.selected.clone();
            let closed = self.closed.clone();
            let moved = self.moved.clone();
            div().w(px(self.width)).child(WorkspaceTabs {
                id: "workspace-tabs".into(),
                theme: self.theme,
                tabs: vec![
                    WorkspaceTabItem {
                        id: "session".into(),
                        label: "A very long session title that truncates".into(),
                        kind: WorkspaceTabKind::Session,
                        active: true,
                        unread: true,
                        waiting: false,
                        running: true,
                        disabled: false,
                        closable: true,
                    },
                    WorkspaceTabItem {
                        id: "disabled".into(),
                        label: "Disabled file".into(),
                        kind: WorkspaceTabKind::File,
                        active: false,
                        unread: false,
                        waiting: false,
                        running: false,
                        disabled: true,
                        closable: true,
                    },
                    WorkspaceTabItem {
                        id: "terminal".into(),
                        label: "Terminal".into(),
                        kind: WorkspaceTabKind::Terminal,
                        active: false,
                        unread: false,
                        waiting: true,
                        running: false,
                        disabled: false,
                        closable: true,
                    },
                ],
                create: Some(WorkspaceCreateAffordance {
                    label: "Create session".into(),
                    disabled: false,
                }),
                recent: Some(RecentSessionsAffordance {
                    label: "Recent sessions".into(),
                    open: true,
                    items: (0..16)
                        .map(|index| RecentSessionItem {
                            id: format!("old-{index}").into(),
                            label: format!("Closed session {index}").into(),
                            detail: Some("Yesterday".into()),
                            disabled: false,
                        })
                        .collect(),
                }),
                tabs_scrollbar: self.tabs_scrollbar.clone(),
                recent_scrollbar: Some(self.recent_scrollbar.clone()),
                on_select: Some(Rc::new(move |id, _, _| selected.borrow_mut().push(id))),
                on_close: Some(Rc::new(move |id, _, _| closed.borrow_mut().push(id))),
                on_move: Some(Rc::new(move |id, direction, _, _| {
                    moved.borrow_mut().push((id, direction))
                })),
                on_create: Some(Rc::new(|_, _| {})),
                on_recent_toggle: Some(Rc::new(|_, _| {})),
                on_recent_select: Some(Rc::new(|_, _, _| {})),
            })
        }
    }
    fn render(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        theme: Theme,
        selected: Rc<RefCell<Vec<SharedString>>>,
        closed: Rc<RefCell<Vec<SharedString>>>,
        moved: Rc<RefCell<Vec<(SharedString, WorkspaceTabMove)>>>,
    ) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let (_, cx) = cx.add_window_view(move |_, cx| {
            use crate::ui::scrollbar::{
                ScrollbarAppearance, ScrollbarPlacement, SharedScrollHandle,
            };
            Fixture {
                theme,
                width,
                selected,
                closed,
                moved,
                tabs_scrollbar: cx.new(|_| {
                    ScrollbarState::horizontal(
                        ScrollbarAppearance::Always,
                        ScrollbarPlacement::Overlay,
                        SharedScrollHandle::new(),
                    )
                }),
                recent_scrollbar: cx.new(|_| {
                    ScrollbarState::vertical(
                        ScrollbarAppearance::Always,
                        ScrollbarPlacement::Overlay,
                        SharedScrollHandle::new(),
                    )
                }),
            }
        });
        cx.simulate_resize(size(px(width.max(720.0)), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }
    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector).unwrap()
    }

    #[gpui::test]
    fn workspace_tabs_render_reference_light_with_exact_menu_geometry(cx: &mut TestAppContext) {
        let cx = render(
            cx,
            1280.0,
            800.0,
            Theme::light(),
            Rc::new(RefCell::new(Vec::new())),
            Rc::new(RefCell::new(Vec::new())),
            Rc::new(RefCell::new(Vec::new())),
        );
        assert_eq!(
            bounds(cx, "workspace-tabs.root").size,
            size(px(1280.0), px(32.0))
        );
        assert_eq!(
            bounds(cx, "workspace-tabs.tab-session").size.height,
            px(32.0)
        );
        assert_eq!(
            bounds(cx, "workspace-tabs.recent-menu").size,
            size(px(300.0), px(320.0))
        );
        assert_eq!(
            bounds(cx, "workspace-tabs.create").size,
            size(px(28.0), px(28.0))
        );
    }

    #[gpui::test]
    fn controls_survive_overflow_and_220_main_width_in_dark(cx: &mut TestAppContext) {
        let cx = render(
            cx,
            220.0,
            480.0,
            Theme::dark(),
            Rc::new(RefCell::new(Vec::new())),
            Rc::new(RefCell::new(Vec::new())),
            Rc::new(RefCell::new(Vec::new())),
        );
        let root = bounds(cx, "workspace-tabs.root");
        let viewport = bounds(cx, "workspace-tabs.viewport");
        let actions = bounds(cx, "workspace-tabs.actions");
        let scrollport = bounds(cx, "workspace-tabs-tabs-scroll.viewport");
        assert_eq!(root.size, size(px(220.0), px(32.0)));
        assert_eq!(actions.size.width, px(68.0));
        assert_eq!(viewport.right(), actions.origin.x);
        assert_eq!(scrollport, viewport);
        assert!(bounds(cx, "workspace-tabs.tab-terminal").right() > scrollport.right());
        let menu = bounds(cx, "workspace-tabs.recent-menu");
        assert_eq!(menu.size, size(px(212.0), px(320.0)));
        assert!(menu.origin.x >= root.origin.x);
        assert!(menu.right() <= root.right());
        assert!(menu.bottom() <= root.origin.y + px(440.0));
        let recent_list = bounds(cx, "workspace-tabs.recent-list");
        let recent_viewport = bounds(cx, "workspace-tabs-recent-scroll.viewport");
        assert_eq!(recent_viewport, recent_list);
        let session_label = bounds(cx, "workspace-tabs.tab-session.label");
        assert!(session_label.right() <= bounds(cx, "workspace-tabs.tab-session.close").origin.x);
        assert!(session_label.origin.y >= root.origin.y);
        assert!(session_label.bottom() <= root.bottom());
        assert!(session_label.size.height <= px(16.0));
    }

    #[gpui::test]
    fn workspace_tabs_have_real_560_layout(cx: &mut TestAppContext) {
        let cx = render(
            cx,
            560.0,
            480.0,
            Theme::light(),
            Rc::new(RefCell::new(Vec::new())),
            Rc::new(RefCell::new(Vec::new())),
            Rc::new(RefCell::new(Vec::new())),
        );
        assert_eq!(
            bounds(cx, "workspace-tabs.root").size,
            size(px(560.0), px(32.0))
        );
        assert_eq!(bounds(cx, "workspace-tabs.actions").size.width, px(68.0));
    }

    #[gpui::test]
    fn arrow_keys_skip_disabled_and_close_accepts_enter_and_space(cx: &mut TestAppContext) {
        let selected = Rc::new(RefCell::new(Vec::new()));
        let closed = Rc::new(RefCell::new(Vec::new()));
        let moved = Rc::new(RefCell::new(Vec::new()));
        let cx = render(
            cx,
            720.0,
            480.0,
            Theme::light(),
            selected.clone(),
            closed.clone(),
            moved.clone(),
        );
        let session_center = bounds(cx, "workspace-tabs.tab-session").center();
        cx.simulate_click(session_center, Modifiers::default());
        selected.borrow_mut().clear();
        cx.simulate_keystrokes("right left");
        assert_eq!(selected.borrow().as_slice(), ["terminal", "session"]);
        cx.simulate_keystrokes("shift-right shift-left");
        assert_eq!(
            moved.borrow().as_slice(),
            [
                (SharedString::from("session"), WorkspaceTabMove::Next),
                (SharedString::from("session"), WorkspaceTabMove::Previous),
            ]
        );
        let close_center = bounds(cx, "workspace-tabs.tab-session.close").center();
        cx.simulate_click(close_center, Modifiers::default());
        closed.borrow_mut().clear();
        cx.simulate_keystrokes("enter space");
        assert_eq!(closed.borrow().as_slice(), ["session", "session"]);
    }

    #[gpui::test]
    fn stable_focus_prunes_dead_registry_entries_before_insertion(cx: &mut TestAppContext) {
        let dead = cx.update(|app: &mut App| stable_focus(app, "dead-focus".to_owned()));
        let dead_weak = dead.downgrade();
        drop(dead);
        assert!(dead_weak.upgrade().is_none());

        let live = cx.update(|app: &mut App| stable_focus(app, "live-focus".to_owned()));
        cx.update(|app: &mut App| {
            let registry = app.default_global::<WorkspaceTabsFocusRegistry>();
            assert!(!registry.handles.contains_key("dead-focus"));
            assert!(registry.handles.contains_key("live-focus"));
        });
        drop(live);
    }
}
