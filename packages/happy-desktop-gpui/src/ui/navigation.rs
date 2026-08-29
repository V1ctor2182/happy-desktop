use gpui::{
    App, ElementId, FocusHandle, FontWeight, Global, IntoElement, MouseButton, RenderOnce,
    SharedString, WeakFocusHandle, Window, div, prelude::*, px,
};
use std::{collections::HashMap, rc::Rc};

use super::icon::{Icon, IconName};
use super::theme_roles::ThemeRole;
use crate::{fonts, theme::Theme};

pub type TabSelectHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type MenuActivateHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type MenuDismissHandler = Rc<dyn Fn(&mut Window, &mut App)>;

fn part(id: SharedString, name: SharedString) -> impl Fn() -> String {
    move || format!("{id}.{name}")
}

#[derive(Default)]
struct NavigationFocusRegistry {
    handles: HashMap<String, WeakFocusHandle>,
}
impl Global for NavigationFocusRegistry {}

fn navigation_focus_handle(cx: &mut App, key: String) -> FocusHandle {
    if let Some(handle) = cx
        .default_global::<NavigationFocusRegistry>()
        .handles
        .get(&key)
        .and_then(WeakFocusHandle::upgrade)
    {
        return handle;
    }
    let handle = cx.focus_handle();
    cx.default_global::<NavigationFocusRegistry>()
        .handles
        .insert(key, handle.downgrade());
    handle
}

