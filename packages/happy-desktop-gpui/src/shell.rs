use gpui::{Context, Entity, IntoElement, Render, Window, WindowAppearance, div, prelude::*, px};

use crate::ui::gallery::{GalleryModalState, GalleryPage};
use crate::{
    theme::Theme,
    ui::{
        ActivateHandler, Avatar, AvatarSize, Button, ButtonVariant, Composer, ControlSize, FileRow,
        Icon, IconName, ListRow, MessageRow, ModalFocus, ScrollSurface, ScrollbarAppearance,
        ScrollbarPlacement, ScrollbarState, SectionLabel, SharedScrollHandle, TabItem,
        TabSelectHandler, Tabs, TabsSize, TextInput, TitleBar, theme_roles::ThemeRole,
    },
};
use std::rc::Rc;

const TITLE_HEIGHT: f32 = 40.0;
const SIDEBAR_WIDTH: f32 = 288.0;
const PANEL_WIDTH: f32 = 340.0;

pub struct HappyApp {
    dark_override: Option<bool>,
    show_gallery: bool,
    gallery_inputs: [Entity<TextInput>; 4],
    gallery_scrollbars: [Entity<ScrollbarState>; 5],
    gallery_modal_states: [GalleryModalState; 5],
    transcript_scrollbar: Entity<ScrollbarState>,
    workspace_tabs_scrollbar: Entity<ScrollbarState>,
    gallery_page: GalleryPage,
    active_tab: gpui::SharedString,
    composer_input: Entity<TextInput>,
    inspector_scope: gpui::SharedString,
}

