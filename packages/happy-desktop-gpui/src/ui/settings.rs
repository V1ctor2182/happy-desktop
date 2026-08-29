//! Store-free two-pane settings shell for native Happy surfaces.
//!
//! Product code owns routing, the selected category, all category content, and
//! the scrollbar state. This module owns only the reusable settings geometry and
//! interaction contract.

use std::{collections::HashMap, rc::Rc};

use gpui::{
    App, ElementId, Entity, FocusHandle, FontWeight, Global, IntoElement, MouseButton, RenderOnce,
    SharedString, WeakFocusHandle, Window, div, prelude::*, px,
};

use super::{
    components::ScrollSurface,
    icon::{Icon, IconName},
    metrics::SURFACE_HEADER_HEIGHT,
    scrollbar::ScrollbarState,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const SETTINGS_CONTENT_MAX_WIDTH: f32 = 720.0;
pub const SETTINGS_CONTENT_PADDING_TOP: f32 = 8.0;
pub const SETTINGS_CONTENT_PADDING_X: f32 = 24.0;
pub const SETTINGS_CONTENT_PADDING_BOTTOM: f32 = 48.0;
pub const SETTINGS_CATEGORY_ROW_HEIGHT: f32 = 32.0;

pub type SettingsCategorySelectHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type SettingsCloseHandler = Rc<dyn Fn(&mut Window, &mut App)>;

/// One closed, presentational destination supplied by the product router.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettingsCategory {
    pub id: SharedString,
    pub label: SharedString,
    pub icon: IconName,
}

/// Controlled, store-free settings window with a permanent category pane.
#[derive(IntoElement)]
pub struct SettingsShell {
    pub id: SharedString,
    pub theme: Theme,
    /// The resolved navigation width. The host can supply its
    /// `clamp(250px, 30vw, 360px)` result without this component reading a window.
    pub navigation_width: f32,
    pub categories: Vec<SettingsCategory>,
    pub selected_category_id: SharedString,
    pub navigation_title: SharedString,
    pub title: SharedString,
    pub description: Option<SharedString>,
    pub close_label: SharedString,
    pub body_scrollbar: Entity<ScrollbarState>,
    pub body: gpui::AnyElement,
    pub on_category_select: SettingsCategorySelectHandler,
    pub on_close: SettingsCloseHandler,
}

fn part(id: SharedString, name: SharedString) -> impl Fn() -> String {
    move || format!("{id}.{name}")
}

fn category_element_id(root: &SharedString, category: &SharedString) -> ElementId {
    ElementId::NamedChild(
        Box::new(ElementId::Name(root.clone())),
        format!("category:{category}").into(),
    )
}

#[derive(Default)]
struct SettingsFocusRegistry {
    handles: HashMap<String, WeakFocusHandle>,
}
impl Global for SettingsFocusRegistry {}

fn settings_focus_handle(cx: &mut App, key: String) -> FocusHandle {
    if let Some(handle) = cx
        .default_global::<SettingsFocusRegistry>()
        .handles
        .get(&key)
        .and_then(WeakFocusHandle::upgrade)
    {
        return handle;
    }
    let handle = cx.focus_handle();
    cx.default_global::<SettingsFocusRegistry>()
        .handles
        .insert(key, handle.downgrade());
    handle
}

impl RenderOnce for SettingsShell {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let root_id = self.id;
        let theme = self.theme;
        let selected = self.selected_category_id;
        let active_icon = self
            .categories
            .iter()
            .find(|category| category.id == selected)
            .map(|category| category.icon)
            .unwrap_or(IconName::Settings);