fn item_element_id(root: &SharedString, kind: &'static str, item: &SharedString) -> ElementId {
    ElementId::NamedChild(
        Box::new(ElementId::Name(root.clone())),
        format!("{kind}:{item}").into(),
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TabsSize {
    Small,
    Medium,
    Large,
}

impl TabsSize {
    pub const fn height(self) -> f32 {
        match self {
            Self::Small => 32.0,
            Self::Medium => 40.0,
            Self::Large => 48.0,
        }
    }

    const fn font_size(self) -> f32 {
        match self {
            Self::Small => 12.0,
            Self::Medium => 13.0,
            Self::Large => 14.0,
        }
    }

    const fn icon_size(self) -> f32 {
        match self {
            Self::Small => 14.0,
            Self::Medium => 16.0,
            Self::Large => 18.0,
        }
    }

    const fn horizontal_padding(self) -> f32 {
        match self {
            Self::Small => 10.0,
            Self::Medium => 14.0,
            Self::Large => 18.0,
        }
    }
}

#[derive(Clone)]
pub struct TabItem {
    pub id: SharedString,
    pub label: SharedString,
    pub icon: Option<IconName>,
    pub selected: bool,
    pub disabled: bool,
}

#[derive(IntoElement)]
pub struct Tabs {
    pub id: SharedString,
    pub theme: Theme,
    pub size: TabsSize,
    pub items: Vec<TabItem>,
    pub on_select: TabSelectHandler,
}

impl RenderOnce for Tabs {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let root_id = self.id;
        let theme = self.theme;
        let size = self.size;
        let on_select = self.on_select;
        let entry_index = self
            .items
            .iter()
            .position(|item| item.selected && !item.disabled)
            .or_else(|| self.items.iter().position(|item| !item.disabled));
        let focus_handles: Vec<Option<FocusHandle>> = self
            .items
            .iter()
            .map(|item| {
                (!item.disabled)
                    .then(|| navigation_focus_handle(cx, format!("tabs:{root_id}:{}", item.id)))
            })
            .collect();
        let enabled: Rc<Vec<(SharedString, FocusHandle)>> = Rc::new(
            self.items
                .iter()
                .zip(focus_handles.iter())
                .filter_map(|(item, focus)| {
                    focus.as_ref().map(|focus| (item.id.clone(), focus.clone()))
                })
                .collect(),
        );

        div()
            .id(root_id.clone())
            .debug_selector(part(root_id.clone(), "root".into()))
            .w_full()
            .h(px(size.height()))
            .flex_none()
            .flex()
            .border_b_1()
            .border_color(theme.role(ThemeRole::Divider))
            .font_family(fonts::UI_FAMILY)
            .children(
                self.items
                    .into_iter()
                    .enumerate()
                    .map(move |(index, item)| {
                        let item_id = item.id;
                        let element_id = item_element_id(&root_id, "tab", &item_id);
                        let selector_name: SharedString = format!("item-{item_id}").into();
                        let item_selector = part(root_id.clone(), selector_name.clone());
                        let callback = on_select.clone();
                        let callback_id = item_id.clone();
                        let icon_selector = format!("{root_id}.{selector_name}.icon");
                        let underline_selector =
                            part(root_id.clone(), format!("{selector_name}.underline").into());
                        let focus_handle = focus_handles[index].clone();
                        let enabled_position = enabled.iter().position(|(id, _)| id == &item_id);

                        div()
                            .id(element_id)
                            .debug_selector(item_selector)
                            .relative()
                            .h(px(size.height()))
                            .flex_none()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .px(px(size.horizontal_padding()))
                            .text_size(px(size.font_size()))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(if item.selected {
                                theme.role(ThemeRole::Text)
                            } else {
                                theme.role(ThemeRole::TextSecondary)
                            })
                            .opacity(if item.disabled { 0.48 } else { 1.0 })
                            .when_some(focus_handle, |row, focus_handle| {
                                let keyboard_callback = callback.clone();
                                let keyboard_id = callback_id.clone();
                                let keyboard_enabled = enabled.clone();
                                let pointer_focus = focus_handle.clone();
                                let enabled_position =
                                    enabled_position.expect("enabled tab has a focus handle");
                                row.track_focus(
                                    &focus_handle
                                        .tab_index(0)
                                        .tab_stop(entry_index == Some(index)),
                                )
                                .focus(|style| style.bg(theme.role(ThemeRole::SurfaceSelected)))
                                .cursor_pointer()
                                .on_mouse_down(MouseButton::Left, move |_, window, _| {
                                    pointer_focus.focus(window);
                                })
                                .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                    callback(callback_id.clone(), window, cx)
                                })
                                .on_key_down(
                                    move |event, window, cx| {
                                        let key = event.keystroke.key.as_str();
                                        if !event.is_held && matches!(key, "enter" | "space" | " ")
                                        {
                                            cx.stop_propagation();
                                            keyboard_callback(keyboard_id.clone(), window, cx);
                                            return;
                                        }

                                        let target = match key {
                                            "left" => Some(
                                                (enabled_position + keyboard_enabled.len() - 1)
                                                    % keyboard_enabled.len(),
                                            ),
                                            "right" => Some(
                                                (enabled_position + 1) % keyboard_enabled.len(),
                                            ),
                                            "home" => Some(0),
                                            "end" => Some(keyboard_enabled.len() - 1),
                                            _ => None,
                                        };
                                        if let Some(target) = target {
                                            cx.stop_propagation();
                                            let (id, focus) = &keyboard_enabled[target];
                                            focus.focus(window);
                                            keyboard_callback(id.clone(), window, cx);
                                        }
                                    },
                                )
                            })
                            .children(item.icon.map(|icon| {
                                Icon::decorative(
                                    icon,
                                    size.icon_size(),
                                    theme.role(ThemeRole::TextSecondary).into(),
                                    icon_selector,
                                )
                            }))
                            .child(
                                div()
                                    .debug_selector(part(
                                        root_id.clone(),
                                        format!("{selector_name}.label").into(),
                                    ))
                                    .child(item.label),
                            )
                            .when(item.selected, |row| {
                                row.child(
                                    div()
                                        .debug_selector(underline_selector)
                                        .absolute()
                                        .left_0()
                                        .right_0()
                                        .bottom(px(-1.0))
                                        .h(px(2.0))
                                        .bg(theme.role(ThemeRole::Text)),
                                )
                            })
                    }),
            )
    }
}
#[derive(Clone)]
pub struct MenuItem {
    pub id: SharedString,
    pub label: SharedString,
    pub icon: Option<IconName>,
    pub selected: bool,
    pub disabled: bool,
}

#[derive(IntoElement)]
pub struct Menu {
    pub id: SharedString,
    pub theme: Theme,
    pub items: Vec<MenuItem>,
    pub on_activate: MenuActivateHandler,
    pub on_dismiss: Option<MenuDismissHandler>,
}

impl RenderOnce for Menu {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let root_id = self.id;
        let theme = self.theme;
        let on_activate = self.on_activate;
        let on_dismiss = self.on_dismiss;
        let focus_handles: Vec<Option<FocusHandle>> = self
            .items
            .iter()
            .map(|item| {
                (!item.disabled)
                    .then(|| navigation_focus_handle(cx, format!("menu:{root_id}:{}", item.id)))
            })
            .collect();
        let enabled: Rc<Vec<FocusHandle>> = Rc::new(
            focus_handles
                .iter()
                .filter_map(|focus| focus.clone())
                .collect(),
        );
        let first_enabled_index = self.items.iter().position(|item| !item.disabled);