impl HappyApp {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let dark_override = match std::env::var("HAPPY_GPUI_APPEARANCE").as_deref() {
            Ok("dark") => Some(true),
            Ok("light") => Some(false),
            _ => None,
        };
        Self::with_mode(
            dark_override,
            std::env::var_os("HAPPY_GPUI_GALLERY").is_some(),
            cx,
        )
    }

    fn with_mode(dark_override: Option<bool>, show_gallery: bool, cx: &mut Context<Self>) -> Self {
        let transcript_handle = SharedScrollHandle::new();
        let transcript_scrollbar = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::BesideWhenOverflowing,
                transcript_handle,
            )
        });
        let workspace_tabs_scrollbar = cx.new(|_| {
            ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let specimen_overflow = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::BesideWhenOverflowing,
                SharedScrollHandle::new(),
            )
        });
        let specimen_fit = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::BesideWhenOverflowing,
                SharedScrollHandle::new(),
            )
        });
        let workbench_handle = SharedScrollHandle::new();
        let workbench_vertical = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                workbench_handle.clone(),
            )
        });
        let workbench_horizontal = cx.new(|_| {
            ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                workbench_handle,
            )
        });
        let page_horizontal = cx.new(|_| {
            ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let gallery_modal_states = std::array::from_fn(|_| {
            let container = cx.focus_handle();
            let first = cx.focus_handle();
            let last = cx.focus_handle();
            GalleryModalState {
                focus: ModalFocus {
                    container,
                    initial: first.clone(),
                    first,
                    last,
                },
                body_scrollbar: cx.new(|_| {
                    ScrollbarState::vertical(
                        ScrollbarAppearance::Automatic,
                        ScrollbarPlacement::BesideWhenOverflowing,
                        SharedScrollHandle::new(),
                    )
                }),
            }
        });
        Self {
            dark_override,
            show_gallery,
            gallery_inputs: [
                cx.new(|cx| TextInput::new("gallery-input-small", "", "Small", Theme::light(), cx)),
                cx.new(|cx| {
                    TextInput::new(
                        "gallery-input-medium",
                        "happy-desktop",
                        "Project name",
                        Theme::light(),
                        cx,
                    )
                }),
                cx.new(|cx| {
                    TextInput::new("gallery-input-large", "", "Repository", Theme::light(), cx)
                }),
                cx.new(|cx| {
                    TextInput::new(
                        "gallery-input-invalid",
                        "missing",
                        "Required",
                        Theme::light(),
                        cx,
                    )
                }),
            ],
            gallery_scrollbars: [
                specimen_overflow,
                specimen_fit,
                workbench_vertical,
                workbench_horizontal,
                page_horizontal,
            ],
            gallery_modal_states,
            transcript_scrollbar,
            workspace_tabs_scrollbar,
            gallery_page: GalleryPage::Buttons,
            active_tab: "native".into(),
            composer_input: cx.new(|cx| {
                TextInput::new(
                    "composer-input",
                    "",
                    "Message Happy in “happy-desktop”…",
                    Theme::light(),
                    cx,
                )
            }),
            inspector_scope: "changes".into(),
        }
    }

    fn effective_dark(dark_override: Option<bool>, appearance: WindowAppearance) -> bool {
        dark_override.unwrap_or(matches!(
            appearance,
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        ))
    }

    fn is_dark(&self, window: &Window) -> bool {
        Self::effective_dark(self.dark_override, window.appearance())
    }

    fn appearance_toggle_label(effective_dark: bool) -> &'static str {
        if effective_dark {
            "Light appearance"
        } else {
            "Dark appearance"
        }
    }

    fn happy_sidebar_selected(&self) -> bool {
        !self.show_gallery
    }

    fn column_widths(viewport_width: f32) -> (f32, f32) {
        let interpolation = ((viewport_width - 720.0) / (1280.0 - 720.0)).clamp(0.0, 1.0);
        let sidebar = 250.0 + (SIDEBAR_WIDTH - 250.0) * interpolation;
        let inspector = 250.0 + (PANEL_WIDTH - 250.0) * interpolation;
        (sidebar, inspector)
    }

    fn sidebar_row(
        &self,
        theme: Theme,
        width: f32,
        icon: IconName,
        label: &'static str,
        selected: bool,
        on_activate: Option<ActivateHandler>,
    ) -> impl IntoElement {
        div().mx(px(6.0)).child(ListRow {
            id: format!("sidebar-row-{label}").into(),
            theme,
            label: label.into(),
            width: width - 13.0,
            horizontal_padding: 8.0,
            gap: 8.0,
            icon: Some(icon),
            trailing: None,
            selected,
            disabled: false,
            focus_handle: None,
            on_activate,
        })
    }

    fn section_label(&self, theme: Theme, label: &'static str) -> impl IntoElement {
        SectionLabel {
            id: format!("section-label-{label}").into(),
            theme,
            label: label.into(),
        }
    }

    fn title_bar(&self, theme: Theme, label: &'static str) -> impl IntoElement {
        TitleBar {
            id: format!("title-bar-{label}").into(),
            theme,
            title: label.into(),
        }
    }

    fn sidebar(
        &self,
        theme: Theme,
        effective_dark: bool,
        width: f32,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let toggle_label = Self::appearance_toggle_label(effective_dark);
        let entity = cx.entity();
        let gallery_action: ActivateHandler = Rc::new(move |_, cx| {
            entity.update(cx, |this, cx| {
                this.show_gallery = !this.show_gallery;
                cx.notify();
            });
        });
        let entity = cx.entity();
        let theme_action: ActivateHandler = Rc::new(move |window, cx| {
            entity.update(cx, |this, cx| {
                this.dark_override = Some(!this.is_dark(window));
                cx.notify();
            });
        });

        div()
            .debug_selector(|| "sidebar-root".into())
            .w(px(width))
            .min_w(px(250.0))
            .flex_none()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::HeaderBackground))
            .border_r_1()
            .border_color(theme.role(ThemeRole::Divider))
            .child(
                div()
                    .debug_selector(|| "sidebar-header".into())
                    .h(px(TITLE_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_end()
                    .px(px(10.0))
                    .border_b_1()
                    .border_color(theme.role(ThemeRole::Divider))
                    .child(Button {
                        id: "new-workspace".into(),
                        theme,
                        label: "New".into(),
                        size: ControlSize::Small,
                        variant: ButtonVariant::Ghost,
                        icon: Some(IconName::Plus),
                        icon_only: false,
                        disabled: false,
                        force_focused: false,
                        focus_handle: None,
                        on_activate: Some(Rc::new(|_, _| {})),
                    }),
            )
            .child(
                div()
                    .debug_selector(|| "sidebar-body".into())
                    .flex_1()
                    .overflow_hidden()
                    .pt(px(6.0))
                    .child(self.sidebar_row(theme, width, IconName::Chat, "Create", false, None))
                    .child(self.sidebar_row(
                        theme,
                        width,
                        IconName::Users,
                        "Happy Social",
                        false,
                        None,
                    ))
                    .child(self.section_label(theme, "THIS MAC"))
                    .child(self.sidebar_row(
                        theme,
                        width,
                        IconName::Home,
                        "Happy",
                        self.happy_sidebar_selected(),
                        None,
                    ))
                    .child(div().ml(px(18.0)).child(self.sidebar_row(
                        theme,
                        width - 18.0,
                        IconName::Chat,
                        "GPUI rewrite",
                        false,
                        None,
                    )))
                    .child(self.section_label(theme, "PROJECTS"))
                    .child(self.sidebar_row(
                        theme,
                        width,
                        IconName::Files,
                        "happy-desktop",
                        false,
                        None,
                    ))
                    .child(div().ml(px(18.0)).child(self.sidebar_row(
                        theme,
                        width - 18.0,
                        IconName::Chat,
                        "Native app",
                        false,
                        None,
                    )))
                    .child(self.sidebar_row(
                        theme,
                        width,
                        IconName::Braces,
                        "UI Gallery",
                        self.show_gallery,
                        Some(gallery_action),
                    )),
            )
            .child(
                div()
                    .debug_selector(|| "sidebar-footer".into())
                    .h(px(40.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .px(px(8.0))
                    .gap(px(4.0))
                    .border_t_1()
                    .border_color(theme.role(ThemeRole::Divider))
                    .child(ListRow {
                        id: "theme-toggle".into(),
                        theme,
                        label: toggle_label.into(),
                        width: width - 17.0,
                        horizontal_padding: 10.0,
                        gap: 8.0,
                        icon: Some(IconName::Settings),
                        trailing: None,
                        selected: false,
                        disabled: false,
                        focus_handle: None,
                        on_activate: Some(theme_action),
                    }),
            )
    }

    fn tabs(&self, theme: Theme, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        let on_select: TabSelectHandler = Rc::new(move |id, _, cx| {
            entity.update(cx, |this, cx| {
                this.active_tab = id;
                cx.notify();
            });
        });
        let tabs = Tabs {
            id: "workspace-tabs".into(),
            theme,
            size: TabsSize::Medium,
            items: vec![
                TabItem {
                    id: "native".into(),
                    label: "Native Happy rewrite".into(),
                    icon: Some(IconName::Dot),
                    selected: self.active_tab == "native",
                    disabled: false,
                },
                TabItem {
                    id: "cargo".into(),
                    label: "Cargo.toml".into(),
                    icon: Some(IconName::Code),
                    selected: self.active_tab == "cargo",
                    disabled: false,
                },
            ],
            on_select,
        };
        ScrollSurface {
            id: "workspace-tabs-scroll".into(),
            theme,
            width: None,
            height: Some(40.0),
            vertical: None,
            horizontal: Some(self.workspace_tabs_scrollbar.clone()),
            content: div()
                .w_full()
                .min_w(px(340.0))
                .flex_none()
                .child(tabs)
                .into_any_element(),
        }
    }

    fn transcript(&self, theme: Theme) -> impl IntoElement {
        let content = div().debug_selector(|| "transcript-content".into()).h_full().flex_none()
            .flex().flex_col().justify_end().gap(px(18.0)).px(px(32.0)).pb(px(24.0))
            .child(MessageRow {
                id: "transcript-first-message".into(), author: "Steve".into(),
                avatar: Avatar { id: "transcript-steve-avatar".into(), theme, initials: "S".into(), icon: None, size: AvatarSize::Sm, agent: true, online: false },
                content: div().text_size(px(14.0)).line_height(px(20.0)).child("Rewrite Happy as a native Rust app with GPUI, while keeping the Electron app intact.").into_any_element(),
            })
            .child(MessageRow {
                id: "transcript-agent-message".into(), author: "Happy".into(),
                avatar: Avatar { id: "transcript-happy-avatar".into(), theme, initials: "H".into(), icon: Some(IconName::Terminal), size: AvatarSize::Sm, agent: false, online: true },
                content: div().flex().flex_col().gap(px(8.0))
                    .child(div().text_size(px(14.0)).line_height(px(20.0)).child("Phase 1 establishes the native window, exact shell geometry, theme tokens, and versioned macOS packaging."))
                    .child(div().h(px(34.0)).flex().items_center().gap(px(8.0)).px(px(10.0)).rounded(px(6.0)).bg(theme.role(ThemeRole::SurfaceHigh))
                        .text_size(px(12.0)).text_color(theme.role(ThemeRole::TextSecondary))
                        .child(Icon::decorative(IconName::Terminal, 14.0, theme.role(ThemeRole::TextSecondary).into(), "transcript-command-icon"))
                        .child("cargo build --release"))
                    .into_any_element(),
            }).into_any_element();
        div()
            .debug_selector(|| "transcript-root".into())
            .flex_1()
            .min_h_0()
            .bg(theme.role(ThemeRole::Surface))
            .child(ScrollSurface {
                id: "transcript-scroll".into(),
                theme,
                width: None,
                height: None,
                vertical: Some(self.transcript_scrollbar.clone()),
                horizontal: None,
                content,
            })
    }

    fn composer(&self, theme: Theme) -> impl IntoElement {
        let input = self.composer_input.clone();
        let submit: ActivateHandler = Rc::new(move |_, cx| {
            input.update(cx, |input, cx| input.set_value("", cx));
        });
        div()
            .debug_selector(|| "composer-wrap".into())
            .flex_none()
            .px(px(24.0))
            .pb(px(18.0))
            .bg(theme.role(ThemeRole::Surface))
            .child(Composer {
                id: "composer".into(),
                theme,
                input: self.composer_input.clone(),
                width: None,
                metadata: vec!["Codex".into(), "Full access".into(), "High".into()],
                on_submit: submit,
            })
    }

    fn workspace(&self, theme: Theme, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .debug_selector(|| "workspace-root".into())
            .flex_1()
            .flex()
            .flex_col()
            .min_w(px(140.0))
            .bg(theme.role(ThemeRole::Surface))
            .child(self.title_bar(
                theme,
                "happy-desktop  ·  /Users/steve/Happy/Workspaces/happy-desktop",
            ))
            .child(self.tabs(theme, cx))
            .child(self.transcript(theme))
            .child(self.composer(theme))
    }

    fn inspector(&self, theme: Theme, width: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        let on_select: TabSelectHandler = Rc::new(move |id, _, cx| {
            entity.update(cx, |this, cx| {
                this.inspector_scope = id;
                cx.notify();
            });
        });
        div()
            .debug_selector(|| "inspector-root".into())
            .w(px(width))
            .min_w(px(250.0))
            .flex_none()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::Surface))
            .border_l_1()
            .border_color(theme.role(ThemeRole::Divider))
            .child(self.title_bar(theme, "Files"))
            .child(Tabs {
                id: "inspector-scope".into(),
                theme,
                size: TabsSize::Small,
                items: vec![
                    TabItem {
                        id: "changes".into(),
                        label: "Changes".into(),
                        icon: None,
                        selected: self.inspector_scope == "changes",
                        disabled: false,
                    },
                    TabItem {
                        id: "all-files".into(),
                        label: "All Files".into(),
                        icon: None,
                        selected: self.inspector_scope == "all-files",
                        disabled: false,
                    },
                ],
                on_select,
            })
            .child(
                div()
                    .px(px(6.0))
                    .pt(px(6.0))
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(file_row(
                        theme,
                        "M",
                        "src/main.rs",
                        "+214  −0",
                        theme.role(ThemeRole::BoxWarningBorder),
                    ))
                    .child(file_row(
                        theme,
                        "A",
                        "src/theme.rs",
                        "+52  −0",
                        theme.role(ThemeRole::Success),
                    ))
                    .child(file_row(
                        theme,
                        "A",
                        "scripts/package-macos.sh",
                        "+61  −0",
                        theme.role(ThemeRole::Success),
                    ))
                    .child(file_row(
                        theme,
                        "A",
                        "docs/plans/native-gpui-rewrite.md",
                        "+118  −0",
                        theme.role(ThemeRole::Success),
                    )),
            )
    }
}

