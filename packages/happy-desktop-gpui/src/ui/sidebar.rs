//! Controlled, router-free sidebar presentation for native Happy surfaces.
//!
//! The caller owns every durable choice and the persistent [`ScrollbarState`].
//! Rows are plain values rendered under this single component boundary; no row
//! creates an entity, subscription, transport, or local product-state mirror.

use std::{collections::HashMap, rc::Rc};

use gpui::{
    App, ElementId, Entity, FocusHandle, FontWeight, Global, IntoElement, MouseButton, RenderOnce,
    SharedString, WeakFocusHandle, Window, div, prelude::*, px,
};

use super::{
    components::ScrollSurface,
    icon::{Icon, IconName},
    metrics::{PANEL_INSET, PANEL_ROW_PADDING, SURFACE_HEADER_HEIGHT},
    scrollbar::ScrollbarState,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const SIDEBAR_MIN_WIDTH: f32 = 250.0;
pub const SIDEBAR_MAX_WIDTH: f32 = 360.0;
pub const SIDEBAR_WIDTH_FRACTION: f32 = 0.30;
pub const SIDEBAR_HEADER_HEIGHT: f32 = SURFACE_HEADER_HEIGHT;
pub const SIDEBAR_FOOTER_HEIGHT: f32 = 40.0;
pub const SIDEBAR_ROW_HEIGHT: f32 = 32.0;
pub const SIDEBAR_ROW_GAP: f32 = 2.0;
pub const SIDEBAR_SECTION_GAP: f32 = 8.0;
pub const SIDEBAR_SECTION_HEADING_HEIGHT: f32 = 24.0;
pub const SIDEBAR_ROW_INDENT: f32 = 16.0;
pub const SIDEBAR_LEADING_LANE: f32 = 20.0;

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

fn row_action_key(item_id: &SharedString, action_id: &SharedString) -> SharedString {
    format!("{item_id}\0{action_id}").into()
}

fn row_action_element_id(
    root: &SharedString,
    item_id: &SharedString,
    action_id: &SharedString,
) -> ElementId {
    ElementId::NamedChild(
        Box::new(child_id(root, "sidebar-item", item_id)),
        format!("action:{action_id}").into(),
    )
}

#[derive(Default)]
struct SidebarFocusRegistry {
    handles: HashMap<String, WeakFocusHandle>,
}
impl Global for SidebarFocusRegistry {}

fn stable_focus(cx: &mut App, key: String) -> FocusHandle {
    if let Some(handle) = cx
        .default_global::<SidebarFocusRegistry>()
        .handles
        .get(&key)
        .and_then(WeakFocusHandle::upgrade)
    {
        return handle;
    }
    let handle = cx.focus_handle();
    cx.default_global::<SidebarFocusRegistry>()
        .handles
        .insert(key, handle.downgrade());
    handle
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarItemLifecycle {
    Creating,
    #[default]
    Ready,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarItemAvailability {
    #[default]
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarActivity {
    #[default]
    Idle,
    Working,
    Waiting,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarFold {
    #[default]
    Leaf,
    Expanded,
    Collapsed,
}

#[derive(Clone)]
pub struct SidebarRowAction {
    pub id: SharedString,
    pub label: SharedString,
    pub icon: IconName,
    pub disabled: bool,
}

#[derive(Clone)]
pub struct SidebarItem {
    /// Stable entity identity. Labels may change without changing this value.
    pub id: SharedString,
    pub label: SharedString,
    pub icon: IconName,
    pub depth: usize,
    pub fold: SidebarFold,
    pub lifecycle: SidebarItemLifecycle,
    pub lifecycle_label: Option<SharedString>,
    pub availability: SidebarItemAvailability,
    pub disabled: bool,
    pub activity: SidebarActivity,
    pub unread: bool,
    pub change_stats: Option<SidebarChangeStats>,
    pub action: Option<SidebarRowAction>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SidebarChangeStats {
    pub added: u32,
    pub deleted: u32,
}

#[derive(Clone)]
pub struct SidebarSectionAction {
    pub label: SharedString,
    pub icon: IconName,
    pub disabled: bool,
    pub busy: bool,
}

#[derive(Clone)]
pub struct SidebarSection {
    pub id: SharedString,
    pub label: Option<SharedString>,
    pub items: Vec<SidebarItem>,
    pub collapsed: bool,
    pub action: Option<SidebarSectionAction>,
    pub error: Option<SharedString>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SidebarUpdateStatus {
    Available,
    Downloading,
    Downloaded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SidebarUpdateSubject {
    Application,
    HappyAgent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SidebarUpdateOperation {
    Refresh,
    Restart,
    Install,
}

#[derive(Clone)]
pub struct SidebarUpdateAction {
    pub status: SidebarUpdateStatus,
    pub subject: SidebarUpdateSubject,
    pub operation: SidebarUpdateOperation,
    pub version: Option<SharedString>,
    pub detail: Option<SharedString>,
    /// Popover visibility is controlled by the caller.
    pub open: bool,
    pub disabled: bool,
}

#[derive(Clone)]
pub struct SidebarFooterAction {
    pub id: SharedString,
    pub label: SharedString,
    pub icon: IconName,
    pub disabled: bool,
}

#[derive(Clone, Default)]
pub struct SidebarFooter {
    pub name: Option<SharedString>,
    pub online: bool,
    pub actions: Vec<SidebarFooterAction>,
    pub update: Option<SidebarUpdateAction>,
}

pub type SidebarItemHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type SidebarRowActionHandler = Rc<dyn Fn(SharedString, SharedString, &mut Window, &mut App)>;
pub type SidebarSectionHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type SidebarFooterHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type SidebarUpdateHandler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Sidebar {
    pub id: SharedString,
    pub theme: Theme,
    pub title: SharedString,
    pub subtitle: Option<SharedString>,
    /// `None` resolves the DESIGN.md `clamp(250px, 30vw, 360px)` contract.
    pub width: Option<f32>,
    pub selected_item_id: Option<SharedString>,
    pub sections: Vec<SidebarSection>,
    pub footer: SidebarFooter,
    /// Caller-owned persistent scrollbar state. Never construct this in render.
    pub body_scrollbar: Entity<ScrollbarState>,
    pub on_item_select: Option<SidebarItemHandler>,
    pub on_item_action: Option<SidebarRowActionHandler>,
    pub on_item_collapse_toggle: Option<SidebarItemHandler>,
    pub on_section_action: Option<SidebarSectionHandler>,
    pub on_footer_action: Option<SidebarFooterHandler>,
    pub on_update_toggle: Option<SidebarUpdateHandler>,
    pub on_update_apply: Option<SidebarUpdateHandler>,
}

#[derive(Clone)]
struct VisibleRow {
    section_id: SharedString,
    item: SidebarItem,
}

fn visible_items(items: Vec<SidebarItem>) -> Vec<SidebarItem> {
    let mut visible = Vec::new();
    let mut hidden_below: Option<usize> = None;
    for item in items {
        if let Some(depth) = hidden_below {
            if item.depth >= depth {
                continue;
            }
            hidden_below = None;
        }
        if item.fold == SidebarFold::Collapsed {
            hidden_below = Some(item.depth + 1);
        }
        visible.push(item);
    }
    visible
}

impl RenderOnce for Sidebar {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let root_id = self.id.clone();
        let theme = self.theme;
        let width = self.width.unwrap_or_else(|| {
            (f32::from(window.viewport_size().width) * SIDEBAR_WIDTH_FRACTION)
                .clamp(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
        });

        let sections: Vec<(SidebarSection, Vec<SidebarItem>)> = self
            .sections
            .into_iter()
            .map(|section| {
                let items = if section.collapsed {
                    Vec::new()
                } else {
                    visible_items(section.items.clone())
                };
                (section, items)
            })
            .collect();
        let rows: Vec<VisibleRow> = sections
            .iter()
            .flat_map(|(section, items)| {
                items.iter().cloned().map(|item| VisibleRow {
                    section_id: section.id.clone(),
                    item,
                })
            })
            .collect();
        let selection_enabled = self.on_item_select.is_some();
        let enabled: Rc<Vec<(SharedString, FocusHandle)>> = Rc::new(
            rows.iter()
                .filter(|row| selection_enabled && !row.item.disabled)
                .map(|row| {
                    let key = format!("sidebar:{root_id}:{}:{}", row.section_id, row.item.id);
                    (row.item.id.clone(), stable_focus(cx, key))
                })
                .collect(),
        );
        let tab_entry = enabled
            .iter()
            .position(|(id, _)| self.selected_item_id.as_ref() == Some(id))
            .unwrap_or(0);
        let section_action_focus: Rc<HashMap<SharedString, FocusHandle>> = Rc::new(
            sections
                .iter()
                .filter(|(section, _)| section.action.is_some())
                .map(|(section, _)| {
                    let key = format!("sidebar:{root_id}:section-action:{}", section.id);
                    (section.id.clone(), stable_focus(cx, key))
                })
                .collect(),
        );
        let fold_focus: Rc<HashMap<SharedString, FocusHandle>> = Rc::new(
            rows.iter()
                .filter(|row| row.item.fold != SidebarFold::Leaf)
                .map(|row| {
                    let key = format!("sidebar:{root_id}:fold:{}", row.item.id);
                    (row.item.id.clone(), stable_focus(cx, key))
                })
                .collect(),
        );
        let row_action_focus: Rc<HashMap<SharedString, FocusHandle>> = Rc::new(
            rows.iter()
                .filter_map(|row| {
                    row.item.action.as_ref().map(|action| {
                        let identity = row_action_key(&row.item.id, &action.id);
                        let key = format!("sidebar:{root_id}:row-action:{identity}");
                        (identity, stable_focus(cx, key))
                    })
                })
                .collect(),
        );
        let footer_action_focus: Rc<HashMap<SharedString, FocusHandle>> = Rc::new(
            self.footer
                .actions
                .iter()
                .map(|action| {
                    let key = format!("sidebar:{root_id}:footer-action:{}", action.id);
                    (action.id.clone(), stable_focus(cx, key))
                })
                .collect(),
        );
        let update_trigger_focus = self
            .footer
            .update
            .as_ref()
            .map(|_| stable_focus(cx, format!("sidebar:{root_id}:update-trigger")));
        let update_apply_focus = self
            .footer
            .update
            .as_ref()
            .map(|_| stable_focus(cx, format!("sidebar:{root_id}:update-apply")));

        let body_content = div()
            .debug_selector(part(root_id.clone(), "body-content"))
            .w_full()
            .min_h_full()
            .flex()
            .flex_col()
            .gap(px(SIDEBAR_SECTION_GAP))
            .p(px(PANEL_INSET))
            .children(sections.into_iter().map(|(section, items)| {
                render_section(
                    &root_id,
                    theme,
                    section,
                    items,
                    self.selected_item_id.clone(),
                    enabled.clone(),
                    tab_entry,
                    self.on_item_select.clone(),
                    self.on_item_action.clone(),
                    self.on_item_collapse_toggle.clone(),
                    self.on_section_action.clone(),
                    section_action_focus.clone(),
                    fold_focus.clone(),
                    row_action_focus.clone(),
                )
            }))
            .into_any_element();

        let footer = render_footer(
            &root_id,
            theme,
            self.footer,
            self.on_footer_action,
            self.on_update_toggle,
            self.on_update_apply,
            footer_action_focus,
            update_trigger_focus,
            update_apply_focus,
        );

        div()
            .id(root_id.clone())
            .debug_selector(part(root_id.clone(), "root"))
            .w(px(width))
            .h_full()
            .flex_none()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::GrouppedBackground))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "header"))
                    .w_full()
                    .h(px(SIDEBAR_HEADER_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(PANEL_INSET + PANEL_ROW_PADDING))
                    .child(
                        div()
                            .debug_selector(part(root_id.clone(), "heading"))
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .debug_selector(part(root_id.clone(), "title"))
                                    .h(px(20.0))
                                    .truncate()
                                    .text_size(px(15.0))
                                    .font_weight(FontWeight::BOLD)
                                    .text_color(theme.role(ThemeRole::HeaderTintSecondary))
                                    .child(self.title),
                            )
                            .children(self.subtitle.map(|subtitle| {
                                div()
                                    .debug_selector(part(root_id.clone(), "subtitle"))
                                    .h(px(14.0))
                                    .truncate()
                                    .text_size(px(11.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme.role(ThemeRole::HeaderTintSecondary))
                                    .child(subtitle)
                            })),
                    ),
            )
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "body"))
                    .w_full()
                    .flex_1()
                    .min_h_0()
                    .child(ScrollSurface {
                        id: format!("{root_id}-body").into(),
                        theme,
                        width: None,
                        height: None,
                        vertical: Some(self.body_scrollbar),
                        horizontal: None,
                        content: body_content,
                    }),
            )
            .child(footer)
    }
}

#[allow(clippy::too_many_arguments)]
fn render_section(
    root_id: &SharedString,
    theme: Theme,
    section: SidebarSection,
    items: Vec<SidebarItem>,
    selected_id: Option<SharedString>,
    enabled: Rc<Vec<(SharedString, FocusHandle)>>,
    tab_entry: usize,
    on_select: Option<SidebarItemHandler>,
    on_action: Option<SidebarRowActionHandler>,
    on_collapse: Option<SidebarItemHandler>,
    on_section_action: Option<SidebarSectionHandler>,
    section_action_focus: Rc<HashMap<SharedString, FocusHandle>>,
    fold_focus: Rc<HashMap<SharedString, FocusHandle>>,
    row_action_focus: Rc<HashMap<SharedString, FocusHandle>>,
) -> impl IntoElement {
    let section_selector: SharedString = format!("section-{}", section.id).into();
    let section_id = section.id.clone();
    let root_for_rows = root_id.clone();
    div()
        .debug_selector(part(root_id.clone(), section_selector))
        .w_full()
        .flex()
        .flex_col()
        .gap(px(SIDEBAR_ROW_GAP))
        .children(section.label.map(|label| {
            let action = section.action;
            let action_focus = section_action_focus.get(&section_id).cloned();
            div()
                .debug_selector(part(
                    root_id.clone(),
                    format!("section-{}.heading", section_id),
                ))
                .w_full()
                .h(px(SIDEBAR_SECTION_HEADING_HEIGHT))
                .flex_none()
                .flex()
                .items_center()
                .gap(px(6.0))
                .px(px(PANEL_ROW_PADDING))
                .child(
                    div()
                        .debug_selector(part(
                            root_id.clone(),
                            format!("section-{}.label", section_id),
                        ))
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .font_family(fonts::MONO_FAMILY)
                        .text_size(px(11.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(label),
                )
                .children(action.map(|action| {
                    let callback = on_section_action.clone();
                    let callback_id = section_id.clone();
                    let disabled = action.disabled || action.busy || callback.is_none();
                    let focus = action_focus.expect("section action focus was registered");
                    div()
                        .id(child_id(root_id, "section-action", &section_id))
                        .debug_selector(part(
                            root_id.clone(),
                            format!("section-{}.action", section_id),
                        ))
                        .size(px(18.0))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(4.0))
                        .opacity(if disabled { 0.48 } else { 1.0 })
                        .track_focus(&focus.clone().tab_index(0).tab_stop(!disabled))
                        .focus(|style| {
                            style
                                .border_2()
                                .border_color(theme.role(ThemeRole::RadioActive))
                        })
                        .when(!disabled, |button| {
                            let callback = callback.expect("checked above");
                            let keyboard = callback.clone();
                            let keyboard_id = callback_id.clone();
                            let pointer_focus = focus.clone();
                            button
                                .cursor_pointer()
                                .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                    cx.stop_propagation();
                                    pointer_focus.focus(window);
                                })
                                .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                    cx.stop_propagation();
                                    callback(callback_id.clone(), window, cx);
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
                            if action.busy {
                                IconName::Clock
                            } else {
                                action.icon
                            },
                            action.label,
                            12.0,
                            theme.role(ThemeRole::TextSecondary).into(),
                            format!("{root_id}.section-{}.action.icon", section_id),
                        ))
                }))
        }))
        .children(section.error.map(|error| {
            div()
                .debug_selector(part(
                    root_id.clone(),
                    format!("section-{}.error", section_id),
                ))
                .px(px(PANEL_ROW_PADDING))
                .text_size(px(11.0))
                .line_height(px(15.0))
                .text_color(theme.role(ThemeRole::TextDestructive))
                .child(error)
        }))
        .children(items.into_iter().map(move |item| {
            render_row(
                root_for_rows.clone(),
                theme,
                item,
                selected_id.clone(),
                enabled.clone(),
                tab_entry,
                on_select.clone(),
                on_action.clone(),
                on_collapse.clone(),
                fold_focus.clone(),
                row_action_focus.clone(),
            )
        }))
}

#[allow(clippy::too_many_arguments)]
fn render_row(
    root_id: SharedString,
    theme: Theme,
    item: SidebarItem,
    selected_id: Option<SharedString>,
    enabled: Rc<Vec<(SharedString, FocusHandle)>>,
    tab_entry: usize,
    on_select: Option<SidebarItemHandler>,
    on_action: Option<SidebarRowActionHandler>,
    on_collapse: Option<SidebarItemHandler>,
    fold_focus: Rc<HashMap<SharedString, FocusHandle>>,
    row_action_focus: Rc<HashMap<SharedString, FocusHandle>>,
) -> impl IntoElement {
    let id = item.id.clone();
    let selector: SharedString = format!("item-{id}").into();
    // Availability and lifecycle constrain transport-backed row actions, not
    // local navigation. Known work remains addressable through reconnects.
    let selectable = !item.disabled && on_select.is_some();
    let enabled_position = enabled.iter().position(|(candidate, _)| candidate == &id);
    let focus = enabled_position.map(|position| (position, enabled[position].1.clone()));
    let selected = selected_id.as_ref() == Some(&id);
    let status_label = match item.lifecycle {
        SidebarItemLifecycle::Creating => item.lifecycle_label.clone().or(Some("Creating…".into())),
        SidebarItemLifecycle::Failed => item.lifecycle_label.clone().or(Some("Failed".into())),
        SidebarItemLifecycle::Ready
            if item.availability == SidebarItemAvailability::Unavailable =>
        {
            item.lifecycle_label.clone().or(Some("Unavailable".into()))
        }
        SidebarItemLifecycle::Ready => None,
    };
    let opacity = if item.disabled
        || item.availability == SidebarItemAvailability::Unavailable
        || item.lifecycle == SidebarItemLifecycle::Failed
    {
        0.48
    } else {
        1.0
    };
    let callback_id = id.clone();
    let row_callback = on_select.clone();
    let fold = item.fold;
    let fold_id = id.clone();
    let fold_callback = on_collapse;
    let fold_control_focus = fold_focus.get(&id).cloned();
    let row_action = item.action;
    let row_action_callback = on_action;

    div()
        .id(child_id(&root_id, "sidebar-item", &id))
        .debug_selector(part(root_id.clone(), selector.clone()))
        .relative()
        .w_full()
        .h(px(SIDEBAR_ROW_HEIGHT))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(6.0))
        .pl(px(
            PANEL_ROW_PADDING + item.depth as f32 * SIDEBAR_ROW_INDENT
        ))
        .pr(px(PANEL_ROW_PADDING))
        .rounded(px(6.0))
        .when(selected, |row| {
            row.bg(theme.role(ThemeRole::SurfaceSelected))
        })
        .opacity(opacity)
        .when_some(focus, |row, (position, focus)| {
            let pointer_focus = focus.clone();
            let keyboard_enabled = enabled.clone();
            let keyboard_callback = row_callback.clone();
            let keyboard_id = callback_id.clone();
            row.track_focus(&focus.tab_index(0).tab_stop(position == tab_entry))
                .focus(|style| {
                    style
                        .border_2()
                        .border_color(theme.role(ThemeRole::RadioActive))
                })
                .when(selectable, |row| {
                    let callback = row_callback.expect("checked above");
                    let pointer_id = callback_id.clone();
                    row.cursor_pointer()
                        .on_mouse_down(MouseButton::Left, move |_, window, _| {
                            pointer_focus.focus(window)
                        })
                        .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                            callback(pointer_id.clone(), window, cx)
                        })
                        .on_key_down(move |event, window, cx| {
                            if event.is_held {
                                return;
                            }
                            let key = event.keystroke.key.as_str();
                            if matches!(key, "enter" | "space" | " ") {
                                cx.stop_propagation();
                                if let Some(callback) = &keyboard_callback {
                                    callback(keyboard_id.clone(), window, cx);
                                }
                                return;
                            }
                            let target = match key {
                                "up" => Some(
                                    (position + keyboard_enabled.len() - 1)
                                        % keyboard_enabled.len(),
                                ),
                                "down" => Some((position + 1) % keyboard_enabled.len()),
                                "home" => Some(0),
                                "end" => Some(keyboard_enabled.len() - 1),
                                _ => None,
                            };
                            if let Some(target) = target {
                                cx.stop_propagation();
                                keyboard_enabled[target].1.focus(window);
                            }
                        })
                })
        })
        .child(
            div()
                .debug_selector(part(root_id.clone(), format!("{selector}.leading")))
                .w(px(SIDEBAR_LEADING_LANE))
                .h_full()
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .id(child_id(&root_id, "sidebar-fold", &fold_id))
                .when_some(fold_control_focus.clone(), |leading, focus| {
                    leading
                        .track_focus(&focus.tab_index(0).tab_stop(fold_callback.is_some()))
                        .focus(|style| {
                            style
                                .border_2()
                                .border_color(theme.role(ThemeRole::RadioActive))
                        })
                })
                .when(
                    fold != SidebarFold::Leaf && fold_callback.is_some(),
                    |leading| {
                        let callback = fold_callback.expect("checked above");
                        let keyboard = callback.clone();
                        let keyboard_id = fold_id.clone();
                        let focus = fold_control_focus
                            .clone()
                            .expect("fold control focus was registered");
                        let pointer_focus = focus.clone();
                        leading
                            .cursor_pointer()
                            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                cx.stop_propagation();
                                pointer_focus.focus(window);
                            })
                            .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                cx.stop_propagation();
                                callback(fold_id.clone(), window, cx);
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
                    },
                )
                .child(Icon::decorative(
                    match fold {
                        SidebarFold::Expanded => IconName::ChevronDown,
                        SidebarFold::Collapsed => IconName::ChevronRight,
                        SidebarFold::Leaf => match item.activity {
                            SidebarActivity::Working => IconName::Zap,
                            SidebarActivity::Waiting => IconName::Clock,
                            SidebarActivity::Idle => item.icon,
                        },
                    },
                    16.0,
                    match item.activity {
                        SidebarActivity::Waiting => theme.role(ThemeRole::Warning),
                        SidebarActivity::Working => theme.role(ThemeRole::TextLink),
                        SidebarActivity::Idle => theme.role(ThemeRole::TextSecondary),
                    }
                    .into(),
                    format!("{root_id}.{selector}.leading.icon"),
                )),
        )
        .child(
            div()
                .debug_selector(part(root_id.clone(), format!("{selector}.label")))
                .flex_1()
                .min_w_0()
                .truncate()
                .text_size(px(13.0))
                .line_height(px(18.0))
                .font_weight(if item.unread {
                    FontWeight::BOLD
                } else {
                    FontWeight::MEDIUM
                })
                .child(item.label),
        )
        .children(status_label.map(|status| {
            div()
                .debug_selector(part(root_id.clone(), format!("{selector}.status")))
                .flex_none()
                .font_family(fonts::MONO_FAMILY)
                .text_size(px(10.0))
                .text_color(theme.role(ThemeRole::TextSecondary))
                .child(status)
        }))
        .children(item.change_stats.map(|stats| {
            div()
                .debug_selector(part(root_id.clone(), format!("{selector}.changes")))
                .flex_none()
                .flex()
                .gap(px(4.0))
                .font_family(fonts::MONO_FAMILY)
                .text_size(px(10.0))
                .font_weight(FontWeight::BOLD)
                .child(
                    div()
                        .text_color(theme.role(ThemeRole::GitAddedText))
                        .child(format!("+{}", stats.added)),
                )
                .child(
                    div()
                        .text_color(theme.role(ThemeRole::GitRemovedText))
                        .child(format!("−{}", stats.deleted)),
                )
        }))
        .when(item.unread, |row| {
            row.child(
                div()
                    .debug_selector(part(root_id.clone(), format!("{selector}.unread")))
                    .size(px(6.0))
                    .flex_none()
                    .rounded_full()
                    .bg(theme.role(ThemeRole::TextLink)),
            )
        })
        .children(row_action.map(|action| {
            let disabled = action.disabled || row_action_callback.is_none();
            let callback = row_action_callback;
            let item_id = id.clone();
            let action_id = action.id.clone();
            let focus = row_action_focus
                .get(&row_action_key(&item_id, &action_id))
                .cloned()
                .expect("row action focus was registered");
            div()
                .id(row_action_element_id(&root_id, &item_id, &action_id))
                .debug_selector(part(root_id.clone(), format!("{selector}.action")))
                .size(px(18.0))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(4.0))
                .opacity(if disabled { 0.48 } else { 1.0 })
                .track_focus(&focus.clone().tab_index(0).tab_stop(!disabled))
                .focus(|style| {
                    style
                        .border_2()
                        .border_color(theme.role(ThemeRole::RadioActive))
                })
                .when(!disabled, |button| {
                    let callback = callback.expect("checked above");
                    let keyboard = callback.clone();
                    let keyboard_item = item_id.clone();
                    let keyboard_action = action_id.clone();
                    let pointer_focus = focus.clone();
                    button
                        .cursor_pointer()
                        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                            cx.stop_propagation();
                            pointer_focus.focus(window);
                        })
                        .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                            cx.stop_propagation();
                            callback(item_id.clone(), action_id.clone(), window, cx);
                        })
                        .on_key_down(move |event, window, cx| {
                            if !event.is_held
                                && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                            {
                                cx.stop_propagation();
                                keyboard(
                                    keyboard_item.clone(),
                                    keyboard_action.clone(),
                                    window,
                                    cx,
                                );
                            }
                        })
                })
                .child(Icon::labelled(
                    action.icon,
                    action.label,
                    12.0,
                    theme.role(ThemeRole::TextSecondary).into(),
                    format!("{root_id}.{selector}.action.icon"),
                ))
        }))
}