        div()
            .id(root_id.clone())
            .debug_selector(part(root_id.clone(), "root".into()))
            .w(px(220.0))
            .flex()
            .flex_col()
            .p(px(4.0))
            .border_1()
            .border_color(theme.role(ThemeRole::ModalBorder))
            .rounded(px(10.0))
            .bg(theme.role(ThemeRole::Surface))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .children(
                self.items
                    .into_iter()
                    .enumerate()
                    .map(move |(index, item)| {
                        let item_id = item.id;
                        let element_id = item_element_id(&root_id, "menu-item", &item_id);
                        let selector_name: SharedString = format!("item-{item_id}").into();
                        let callback = on_activate.clone();
                        let dismiss = on_dismiss.clone();
                        let callback_id = item_id.clone();
                        let icon_selector = format!("{root_id}.{selector_name}.icon");
                        let focus_handle = focus_handles[index].clone();
                        let enabled_position = focus_handles[..index]
                            .iter()
                            .filter(|focus| focus.is_some())
                            .count();

                        div()
                            .id(element_id)
                            .debug_selector(part(root_id.clone(), selector_name.clone()))
                            .relative()
                            .w_full()
                            .h(px(28.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .px(px(8.0))
                            .rounded(px(5.0))
                            .when(item.selected, |row| {
                                row.bg(theme.role(ThemeRole::SurfaceSelected))
                            })
                            .text_size(px(13.0))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(if item.disabled {
                                theme.role(ThemeRole::TextSecondary)
                            } else {
                                theme.role(ThemeRole::Text)
                            })
                            .opacity(if item.disabled { 0.48 } else { 1.0 })
                            .when_some(focus_handle, |row, focus_handle| {
                                let keyboard_callback = callback.clone();
                                let keyboard_dismiss = dismiss.clone();
                                let keyboard_id = callback_id.clone();
                                let keyboard_enabled = enabled.clone();
                                let pointer_focus = focus_handle.clone();
                                row.track_focus(
                                    &focus_handle
                                        .tab_index(0)
                                        .tab_stop(first_enabled_index == Some(index)),
                                )
                                .focus(|style| style.bg(theme.role(ThemeRole::SurfaceSelected)))
                                .cursor_pointer()
                                .on_mouse_down(MouseButton::Left, move |_, window, _| {
                                    pointer_focus.focus(window);
                                })
                                .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                                    callback(callback_id.clone(), window, cx)
                                })
                                .on_key_down(
                                    move |event, window, cx| {
                                        let key = event.keystroke.key.as_str();
                                        if key == "tab"
                                            && let Some(dismiss) = &keyboard_dismiss
                                        {
                                            dismiss(window, cx);
                                            if event.keystroke.modifiers.shift {
                                                window.focus_prev();
                                            } else {
                                                window.focus_next();
                                            }
                                            cx.stop_propagation();
                                            return;
                                        }
                                        if !event.is_held && matches!(key, "enter" | "space" | " ")
                                        {
                                            cx.stop_propagation();
                                            keyboard_callback(keyboard_id.clone(), window, cx);
                                            return;
                                        }

                                        let target = match key {
                                            "up" => Some(
                                                (enabled_position + keyboard_enabled.len() - 1)
                                                    % keyboard_enabled.len(),
                                            ),
                                            "down" => Some(
                                                (enabled_position + 1) % keyboard_enabled.len(),
                                            ),
                                            "home" => Some(0),
                                            "end" => Some(keyboard_enabled.len() - 1),
                                            _ => None,
                                        };
                                        if let Some(target) = target {
                                            cx.stop_propagation();
                                            keyboard_enabled[target].focus(window);
                                        } else if key == "escape"
                                            && let Some(dismiss) = &keyboard_dismiss
                                        {
                                            cx.stop_propagation();
                                            dismiss(window, cx);
                                        }
                                    },
                                )
                            })
                            .children(item.icon.map(|icon| {
                                Icon::decorative(
                                    icon,
                                    16.0,
                                    theme.role(ThemeRole::TextSecondary).into(),
                                    icon_selector,
                                )
                            }))
                            .child(
                                div()
                                    .debug_selector(part(
                                        root_id.clone(),
                                        format!("{selector_name}.label").into(),
                                    ))
                                    .flex_1()
                                    .min_w_0()
                                    .child(item.label),
                            )
                    }),
            )
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