impl Render for HappyApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let effective_dark = self.is_dark(window);
        let theme = if effective_dark {
            Theme::dark()
        } else {
            Theme::light()
        };
        let viewport_width: f32 = window.viewport_size().width.into();
        let (sidebar_width, inspector_width) = Self::column_widths(viewport_width);
        for input in &self.gallery_inputs {
            input.update(cx, |input, _| input.theme_reconcile(theme));
        }
        self.composer_input
            .update(cx, |input, _| input.theme_reconcile(theme));
        let root = div()
            .debug_selector(|| "app-shell-root".into())
            .tab_group()
            .size_full()
            .flex()
            .bg(theme.role(ThemeRole::GrouppedBackground))
            .text_color(theme.role(ThemeRole::Text))
            .font_family(crate::fonts::UI_FAMILY)
            .on_key_down(|event, window, cx| {
                if event.keystroke.key == "tab" {
                    cx.stop_propagation();
                    if event.keystroke.modifiers.shift {
                        window.focus_prev();
                    } else {
                        window.focus_next();
                    }
                }
            })
            .child(self.sidebar(theme, effective_dark, sidebar_width, cx));
        if self.show_gallery {
            {
                let entity = cx.entity();
                let on_select: TabSelectHandler = Rc::new(move |id, _, cx| {
                    if let Some(page) = GalleryPage::from_id(&id) {
                        entity.update(cx, |this, cx| {
                            this.gallery_page = page;
                            cx.notify();
                        });
                    }
                });
                root.child(crate::ui::gallery::gallery(
                    theme,
                    self.gallery_inputs.clone(),
                    self.gallery_scrollbars.clone(),
                    self.gallery_modal_states.clone(),
                    self.gallery_page,
                    on_select,
                ))
            }
        } else {
            root.child(self.workspace(theme, cx))
                .child(self.inspector(theme, inspector_width, cx))
        }
    }
}