fn render_footer(
    root_id: &SharedString,
    theme: Theme,
    footer: SidebarFooter,
    on_footer_action: Option<SidebarFooterHandler>,
    on_update_toggle: Option<SidebarUpdateHandler>,
    on_update_apply: Option<SidebarUpdateHandler>,
    footer_action_focus: Rc<HashMap<SharedString, FocusHandle>>,
    update_trigger_focus: Option<FocusHandle>,
    update_apply_focus: Option<FocusHandle>,
) -> impl IntoElement {
    let root = root_id.clone();
    let has_name = footer.name.is_some();
    div()
        .debug_selector(part(root_id.clone(), "footer"))
        .relative()
        .w_full()
        .h(px(SIDEBAR_FOOTER_HEIGHT))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(4.0))
        .px(px(PANEL_INSET))
        .border_t_1()
        .border_color(theme.role(ThemeRole::Divider))
        .children(footer.name.map(|name| {
            div()
                .debug_selector(part(root_id.clone(), "footer.identity"))
                .flex_1()
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(
                    div()
                        .size(px(20.0))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(6.0))
                        .bg(theme.role(ThemeRole::SurfaceRipple))
                        .child(Icon::decorative(
                            IconName::Agents,
                            13.0,
                            theme.role(ThemeRole::TextSecondary).into(),
                            format!("{root}.footer.identity.icon"),
                        )),
                )
                .child(div().min_w_0().truncate().text_size(px(12.0)).child(name))
                .when(footer.online, |identity| {
                    identity.child(
                        div()
                            .size(px(6.0))
                            .flex_none()
                            .rounded_full()
                            .bg(theme.role(ThemeRole::StatusConnected)),
                    )
                })
        }))
        .when(!has_name, |footer| footer.child(div().flex_1()))
        .children(footer.update.map(|update| {
            render_update(
                root_id,
                theme,
                update,
                on_update_toggle,
                on_update_apply,
                update_trigger_focus.expect("update trigger focus was registered"),
                update_apply_focus.expect("update apply focus was registered"),
            )
        }))
        .children(footer.actions.into_iter().map(|action| {
            let callback = on_footer_action.clone();
            let action_id = action.id.clone();
            let disabled = action.disabled || callback.is_none();
            let focus = footer_action_focus
                .get(&action_id)
                .cloned()
                .expect("footer action focus was registered");
            div()
                .id(child_id(root_id, "footer-action", &action.id))
                .debug_selector(part(
                    root_id.clone(),
                    format!("footer.action-{}", action.id),
                ))
                .size(px(28.0))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.0))
                .opacity(if disabled { 0.48 } else { 1.0 })
                .track_focus(&focus.clone().tab_index(0).tab_stop(!disabled))
                .focus(|style| {
                    style
                        .border_2()
                        .border_color(theme.role(ThemeRole::RadioActive))
                })
                .when(!disabled, |button| {
                    let callback = callback.expect("checked above");
                    let keyboard = callback.clone();
                    let keyboard_id = action_id.clone();
                    let pointer_focus = focus.clone();
                    button
                        .cursor_pointer()
                        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                            cx.stop_propagation();
                            pointer_focus.focus(window);
                        })
                        .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                            callback(action_id.clone(), window, cx)
                        })
                        .on_key_down(move |event, window, cx| {
                            if !event.is_held
                                && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                            {
                                cx.stop_propagation();
                                keyboard(keyboard_id.clone(), window, cx);
                            }
                        })
                })
                .child(Icon::labelled(
                    action.icon,
                    action.label,
                    16.0,
                    theme.role(ThemeRole::TextSecondary).into(),
                    format!("{root}.footer.action-{}.icon", action.id),
                ))
        }))
}