    fn tab_item(id: &'static str, label: &'static str, selected: bool, disabled: bool) -> TabItem {
        TabItem {
            id: id.into(),
            label: label.into(),
            icon: if id == "conversation" {
                Some(IconName::Chat)
            } else {
                None
            },
            selected,
            disabled,
        }
    }

    struct TabsGeometryFixture;
    impl Render for TabsGeometryFixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let empty_handler: TabSelectHandler = Rc::new(|_, _, _| {});
            div().w(px(400.0)).flex().flex_col().gap(px(4.0)).children(
                [
                    ("tabs-small", TabsSize::Small),
                    ("tabs-medium", TabsSize::Medium),
                    ("tabs-large", TabsSize::Large),
                ]
                .map(|(id, size)| Tabs {
                    id: id.into(),
                    theme: Theme::light(),
                    size,
                    items: vec![
                        tab_item("conversation", "Conversation", true, false),
                        tab_item("files", "Files", false, false),
                    ],
                    on_select: empty_handler.clone(),
                }),
            )
        }
    }

    struct TabsActivationFixture {
        activated: Rc<RefCell<Vec<SharedString>>>,
    }
    impl Render for TabsActivationFixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let activated = self.activated.clone();
            Tabs {
                id: "tabs-action".into(),
                theme: Theme::light(),
                size: TabsSize::Medium,
                items: vec![
                    tab_item("enabled", "Enabled", true, false),
                    tab_item("disabled", "Disabled", false, true),
                ],
                on_select: Rc::new(move |id, _, _| activated.borrow_mut().push(id)),
            }
        }
    }

    struct TabsKeyboardFixture {
        activated: Rc<RefCell<Vec<SharedString>>>,
    }
    impl Render for TabsKeyboardFixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let activated = self.activated.clone();
            div()
                .tab_group()
                .flex()
                .flex_col()
                .child(Tabs {
                    id: "tabs-keyboard".into(),
                    theme: Theme::light(),
                    size: TabsSize::Medium,
                    items: vec![
                        tab_item("first", "First", true, false),
                        tab_item("disabled", "Disabled", false, true),
                        tab_item("third", "Third", false, false),
                        tab_item("last", "Last", false, false),
                    ],
                    on_select: Rc::new(move |id, _, _| activated.borrow_mut().push(id)),
                })
                .child(
                    div()
                        .id("after-tabs")
                        .debug_selector(|| "after-tabs".to_string())
                        .tab_index(1)
                        .child("After tabs"),
                )
        }
    }

    struct MenuFixture {
        activated: Rc<RefCell<Vec<SharedString>>>,
    }
    impl Render for MenuFixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let activated = self.activated.clone();
            Menu {
                id: "menu".into(),
                theme: Theme::light(),
                items: vec![
                    MenuItem {
                        id: "open".into(),
                        label: "Open".into(),
                        icon: Some(IconName::Files),
                        selected: true,
                        disabled: false,
                    },
                    MenuItem {
                        id: "rename".into(),
                        label: "Rename".into(),
                        icon: None,
                        selected: false,
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
                on_activate: Rc::new(move |id, _, _| activated.borrow_mut().push(id)),
                on_dismiss: None,
            }
        }
    }

    struct MenuKeyboardFixture {
        activated: Rc<RefCell<Vec<SharedString>>>,
        dismissed: Rc<RefCell<usize>>,
        before: FocusHandle,
        after: FocusHandle,
    }
    impl Render for MenuKeyboardFixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let activated = self.activated.clone();
            let dismissed = self.dismissed.clone();
            div()
                .tab_group()
                .flex()
                .flex_col()
                .child(
                    div()
                        .id("before-menu")
                        .debug_selector(|| "before-menu".to_string())
                        .track_focus(&self.before.clone().tab_index(-1).tab_stop(true))
                        .child("Before menu"),
                )
                .child(Menu {
                    id: "menu-keyboard".into(),
                    theme: Theme::light(),
                    items: vec![
                        MenuItem {
                            id: "disabled-first".into(),
                            label: "Disabled first".into(),
                            icon: None,
                            selected: false,
                            disabled: true,
                        },
                        MenuItem {
                            id: "second".into(),
                            label: "Second".into(),
                            icon: None,
                            selected: false,
                            disabled: false,
                        },
                        MenuItem {
                            id: "disabled-third".into(),
                            label: "Disabled third".into(),
                            icon: None,
                            selected: false,
                            disabled: true,
                        },
                        MenuItem {
                            id: "last".into(),
                            label: "Last".into(),
                            icon: None,
                            selected: false,
                            disabled: false,
                        },
                    ],
                    on_activate: Rc::new(move |id, _, _| activated.borrow_mut().push(id)),
                    on_dismiss: Some(Rc::new(move |_, _| *dismissed.borrow_mut() += 1)),
                })
                .child(
                    div()
                        .id("after-menu")
                        .debug_selector(|| "after-menu".to_string())
                        .track_focus(&self.after.clone().tab_index(1).tab_stop(true))
                        .child("After menu"),
                )
        }
    }

    fn render<T: Render + 'static>(
        cx: &mut TestAppContext,
        build: impl FnOnce() -> T + 'static,
        width: f32,
        height: f32,
    ) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let (_, cx) = cx.add_window_view(move |_, _| build());
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }

    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector)
            .unwrap_or_else(|| panic!("missing rendered geometry for {selector}"))
    }

    #[gpui::test]
    fn tabs_render_all_design_heights_and_icon_label_gap(cx: &mut TestAppContext) {
        let cx = render(cx, || TabsGeometryFixture, 400.0, 160.0);
        assert_eq!(
            bounds(cx, "tabs-small.root").size,
            size(px(400.0), px(32.0))
        );
        assert_eq!(
            bounds(cx, "tabs-medium.root").size,
            size(px(400.0), px(40.0))
        );
        assert_eq!(
            bounds(cx, "tabs-large.root").size,
            size(px(400.0), px(48.0))
        );

        let item = bounds(cx, "tabs-medium.item-conversation");
        let icon = bounds(cx, "tabs-medium.item-conversation.icon");
        let label = bounds(cx, "tabs-medium.item-conversation.label");
        assert_eq!(item.size.height, px(40.0));
        assert_eq!(icon.size, size(px(16.0), px(16.0)));
        assert_eq!(icon.origin.x - item.origin.x, px(14.0));
        assert_eq!(label.origin.x - icon.right(), px(8.0));
        let underline = bounds(cx, "tabs-medium.item-conversation.underline");
        assert_eq!(underline.origin.x, item.origin.x);
        assert_eq!(underline.origin.y, item.origin.y + px(39.0));
        assert_eq!(underline.size, size(item.size.width, px(2.0)));
    }

    #[gpui::test]
    fn tabs_activate_by_pointer_enter_and_space_but_disabled_tab_does_not(cx: &mut TestAppContext) {
        let activated = Rc::new(RefCell::new(Vec::new()));
        let fixture_log = activated.clone();
        let cx = render(
            cx,
            move || TabsActivationFixture {
                activated: fixture_log,
            },
            320.0,
            80.0,
        );
        let enabled = bounds(cx, "tabs-action.item-enabled");
        cx.simulate_click(enabled.center(), Modifiers::default());
        assert!(
            cx.update(|window, app| window.focused(app).is_some()),
            "click must focus enabled tab"
        );
        cx.simulate_keystrokes("enter space");
        let disabled = bounds(cx, "tabs-action.item-disabled");
        cx.simulate_click(disabled.center(), Modifiers::default());
        assert_eq!(
            activated.borrow().as_slice(),
            ["enabled", "enabled", "enabled"],
            "pointer, Enter, and Space activate exactly once each"
        );
    }

    #[gpui::test]
    fn tabs_roving_focus_skips_disabled_items_and_automatically_selects(cx: &mut TestAppContext) {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let activated = Rc::new(RefCell::new(Vec::new()));
        let fixture_log = activated.clone();
        let (_, cx) = cx.add_window_view(move |_, _| TabsKeyboardFixture {
            activated: fixture_log,
        });
        cx.simulate_resize(size(px(320.0), px(100.0)));
        cx.run_until_parked();

        let first = bounds(cx, "tabs-keyboard.item-first").center();
        cx.simulate_click(first, Modifiers::default());
        activated.borrow_mut().clear();
        cx.update(|window, _| window.focus_next());
        cx.simulate_keystrokes("enter");
        assert_eq!(
            activated.borrow().as_slice(),
            [] as [&str; 0],
            "Tab leaves the tablist instead of visiting every tab"
        );
        cx.simulate_click(first, Modifiers::default());
        cx.simulate_keystrokes("right right right left home end space");

        assert_eq!(
            activated.borrow().as_slice(),
            [
                "first", "third", "last", "first", "last", "first", "last", "last"
            ],
            "only the selected tab is in the tab order; navigation wraps, skips disabled tabs, and activates selection"
        );
    }

    #[gpui::test]
    fn menu_renders_220_width_28_rows_4_inset_and_8_icon_gap_and_activates(
        cx: &mut TestAppContext,
    ) {
        let activated = Rc::new(RefCell::new(Vec::new()));
        let fixture_log = activated.clone();
        let cx = render(
            cx,
            move || MenuFixture {
                activated: fixture_log,
            },
            300.0,
            140.0,
        );
        let root = bounds(cx, "menu.root");
        let open = bounds(cx, "menu.item-open");
        let icon = bounds(cx, "menu.item-open.icon");
        let label = bounds(cx, "menu.item-open.label");
        assert_eq!(root.size.width, px(220.0));
        assert_eq!(open.size.height, px(28.0));
        assert_eq!(open.origin.x - root.origin.x, px(5.0));
        assert_eq!(root.right() - open.right(), px(5.0));
        assert_eq!(icon.origin.x - open.origin.x, px(8.0));
        assert_eq!(label.origin.x - icon.right(), px(8.0));
        assert_eq!(
            bounds(cx, "menu.item-rename.label").origin.x - bounds(cx, "menu.item-rename").origin.x,
            px(8.0),
            "an absent optional icon creates no empty lane or gap"
        );

        cx.simulate_click(open.center(), Modifiers::default());
        cx.simulate_keystrokes("enter space");
        let disabled = bounds(cx, "menu.item-delete");
        cx.simulate_click(disabled.center(), Modifiers::default());
        assert_eq!(
            activated.borrow().as_slice(),
            ["open", "open", "open"],
            "pointer, Enter, and Space activate exactly once each"
        );
    }

    #[gpui::test]
    fn menu_roving_focus_skips_disabled_items_and_escape_dismisses(cx: &mut TestAppContext) {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let activated = Rc::new(RefCell::new(Vec::new()));
        let dismissed = Rc::new(RefCell::new(0));
        let before = cx.update(|cx: &mut App| cx.focus_handle());
        let after = cx.update(|cx: &mut App| cx.focus_handle());
        let fixture_log = activated.clone();
        let fixture_dismissed = dismissed.clone();
        let fixture_before = before.clone();
        let fixture_after = after.clone();
        let (_, cx) = cx.add_window_view(move |_, _| MenuKeyboardFixture {
            activated: fixture_log,
            dismissed: fixture_dismissed,
            before: fixture_before,
            after: fixture_after,
        });
        cx.simulate_resize(size(px(300.0), px(180.0)));
        cx.run_until_parked();

        let second = bounds(cx, "menu-keyboard.item-second").center();
        cx.simulate_click(second, Modifiers::default());
        activated.borrow_mut().clear();
        cx.update(|window, _| window.focus_next());
        cx.simulate_keystrokes("enter");
        assert_eq!(
            activated.borrow().as_slice(),
            [] as [&str; 0],
            "Tab leaves the menu instead of visiting every item"
        );
        cx.simulate_click(second, Modifiers::default());
        cx.simulate_keystrokes("down enter down enter up enter home enter end space escape");

        assert_eq!(
            activated.borrow().as_slice(),
            ["second", "last", "second", "last", "second", "last"],
            "arrows and Home/End move focus without activation and skip disabled items"
        );
        assert_eq!(
            *dismissed.borrow(),
            1,
            "Escape invokes the typed dismiss handler"
        );
    }

    #[gpui::test]
    fn menu_tab_and_shift_tab_dismiss_then_move_to_external_focus(cx: &mut TestAppContext) {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let activated = Rc::new(RefCell::new(Vec::new()));
        let dismissed = Rc::new(RefCell::new(0));
        let before = cx.update(|cx: &mut App| cx.focus_handle());
        let after = cx.update(|cx: &mut App| cx.focus_handle());
        let fixture_log = activated.clone();
        let fixture_dismissed = dismissed.clone();
        let fixture_before = before.clone();
        let fixture_after = after.clone();
        let (_, cx) = cx.add_window_view(move |_, _| MenuKeyboardFixture {
            activated: fixture_log,
            dismissed: fixture_dismissed,
            before: fixture_before,
            after: fixture_after,
        });
        cx.simulate_resize(size(px(300.0), px(180.0)));
        cx.run_until_parked();

        let second = bounds(cx, "menu-keyboard.item-second").center();
        cx.simulate_click(second, Modifiers::default());
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, _| after.is_focused(window)));
        assert_eq!(*dismissed.borrow(), 1);

        cx.simulate_click(second, Modifiers::default());
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, _| before.is_focused(window)));
        assert_eq!(*dismissed.borrow(), 2);
    }
}