        let close_focus = settings_focus_handle(cx, format!("settings:{root_id}:close"));
        let close_callback = self.on_close;
        let close_pointer_focus = close_focus.clone();
        let close_keyboard = close_callback.clone();
        let close_id: SharedString = format!("{root_id}-close").into();
        let close_control = div()
            .id(close_id.clone())
            .debug_selector(part(root_id.clone(), "close".into()))
            .relative()
            .size(px(28.0))
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(6.0))
            .text_color(theme.role(ThemeRole::TextSecondary))
            .cursor_pointer()
            .track_focus(&close_focus.tab_index(0).tab_stop(true))
            .hover(|style| {
                style
                    .bg(theme.role(ThemeRole::SurfaceRipple))
                    .text_color(theme.role(ThemeRole::Text))
            })
            .focus(|style| {
                style
                    .border_2()
                    .border_color(theme.role(ThemeRole::RadioActive))
            })
            .on_mouse_down(MouseButton::Left, move |_, window, _| {
                close_pointer_focus.focus(window);
            })
            .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                close_callback(window, cx);
            })
            .on_key_down(move |event, window, cx| {
                if !event.is_held && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                {
                    cx.stop_propagation();
                    close_keyboard(window, cx);
                }
            })
            .child(Icon::decorative(
                IconName::Close,
                16.0,
                theme.role(ThemeRole::TextSecondary).into(),
                format!("{root_id}.close.icon"),
            ))
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "close-label".into()))
                    .absolute()
                    .size(px(0.0))
                    .overflow_hidden()
                    .child(self.close_label),
            );

        let category_callback = self.on_category_select;
        let row_width = (self.navigation_width - 12.0).max(0.0);
        let category_rows = self.categories.into_iter().map({
            let root_id = root_id.clone();
            let selected = selected.clone();
            move |category| {
                let category_id = category.id;
                let selected = category_id == selected;
                let selector_name: SharedString = format!("category-{category_id}").into();
                let focus =
                    settings_focus_handle(cx, format!("settings:{root_id}:category:{category_id}"));
                let pointer_focus = focus.clone();
                let callback = category_callback.clone();
                let keyboard_callback = callback.clone();
                let callback_id = category_id.clone();
                let keyboard_id = callback_id.clone();
                let icon_selector = format!("{root_id}.{selector_name}.icon");

                div()
                    .id(category_element_id(&root_id, &category_id))
                    .debug_selector(part(root_id.clone(), selector_name.clone()))
                    .relative()
                    .w(px(row_width))
                    .h(px(SETTINGS_CATEGORY_ROW_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(10.0))
                    .rounded(px(6.0))
                    .font_family(fonts::UI_FAMILY)
                    .text_size(px(13.0))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if selected {
                        theme.role(ThemeRole::Text)
                    } else {
                        theme.role(ThemeRole::TextSecondary)
                    })
                    .when(selected, |row| {
                        row.bg(theme.role(ThemeRole::SurfaceSelected))
                    })
                    .hover(|row| row.bg(theme.role(ThemeRole::SurfaceRipple)))
                    .cursor_pointer()
                    .track_focus(&focus.tab_index(0).tab_stop(true))
                    .focus(|style| {
                        style
                            .border_2()
                            .border_color(theme.role(ThemeRole::RadioActive))
                    })
                    .on_mouse_down(MouseButton::Left, move |_, window, _| {
                        pointer_focus.focus(window);
                    })
                    .on_mouse_up(MouseButton::Left, move |_, window, cx| {
                        callback(callback_id.clone(), window, cx);
                    })
                    .on_key_down(move |event, window, cx| {
                        if !event.is_held
                            && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                        {
                            cx.stop_propagation();
                            keyboard_callback(keyboard_id.clone(), window, cx);
                        }
                    })
                    .child(Icon::decorative(
                        category.icon,
                        16.0,
                        theme.role(ThemeRole::TextSecondary).into(),
                        icon_selector,
                    ))
                    .child(
                        div()
                            .debug_selector(part(
                                root_id.clone(),
                                format!("{selector_name}.label").into(),
                            ))
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .child(category.label),
                    )
            }
        });

        let navigation = div()
            .debug_selector(part(root_id.clone(), "navigation".into()))
            .w(px(self.navigation_width))
            .h_full()
            .min_h_0()
            .flex_none()
            .flex()
            .flex_col()
            .relative()
            .bg(theme.role(ThemeRole::GrouppedBackground))
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "navigation-header".into()))
                    .w_full()
                    .h(px(SURFACE_HEADER_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(12.0))
                    .child(close_control)
                    .child(
                        div()
                            .debug_selector(part(root_id.clone(), "navigation-title".into()))
                            .min_w_0()
                            .truncate()
                            .font_family(fonts::UI_FAMILY)
                            .text_size(px(15.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.role(ThemeRole::HeaderTintSecondary))
                            .child(self.navigation_title),
                    ),
            )
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "categories".into()))
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .p(px(6.0))
                    .children(category_rows),
            )
            // The hairline overlays the pane edge so the caller's explicit
            // navigation width remains the content's resolved width.
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "divider".into()))
                    .absolute()
                    .top_0()
                    .right_0()
                    .bottom_0()
                    .w(px(1.0))
                    .bg(theme.role(ThemeRole::Divider)),
            );

        let heading = div()
            .debug_selector(part(root_id.clone(), "heading".into()))
            .flex_1()
            .min_w_0()
            .flex()
            .items_baseline()
            .gap(px(8.0))
            .text_color(theme.role(ThemeRole::TextSecondary))
            .child(Icon::decorative(
                active_icon,
                16.0,
                theme.role(ThemeRole::TextSecondary).into(),
                format!("{root_id}.heading.icon"),
            ))
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "heading-title".into()))
                    .flex_none()
                    .text_size(px(15.0))
                    .line_height(px(20.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.role(ThemeRole::Text))
                    .child(self.title),
            )
            .children(self.description.map(|description| {
                div()
                    .debug_selector(part(root_id.clone(), "heading-description".into()))
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(13.0))
                    .line_height(px(20.0))
                    .text_color(theme.role(ThemeRole::TextSecondary))
                    .child(description)
            }));

        let main = div()
            .debug_selector(part(root_id.clone(), "main".into()))
            .flex_1()
            .min_w_0()
            .min_h_0()
            .h_full()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::Surface))
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "panel-header".into()))
                    .w_full()
                    .h(px(SURFACE_HEADER_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .px(px(16.0))
                    .border_b_1()
                    .border_color(theme.role(ThemeRole::Divider))
                    .bg(theme.role(ThemeRole::HeaderBackground))
                    .font_family(fonts::UI_FAMILY)
                    .child(heading),
            )
            .child(
                div()
                    .debug_selector(part(root_id.clone(), "body".into()))
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .w_full()
                    .child(ScrollSurface {
                        id: format!("{root_id}-body-scroll").into(),
                        theme,
                        width: None,
                        height: None,
                        vertical: Some(self.body_scrollbar),
                        horizontal: None,
                        content: div()
                            .debug_selector(part(root_id.clone(), "content".into()))
                            .w_full()
                            .max_w(px(SETTINGS_CONTENT_MAX_WIDTH))
                            .min_h_full()
                            .flex()
                            .flex_col()
                            .gap(px(32.0))
                            .pt(px(SETTINGS_CONTENT_PADDING_TOP))
                            .px(px(SETTINGS_CONTENT_PADDING_X))
                            .pb(px(SETTINGS_CONTENT_PADDING_BOTTOM))
                            .child(self.body)
                            .into_any_element(),
                    }),
            );

        div()
            .id(root_id.clone())
            .debug_selector(part(root_id, "root".into()))
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .flex()
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .bg(theme.role(ThemeRole::HeaderBackground))
            .child(navigation)
            .child(main)
    }
}