fn render_update(
    root_id: &SharedString,
    theme: Theme,
    update: SidebarUpdateAction,
    on_toggle: Option<SidebarUpdateHandler>,
    on_apply: Option<SidebarUpdateHandler>,
    trigger_focus: FocusHandle,
    apply_focus: FocusHandle,
) -> impl IntoElement {
    let toggle_disabled = update.disabled || on_toggle.is_none();
    let ready =
        update.status == SidebarUpdateStatus::Downloaded && !update.disabled && on_apply.is_some();
    let subject: SharedString = match (update.subject, update.version.clone()) {
        (SidebarUpdateSubject::HappyAgent, Some(version)) => {
            format!("Happy Agent {version}").into()
        }
        (SidebarUpdateSubject::HappyAgent, None) => "Happy Agent update".into(),
        (SidebarUpdateSubject::Application, Some(version)) => version,
        (SidebarUpdateSubject::Application, None) => "New version".into(),
    };
    let state: SharedString = match update.status {
        SidebarUpdateStatus::Available => "Available to download".into(),
        SidebarUpdateStatus::Downloading => update.detail.unwrap_or_else(|| "Downloading".into()),
        SidebarUpdateStatus::Downloaded => "Ready".into(),
    };
    let action_label: SharedString = match update.operation {
        SidebarUpdateOperation::Refresh => "Refresh".into(),
        SidebarUpdateOperation::Restart => "Restart".into(),
        SidebarUpdateOperation::Install => "Install".into(),
    };
    div()
        .debug_selector(part(root_id.clone(), "update"))
        .relative()
        .size(px(28.0))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .children(update.open.then(|| {
            let apply = on_apply;
            div()
                .debug_selector(part(root_id.clone(), "update.panel"))
                .absolute()
                .right_0()
                .bottom(px(34.0))
                .w(px(240.0))
                .flex()
                .flex_col()
                .gap(px(8.0))
                .p(px(12.0))
                .border_1()
                .border_color(theme.role(ThemeRole::ModalBorder))
                .rounded(px(10.0))
                .bg(theme.role(ThemeRole::SurfaceHigh))
                .child(
                    div()
                        .debug_selector(part(root_id.clone(), "update.subject"))
                        .truncate()
                        .text_size(px(13.0))
                        .font_weight(FontWeight::BOLD)
                        .child(subject),
                )
                .child(
                    div()
                        .debug_selector(part(root_id.clone(), "update.state"))
                        .text_size(px(11.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(state),
                )
                .when(ready, |panel| {
                    let apply = apply.expect("checked above");
                    let keyboard = apply.clone();
                    let focus = apply_focus.clone();
                    let pointer_focus = focus.clone();
                    panel.child(
                        div()
                            .id(child_id(root_id, "update", &"apply".into()))
                            .debug_selector(part(root_id.clone(), "update.apply"))
                            .w_full()
                            .h(px(28.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(6.0))
                            .bg(theme.role(ThemeRole::ButtonPrimaryBackground))
                            .text_color(theme.role(ThemeRole::ButtonPrimaryTint))
                            .text_size(px(12.0))
                            .font_weight(FontWeight::BOLD)
                            .track_focus(&focus.tab_index(0))
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
                            .on_mouse_up(MouseButton::Left, move |_, window, cx| apply(window, cx))
                            .on_key_down(move |event, window, cx| {
                                if !event.is_held
                                    && matches!(
                                        event.keystroke.key.as_str(),
                                        "enter" | "space" | " "
                                    )
                                {
                                    cx.stop_propagation();
                                    keyboard(window, cx);
                                }
                            })
                            .child(action_label),
                    )
                })
        }))
        .child(
            div()
                .id(child_id(root_id, "update", &"trigger".into()))
                .debug_selector(part(root_id.clone(), "update.trigger"))
                .size(px(28.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.0))
                .opacity(if toggle_disabled { 0.48 } else { 1.0 })
                .track_focus(
                    &trigger_focus
                        .clone()
                        .tab_index(0)
                        .tab_stop(!toggle_disabled),
                )
                .focus(|style| {
                    style
                        .border_2()
                        .border_color(theme.role(ThemeRole::RadioActive))
                })
                .when(!toggle_disabled, |button| {
                    let toggle = on_toggle.expect("checked above");
                    let keyboard = toggle.clone();
                    let pointer_focus = trigger_focus.clone();
                    button
                        .cursor_pointer()
                        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                            cx.stop_propagation();
                            pointer_focus.focus(window);
                        })
                        .on_mouse_up(MouseButton::Left, move |_, window, cx| toggle(window, cx))
                        .on_key_down(move |event, window, cx| {
                            if !event.is_held
                                && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                            {
                                cx.stop_propagation();
                                keyboard(window, cx);
                            }
                        })
                })
                .child(Icon::labelled(
                    IconName::ArrowUp,
                    "Update available",
                    20.0,
                    theme.role(ThemeRole::Warning).into(),
                    format!("{root_id}.update.trigger.icon"),
                )),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        App, Bounds, Context, Modifiers, Pixels, Render, TestAppContext, VisualTestContext, Window,
        px, size,
    };

    struct Fixture {
        scrollbar: Entity<ScrollbarState>,
    }

    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let mut worktree = item("worktree", "Native rewrite", 1, SidebarFold::Leaf);
            worktree.action = Some(SidebarRowAction {
                id: "more".into(),
                label: "More actions".into(),
                icon: IconName::More,
                disabled: false,
            });
            Sidebar {
                id: "sidebar".into(),
                theme: Theme::light(),
                title: "Happy".into(),
                subtitle: Some("Local agent".into()),
                width: None,
                selected_item_id: Some("project".into()),
                sections: vec![
                    SidebarSection {
                        id: "pinned".into(),
                        label: None,
                        collapsed: false,
                        action: None,
                        error: None,
                        items: vec![item("inbox", "Inbox", 0, SidebarFold::Leaf)],
                    },
                    SidebarSection {
                        id: "projects".into(),
                        label: Some("Projects".into()),
                        collapsed: false,
                        action: Some(SidebarSectionAction {
                            label: "New project".into(),
                            icon: IconName::Plus,
                            disabled: false,
                            busy: false,
                        }),
                        error: None,
                        items: vec![
                            item("project", "Happy Desktop", 0, SidebarFold::Expanded),
                            worktree,
                            item("nested", "Sidebar", 2, SidebarFold::Leaf),
                        ],
                    },
                ],
                footer: SidebarFooter {
                    name: Some("Steve".into()),
                    online: true,
                    actions: vec![SidebarFooterAction {
                        id: "settings".into(),
                        label: "Settings".into(),
                        icon: IconName::Settings,
                        disabled: false,
                    }],
                    update: Some(SidebarUpdateAction {
                        status: SidebarUpdateStatus::Downloaded,
                        subject: SidebarUpdateSubject::Application,
                        operation: SidebarUpdateOperation::Restart,
                        version: Some("0.4.0".into()),
                        detail: Some("Ready to restart".into()),
                        open: true,
                        disabled: false,
                    }),
                },
                body_scrollbar: self.scrollbar.clone(),
                on_item_select: Some(Rc::new(|_, _, _| {})),
                on_item_action: Some(Rc::new(|_, _, _, _| {})),
                on_item_collapse_toggle: Some(Rc::new(|_, _, _| {})),
                on_section_action: Some(Rc::new(|_, _, _| {})),
                on_footer_action: Some(Rc::new(|_, _, _| {})),
                on_update_toggle: Some(Rc::new(|_, _| {})),
                on_update_apply: Some(Rc::new(|_, _| {})),
            }
        }
    }

    fn item(id: &'static str, label: &'static str, depth: usize, fold: SidebarFold) -> SidebarItem {
        SidebarItem {
            id: id.into(),
            label: label.into(),
            icon: if depth == 0 {
                IconName::Files
            } else {
                IconName::Branch
            },
            depth,
            fold,
            lifecycle: SidebarItemLifecycle::Ready,
            lifecycle_label: None,
            availability: SidebarItemAvailability::Available,
            disabled: false,
            activity: SidebarActivity::Idle,
            unread: false,
            change_stats: None,
            action: None,
        }
    }

    fn render(cx: &mut TestAppContext, width: f32, height: f32) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let scrollbar = cx.new(|_| {
            ScrollbarState::vertical(
                super::super::scrollbar::ScrollbarAppearance::Automatic,
                super::super::scrollbar::ScrollbarPlacement::Overlay,
                super::super::scrollbar::SharedScrollHandle::new(),
            )
        });
        let (_, cx) = cx.add_window_view(move |_, _| Fixture { scrollbar });
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }

    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector)
            .unwrap_or_else(|| panic!("missing resolved GPUI part {selector}"))
    }

    fn assert_geometry(cx: &mut VisualTestContext, width: f32, height: f32) {
        let root = bounds(cx, "sidebar.root");
        let header = bounds(cx, "sidebar.header");
        let body = bounds(cx, "sidebar.body");
        let viewport = bounds(cx, "sidebar-body.viewport");
        let content = bounds(cx, "sidebar.body-content");
        let footer = bounds(cx, "sidebar.footer");
        assert_eq!(root.size, size(px(width), px(height)));
        assert_eq!(header.size, size(px(width), px(56.0)));
        assert_eq!(header.origin, root.origin);
        assert_eq!(body.origin.y, header.bottom());
        assert_eq!(body.size, size(px(width), px(height - 96.0)));
        assert_eq!(viewport.origin, body.origin, "scrollport is full bleed");
        assert_eq!(viewport.size, body.size, "scrollport owns the whole body");
        assert_eq!(footer.origin.y, body.bottom());
        assert_eq!(footer.size, size(px(width), px(40.0)));
        assert_eq!(
            content.origin, viewport.origin,
            "inner wrapper, not the scrollport, owns spacing"
        );

        let pinned = bounds(cx, "sidebar.section-pinned");
        let projects = bounds(cx, "sidebar.section-projects");
        assert_eq!(pinned.origin.x - viewport.origin.x, px(6.0));
        assert_eq!(pinned.origin.y - viewport.origin.y, px(6.0));
        assert_eq!(
            projects.origin.y - pinned.bottom(),
            px(SIDEBAR_SECTION_GAP),
            "the body owns the 4px-grid spacing between adjacent sections"
        );
        let heading = bounds(cx, "sidebar.section-projects.heading");
        let project = bounds(cx, "sidebar.item-project");
        let worktree = bounds(cx, "sidebar.item-worktree");
        let nested = bounds(cx, "sidebar.item-nested");
        assert_eq!(heading.size.height, px(24.0));
        assert_eq!(project.size.height, px(32.0));
        assert_eq!(worktree.origin.y - project.bottom(), px(2.0));
        assert_eq!(nested.origin.y - worktree.bottom(), px(2.0));
        let project_leading = bounds(cx, "sidebar.item-project.leading");
        let worktree_leading = bounds(cx, "sidebar.item-worktree.leading");
        let nested_leading = bounds(cx, "sidebar.item-nested.leading");
        assert_eq!(project_leading.size.width, px(20.0));
        assert_eq!(
            worktree_leading.origin.x - project_leading.origin.x,
            px(16.0)
        );
        assert_eq!(
            nested_leading.origin.x - worktree_leading.origin.x,
            px(16.0)
        );
    }

    #[test]
    fn repeated_row_action_ids_are_scoped_to_the_owning_item() {
        let root: SharedString = "sidebar".into();
        let first_item: SharedString = "first".into();
        let second_item: SharedString = "second".into();
        let repeated_action: SharedString = "more".into();

        assert_ne!(
            row_action_key(&first_item, &repeated_action),
            row_action_key(&second_item, &repeated_action)
        );
        assert_ne!(
            row_action_element_id(&root, &first_item, &repeated_action),
            row_action_element_id(&root, &second_item, &repeated_action)
        );
    }

    fn assert_pointer_focus(
        cx: &mut VisualTestContext,
        selector: &'static str,
        registry_key: String,
    ) {
        let expected = cx.update(|_, cx| stable_focus(cx, registry_key));
        let center = bounds(cx, selector).center();
        cx.simulate_click(center, Modifiers::default());
        assert_eq!(cx.update(|window, cx| window.focused(cx)), Some(expected));
    }

    #[gpui::test]
    fn auxiliary_controls_own_stable_visible_pointer_focus(cx: &mut TestAppContext) {
        let cx = render(cx, 1280.0, 800.0);
        assert_pointer_focus(
            cx,
            "sidebar.section-projects.action",
            "sidebar:sidebar:section-action:projects".into(),
        );
        assert_pointer_focus(
            cx,
            "sidebar.item-project.leading",
            "sidebar:sidebar:fold:project".into(),
        );
        let identity = row_action_key(&"worktree".into(), &"more".into());
        assert_pointer_focus(
            cx,
            "sidebar.item-worktree.action",
            format!("sidebar:sidebar:row-action:{identity}"),
        );
        assert_pointer_focus(
            cx,
            "sidebar.footer.action-settings",
            "sidebar:sidebar:footer-action:settings".into(),
        );
        assert_pointer_focus(
            cx,
            "sidebar.update.trigger",
            "sidebar:sidebar:update-trigger".into(),
        );
        assert_pointer_focus(
            cx,
            "sidebar.update.apply",
            "sidebar:sidebar:update-apply".into(),
        );
    }

    #[gpui::test]
    fn sidebar_resolves_design_window_geometry_at_retina(cx: &mut TestAppContext) {
        let cx = render(cx, 1280.0, 800.0);
        assert_geometry(cx, 360.0, 800.0);
    }

    #[gpui::test]
    fn sidebar_resolves_minimum_window_geometry_at_retina(cx: &mut TestAppContext) {
        let cx = render(cx, 720.0, 480.0);
        assert_geometry(cx, 250.0, 480.0);
    }
}
