use gpui::{
    App, Context, Entity, FocusHandle, IntoElement, PathPromptOptions, Render, Subscription,
    Window, WindowAppearance, div, prelude::*, px,
};

use crate::connectivity::{
    AgentAvailability, ConnectivityController, InitialPhase, InitialRetry, OnboardingMutationKind,
};
use crate::ui::gallery::{GalleryModalState, GalleryPage};
use crate::{
    theme::Theme,
    ui::{
        ActivateHandler, Avatar, AvatarSize, Button, ButtonVariant, Composer, ConnectionNotice,
        ConnectionNoticeState, ControlSize, FileRow, Icon, IconName, InstallProgressState, ListRow,
        MessageRow, ModalFocus, ProfileOnboardingSurface, ProviderOnboardingSurface, ScrollSurface,
        ScrollbarAppearance, ScrollbarPlacement, ScrollbarState, SectionLabel, SharedScrollHandle,
        StartupSurface, StartupSurfaceState, TabItem, TabSelectHandler, Tabs, TabsSize, TextInput,
        TitleBar, WelcomeDeck, WelcomeSelectHandler, theme_roles::ThemeRole,
    },
};
use std::rc::Rc;

const TITLE_HEIGHT: f32 = 40.0;
const SIDEBAR_WIDTH: f32 = 288.0;
const PANEL_WIDTH: f32 = 340.0;