fn file_row(
    theme: Theme,
    status: &'static str,
    label: &'static str,
    changes: &'static str,
    status_color: gpui::Rgba,
) -> FileRow {
    FileRow {
        id: format!("file-row-{label}").into(),
        theme,
        status: status.into(),
        path: label.into(),
        changes: changes.into(),
        status_color,
    }
}

#[cfg(test)]
mod geometry_tests {
    use gpui::{
        Bounds, Modifiers, Pixels, ScrollDelta, ScrollWheelEvent, TestAppContext,
        VisualTestContext, WindowAppearance, point, px, size,
    };

    use super::{GalleryPage, HappyApp};

    const WIDTH: f32 = 1280.0;
    const HEIGHT: f32 = 800.0;

    fn render(cx: &mut TestAppContext) -> &mut VisualTestContext {
        render_at(cx, WIDTH, HEIGHT, None).1
    }

    fn render_at(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        dark_override: Option<bool>,
    ) -> (gpui::Entity<HappyApp>, &mut VisualTestContext) {
        cx.update(|cx| crate::fonts::register(cx));
        let (app, cx) = cx.add_window_view(|_, cx| HappyApp::with_mode(dark_override, false, cx));
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        (app, cx)
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
    fn app_shell_resolves_design_reference_columns(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(bounds(cx, "app-shell-root"), 0.0, 0.0, 1280.0, 800.0);
        assert_rect(bounds(cx, "sidebar-root"), 0.0, 0.0, 288.0, 800.0);
        assert_rect(bounds(cx, "workspace-root"), 288.0, 0.0, 652.0, 800.0);
        assert_rect(bounds(cx, "inspector-root"), 940.0, 0.0, 340.0, 800.0);
    }

    #[gpui::test]
    fn app_shell_fits_the_720_by_480_minimum_without_clipping(cx: &mut TestAppContext) {
        let (_, cx) = render_at(cx, 720.0, 480.0, None);
        assert_rect(bounds(cx, "app-shell-root"), 0.0, 0.0, 720.0, 480.0);
        assert_rect(bounds(cx, "sidebar-root"), 0.0, 0.0, 250.0, 480.0);
        assert_rect(bounds(cx, "workspace-root"), 250.0, 0.0, 220.0, 480.0);
        assert_rect(bounds(cx, "inspector-root"), 470.0, 0.0, 250.0, 480.0);

        let sidebar = bounds(cx, "sidebar-root");
        let outer_row = bounds(cx, "sidebar-row-Happy.root");
        for selector in [
            "sidebar-row-GPUI rewrite.root",
            "sidebar-row-Native app.root",
        ] {
            let nested = bounds(cx, selector);
            assert_eq!(
                nested.right(),
                outer_row.right(),
                "{selector} shares the safe row edge"
            );
            assert_eq!(
                sidebar.right() - nested.right(),
                px(7.0),
                "{selector} keeps the 6px inset inside the sidebar border",
            );
        }

        for selector in [
            "sidebar-row-Happy.root",
            "sidebar-row-UI Gallery.root",
            "theme-toggle.root",
            "composer.card",
            "file-row-src/main.rs.root",
        ] {
            let element = bounds(cx, selector);
            assert!(
                element.origin.x >= px(0.0),
                "{selector} starts inside the window"
            );
            assert!(
                element.right() <= px(720.0),
                "{selector} ends inside the window"
            );
        }
    }

    #[gpui::test]
    fn workspace_tabs_are_contained_and_horizontally_reachable_at_720(cx: &mut TestAppContext) {
        let (_, cx) = render_at(cx, 720.0, 480.0, None);
        let viewport = bounds(cx, "workspace-tabs-scroll.viewport");
        assert_rect(viewport, 250.0, 40.0, 220.0, 40.0);

        let native = bounds(cx, "workspace-tabs.item-native");
        assert!(native.origin.x >= viewport.origin.x);
        assert!(native.right() <= viewport.right());
        assert!(native.size.width <= viewport.size.width);
        let cargo = bounds(cx, "workspace-tabs.item-cargo");
        assert!(cargo.size.width <= viewport.size.width);
        assert!(
            cargo.right() > viewport.right(),
            "the second tab starts offscreen"
        );

        cx.simulate_event(ScrollWheelEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(px(-220.0), px(0.0))),
            ..Default::default()
        });
        let cargo = bounds(cx, "workspace-tabs.item-cargo");
        assert!(cargo.origin.x >= viewport.origin.x);
        assert!(cargo.right() <= viewport.right());
        assert!(
            cargo.right() <= bounds(cx, "inspector-root").origin.x,
            "reachable tab content never paints into the inspector",
        );
    }

    #[gpui::test]
    fn rendered_dark_effective_mode_offers_light_and_ambient_dark_uses_same_state(
        cx: &mut TestAppContext,
    ) {
        let (app, cx) = render_at(cx, 720.0, 480.0, Some(true));
        assert!(bounds(cx, "theme-toggle.label").size.width > px(0.0));
        assert_eq!(
            cx.update(|_, context| {
                let app = app.read(context);
                HappyApp::appearance_toggle_label(app.dark_override.unwrap())
            }),
            "Light appearance"
        );
        assert!(HappyApp::effective_dark(None, WindowAppearance::Dark));
        assert_eq!(
            HappyApp::appearance_toggle_label(HappyApp::effective_dark(
                None,
                WindowAppearance::Dark,
            )),
            "Light appearance"
        );

        let toggle = bounds(cx, "theme-toggle.root").center();
        cx.simulate_click(toggle, Modifiers::default());
        assert_eq!(
            cx.update(|_, context| app.read(context).dark_override),
            Some(false),
            "the rendered toggle flips the effective dark state"
        );
    }

    #[gpui::test]
    fn selecting_gallery_clears_the_happy_sidebar_selection(cx: &mut TestAppContext) {
        let (app, cx) = render_at(cx, 720.0, 480.0, None);
        assert!(cx.update(|_, context| app.read(context).happy_sidebar_selected()));

        let gallery = bounds(cx, "sidebar-row-UI Gallery.root").center();
        cx.simulate_click(gallery, Modifiers::default());
        assert!(cx.debug_bounds("gallery-root").is_some());
        assert!(!cx.update(|_, context| app.read(context).happy_sidebar_selected()));
    }

    #[gpui::test]
    fn sidebar_resolves_header_body_footer_and_row_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(bounds(cx, "sidebar-header"), 0.0, 0.0, 287.0, 40.0);
        assert_rect(bounds(cx, "sidebar-body"), 0.0, 40.0, 287.0, 720.0);
        assert_rect(bounds(cx, "sidebar-footer"), 0.0, 760.0, 287.0, 40.0);

        let row = bounds(cx, "sidebar-row-Happy.root");
        assert_rect(row, 6.0, 138.0, 275.0, 32.0);
        let icon = bounds(cx, "sidebar-row-Happy.icon");
        assert_rect(icon, 14.0, 146.0, 16.0, 16.0);
        let label = bounds(cx, "sidebar-row-Happy.label");
        assert_eq!(
            label.origin.x - row.origin.x,
            px(32.0),
            "8px left padding + 16px icon + 8px gap"
        );
        assert_eq!(
            row.right() - label.right(),
            px(8.0),
            "resolved right padding"
        );
    }

    #[gpui::test]
    fn workspace_resolves_native_header_tabs_transcript_and_composer(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(
            bounds(
                cx,
                "title-bar-happy-desktop  ·  /Users/steve/Happy/Workspaces/happy-desktop.root",
            ),
            288.0,
            0.0,
            652.0,
            40.0,
        );
        assert_rect(bounds(cx, "workspace-tabs.root"), 288.0, 40.0, 652.0, 40.0);
        assert_rect(bounds(cx, "transcript-root"), 288.0, 80.0, 652.0, 610.0);
        assert_rect(bounds(cx, "composer-wrap"), 288.0, 690.0, 652.0, 110.0);
    }

    #[gpui::test]
    fn tabs_resolve_reusable_bar_item_padding_gap_and_indicator(cx: &mut TestAppContext) {
        let cx = render(cx);
        let tabs = bounds(cx, "workspace-tabs.root");
        let selected = bounds(cx, "workspace-tabs.item-native");
        let icon = bounds(cx, "workspace-tabs.item-native.icon");
        let label = bounds(cx, "workspace-tabs.item-native.label");
        assert_rect(tabs, 288.0, 40.0, 652.0, 40.0);
        assert_eq!(selected.origin, tabs.origin);
        assert_eq!(selected.size.height, px(40.0));
        assert_eq!(icon.origin.x - selected.origin.x, px(14.0));
        assert_eq!(label.origin.x - icon.right(), px(8.0));
        assert_eq!(selected.right() - label.right(), px(14.0));
        let underline = bounds(cx, "workspace-tabs.item-native.underline");
        assert_eq!(underline.origin.y, px(79.0));
        assert_eq!(underline.size.height, px(2.0));
    }

    #[gpui::test]
    fn transcript_composes_full_bleed_scroll_surface_and_inner_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        let transcript = bounds(cx, "transcript-root");
        let scroll = bounds(cx, "transcript-scroll.root");
        let viewport = bounds(cx, "transcript-scroll.viewport");
        let content = bounds(cx, "transcript-content");
        let first_message = bounds(cx, "transcript-first-message.root");
        assert_eq!(
            scroll, transcript,
            "shared scroll surface owns the allocated transcript region"
        );
        assert_eq!(
            content, viewport,
            "inner content fills the zero-spacing viewport"
        );
        assert_eq!(
            first_message.origin.x - content.origin.x,
            px(32.0),
            "inner left padding"
        );
        assert_eq!(
            content.right() - first_message.right(),
            px(32.0),
            "inner right padding"
        );
        assert_rect(
            bounds(cx, "transcript-scroll.track"),
            940.0,
            80.0,
            0.0,
            610.0,
        );
    }

    #[gpui::test]
    fn composer_resolves_outer_gutter_card_height_and_card_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        let wrap = bounds(cx, "composer-wrap");
        let card = bounds(cx, "composer.card");
        let placeholder = bounds(cx, "composer.input");
        assert_rect(card, 312.0, 690.0, 604.0, 92.0);
        assert_eq!(
            card.origin.x - wrap.origin.x,
            px(24.0),
            "composer left gutter"
        );
        assert_eq!(
            wrap.right() - card.right(),
            px(24.0),
            "composer right gutter"
        );
        assert_eq!(
            wrap.bottom() - card.bottom(),
            px(18.0),
            "composer bottom gutter"
        );
        assert_eq!(
            placeholder.origin.x - card.origin.x,
            px(13.0),
            "1px border plus 12px card left padding"
        );
        assert_eq!(
            placeholder.origin.y - card.origin.y,
            px(13.0),
            "1px border plus 12px card top padding"
        );
    }

    #[gpui::test]
    fn inspector_resolves_header_scope_and_file_list_insets(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(bounds(cx, "title-bar-Files.root"), 941.0, 0.0, 339.0, 40.0);
        assert_rect(bounds(cx, "inspector-scope.root"), 941.0, 40.0, 339.0, 32.0);
        let changes = bounds(cx, "inspector-scope.item-changes");
        assert_eq!(
            changes.origin.x,
            px(941.0),
            "tabs own the full inspector scope lane"
        );
        assert_eq!(changes.origin.y, px(40.0));
        assert_eq!(changes.size.height, px(32.0), "small reusable tab height");
        let row = bounds(cx, "file-row-src/main.rs.root");
        assert_rect(row, 947.0, 78.0, 327.0, 32.0);
    }

    #[gpui::test]
    fn file_row_resolves_status_path_stats_and_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        let row = bounds(cx, "file-row-src/main.rs.root");
        let status = bounds(cx, "file-row-src/main.rs.status");
        let path = bounds(cx, "file-row-src/main.rs.label");
        let stats = bounds(cx, "file-row-src/main.rs.changes");
        assert_eq!(status.origin.x - row.origin.x, px(8.0), "row left padding");
        assert_eq!(status.size.width, px(14.0), "fixed status lane");
        assert_eq!(path.origin.x - status.right(), px(8.0), "status/path gap");
        assert_eq!(stats.origin.x - path.right(), px(8.0), "path/stats gap");
        assert_eq!(row.right() - stats.right(), px(8.0), "row right padding");
        assert_eq!(row.size.height, px(32.0), "design-system row height");
    }

    #[gpui::test]
    fn ionicon_component_resolves_declared_square(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(
            bounds(cx, "sidebar-row-Happy.icon"),
            14.0,
            146.0,
            16.0,
            16.0,
        );
        let ink = cx.update(|_, app| {
            let face = app
                .text_system()
                .resolve_font(&gpui::font("Happy Ionicons"));
            app.text_system()
                .typographic_bounds(
                    face,
                    px(16.0),
                    crate::ui::icon_data::ionicons::HOME_OUTLINE.glyph,
                )
                .expect("the exact upstream home-outline glyph must resolve")
        });
        assert!(ink.size.width > px(0.0), "font glyph paints horizontal ink");
        assert!(ink.size.height > px(0.0), "font glyph paints vertical ink");
    }

    #[gpui::test]
    fn gallery_page_tabs_switch_the_live_reusable_fixture(cx: &mut TestAppContext) {
        cx.update(|cx| {
            crate::fonts::register(cx);
            crate::ui::text_input::init(cx);
            crate::ui::components::init(cx);
        });
        let (app, cx) = cx.add_window_view(|_, cx| HappyApp::with_mode(None, true, cx));
        cx.simulate_resize(size(px(800.0), px(600.0)));
        cx.run_until_parked();
        assert!(cx.debug_bounds("gallery-button-small.root").is_some());
        let fields = bounds(cx, "gallery-pages.item-fields").center();
        cx.simulate_click(fields, Modifiers::default());
        assert!(cx.debug_bounds("gallery-field-medium.control").is_some());
        assert_eq!(
            cx.update(|_, context| app.read(context).gallery_page),
            GalleryPage::Fields
        );
    }
}