#[cfg(test)]
mod geometry_tests {
    use super::*;
    use crate::ui::scrollbar::{ScrollbarAppearance, ScrollbarPlacement, SharedScrollHandle};
    use gpui::{
        App, Bounds, Context, Modifiers, Pixels, Render, TestAppContext, VisualTestContext, Window,
        px, size,
    };
    use std::{cell::RefCell, rc::Rc};

    struct Fixture {
        scrollbar: Entity<ScrollbarState>,
        category_log: Rc<RefCell<Vec<String>>>,
        close_count: Rc<RefCell<usize>>,
        navigation_width: f32,
    }

    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let category_log = self.category_log.clone();
            let close_count = self.close_count.clone();
            SettingsShell {
                id: "settings-test".into(),
                theme: Theme::light(),
                navigation_width: self.navigation_width,
                categories: vec![
                    SettingsCategory {
                        id: "general".into(),
                        label: "General".into(),
                        icon: IconName::Settings,
                    },
                    SettingsCategory {
                        id: "security".into(),
                        label: "Security".into(),
                        icon: IconName::Shield,
                    },
                ],
                selected_category_id: "general".into(),
                navigation_title: "Settings".into(),
                title: "General".into(),
                description: Some("Happy Agent preferences".into()),
                close_label: "Back to workspace".into(),
                body_scrollbar: self.scrollbar.clone(),
                body: div()
                    .debug_selector(|| "settings-test.body-fixture".into())
                    .w_full()
                    .h(px(900.0))
                    .flex_none()
                    .child("Body")
                    .into_any_element(),
                on_category_select: Rc::new(move |id, _, _| {
                    category_log.borrow_mut().push(id.to_string());
                }),
                on_close: Rc::new(move |_, _| {
                    *close_count.borrow_mut() += 1;
                }),
            }
        }
    }

    fn render(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        navigation_width: f32,
    ) -> (
        &mut VisualTestContext,
        Rc<RefCell<Vec<String>>>,
        Rc<RefCell<usize>>,
    ) {
        cx.update(|cx: &mut App| {
            crate::fonts::register(cx);
            crate::ui::components::init(cx);
        });
        let category_log = Rc::new(RefCell::new(Vec::new()));
        let close_count = Rc::new(RefCell::new(0));
        let fixture_log = category_log.clone();
        let fixture_close = close_count.clone();
        let (_, cx) = cx.add_window_view(move |_, cx| {
            let handle = SharedScrollHandle::new();
            Fixture {
                scrollbar: cx.new(|_| {
                    ScrollbarState::vertical(
                        ScrollbarAppearance::Always,
                        ScrollbarPlacement::Overlay,
                        handle,
                    )
                }),
                category_log: fixture_log,
                close_count: fixture_close,
                navigation_width,
            }
        });
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        (cx, category_log, close_count)
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
    fn settings_shell_resolves_two_panes_header_full_bleed_viewport_and_body_measure_at_retina(
        cx: &mut TestAppContext,
    ) {
        for (width, height, navigation_width, main_width, viewport_height, content_width) in [
            (1280.0, 800.0, 360.0, 920.0, 744.0, 720.0),
            (720.0, 480.0, 250.0, 470.0, 424.0, 470.0),
        ] {
            let (cx, _, _) = render(cx, width, height, navigation_width);
            assert_rect(bounds(cx, "settings-test.root"), 0.0, 0.0, width, height);
            assert_rect(
                bounds(cx, "settings-test.navigation"),
                0.0,
                0.0,
                navigation_width,
                height,
            );
            assert_rect(
                bounds(cx, "settings-test.navigation-header"),
                0.0,
                0.0,
                navigation_width,
                56.0,
            );
            assert_rect(
                bounds(cx, "settings-test.main"),
                navigation_width,
                0.0,
                main_width,
                height,
            );
            assert_rect(
                bounds(cx, "settings-test.panel-header"),
                navigation_width,
                0.0,
                main_width,
                56.0,
            );
            assert_rect(
                bounds(cx, "settings-test.body"),
                navigation_width,
                56.0,
                main_width,
                viewport_height,
            );
            assert_rect(
                bounds(cx, "settings-test-body-scroll.root"),
                navigation_width,
                56.0,
                main_width,
                viewport_height,
            );
            assert_rect(
                bounds(cx, "settings-test-body-scroll.viewport"),
                navigation_width,
                56.0,
                main_width,
                viewport_height,
            );
            let content = bounds(cx, "settings-test.content");
            assert_rect(content, navigation_width, 56.0, content_width, 956.0);
            let body = bounds(cx, "settings-test.body-fixture");
            assert_eq!(body.origin.x - content.origin.x, px(24.0));
            assert_eq!(body.origin.y - content.origin.y, px(8.0));
            assert_eq!(body.size.width, px(content_width - 48.0));
            assert_eq!(content.bottom() - body.bottom(), px(48.0));
        }
    }

    #[gpui::test]
    fn settings_categories_and_close_activate_by_pointer_enter_and_space(cx: &mut TestAppContext) {
        let (cx, category_log, close_count) = render(cx, 720.0, 480.0, 250.0);
        let category_center = bounds(cx, "settings-test.category-security").center();
        cx.simulate_click(category_center, Modifiers::default());
        cx.simulate_keystrokes("enter space");
        let close_center = bounds(cx, "settings-test.close").center();
        cx.simulate_click(close_center, Modifiers::default());
        cx.simulate_keystrokes("enter space");
        assert_eq!(
            category_log.borrow().as_slice(),
            ["security", "security", "security"]
        );
        assert_eq!(*close_count.borrow(), 3);
    }
}