pub struct HappyApp {
    connectivity: Option<Entity<ConnectivityController>>,
    _connectivity_subscription: Option<Subscription>,
    dark_override: Option<bool>,
    persist_appearance: bool,
    appearance_error: Option<gpui::SharedString>,
    show_gallery: bool,
    gallery_inputs: [Entity<TextInput>; 4],
    profile_inputs: [Entity<TextInput>; 2],
    profile_input_subscriptions: Vec<Subscription>,
    profile_seeded: bool,
    welcome_needed: bool,
    welcome_error: Option<gpui::SharedString>,
    welcome_slide: usize,
    welcome_dot_focus: [FocusHandle; 5],
    welcome_timer_lifecycle: u64,
    welcome_timer_running: bool,
    reduced_motion: bool,
    gallery_scrollbars: [Entity<ScrollbarState>; 5],
    connectivity_gallery_scrollbars: [Entity<ScrollbarState>; 24],
    gallery_welcome_dot_focus: [FocusHandle; 25],
    onboarding_scrollbar: Entity<ScrollbarState>,
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
            Ok("system") => None,
            _ => appearance_read(),
        };
        let mut app = Self::with_mode(
            dark_override,
            std::env::var_os("HAPPY_GPUI_GALLERY").is_some(),
            cx,
        );
        app.persist_appearance = true;
        app.welcome_needed = !welcome_acknowledged();
        if let Ok(page) = std::env::var("HAPPY_GPUI_GALLERY_PAGE")
            && let Some(page) = GalleryPage::from_id(&page)
        {
            app.gallery_page = page;
        }
        for input in app.profile_inputs.clone() {
            app.profile_input_subscriptions
                .push(cx.observe(&input, |_, _, cx| cx.notify()));
        }
        let connectivity = cx.new(ConnectivityController::new);
        let subscription = cx.observe(&connectivity, |_, _, cx| cx.notify());
        app.connectivity = Some(connectivity);
        app._connectivity_subscription = Some(subscription);
        app
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
        let onboarding_scrollbar = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let connectivity_gallery_scrollbars = std::array::from_fn(|_| {
            cx.new(|_| {
                ScrollbarState::vertical(
                    ScrollbarAppearance::Automatic,
                    ScrollbarPlacement::Overlay,
                    SharedScrollHandle::new(),
                )
            })
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
            connectivity: None,
            _connectivity_subscription: None,
            dark_override,
            persist_appearance: false,
            appearance_error: None,
            show_gallery,
            profile_inputs: [
                cx.new(|cx| TextInput::new("profile-name", "", "Name", Theme::light(), cx)),
                cx.new(|cx| TextInput::new("profile-email", "", "Git email", Theme::light(), cx)),
            ],
            profile_input_subscriptions: Vec::new(),
            profile_seeded: false,
            welcome_needed: false,
            welcome_error: None,
            welcome_slide: 0,
            welcome_dot_focus: std::array::from_fn(|_| cx.focus_handle()),
            welcome_timer_lifecycle: 0,
            welcome_timer_running: false,
            reduced_motion: native_reduced_motion(),
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
            connectivity_gallery_scrollbars,
            gallery_welcome_dot_focus: std::array::from_fn(|_| cx.focus_handle()),
            onboarding_scrollbar,
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

    fn welcome_timer_start(&mut self, cx: &mut Context<Self>) {
        self.welcome_timer_lifecycle = self.welcome_timer_lifecycle.wrapping_add(1);
        self.welcome_timer_running = false;
        if self.reduced_motion || !self.welcome_needed || crate::ui::WELCOME_SLIDES.len() < 2 {
            return;
        }
        self.welcome_timer_running = true;
        let lifecycle = self.welcome_timer_lifecycle;
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            executor.timer(std::time::Duration::from_secs(15)).await;
            this.update(cx, |this, cx| {
                if this.welcome_timer_lifecycle != lifecycle || !this.welcome_needed {
                    return;
                }
                this.welcome_timer_running = false;
                this.welcome_slide = (this.welcome_slide + 1) % crate::ui::WELCOME_SLIDES.len();
                this.welcome_timer_start(cx);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn appearance_cycle(&mut self) {
        let next = match self.dark_override {
            None => Some(false),
            Some(false) => Some(true),
            Some(true) => None,
        };
        if self.persist_appearance && appearance_write(next).is_err() {
            self.appearance_error = Some("Appearance not saved".into());
            return;
        }
        self.dark_override = next;
        self.appearance_error = None;
    }

    fn welcome_timer_stop(&mut self) {
        if self.welcome_timer_running {
            self.welcome_timer_lifecycle = self.welcome_timer_lifecycle.wrapping_add(1);
            self.welcome_timer_running = false;
        }
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
        let toggle_label: gpui::SharedString = self
            .appearance_error
            .clone()
            .unwrap_or_else(|| Self::appearance_toggle_label(effective_dark).into());
        let entity = cx.entity();
        let gallery_action: ActivateHandler = Rc::new(move |_, cx| {
            entity.update(cx, |this, cx| {
                this.show_gallery = !this.show_gallery;
                cx.notify();
            });
        });
        let entity = cx.entity();
        let theme_action: ActivateHandler = Rc::new(move |_, cx| {
            entity.update(cx, |this, cx| {
                this.appearance_cycle();
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

    fn composer(&self, theme: Theme, online: bool) -> impl IntoElement {
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
                metadata: if online {
                    vec!["Codex".into(), "Full access".into(), "High".into()]
                } else {
                    vec!["Offline".into(), "Live actions unavailable".into()]
                },
                submit_disabled: !online,
                on_submit: submit,
            })
    }

    fn workspace(
        &self,
        theme: Theme,
        notice: Option<ConnectionNotice>,
        online: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
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
            .children(notice.map(|notice| {
                div()
                    .debug_selector(|| "workspace-connection-notice".into())
                    .flex_none()
                    .p(px(8.0))
                    .child(notice)
            }))
            .child(self.transcript(theme))
            .child(self.composer(theme, online))
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

        for input in self.gallery_inputs.iter().chain(&self.profile_inputs) {
            input.update(cx, |input, _| input.theme_reconcile(theme));
        }
        self.composer_input
            .update(cx, |input, _| input.theme_reconcile(theme));

        let mut connection_notice = None;
        let mut agent_online = true;
        if !self.show_gallery
            && let Some(connectivity) = self.connectivity.clone()
        {
            let (mounted, initial_phase, host, onboarding_failure, profile_defaults, setup_owed) = {
                let controller = connectivity.read(cx);
                let (name, email) = controller.profile_defaults();
                (
                    controller.mounted(),
                    controller.initial_phase().clone(),
                    controller.agents().host().clone(),
                    controller.onboarding_failure().cloned(),
                    (name.map(str::to_owned), email.map(str::to_owned)),
                    controller.setup_owed(),
                )
            };
            if !mounted {
                let live_mutations = connectivity.read(cx).live_mutations_available();
                if setup_owed == Some(true) && self.welcome_needed {
                    if !self.welcome_timer_running {
                        self.welcome_timer_start(cx);
                    }
                    let entity = cx.entity();
                    let on_select: WelcomeSelectHandler = Rc::new(move |slide, _, cx| {
                        entity.update(cx, |this, cx| {
                            this.welcome_slide = slide.min(crate::ui::WELCOME_SLIDES.len() - 1);
                            this.welcome_timer_start(cx);
                            cx.notify();
                        });
                    });
                    let entity = cx.entity();
                    let setup_controller = connectivity.clone();
                    let install_after_welcome = matches!(
                        &initial_phase,
                        InitialPhase::AgentMissing {
                            installable: true,
                            ..
                        }
                    );
                    let on_action: ActivateHandler = Rc::new(move |_, cx| {
                        let completed = entity
                            .update(cx, |this, cx| match welcome_marker_write() {
                                Ok(()) => {
                                    this.welcome_needed = false;
                                    this.welcome_error = None;
                                    this.welcome_timer_lifecycle =
                                        this.welcome_timer_lifecycle.wrapping_add(1);
                                    this.welcome_timer_running = false;
                                    cx.notify();
                                    true
                                }
                                Err(_) => {
                                    this.welcome_error = Some(
                                        "Happy could not save your welcome choice. Check that Application Support is writable, then try again."
                                            .into(),
                                    );
                                    cx.notify();
                                    false
                                }
                            });
                        if completed && install_after_welcome {
                            setup_controller.update(cx, |controller, _| controller.install_start());
                        }
                    });
                    let entity = cx.entity();
                    let on_appearance: ActivateHandler = Rc::new(move |_, cx| {
                        entity.update(cx, |this, cx| {
                            this.appearance_cycle();
                            cx.notify();
                        });
                    });
                    let appearance_icon = match self.dark_override {
                        None => IconName::Contrast,
                        Some(false) => IconName::Sun,
                        Some(true) => IconName::Moon,
                    };
                    return WelcomeDeck {
                        id: "native-welcome".into(),
                        theme,
                        scrollbar: self.onboarding_scrollbar.clone(),
                        slide: self.welcome_slide,
                        error: self
                            .welcome_error
                            .clone()
                            .or_else(|| self.appearance_error.clone()),
                        dot_focus: self.welcome_dot_focus.clone(),
                        dark: self.is_dark(window),
                        appearance_icon,
                        on_select,
                        on_action,
                        on_appearance,
                    }
                    .into_any_element();
                }
                self.welcome_timer_stop();
                if matches!(&initial_phase, InitialPhase::ProfileRequired) {
                    if !self.profile_seeded {
                        if let Some(name) = profile_defaults.0 {
                            self.profile_inputs[0]
                                .update(cx, |input, cx| input.set_value(name, cx));
                        }
                        if let Some(email) = profile_defaults.1 {
                            self.profile_inputs[1]
                                .update(cx, |input, cx| input.set_value(email, cx));
                        }
                        self.profile_seeded = true;
                    }
                    let name = self.profile_inputs[0].clone();
                    let email = self.profile_inputs[1].clone();
                    let controller = connectivity.clone();
                    let on_submit: ActivateHandler = Rc::new(move |_, cx| {
                        let name = name.read(cx).value().trim().to_owned();
                        let email = email.read(cx).value().trim().to_owned();
                        controller.update(cx, |controller, _| {
                            controller.profile_update(name, email);
                        });
                    });
                    return ProfileOnboardingSurface {
                        id: "native-profile-onboarding".into(),
                        theme,
                        scrollbar: self.onboarding_scrollbar.clone(),
                        name: self.profile_inputs[0].clone(),
                        email: self.profile_inputs[1].clone(),
                        error: onboarding_failure
                            .as_ref()
                            .filter(|failure| failure.kind == OnboardingMutationKind::Profile)
                            .map(|failure| failure.error.message.clone().into()),
                        busy: connectivity
                            .read(cx)
                            .mutation_pending(OnboardingMutationKind::Profile),
                        on_submit: live_mutations.then_some(on_submit),
                    }
                    .into_any_element();
                }
                if matches!(&initial_phase, InitialPhase::ProvidersMissing) {
                    let (rows, busy, continue_available, error) = {
                        let controller = connectivity.read(cx);
                        (
                            controller.provider_rows().to_vec(),
                            controller.mutation_pending(OnboardingMutationKind::Providers),
                            controller.providers_continue_available(),
                            controller
                                .onboarding_failure()
                                .filter(|failure| failure.kind == OnboardingMutationKind::Providers)
                                .map(|failure| failure.error.message.clone().into()),
                        )
                    };
                    let scan_controller = connectivity.clone();
                    let on_scan: ActivateHandler = Rc::new(move |_, cx| {
                        scan_controller.update(cx, |controller, _| {
                            controller.providers_scan();
                        });
                    });
                    let continue_controller = connectivity.clone();
                    let on_continue: ActivateHandler = Rc::new(move |_, cx| {
                        continue_controller.update(cx, |controller, cx| {
                            if controller.providers_continue() {
                                cx.notify();
                            }
                        });
                    });
                    return ProviderOnboardingSurface {
                        id: "native-provider-onboarding".into(),
                        theme,
                        scrollbar: self.onboarding_scrollbar.clone(),
                        rows,
                        busy,
                        continue_available,
                        error,
                        on_scan: live_mutations.then_some(on_scan),
                        // Continue only advances local onboarding navigation after an
                        // authoritative scan. It remains usable while the daemon drains.
                        on_continue: Some(on_continue),
                    }
                    .into_any_element();
                }
                let install_action = matches!(
                    &initial_phase,
                    InitialPhase::AgentMissing {
                        installable: true,
                        ..
                    }
                );
                let provider_action = matches!(&initial_phase, InitialPhase::ProvidersMissing);
                let project_action = matches!(&initial_phase, InitialPhase::FirstProject);
                let complete_action = matches!(&initial_phase, InitialPhase::CompletionRequired);
                let project_busy = connectivity
                    .read(cx)
                    .mutation_pending(OnboardingMutationKind::Project);
                let complete_busy = connectivity
                    .read(cx)
                    .mutation_pending(OnboardingMutationKind::Complete);
                let retry_action = matches!(
                    &initial_phase,
                    InitialPhase::Failed {
                        retry: InitialRetry::Transport,
                        ..
                    }
                );
                let install_retry_action = matches!(
                    &initial_phase,
                    InitialPhase::Failed {
                        retry: InitialRetry::Install,
                        ..
                    }
                );
                let state = match initial_phase {
                    InitialPhase::Checking => StartupSurfaceState::Checking {
                        detail: "Looking for the local Happy Agent.".into(),
                    },
                    InitialPhase::AgentMissing {
                        message,
                        installable,
                    } => {
                        if installable {
                            StartupSurfaceState::AgentMissing {
                                detail: message.into(),
                                installable: true,
                            }
                        } else {
                            StartupSurfaceState::ManagedUnavailable {
                                detail: message.into(),
                            }
                        }
                    }
                    InitialPhase::Starting { message } => StartupSurfaceState::Starting {
                        detail: message.into(),
                        progress: InstallProgressState::Indeterminate,
                    },
                    InitialPhase::Installing { message, fraction } => {
                        StartupSurfaceState::Starting {
                            detail: message.into(),
                            progress: fraction
                                .map_or(InstallProgressState::Indeterminate, |fraction| {
                                    InstallProgressState::Determinate { fraction }
                                }),
                        }
                    }
                    InitialPhase::Connecting => StartupSurfaceState::Connecting {
                        detail: "Opening the authenticated local connection.".into(),
                    },
                    InitialPhase::ProvidersMissing => StartupSurfaceState::ProvidersMissing {
                        detail: onboarding_failure
                            .as_ref()
                            .filter(|failure| failure.kind == OnboardingMutationKind::Providers)
                            .map(|failure| failure.error.message.clone())
                            .unwrap_or_else(|| {
                                "Sign in with Claude, Codex, or Grok, then check again.".into()
                            })
                            .into(),
                    },
                    InitialPhase::ProfileRequired => StartupSurfaceState::ProfileRequired {
                        detail: "Add the name and Git email used for your work.".into(),
                    },
                    InitialPhase::FirstProject => StartupSurfaceState::FirstProject {
                        detail: onboarding_failure
                            .as_ref()
                            .filter(|failure| failure.kind == OnboardingMutationKind::Project)
                            .map(|failure| failure.error.message.clone())
                            .unwrap_or_else(|| {
                                "Choose the first project folder for this Happy Agent.".into()
                            })
                            .into(),
                    },
                    InitialPhase::CompletionRequired => StartupSurfaceState::CompletionRequired {
                        detail: onboarding_failure
                            .as_ref()
                            .filter(|failure| failure.kind == OnboardingMutationKind::Complete)
                            .map(|failure| failure.error.message.clone())
                            .unwrap_or_else(|| {
                                "Every required step is complete. Save the final acknowledgement to continue."
                                    .into()
                            })
                            .into(),
                    },
                    InitialPhase::Failed { message, .. } => StartupSurfaceState::Failed {
                        message: message.into(),
                    },
                };
                let on_action = if install_action || install_retry_action {
                    let connectivity = connectivity.clone();
                    Some(Rc::new(move |_: &mut Window, cx: &mut App| {
                        connectivity.update(cx, |controller, _| controller.install_start());
                    }) as ActivateHandler)
                } else if provider_action {
                    let connectivity = connectivity.clone();
                    Some(Rc::new(move |_: &mut Window, cx: &mut App| {
                        connectivity.update(cx, |controller, _| controller.providers_scan());
                    }) as ActivateHandler)
                } else if project_action && !project_busy && live_mutations {
                    let connectivity = connectivity.clone();
                    Some(Rc::new(move |_: &mut Window, cx: &mut App| {
                        let prompt = cx.prompt_for_paths(PathPromptOptions {
                            files: false,
                            directories: true,
                            multiple: false,
                            prompt: Some("Choose project".into()),
                        });
                        let connectivity = connectivity.clone();
                        cx.spawn(async move |cx| {
                            if let Ok(Ok(Some(paths))) = prompt.await
                                && let Some(path) = paths.into_iter().next()
                            {
                                connectivity
                                    .update(cx, |controller, _| controller.project_register(path))
                                    .ok();
                            }
                        })
                        .detach();
                    }) as ActivateHandler)
                } else if complete_action && !complete_busy && live_mutations {
                    let connectivity = connectivity.clone();
                    Some(Rc::new(move |_: &mut Window, cx: &mut App| {
                        connectivity.update(cx, |controller, _| {
                            controller.onboarding_complete();
                        });
                    }) as ActivateHandler)
                } else if retry_action {
                    let connectivity = connectivity.clone();
                    Some(Rc::new(move |_: &mut Window, cx: &mut App| {
                        connectivity.update(cx, |controller, _| controller.retry());
                    }) as ActivateHandler)
                } else {
                    None
                };
                return StartupSurface {
                    id: "native-startup".into(),
                    theme,
                    scrollbar: self.onboarding_scrollbar.clone(),
                    state,
                    on_action,
                }
                .into_any_element();
            }
            self.welcome_timer_stop();

            let (availability, agent_name) = {
                let host = host.read(cx);
                let name = if host.namespace().as_str() == "host:local" {
                    "This Mac"
                } else {
                    "Happy Agent"
                };
                (host.availability().clone(), name)
            };
            agent_online = matches!(&availability, AgentAvailability::Online);
            let notice_state = match availability {
                AgentAvailability::Online => None,
                AgentAvailability::Draining { message } => {
                    Some(ConnectionNoticeState::Restricted {
                        reason: message.into(),
                    })
                }
                AgentAvailability::Connecting => Some(ConnectionNoticeState::Connecting),
                AgentAvailability::Reconnecting { attempt, error } => {
                    Some(ConnectionNoticeState::Reconnecting {
                        attempt,
                        reason: error.map(|error| error.message.into()),
                    })
                }
                AgentAvailability::Offline { error } => Some(ConnectionNoticeState::Offline {
                    reason: error.message.into(),
                }),
                AgentAvailability::Error { error } => Some(ConnectionNoticeState::Error {
                    message: error.message.into(),
                }),
            };
            connection_notice = notice_state.map(|state| {
                let retry = connectivity.clone();
                ConnectionNotice {
                    id: "local-host-connection".into(),
                    theme,
                    agent_name: agent_name.into(),
                    state,
                    on_action: Some(Rc::new(move |_, cx| {
                        retry.update(cx, |controller, _| controller.retry());
                    })),
                }
            });
        }

        let viewport_width: f32 = window.viewport_size().width.into();
        let (sidebar_width, inspector_width) = Self::column_widths(viewport_width);
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
                    self.connectivity_gallery_scrollbars.clone(),
                    self.gallery_welcome_dot_focus.clone(),
                    self.gallery_modal_states.clone(),
                    self.gallery_page,
                    on_select,
                ))
                .into_any_element()
            }
        } else {
            root.child(self.workspace(theme, connection_notice, agent_online, cx))
                .child(self.inspector(theme, inspector_width, cx))
                .into_any_element()
        }
    }
}

fn settings_directory() -> std::path::PathBuf {
    std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/dev/null"))
        .join("Library/Application Support/Happy GPUI")
}

fn welcome_marker_path() -> std::path::PathBuf {
    settings_directory().join("welcome-v1")
}

fn appearance_path() -> std::path::PathBuf {
    settings_directory().join("appearance-v1")
}

const WELCOME_ACKNOWLEDGEMENT: &[u8] = b"happy-gpui-welcome-v1\n";

fn welcome_acknowledged_at(path: &std::path::Path) -> bool {
    std::fs::read(path).is_ok_and(|value| value == WELCOME_ACKNOWLEDGEMENT)
}

fn welcome_acknowledged() -> bool {
    welcome_acknowledged_at(&welcome_marker_path())
}

fn atomic_private_write(path: &std::path::Path, value: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let directory = path
        .parent()
        .ok_or_else(|| std::io::Error::other("missing settings directory"))?;
    std::fs::create_dir_all(directory)?;
    std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
    let temporary = directory.join(format!(
        ".{}.tmp-{}-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("settings"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    ));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        use std::io::Write;
        file.write_all(value)?;
        file.sync_all()?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        std::fs::rename(&temporary, path)?;
        std::fs::File::open(directory)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

fn welcome_marker_write() -> std::io::Result<()> {
    atomic_private_write(&welcome_marker_path(), WELCOME_ACKNOWLEDGEMENT)
}

fn appearance_read_at(path: &std::path::Path) -> Option<Option<bool>> {
    match std::fs::read(path).ok().as_deref() {
        Some(b"happy-gpui-appearance-v1:system\n") => Some(None),
        Some(b"happy-gpui-appearance-v1:light\n") => Some(Some(false)),
        Some(b"happy-gpui-appearance-v1:dark\n") => Some(Some(true)),
        _ => None,
    }
}

fn appearance_read() -> Option<bool> {
    appearance_read_at(&appearance_path()).flatten()
}

fn appearance_write(value: Option<bool>) -> std::io::Result<()> {
    let value = match value {
        None => b"happy-gpui-appearance-v1:system\n".as_slice(),
        Some(false) => b"happy-gpui-appearance-v1:light\n".as_slice(),
        Some(true) => b"happy-gpui-appearance-v1:dark\n".as_slice(),
    };
    atomic_private_write(&appearance_path(), value)
}

fn native_reduced_motion() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
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
        AppContext, Bounds, Focusable, Modifiers, Pixels, ScrollDelta, ScrollWheelEvent,
        TestAppContext, VisualTestContext, WindowAppearance, point, px, size,
    };

    use super::{
        GalleryPage, HappyApp, WELCOME_ACKNOWLEDGEMENT, appearance_read_at, atomic_private_write,
        welcome_acknowledged_at,
    };
    use crate::connectivity::{AgentAvailability, ConnectivityController};

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
    fn rendered_dark_effective_mode_cycles_to_system_and_ambient_dark_uses_same_state(
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
            None,
            "the rendered toggle cycles dark to the system appearance"
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
    fn direct_gallery_mode_bypasses_product_startup_without_mutating_it(cx: &mut TestAppContext) {
        let (app, cx) = render_at(cx, 720.0, 480.0, None);
        let startup = cx.update(|_, cx| cx.new(ConnectivityController::fixture_startup));
        app.update(cx, |app, cx| {
            app.connectivity = Some(startup.clone());
            app.show_gallery = true;
            app.gallery_page = GalleryPage::Welcome;
            cx.notify();
        });
        cx.run_until_parked();
        assert!(cx.debug_bounds("gallery-root").is_some());
        assert!(cx.debug_bounds("native-welcome.root").is_none());
        startup.read_with(cx, |controller, _| {
            assert!(!controller.mounted());
            assert_eq!(controller.setup_owed(), Some(true));
        });
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

    #[gpui::test]
    fn mounted_connectivity_degrades_and_heals_without_replacing_draft_focus_or_surface_entities(
        cx: &mut TestAppContext,
    ) {
        let (app, cx) = render_at(cx, 1280.0, 800.0, None);
        let controller = cx.update(|_, cx| cx.new(ConnectivityController::fixture_mounted));
        cx.update(|_, app_cx| {
            app.update(app_cx, |this, cx| {
                let subscription = cx.observe(&controller, |_, _, cx| cx.notify());
                this.connectivity = Some(controller.clone());
                this._connectivity_subscription = Some(subscription);
                cx.notify();
            });
        });
        cx.run_until_parked();

        let (input, transcript_scrollbar, tabs_scrollbar) = app.read_with(cx, |app, _| {
            (
                app.composer_input.clone(),
                app.transcript_scrollbar.clone(),
                app.workspace_tabs_scrollbar.clone(),
            )
        });
        cx.update(|_, app_cx| {
            input.update(app_cx, |input, cx| input.set_value("draft survives", cx));
        });
        cx.run_until_parked();
        let input_center = bounds(cx, "composer-input.root").center();
        cx.simulate_click(input_center, Modifiers::default());
        assert!(cx.update(|window, app_cx| input.focus_handle(app_cx).is_focused(window)));

        cx.update(|_, app_cx| {
            controller.update(app_cx, |controller, cx| {
                controller.availability_set(
                    AgentAvailability::Reconnecting {
                        attempt: 3,
                        error: Some(crate::connectivity::UserError {
                            kind: crate::connectivity::UserErrorKind::Unavailable,
                            message: "route closed".into(),
                            api: None,
                        }),
                    },
                    cx,
                );
            });
        });
        cx.run_until_parked();
        assert!(cx.debug_bounds("local-host-connection.root").is_some());
        assert!(cx.debug_bounds("workspace-connection-notice").is_some());
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            "draft survives"
        );
        assert!(cx.update(|window, app_cx| input.focus_handle(app_cx).is_focused(window)));
        assert!(app.read_with(cx, |app, _| app.composer_input == input));
        assert!(app.read_with(cx, |app, _| app.transcript_scrollbar
            == transcript_scrollbar));
        assert!(app.read_with(cx, |app, _| app.workspace_tabs_scrollbar == tabs_scrollbar));

        let offline_submit = bounds(cx, "composer-submit.root").center();
        cx.simulate_click(offline_submit, Modifiers::default());
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            "draft survives",
            "offline submit stays disabled while the draft remains editable",
        );

        cx.update(|_, app_cx| {
            controller.update(app_cx, |controller, cx| {
                controller.availability_set(AgentAvailability::Online, cx);
            });
        });
        cx.run_until_parked();
        assert!(cx.debug_bounds("local-host-connection.root").is_none());
        assert!(cx.update(|window, app_cx| input.focus_handle(app_cx).is_focused(window)));
        assert_eq!(
            app.read_with(cx, |app, _| app.active_tab.to_string()),
            "native"
        );
        let online_submit = bounds(cx, "composer-submit.root").center();
        cx.simulate_click(online_submit, Modifiers::default());
        assert_eq!(
            input.read_with(cx, |input, _| input.value().to_string()),
            ""
        );
    }

    #[gpui::test]
    fn welcome_timer_advances_every_fifteen_seconds_and_respects_reduced_motion(
        cx: &mut TestAppContext,
    ) {
        let (app, cx) = render_at(cx, 720.0, 480.0, None);
        app.update(cx, |app, cx| {
            app.welcome_needed = true;
            app.reduced_motion = false;
            app.welcome_slide = 0;
            app.welcome_timer_start(cx);
        });
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(15));
        cx.run_until_parked();
        assert_eq!(app.read_with(cx, |app, _| app.welcome_slide), 1);

        app.update(cx, |app, cx| {
            app.reduced_motion = true;
            app.welcome_timer_start(cx);
        });
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(30));
        cx.run_until_parked();
        assert_eq!(app.read_with(cx, |app, _| app.welcome_slide), 1);
        assert!(!app.read_with(cx, |app, _| app.welcome_timer_running));

        app.update(cx, |app, cx| {
            app.reduced_motion = false;
            app.welcome_timer_start(cx);
            app.welcome_timer_stop();
        });
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(30));
        cx.run_until_parked();
        assert_eq!(app.read_with(cx, |app, _| app.welcome_slide), 1);
        assert!(!app.read_with(cx, |app, _| app.welcome_timer_running));
    }

    #[test]
    fn welcome_and_appearance_persistence_reject_corruption_and_write_atomically() {
        use std::os::unix::fs::PermissionsExt;
        let directory = std::env::temp_dir().join(format!(
            "happy-gpui-persistence-{}-{:?}",
            std::process::id(),
            std::thread::current().id(),
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir(&directory).unwrap();
        let welcome = directory.join("welcome-v1");
        std::fs::write(&welcome, b"").unwrap();
        assert!(!welcome_acknowledged_at(&welcome));
        atomic_private_write(&welcome, WELCOME_ACKNOWLEDGEMENT).unwrap();
        assert!(welcome_acknowledged_at(&welcome));
        assert_eq!(
            std::fs::metadata(&welcome).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );

        let appearance = directory.join("appearance-v1");
        std::fs::write(&appearance, b"corrupt").unwrap();
        assert_eq!(appearance_read_at(&appearance), None);
        atomic_private_write(&appearance, b"happy-gpui-appearance-v1:system\n").unwrap();
        assert_eq!(appearance_read_at(&appearance), Some(None));
        atomic_private_write(&appearance, b"happy-gpui-appearance-v1:light\n").unwrap();
        assert_eq!(appearance_read_at(&appearance), Some(Some(false)));
        atomic_private_write(&appearance, b"happy-gpui-appearance-v1:dark\n").unwrap();
        assert_eq!(appearance_read_at(&appearance), Some(Some(true)));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
