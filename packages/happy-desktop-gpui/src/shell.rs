use gpui::{
    App, Context, Entity, FocusHandle, IntoElement, PathPromptOptions, Render, Subscription,
    Window, WindowAppearance, WindowControlArea, div, prelude::*, px,
};

use crate::connectivity::{
    ActivityAggregate, AgentAvailability, AgentCatalogSnapshot, AgentNamespace, CatalogAvatar,
    CatalogInitializationState, CatalogLifecycle, ConnectivityController, GitTotals, InitialPhase,
    InitialRetry, OnboardingMutationKind, ProjectKey, WorkspaceCatalogRow,
};
use crate::navigation::{
    HistoryPersistence, NavigationHistory, PaletteCommand, PaletteSection, PinnedDestination,
    Route, SettingsSection, SidebarMemory, palette_matches,
};
use crate::ui::gallery::{GalleryModalState, GalleryPage};
use crate::ui::{command_palette as palette_ui, settings as settings_ui, sidebar as sidebar_ui};
use crate::{
    theme::Theme,
    ui::{
        ActivateHandler, ConnectionNotice, ConnectionNoticeState, Icon, IconName,
        InstallProgressState, ModalFocus, ProfileOnboardingSurface, ProviderOnboardingSurface,
        ScrollbarAppearance, ScrollbarPlacement, ScrollbarState, SharedScrollHandle,
        StartupSurface, StartupSurfaceState, TabItem, TabSelectHandler, Tabs, TabsSize, TextInput,
        TitleBar, WelcomeDeck, WelcomeSelectHandler, theme_roles::ThemeRole,
    },
};
use std::{
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::Arc,
};

const NATIVE_TITLEBAR_HEIGHT: f32 = 40.0;
const TITLE_HEIGHT: f32 = 56.0;

pub struct HappyApp {
    connectivity: Option<Entity<ConnectivityController>>,
    _connectivity_subscription: Option<Subscription>,
    navigation: NavigationHistory,
    sidebar_memory: SidebarMemory,
    navigation_error: Option<gpui::SharedString>,
    sidebar_scrollbar: Entity<ScrollbarState>,
    settings_scrollbar: Entity<ScrollbarState>,
    command_palette: Entity<palette_ui::CommandPalette>,
    gallery_command_palette: Entity<palette_ui::CommandPalette>,
    palette_open: bool,
    palette_return_focus: Option<FocusHandle>,
    shell_focus: FocusHandle,
    palette_query: gpui::SharedString,
    palette_active: usize,
    palette_commands: Vec<(gpui::SharedString, PaletteCommand)>,
    sidebar_routes: Vec<(gpui::SharedString, Route)>,
    known_groups: BTreeSet<String>,
    known_sessions: BTreeMap<String, String>,
    catalog_seen: bool,
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
    gallery_page: GalleryPage,
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
        let history_path = settings_directory().join("navigation-history-v1.json");
        match HistoryPersistence::open(history_path).and_then(|persistence| {
            NavigationHistory::restore(persistence, |value| {
                (value == AgentNamespace::local_host().as_str()).then(AgentNamespace::local_host)
            })
        }) {
            Ok(mut navigation) => {
                if matches!(navigation.current(), Route::Home | Route::Chats) {
                    navigation.replace(Route::HappyAgent {
                        agent: AgentNamespace::local_host(),
                    });
                }
                app.navigation = navigation;
            }
            Err(error) => {
                app.navigation_error =
                    Some(format!("Navigation history not loaded: {error}").into());
            }
        }
        app.sidebar_memory =
            SidebarMemory::restore(settings_directory().join("sidebar-memory-v1.json"));
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
        let sidebar_scrollbar = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let settings_scrollbar = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let palette_scrollbar = cx.new(|_| {
            ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let palette_focus = palette_ui::CommandPaletteFocus {
            container: cx.focus_handle(),
            last: cx.focus_handle(),
        };
        let app = cx.entity();
        let query_app = app.clone();
        let active_app = app.clone();
        let commit_app = app.clone();
        let dismiss_app = app;
        let command_palette = cx.new(move |cx| {
            palette_ui::CommandPalette::new(
                "global-command-palette",
                Theme::light(),
                "",
                "Search chats, workspaces, and settings…",
                Vec::new(),
                0,
                palette_scrollbar,
                palette_focus,
                palette_ui::CommandPaletteCallbacks {
                    query_changed: Rc::new(move |query, cx| {
                        query_app.update(cx, |this, cx| {
                            this.palette_query = query;
                            this.palette_active = 0;
                            cx.notify();
                        });
                    }),
                    active_changed: Rc::new(move |index, _, _, cx| {
                        active_app.update(cx, |this, cx| {
                            this.palette_active = index;
                            cx.notify();
                        });
                    }),
                    committed: Rc::new(move |_, id, window, cx| {
                        let focus = commit_app.update(cx, |this, cx| {
                            let route = this
                                .palette_commands
                                .iter()
                                .find(|(candidate, _)| candidate == &id)
                                .map(|(_, PaletteCommand::Navigate(route))| route.clone());
                            route.map(|route| {
                                let destination_replaces_sidebar = matches!(
                                    route,
                                    Route::Settings | Route::SettingsSection { .. }
                                );
                                let focus = if destination_replaces_sidebar {
                                    this.palette_return_focus.take();
                                    this.shell_focus.clone()
                                } else {
                                    this.palette_return_focus
                                        .take()
                                        .unwrap_or_else(|| this.shell_focus.clone())
                                };
                                this.navigation.push(route);
                                this.palette_open = false;
                                this.palette_query = "".into();
                                this.palette_active = 0;
                                cx.notify();
                                focus
                            })
                        });
                        if let Some(focus) = focus {
                            focus.focus(window);
                        }
                    }),
                    dismissed: Rc::new(move |window, cx| {
                        dismiss_app.update(cx, |this, cx| {
                            this.palette_open = false;
                            if let Some(focus) = this.palette_return_focus.take() {
                                focus.focus(window);
                            }
                            cx.notify();
                        });
                    }),
                },
                cx,
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
        let gallery_palette_focus = palette_ui::CommandPaletteFocus {
            container: cx.focus_handle(),
            last: cx.focus_handle(),
        };
        let gallery_palette_scrollbar = connectivity_gallery_scrollbars[23].clone();
        let gallery_command_palette = cx.new(move |cx| {
            palette_ui::CommandPalette::new(
                "gallery-command-palette",
                Theme::light(),
                "happy",
                "Search chats, workspaces, and settings…",
                vec![
                    palette_ui::CommandPaletteSection {
                        id: "suggestions".into(),
                        caption: Some("Suggestions".into()),
                        rows: (0..7)
                            .map(|index| {
                                palette_ui::CommandPaletteRow::Command(
                                    palette_ui::CommandPaletteCommandRow {
                                        id: format!("suggestion-{index}").into(),
                                        title: format!("Open Happy project {:02}", index + 1)
                                            .into(),
                                        meta: Some("Projects · This Mac".into()),
                                        icon: Some(IconName::Files),
                                        shortcut: (index == 0).then(|| "⌘1".into()),
                                        disabled: false,
                                    },
                                )
                            })
                            .collect(),
                    },
                    palette_ui::CommandPaletteSection {
                        id: "actions".into(),
                        caption: Some("Actions".into()),
                        rows: vec![
                            palette_ui::CommandPaletteRow::Command(
                                palette_ui::CommandPaletteCommandRow {
                                    id: "new-project".into(),
                                    title: "Create new project".into(),
                                    meta: None,
                                    icon: Some(IconName::Plus),
                                    shortcut: Some("⌘N".into()),
                                    disabled: false,
                                },
                            ),
                            palette_ui::CommandPaletteRow::Control(
                                palette_ui::CommandPaletteControlRow {
                                    id: "appearance".into(),
                                    label: "Appearance".into(),
                                    description: Some("Match the system appearance".into()),
                                    disabled: false,
                                    control: Rc::new(|theme, _, _| {
                                        div()
                                            .text_color(theme.role(ThemeRole::TextSecondary))
                                            .child("System")
                                            .into_any_element()
                                    }),
                                },
                            ),
                        ],
                    },
                ],
                0,
                gallery_palette_scrollbar,
                gallery_palette_focus,
                palette_ui::CommandPaletteCallbacks {
                    query_changed: Rc::new(|_, _| {}),
                    active_changed: Rc::new(|_, _, _, _| {}),
                    committed: Rc::new(|_, _, _, _| {}),
                    dismissed: Rc::new(|_, _| {}),
                },
                cx,
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
            connectivity: None,
            _connectivity_subscription: None,
            navigation: NavigationHistory::new(Route::HappyAgent {
                agent: AgentNamespace::local_host(),
            }),
            sidebar_memory: SidebarMemory::memory_only(),
            navigation_error: None,
            sidebar_scrollbar,
            settings_scrollbar,
            command_palette,
            gallery_command_palette,
            palette_open: false,
            palette_return_focus: None,
            shell_focus: cx.focus_handle(),
            palette_query: "".into(),
            palette_active: 0,
            palette_commands: Vec::new(),
            sidebar_routes: Vec::new(),
            known_groups: BTreeSet::new(),
            known_sessions: BTreeMap::new(),
            catalog_seen: false,
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
            gallery_page: GalleryPage::Buttons,
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

    fn column_widths(viewport_width: f32) -> (f32, f32) {
        let width = (viewport_width * 0.30).clamp(250.0, 360.0);
        (width, width)
    }

    fn title_bar(&self, theme: Theme, label: &'static str) -> impl IntoElement {
        TitleBar {
            id: format!("title-bar-{label}").into(),
            theme,
            title: label.into(),
        }
    }

    fn reconcile_navigation_catalog(&mut self, catalog: &AgentCatalogSnapshot) {
        let active_projects: BTreeSet<_> = catalog
            .active_projects
            .iter()
            .map(|project| project.key.id().to_owned())
            .collect();
        let groups: BTreeSet<_> = active_projects
            .iter()
            .cloned()
            .chain(
                catalog
                    .active_workspaces
                    .iter()
                    .filter(|workspace| {
                        workspace.bot_key.is_some()
                            || workspace
                                .project_key
                                .as_ref()
                                .is_some_and(|project| active_projects.contains(project.id()))
                    })
                    .map(|workspace| workspace.key.id().to_owned()),
            )
            // Bot-owned workspaces are explicit bot relationships but are not
            // duplicated in the normal workspace collection.
            .chain(
                catalog
                    .active_bots
                    .iter()
                    .map(|bot| bot.workspace_key.id().to_owned()),
            )
            .collect();
        let sessions: BTreeMap<_, _> = catalog
            .active_conversations
            .iter()
            .filter(|conversation| groups.contains(conversation.workspace_key.id()))
            .map(|conversation| {
                (
                    conversation.key.id().to_owned(),
                    conversation.workspace_key.id().to_owned(),
                )
            })
            .collect();
        if self.catalog_seen {
            let removed_sessions: Vec<_> = self
                .known_sessions
                .iter()
                .filter(|(session, _)| !sessions.contains_key(*session))
                .map(|(session, group)| (session.clone(), group.clone()))
                .collect();
            for (session, group) in removed_sessions {
                let group = crate::navigation::GroupId::new(Arc::<str>::from(group))
                    .expect("remembered daemon identity");
                let session = crate::navigation::SessionId::new(Arc::<str>::from(session))
                    .expect("remembered daemon identity");
                self.navigation.session_forget(
                    &AgentNamespace::local_host(),
                    &group,
                    &session,
                    None,
                );
            }
            let removed_groups: Vec<_> = self.known_groups.difference(&groups).cloned().collect();
            for group in removed_groups {
                let group = crate::navigation::GroupId::new(Arc::<str>::from(group))
                    .expect("remembered daemon identity");
                self.navigation
                    .group_forget(&AgentNamespace::local_host(), &group);
            }
        }
        self.known_groups = groups;
        self.known_sessions = sessions;
        self.catalog_seen = true;
        if let Some(error) = self.navigation.take_persistence_error() {
            self.navigation_error = Some(format!("Navigation history not saved: {error}").into());
        }
    }

    fn reconcile_command_palette(
        &mut self,
        theme: Theme,
        catalog: Option<&AgentCatalogSnapshot>,
        cx: &mut Context<Self>,
    ) {
        let namespace = AgentNamespace::local_host();
        let matches = catalog
            .map(|catalog| {
                palette_matches(
                    catalog,
                    &namespace,
                    self.navigation.current(),
                    self.palette_query.as_ref(),
                )
            })
            .unwrap_or_else(|| {
                vec![crate::navigation::PaletteMatch {
                    stable_id: "settings:general".into(),
                    section: PaletteSection::Suggestions,
                    title: "Open settings".into(),
                    detail: Some("General".into()),
                    command: PaletteCommand::Navigate(Route::SettingsSection {
                        section: SettingsSection::General,
                    }),
                }]
            });
        self.palette_commands = matches
            .iter()
            .map(|item| (item.stable_id.to_string().into(), item.command.clone()))
            .collect();
        let mut sections = Vec::new();
        for section in [
            PaletteSection::Suggestions,
            PaletteSection::Chats,
            PaletteSection::Workspaces,
            PaletteSection::Tabs,
            PaletteSection::Actions,
            PaletteSection::Settings,
        ] {
            let rows: Vec<_> = matches
                .iter()
                .filter(|item| item.section == section)
                .map(|item| {
                    palette_ui::CommandPaletteRow::Command(palette_ui::CommandPaletteCommandRow {
                        id: item.stable_id.to_string().into(),
                        title: item.title.to_string().into(),
                        meta: item.detail.as_ref().map(|value| value.to_string().into()),
                        icon: Some(match section {
                            PaletteSection::Chats => IconName::Chat,
                            PaletteSection::Workspaces => IconName::Files,
                            PaletteSection::Actions => IconName::Plus,
                            PaletteSection::Settings => IconName::Settings,
                            PaletteSection::Suggestions if item.stable_id.starts_with("chat:") => {
                                IconName::Chat
                            }
                            PaletteSection::Suggestions
                                if item.stable_id.starts_with("settings:") =>
                            {
                                IconName::Settings
                            }
                            _ => IconName::Spark,
                        }),
                        shortcut: None,
                        disabled: false,
                    })
                })
                .collect();
            if !rows.is_empty() {
                sections.push(palette_ui::CommandPaletteSection {
                    id: section.label().to_lowercase().into(),
                    caption: Some(section.label().into()),
                    rows,
                });
            }
        }
        let row_count: usize = sections.iter().map(|section| section.rows.len()).sum();
        self.palette_active = self.palette_active.min(row_count.saturating_sub(1));
        let query_changed =
            self.command_palette.read(cx).input().read(cx).value() != self.palette_query.as_ref();
        self.command_palette.update(cx, |palette, cx| {
            palette.theme_reconcile(theme, cx);
            if query_changed {
                palette.query_reconcile(self.palette_query.clone(), cx);
            }
            palette.results_reconcile(sections, self.palette_active, cx);
        });
    }

    fn settings_surface(
        &mut self,
        theme: Theme,
        navigation_width: f32,
        availability: Option<&AgentAvailability>,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let selected = match self.navigation.current() {
            Route::SettingsSection { section } => *section,
            _ => SettingsSection::General,
        };
        let categories: Vec<_> = SettingsSection::ALL
            .into_iter()
            .map(|section| {
                let (label, icon, _) = settings_metadata(section);
                settings_ui::SettingsCategory {
                    id: section.as_str().into(),
                    label: label.into(),
                    icon,
                }
            })
            .collect();
        let (title, _, description) = settings_metadata(selected);
        let entity = cx.entity();
        let on_category: settings_ui::SettingsCategorySelectHandler = Rc::new(move |id, _, cx| {
            entity.update(cx, |this, cx| {
                if let Some(section) = SettingsSection::ALL
                    .into_iter()
                    .find(|section| section.as_str() == id.as_ref())
                {
                    this.navigation.push(Route::SettingsSection { section });
                    cx.notify();
                }
            });
        });
        let entity = cx.entity();
        let on_close: settings_ui::SettingsCloseHandler = Rc::new(move |_, cx| {
            entity.update(cx, |this, cx| {
                while matches!(
                    this.navigation.current(),
                    Route::Settings | Route::SettingsSection { .. }
                ) && this.navigation.back()
                {}
                if matches!(
                    this.navigation.current(),
                    Route::Settings | Route::SettingsSection { .. }
                ) {
                    this.navigation.replace(Route::HappyAgent {
                        agent: AgentNamespace::local_host(),
                    });
                }
                cx.notify();
            });
        });
        let (status, status_color, status_reason, online) = match availability {
            None | Some(AgentAvailability::Online) => (
                gpui::SharedString::from("Online"),
                theme.role(ThemeRole::Success),
                None::<gpui::SharedString>,
                true,
            ),
            Some(AgentAvailability::Connecting) => (
                "Connecting".into(),
                theme.role(ThemeRole::TextSecondary),
                Some("Opening the authenticated local connection.".into()),
                false,
            ),
            Some(AgentAvailability::Reconnecting { attempt, error }) => (
                format!("Reconnecting · attempt {attempt}").into(),
                theme.role(ThemeRole::BoxWarningText),
                error
                    .as_ref()
                    .map(|error| error.message.clone().into())
                    .or_else(|| Some("Retrying automatically.".into())),
                false,
            ),
            Some(AgentAvailability::Draining { message }) => (
                "Read only".into(),
                theme.role(ThemeRole::BoxWarningText),
                Some(message.clone().into()),
                false,
            ),
            Some(AgentAvailability::Offline { error }) => (
                "Offline".into(),
                theme.role(ThemeRole::StatusError),
                Some(error.message.clone().into()),
                false,
            ),
            Some(AgentAvailability::Error { error }) => (
                "Error".into(),
                theme.role(ThemeRole::StatusError),
                Some(error.message.clone().into()),
                false,
            ),
        };
        let body = if selected == SettingsSection::General {
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .children(self.navigation_error.clone().map(|error| {
                    div()
                        .p(px(12.0))
                        .rounded(px(8.0))
                        .bg(theme.role(ThemeRole::BoxWarningBackground))
                        .text_color(theme.role(ThemeRole::Text))
                        .child(error)
                }))
                .child(
                    div()
                        .p(px(16.0))
                        .rounded(px(10.0))
                        .border_1()
                        .border_color(theme.role(ThemeRole::Divider))
                        .bg(theme.role(ThemeRole::Surface))
                        .flex()
                        .flex_col()
                        .gap(px(8.0))
                        .child(
                            div()
                                .text_size(px(15.0))
                                .font_weight(gpui::FontWeight::SEMIBOLD)
                                .child("Happy Agent nodes"),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .child(Icon::decorative(
                                    IconName::Agents,
                                    18.0,
                                    theme.role(ThemeRole::TextSecondary).into(),
                                    "settings-host-agent",
                                ))
                                .child(div().flex_1().child("This Mac"))
                                .child(
                                    div()
                                        .debug_selector(|| "native-settings.agent-status".into())
                                        .text_color(status_color)
                                        .child(status.clone()),
                                ),
                        )
                        .children(status_reason.clone().map(|reason| {
                            div()
                                .debug_selector(|| "native-settings.agent-status-reason".into())
                                .text_size(px(13.0))
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child(reason)
                        }))
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child("Protocol 23 does not publish typed peer routes or peer status. Native Happy will add remote nodes only when the host supplies that contract."),
                        ),
                )
                .into_any_element()
        } else {
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .children((!online).then(|| {
                    div()
                        .w_full()
                        .p(px(12.0))
                        .rounded(px(8.0))
                        .bg(theme.role(ThemeRole::BoxWarningBackground))
                        .flex()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .debug_selector(|| "native-settings.agent-status".into())
                                .text_color(status_color)
                                .child(status),
                        )
                        .children(status_reason.map(|reason| {
                            div()
                                .debug_selector(|| "native-settings.agent-status-reason".into())
                                .text_size(px(13.0))
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child(reason)
                        }))
                }))
                .child(
                    div()
                        .w_full()
                        .p(px(16.0))
                        .rounded(px(10.0))
                        .border_1()
                        .border_color(theme.role(ThemeRole::Divider))
                        .bg(theme.role(ThemeRole::Surface))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(format!(
                            "The {title} destination is mounted. Its product controls arrive in Phase 8."
                        )),
                )
                .into_any_element()
        };
        settings_ui::SettingsShell {
            id: "native-settings".into(),
            theme,
            navigation_width,
            categories,
            selected_category_id: selected.as_str().into(),
            navigation_title: "Settings".into(),
            title: title.into(),
            description: Some(description.into()),
            close_label: "Close settings".into(),
            body_scrollbar: self.settings_scrollbar.clone(),
            body,
            on_category_select: on_category,
            on_close,
        }
        .into_any_element()
    }

    fn navigation_sidebar(
        &mut self,
        theme: Theme,
        effective_dark: bool,
        width: f32,
        catalog: Option<&AgentCatalogSnapshot>,
        online: bool,
        cx: &mut Context<Self>,
    ) -> gpui::AnyElement {
        let namespace = AgentNamespace::local_host();
        let selected_item_id = selected_sidebar_item(self.navigation.current());
        let availability = if online {
            sidebar_ui::SidebarItemAvailability::Available
        } else {
            sidebar_ui::SidebarItemAvailability::Unavailable
        };
        let mut routes = Vec::new();
        let mut pinned = Vec::new();
        let create_id: gpui::SharedString = "pinned:create".into();
        routes.push((
            create_id.clone(),
            Route::Create {
                agent: namespace.clone(),
            },
        ));
        pinned.push(sidebar_ui::SidebarItem {
            id: create_id,
            label: "Create".into(),
            icon: IconName::Plus,
            depth: 0,
            fold: sidebar_ui::SidebarFold::Leaf,
            lifecycle: sidebar_ui::SidebarItemLifecycle::Ready,
            lifecycle_label: (!online).then(|| "Reconnect to create work".into()),
            availability,
            disabled: !online,
            activity: sidebar_ui::SidebarActivity::Idle,
            unread: false,
            change_stats: None,
            action: None,
        });
        for destination in self.sidebar_memory.pinned().iter().copied() {
            let (id, label, icon, route) = match destination {
                PinnedDestination::Social => (
                    "pinned:social",
                    "Social",
                    IconName::Users,
                    Route::Social {
                        agent: namespace.clone(),
                    },
                ),
                PinnedDestination::Inbox => (
                    "pinned:inbox",
                    "Inbox",
                    IconName::Inbox,
                    Route::Inbox {
                        agent: namespace.clone(),
                    },
                ),
            };
            let id: gpui::SharedString = id.into();
            routes.push((id.clone(), route));
            pinned.push(sidebar_ui::SidebarItem {
                id,
                label: label.into(),
                icon,
                depth: 0,
                fold: sidebar_ui::SidebarFold::Leaf,
                lifecycle: sidebar_ui::SidebarItemLifecycle::Ready,
                lifecycle_label: None,
                availability,
                disabled: false,
                activity: sidebar_ui::SidebarActivity::Idle,
                unread: false,
                change_stats: None,
                action: None,
            });
        }

        let mut sections = Vec::new();
        if !pinned.is_empty() {
            sections.push(sidebar_ui::SidebarSection {
                id: "pinned".into(),
                label: None,
                items: pinned,
                collapsed: false,
                action: None,
                error: None,
            });
        }
        if let Some(catalog) = catalog {
            if !catalog.active_bots.is_empty() {
                let mut items = Vec::new();
                for bot in &catalog.active_bots {
                    let id: gpui::SharedString = format!("group:{}", bot.workspace_key.id()).into();
                    routes.push((
                        id.clone(),
                        Route::Group {
                            agent: namespace.clone(),
                            group: crate::navigation::GroupId::new(Arc::<str>::from(
                                bot.workspace_key.id(),
                            ))
                            .expect("daemon identities are non-empty"),
                        },
                    ));
                    items.push(sidebar_ui::SidebarItem {
                        id,
                        label: bot.label.to_string().into(),
                        icon: IconName::Agents,
                        depth: 0,
                        fold: sidebar_ui::SidebarFold::Leaf,
                        lifecycle: sidebar_lifecycle(&bot.lifecycle),
                        lifecycle_label: bot
                            .lifecycle
                            .initialization_error
                            .as_ref()
                            .map(|value| value.to_string().into()),
                        availability,
                        disabled: false,
                        activity: sidebar_activity(&bot.activity),
                        unread: bot.unread.conversations > 0,
                        change_stats: sidebar_change_stats(bot.git_totals.as_ref()),
                        action: None,
                    });
                }
                sections.push(sidebar_ui::SidebarSection {
                    id: "bots".into(),
                    label: Some("BOTS".into()),
                    items,
                    collapsed: false,
                    action: None,
                    error: None,
                });
            }

            let mut project_items = Vec::new();
            for project in &catalog.active_projects {
                let id_text = format!("group:{}", project.key.id());
                let id: gpui::SharedString = id_text.clone().into();
                let has_children = catalog.active_workspaces.iter().any(|workspace| {
                    workspace.key.id() != project.key.id()
                        && workspace.project_key.as_ref() == Some(&project.key)
                        && workspace
                            .parent_key
                            .as_ref()
                            .is_some_and(|parent| parent.id() == project.key.id())
                });
                let collapsed = self.sidebar_memory.is_collapsed(&id_text);
                routes.push((
                    id.clone(),
                    Route::Group {
                        agent: namespace.clone(),
                        group: crate::navigation::GroupId::new(Arc::<str>::from(project.key.id()))
                            .expect("daemon identities are non-empty"),
                    },
                ));
                project_items.push(sidebar_ui::SidebarItem {
                    id,
                    label: project.label.to_string().into(),
                    icon: if matches!(project.avatar, Some(CatalogAvatar::Home)) {
                        IconName::Home
                    } else {
                        IconName::Files
                    },
                    depth: 0,
                    fold: if !has_children {
                        sidebar_ui::SidebarFold::Leaf
                    } else if collapsed {
                        sidebar_ui::SidebarFold::Collapsed
                    } else {
                        sidebar_ui::SidebarFold::Expanded
                    },
                    lifecycle: sidebar_lifecycle(&project.lifecycle),
                    lifecycle_label: project
                        .lifecycle
                        .initialization_error
                        .as_ref()
                        .map(|value| value.to_string().into()),
                    availability,
                    disabled: false,
                    activity: sidebar_activity(&project.activity),
                    unread: project.unread.conversations > 0,
                    change_stats: sidebar_change_stats(project.git_totals.as_ref()),
                    action: None,
                });
                append_workspace_sidebar_items(
                    catalog,
                    &project.key,
                    project.key.id(),
                    1,
                    availability,
                    &self.sidebar_memory,
                    &namespace,
                    &mut project_items,
                    &mut routes,
                    &mut BTreeSet::new(),
                );
            }
            sections.push(sidebar_ui::SidebarSection {
                id: "projects".into(),
                label: Some("THIS MAC".into()),
                items: project_items,
                collapsed: false,
                action: Some(sidebar_ui::SidebarSectionAction {
                    label: "Add project".into(),
                    icon: IconName::Plus,
                    disabled: !online,
                    busy: false,
                }),
                error: if !catalog.issues.is_empty() {
                    Some(
                        format!(
                            "{} catalog relationships need reconciliation.",
                            catalog.issues.len()
                        )
                        .into(),
                    )
                } else if !online {
                    Some("Reconnecting. Known work remains available.".into())
                } else if catalog.active_projects.is_empty() {
                    Some("No projects yet. Choose a repository folder on this Mac.".into())
                } else {
                    None
                },
            });
        } else {
            sections.push(sidebar_ui::SidebarSection {
                id: "projects".into(),
                label: Some("THIS MAC".into()),
                items: Vec::new(),
                collapsed: false,
                action: None,
                error: Some("Loading this Happy Agent’s catalog…".into()),
            });
        }
        self.sidebar_routes = routes;

        let entity = cx.entity();
        let on_item_select: sidebar_ui::SidebarItemHandler = Rc::new(move |id, _, cx| {
            entity.update(cx, |this, cx| {
                if let Some((_, route)) = this
                    .sidebar_routes
                    .iter()
                    .find(|(candidate, _)| candidate == &id)
                {
                    this.navigation.push(route.clone());
                    this.show_gallery = false;
                    cx.notify();
                }
            });
        });
        let entity = cx.entity();
        let on_collapse: sidebar_ui::SidebarItemHandler = Rc::new(move |id, _, cx| {
            entity.update(cx, |this, cx| {
                this.sidebar_memory.collapse_toggle(id.as_ref());
                if let Some(error) = this.sidebar_memory.take_persistence_error() {
                    this.navigation_error =
                        Some(format!("Sidebar state not saved: {error}").into());
                }
                cx.notify();
            });
        });
        let section_connectivity = self.connectivity.clone();
        let on_section: sidebar_ui::SidebarSectionHandler = Rc::new(move |id, _, cx| {
            if id != "projects" {
                return;
            }
            let Some(connectivity) = section_connectivity.clone() else {
                return;
            };
            let prompt = cx.prompt_for_paths(PathPromptOptions {
                files: false,
                directories: true,
                multiple: false,
                prompt: Some("Choose project".into()),
            });
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
        });
        let entity = cx.entity();
        let on_footer: sidebar_ui::SidebarFooterHandler = Rc::new(move |id, _, cx| {
            entity.update(cx, |this, cx| {
                match id.as_ref() {
                    "settings" => {
                        this.navigation.push(Route::SettingsSection {
                            section: SettingsSection::General,
                        });
                        this.show_gallery = false;
                    }
                    "appearance" => this.appearance_cycle(),
                    "blueprint" => {
                        this.navigation.push(Route::Blueprint);
                        this.show_gallery = true;
                    }
                    _ => {}
                }
                cx.notify();
            });
        });
        let appearance_label = self
            .appearance_error
            .clone()
            .unwrap_or_else(|| Self::appearance_toggle_label(effective_dark).into());
        let mut footer_actions = Vec::new();
        if cfg!(debug_assertions) {
            footer_actions.push(sidebar_ui::SidebarFooterAction {
                id: "blueprint".into(),
                label: "Blueprint".into(),
                icon: IconName::Braces,
                disabled: false,
            });
        }
        footer_actions.push(sidebar_ui::SidebarFooterAction {
            id: "settings".into(),
            label: "Settings".into(),
            icon: IconName::Settings,
            disabled: false,
        });
        footer_actions.push(sidebar_ui::SidebarFooterAction {
            id: "appearance".into(),
            label: appearance_label,
            icon: if effective_dark {
                IconName::Sun
            } else {
                IconName::Moon
            },
            disabled: false,
        });

        sidebar_ui::Sidebar {
            id: "native-navigation-sidebar".into(),
            theme,
            title: "Happy".into(),
            subtitle: Some(
                if online {
                    "This Mac · Online"
                } else {
                    "This Mac · Reconnecting"
                }
                .into(),
            ),
            width: Some(width),
            selected_item_id,
            sections,
            footer: sidebar_ui::SidebarFooter {
                name: None,
                online,
                actions: footer_actions,
                // App update ownership is a Phase 8 host contract. Do not infer
                // it from the daemon version or health response.
                update: None,
            },
            body_scrollbar: self.sidebar_scrollbar.clone(),
            on_item_select: Some(on_item_select),
            on_item_action: None,
            on_item_collapse_toggle: Some(on_collapse),
            on_section_action: Some(on_section),
            on_footer_action: Some(on_footer),
            on_update_toggle: None,
            on_update_apply: None,
        }
        .into_any_element()
    }

    fn destination_surface(
        &self,
        theme: Theme,
        route: &Route,
        catalog: Option<&AgentCatalogSnapshot>,
        notice: Option<ConnectionNotice>,
    ) -> gpui::AnyElement {
        let (title, detail, icon) = destination_metadata(route, catalog);
        div()
            .debug_selector(|| "navigation-destination".into())
            .flex_1()
            .min_w(px(140.0))
            .h_full()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::Surface))
            .child(
                div()
                    .debug_selector(|| "navigation-destination-header".into())
                    .h(px(TITLE_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(10.0))
                    .px(px(16.0))
                    .border_b_1()
                    .border_color(theme.role(ThemeRole::Divider))
                    .child(Icon::decorative(
                        icon,
                        18.0,
                        theme.role(ThemeRole::TextSecondary).into(),
                        "navigation-destination-icon",
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(15.0))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child(title),
                    ),
            )
            .children(notice.map(|notice| div().flex_none().p(px(8.0)).child(notice)))
            .children(self.navigation_error.clone().map(|error| {
                div()
                    .mx(px(16.0))
                    .mt(px(12.0))
                    .p(px(10.0))
                    .rounded(px(8.0))
                    .bg(theme.role(ThemeRole::BoxWarningBackground))
                    .child(error)
            }))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(24.0))
                    .child(
                        div()
                            .max_w(px(520.0))
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(8.0))
                            .text_center()
                            .child(
                                div()
                                    .text_size(px(18.0))
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .child(detail.0),
                            )
                            .child(
                                div()
                                    .text_size(px(13.0))
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(detail.1),
                            ),
                    ),
            )
            .into_any_element()
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
                    .debug_selector(|| "inspector-phase-6-placeholder".into())
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(20.0))
                    .child(
                        div()
                            .max_w(px(240.0))
                            .text_center()
                            .text_size(px(13.0))
                            .line_height(px(20.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child("Git changes and file browsing arrive in Phase 6."),
                    ),
            )
    }
}

fn destination_metadata(
    route: &Route,
    catalog: Option<&AgentCatalogSnapshot>,
) -> (
    gpui::SharedString,
    (gpui::SharedString, gpui::SharedString),
    IconName,
) {
    match route {
        Route::HappyAgent { .. } | Route::Home | Route::Chats => {
            let counts = catalog.map_or_else(
                || "Loading the workspace catalog…".to_owned(),
                |catalog| {
                    format!(
                        "{} projects · {} workspaces · {} bots",
                        catalog.active_projects.len(),
                        catalog
                            .active_workspaces
                            .iter()
                            .filter(|workspace| workspace.key.id()
                                != workspace
                                    .project_key
                                    .as_ref()
                                    .map(|project| project.id())
                                    .unwrap_or(""))
                            .count(),
                        catalog.active_bots.len(),
                    )
                },
            );
            (
                "This Mac".into(),
                (
                    counts.into(),
                    "Choose work from the navigation sidebar.".into(),
                ),
                IconName::Agents,
            )
        }
        Route::Group { group, .. } => {
            let label = catalog
                .and_then(|catalog| {
                    catalog
                        .active_projects
                        .iter()
                        .find(|row| row.key.id() == group.as_str())
                        .map(|row| row.label.to_string())
                        .or_else(|| {
                            catalog
                                .active_workspaces
                                .iter()
                                .find(|row| row.key.id() == group.as_str())
                                .map(|row| row.label.to_string())
                        })
                        .or_else(|| {
                            catalog
                                .active_bots
                                .iter()
                                .find(|row| row.workspace_key.id() == group.as_str())
                                .map(|row| row.label.to_string())
                        })
                })
                .unwrap_or_else(|| "Workspace".into());
            (
                label.into(),
                (
                    "Workspace selected".into(),
                    "Chats and ordered tabs arrive in Phase 5.".into(),
                ),
                IconName::Files,
            )
        }
        Route::Chat { session, .. } => {
            let label = catalog
                .and_then(|catalog| {
                    catalog
                        .active_conversations
                        .iter()
                        .find(|row| row.key.id() == session.as_str())
                        .and_then(|row| row.label.as_ref())
                        .map(|label| label.to_string())
                })
                .unwrap_or_else(|| "Chat".into());
            (
                label.into(),
                (
                    "Chat destination selected".into(),
                    "The native transcript and composer arrive in Phase 5.".into(),
                ),
                IconName::Chat,
            )
        }
        Route::File { path, .. } => (
            path.as_str().to_owned().into(),
            (
                "File destination selected".into(),
                "Native file and document previews arrive in Phase 6.".into(),
            ),
            IconName::Doc,
        ),
        Route::Create { .. } => (
            "Create".into(),
            (
                "Create a chat".into(),
                "The native creation workflow arrives with the chat work loop in Phase 5.".into(),
            ),
            IconName::Plus,
        ),
        Route::Inbox { .. } => (
            "Inbox".into(),
            (
                "Inbox destination selected".into(),
                "Inbox is a Phase 8 secondary surface.".into(),
            ),
            IconName::Inbox,
        ),
        Route::Social { .. } => (
            "Happy Social".into(),
            (
                "Social destination selected".into(),
                "Happy Social is a Phase 8 secondary surface.".into(),
            ),
            IconName::Users,
        ),
        Route::Blueprint => (
            "Blueprint".into(),
            (
                "Reusable component gallery".into(),
                "Inspect native visual states at full scale.".into(),
            ),
            IconName::Braces,
        ),
        Route::Settings | Route::SettingsSection { .. } => (
            "Settings".into(),
            ("Settings".into(), "Choose a category.".into()),
            IconName::Settings,
        ),
    }
}

fn settings_metadata(section: SettingsSection) -> (&'static str, IconName, &'static str) {
    match section {
        SettingsSection::General => (
            "General",
            IconName::Settings,
            "Appearance and Happy Agent nodes",
        ),
        SettingsSection::Account => ("Account", IconName::Users, "Profile, social, and devices"),
        SettingsSection::Instructions => (
            "Instructions",
            IconName::Doc,
            "Instructions and security policy",
        ),
        SettingsSection::Secrets => (
            "Secrets",
            IconName::Lock,
            "Credentials attached to projects",
        ),
        SettingsSection::Providers => ("Providers", IconName::Globe, "Model provider connections"),
        SettingsSection::Usage => ("Usage", IconName::Zap, "Provider plan usage"),
        SettingsSection::MobileAccess => (
            "Mobile Access",
            IconName::Mobile,
            "Pair another Happy device",
        ),
        SettingsSection::Debug => ("Dev Tools", IconName::Code, "State, logs, and profiling"),
    }
}

fn selected_sidebar_item(route: &Route) -> Option<gpui::SharedString> {
    match route {
        Route::Group { group, .. } | Route::Chat { group, .. } | Route::File { group, .. } => {
            Some(format!("group:{}", group.as_str()).into())
        }
        Route::Create { .. } => Some("pinned:create".into()),
        Route::Social { .. } => Some("pinned:social".into()),
        Route::Inbox { .. } => Some("pinned:inbox".into()),
        _ => None,
    }
}

fn sidebar_lifecycle(value: &CatalogLifecycle) -> sidebar_ui::SidebarItemLifecycle {
    match value.initialization {
        Some(CatalogInitializationState::Initializing) => {
            sidebar_ui::SidebarItemLifecycle::Creating
        }
        Some(CatalogInitializationState::Failed) => sidebar_ui::SidebarItemLifecycle::Failed,
        _ => sidebar_ui::SidebarItemLifecycle::Ready,
    }
}

fn sidebar_activity(value: &ActivityAggregate) -> sidebar_ui::SidebarActivity {
    if value.thinking_conversations > 0
        || value.working_conversations > 0
        || value.generating_tools_conversations > 0
        || value.running_tools_conversations > 0
        || value.running_processes > 0
        || value.running_subagents > 0
    {
        sidebar_ui::SidebarActivity::Working
    } else if value.waiting_for_person_conversations > 0 {
        sidebar_ui::SidebarActivity::Waiting
    } else {
        sidebar_ui::SidebarActivity::Idle
    }
}

fn sidebar_change_stats(value: Option<&GitTotals>) -> Option<sidebar_ui::SidebarChangeStats> {
    let value = value?;
    if value.insertions == 0 && value.deletions == 0 {
        return None;
    }
    Some(sidebar_ui::SidebarChangeStats {
        added: value.insertions.min(u32::MAX as u64) as u32,
        deleted: value.deletions.min(u32::MAX as u64) as u32,
    })
}

#[allow(clippy::too_many_arguments)]
fn append_workspace_sidebar_items(
    catalog: &AgentCatalogSnapshot,
    project: &ProjectKey,
    parent_id: &str,
    depth: usize,
    availability: sidebar_ui::SidebarItemAvailability,
    memory: &SidebarMemory,
    namespace: &AgentNamespace,
    items: &mut Vec<sidebar_ui::SidebarItem>,
    routes: &mut Vec<(gpui::SharedString, Route)>,
    visited: &mut BTreeSet<String>,
) {
    let children: Vec<Arc<WorkspaceCatalogRow>> = catalog
        .active_workspaces
        .iter()
        .filter(|workspace| {
            workspace.key.id() != project.id()
                && workspace.project_key.as_ref() == Some(project)
                && workspace
                    .parent_key
                    .as_ref()
                    .is_some_and(|parent| parent.id() == parent_id)
        })
        .cloned()
        .collect();
    for workspace in children {
        if !visited.insert(workspace.key.id().to_owned()) {
            continue;
        }
        let id_text = format!("group:{}", workspace.key.id());
        let id: gpui::SharedString = id_text.clone().into();
        let has_children = catalog.active_workspaces.iter().any(|candidate| {
            candidate.project_key.as_ref() == Some(project)
                && candidate
                    .parent_key
                    .as_ref()
                    .is_some_and(|parent| parent == &workspace.key)
        });
        let collapsed = memory.is_collapsed(&id_text);
        routes.push((
            id.clone(),
            Route::Group {
                agent: namespace.clone(),
                group: crate::navigation::GroupId::new(Arc::<str>::from(workspace.key.id()))
                    .expect("daemon identities are non-empty"),
            },
        ));
        items.push(sidebar_ui::SidebarItem {
            id,
            label: workspace.label.to_string().into(),
            icon: IconName::Branch,
            depth,
            fold: if !has_children {
                sidebar_ui::SidebarFold::Leaf
            } else if collapsed {
                sidebar_ui::SidebarFold::Collapsed
            } else {
                sidebar_ui::SidebarFold::Expanded
            },
            lifecycle: sidebar_lifecycle(&workspace.lifecycle),
            lifecycle_label: workspace
                .lifecycle
                .initialization_error
                .as_ref()
                .map(|value| value.to_string().into()),
            availability,
            disabled: false,
            activity: sidebar_activity(&workspace.activity),
            unread: workspace.unread.conversations > 0,
            change_stats: sidebar_change_stats(workspace.git_totals.as_ref()),
            // Destructive archive and server reorder controls remain hidden until
            // the shell can pair them with confirmation and mutation state.
            action: None,
        });
        append_workspace_sidebar_items(
            catalog,
            project,
            workspace.key.id(),
            depth + 1,
            availability,
            memory,
            namespace,
            items,
            routes,
            visited,
        );
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
        let mut connection_notice = None;
        let mut agent_availability: Option<AgentAvailability> = None;
        let mut agent_online = true;
        let mut catalog_snapshot: Option<Arc<AgentCatalogSnapshot>> = None;
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

            let (availability, agent_name, catalog) = {
                let host = host.read(cx);
                let name = if host.namespace().as_str() == "host:local" {
                    "This Mac"
                } else {
                    "Happy Agent"
                };
                (host.availability().clone(), name, host.catalog().clone())
            };
            catalog_snapshot = Some(catalog.read(cx).snapshot().clone());
            agent_online = matches!(&availability, AgentAvailability::Online);
            agent_availability = Some(availability.clone());
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

        if let Some(catalog) = catalog_snapshot.as_deref() {
            self.reconcile_navigation_catalog(catalog);
        }
        self.reconcile_command_palette(theme, catalog_snapshot.as_deref(), cx);
        let route = self.navigation.current().clone();
        let viewport_width: f32 = window.viewport_size().width.into();
        let (sidebar_width, inspector_width) = Self::column_widths(viewport_width);
        let entity = cx.entity();
        let root = div()
            .debug_selector(|| "app-shell-root".into())
            .relative()
            .track_focus(&self.shell_focus)
            .tab_group()
            .size_full()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::GrouppedBackground))
            .text_color(theme.role(ThemeRole::Text))
            .font_family(crate::fonts::UI_FAMILY)
            .on_action(move |_: &palette_ui::CommandPaletteToggle, window, cx| {
                entity.update(cx, |this, cx| {
                    if this.palette_open {
                        this.palette_open = false;
                        if let Some(focus) = this.palette_return_focus.take() {
                            focus.focus(window);
                        }
                    } else {
                        this.palette_return_focus = window.focused(cx);
                        this.palette_open = true;
                    }
                    cx.notify();
                });
            })
            .on_key_down(|event, window, cx| {
                if event.keystroke.key == "tab" {
                    cx.stop_propagation();
                    if event.keystroke.modifiers.shift {
                        window.focus_prev();
                    } else {
                        window.focus_next();
                    }
                }
            });

        let root = root.child(
            div()
                .debug_selector(|| "native-titlebar-lane".into())
                .w_full()
                .h(px(NATIVE_TITLEBAR_HEIGHT))
                .flex_none()
                .window_control_area(WindowControlArea::Drag)
                .bg(theme.role(ThemeRole::HeaderBackground)),
        );
        let content = div()
            .debug_selector(|| "app-shell-content".into())
            .w_full()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex();

        if matches!(route, Route::Settings | Route::SettingsSection { .. }) {
            return root
                .child(content.child(self.settings_surface(
                    theme,
                    sidebar_width,
                    agent_availability.as_ref(),
                    cx,
                )))
                .children(self.palette_open.then(|| self.command_palette.clone()))
                .into_any_element();
        }

        let content = content.child(self.navigation_sidebar(
            theme,
            effective_dark,
            sidebar_width,
            catalog_snapshot.as_deref(),
            agent_online,
            cx,
        ));
        if self.show_gallery || matches!(route, Route::Blueprint) {
            let entity = cx.entity();
            let on_select: TabSelectHandler = Rc::new(move |id, _, cx| {
                if let Some(page) = GalleryPage::from_id(&id) {
                    entity.update(cx, |this, cx| {
                        this.gallery_page = page;
                        cx.notify();
                    });
                }
            });
            root.child(content.child(crate::ui::gallery::gallery(
                theme,
                self.gallery_inputs.clone(),
                self.gallery_scrollbars.clone(),
                self.connectivity_gallery_scrollbars.clone(),
                self.gallery_welcome_dot_focus.clone(),
                self.gallery_modal_states.clone(),
                self.gallery_command_palette.clone(),
                self.gallery_page,
                on_select,
            )))
            .children(self.palette_open.then(|| self.command_palette.clone()))
            .into_any_element()
        } else {
            root.child(
                content
                    .child(self.destination_surface(
                        theme,
                        &route,
                        catalog_snapshot.as_deref(),
                        connection_notice,
                    ))
                    .child(self.inspector(theme, inspector_width, cx)),
            )
            .children(self.palette_open.then(|| self.command_palette.clone()))
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

#[cfg(test)]
mod geometry_tests {
    use gpui::{
        AppContext, Bounds, Modifiers, Pixels, TestAppContext, VisualTestContext, px, size,
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
        cx.update(|cx| {
            crate::fonts::register(cx);
            crate::ui::command_palette::init(cx);
            cx.bind_keys([gpui::KeyBinding::new(
                "cmd-k",
                crate::ui::command_palette::CommandPaletteToggle,
                None,
            )]);
        });
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
        assert_rect(bounds(cx, "native-titlebar-lane"), 0.0, 0.0, 1280.0, 40.0);
        assert_rect(bounds(cx, "app-shell-content"), 0.0, 40.0, 1280.0, 760.0);
        assert_rect(
            bounds(cx, "native-navigation-sidebar.root"),
            0.0,
            40.0,
            360.0,
            760.0,
        );
        assert_rect(
            bounds(cx, "navigation-destination"),
            360.0,
            40.0,
            560.0,
            760.0,
        );
        assert_rect(bounds(cx, "inspector-root"), 920.0, 40.0, 360.0, 760.0);
    }

    #[gpui::test]
    fn app_shell_fits_the_720_by_480_minimum_without_clipping(cx: &mut TestAppContext) {
        let (_, cx) = render_at(cx, 720.0, 480.0, None);
        assert_rect(bounds(cx, "app-shell-root"), 0.0, 0.0, 720.0, 480.0);
        assert_rect(
            bounds(cx, "native-navigation-sidebar.root"),
            0.0,
            40.0,
            250.0,
            440.0,
        );
        assert_rect(
            bounds(cx, "navigation-destination"),
            250.0,
            40.0,
            220.0,
            440.0,
        );
        assert_rect(bounds(cx, "inspector-root"), 470.0, 40.0, 250.0, 440.0);
        for selector in [
            "native-navigation-sidebar.root",
            "navigation-destination",
            "inspector-root",
            "inspector-phase-6-placeholder",
        ] {
            let element = bounds(cx, selector);
            assert!(element.origin.x >= px(0.0));
            assert!(element.right() <= px(720.0));
        }
    }

    #[gpui::test]
    fn sidebar_resolves_design_header_full_bleed_body_and_footer(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(
            bounds(cx, "native-navigation-sidebar.header"),
            0.0,
            40.0,
            360.0,
            56.0,
        );
        assert_rect(
            bounds(cx, "native-navigation-sidebar.body"),
            0.0,
            96.0,
            360.0,
            664.0,
        );
        assert_rect(
            bounds(cx, "native-navigation-sidebar.footer"),
            0.0,
            760.0,
            360.0,
            40.0,
        );
        assert_eq!(
            bounds(cx, "native-navigation-sidebar-body.viewport"),
            bounds(cx, "native-navigation-sidebar.body"),
        );
    }

    #[gpui::test]
    fn destination_and_inspector_headers_share_the_56px_surface_lane(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(
            bounds(cx, "navigation-destination-header"),
            360.0,
            40.0,
            560.0,
            56.0,
        );
        assert_rect(bounds(cx, "title-bar-Files.root"), 921.0, 40.0, 359.0, 56.0);
        assert_rect(bounds(cx, "inspector-scope.root"), 921.0, 96.0, 359.0, 32.0);
        assert_rect(
            bounds(cx, "inspector-phase-6-placeholder"),
            921.0,
            128.0,
            359.0,
            672.0,
        );
    }

    #[gpui::test]
    fn footer_blueprint_and_appearance_actions_update_product_navigation(cx: &mut TestAppContext) {
        let (app, cx) = render_at(cx, 720.0, 480.0, Some(true));
        let appearance = bounds(cx, "native-navigation-sidebar.footer.action-appearance").center();
        cx.simulate_click(appearance, Modifiers::default());
        assert_eq!(
            cx.update(|_, context| app.read(context).dark_override),
            None
        );

        let blueprint = bounds(cx, "native-navigation-sidebar.footer.action-blueprint").center();
        cx.simulate_click(blueprint, Modifiers::default());
        assert!(cx.debug_bounds("gallery-root").is_some());
        assert!(matches!(
            cx.update(|_, context| app.read(context).navigation.current().clone()),
            crate::navigation::Route::Blueprint
        ));
    }

    #[gpui::test]
    fn global_palette_restores_the_sidebar_focus_on_escape(cx: &mut TestAppContext) {
        let (app, cx) = render_at(cx, 1280.0, 800.0, None);
        let social = bounds(cx, "native-navigation-sidebar.item-pinned:social").center();
        cx.simulate_click(social, Modifiers::default());
        let return_focus = cx
            .update(|window, cx| window.focused(cx))
            .expect("the selected sidebar row owns focus");

        cx.simulate_keystrokes("cmd-k");
        assert!(cx.debug_bounds("global-command-palette.card").is_some());
        assert!(app.read_with(cx, |app, _| app.palette_open));

        cx.simulate_keystrokes("escape");
        assert!(!app.read_with(cx, |app, _| app.palette_open));
        assert_eq!(
            cx.update(|window, cx| window.focused(cx)),
            Some(return_focus)
        );

        cx.simulate_keystrokes("cmd-k");
        let settings = bounds(cx, "global-command-palette.row-0").center();
        cx.simulate_click(settings, Modifiers::default());
        assert!(!app.read_with(cx, |app, _| app.palette_open));
        assert!(matches!(
            app.read_with(cx, |app, _| app.navigation.current().clone()),
            crate::navigation::Route::SettingsSection { .. }
        ));
        let shell_focus = app.read_with(cx, |app, _| app.shell_focus.clone());
        assert_eq!(
            cx.update(|window, cx| window.focused(cx)),
            Some(shell_focus)
        );
    }

    #[gpui::test]
    fn settings_route_uses_the_permanent_two_pane_shell(cx: &mut TestAppContext) {
        let (app, cx) = render_at(cx, 1280.0, 800.0, None);
        let origin = app.read_with(cx, |app, _| app.navigation.current().clone());
        app.update(cx, |app, cx| {
            app.navigation
                .push(crate::navigation::Route::SettingsSection {
                    section: crate::navigation::SettingsSection::General,
                });
            cx.notify();
        });
        cx.run_until_parked();
        assert_rect(bounds(cx, "native-settings.root"), 0.0, 40.0, 1280.0, 760.0);
        assert_rect(
            bounds(cx, "native-settings.navigation"),
            0.0,
            40.0,
            360.0,
            760.0,
        );
        assert_rect(
            bounds(cx, "native-settings.body"),
            360.0,
            96.0,
            920.0,
            704.0,
        );
        let content = bounds(cx, "native-settings.content");
        assert_eq!(content.origin.x, px(360.0));
        assert_eq!(content.origin.y, px(96.0));
        assert_eq!(content.size.width, px(720.0));

        app.update(cx, |app, cx| {
            app.navigation
                .push(crate::navigation::Route::SettingsSection {
                    section: crate::navigation::SettingsSection::Account,
                });
            app.navigation
                .push(crate::navigation::Route::SettingsSection {
                    section: crate::navigation::SettingsSection::Providers,
                });
            cx.notify();
        });
        cx.run_until_parked();
        let close = bounds(cx, "native-settings.close").center();
        cx.simulate_click(close, Modifiers::default());
        assert_eq!(
            app.read_with(cx, |app, _| app.navigation.current().clone()),
            origin
        );
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
    fn mounted_connectivity_degrades_without_replacing_route_catalog_or_sidebar_state(
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
        let (route, sidebar_scrollbar, catalog) = app.read_with(cx, |app, cx| {
            let catalog = controller
                .read(cx)
                .agents()
                .host()
                .read(cx)
                .catalog()
                .clone();
            (
                app.navigation.current().clone(),
                app.sidebar_scrollbar.clone(),
                catalog,
            )
        });

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
        assert!(cx.debug_bounds("native-navigation-sidebar.root").is_some());
        assert_eq!(
            app.read_with(cx, |app, _| app.navigation.current().clone()),
            route
        );
        assert_eq!(
            app.read_with(cx, |app, _| app.sidebar_scrollbar.clone()),
            sidebar_scrollbar
        );
        assert_eq!(
            controller.read_with(cx, |controller, cx| controller
                .agents()
                .host()
                .read(cx)
                .catalog()
                .clone()),
            catalog
        );

        let social = bounds(cx, "native-navigation-sidebar.item-pinned:social").center();
        cx.simulate_click(social, Modifiers::default());
        assert!(matches!(
            app.read_with(cx, |app, _| app.navigation.current().clone()),
            crate::navigation::Route::Social { .. }
        ));
        app.update(cx, |app, cx| {
            app.navigation.back();
            cx.notify();
        });
        cx.run_until_parked();

        let settings = bounds(cx, "native-navigation-sidebar.footer.action-settings").center();
        cx.simulate_click(settings, Modifiers::default());
        assert!(cx.debug_bounds("native-settings.root").is_some());
        assert!(cx.debug_bounds("native-settings.agent-status").is_some());
        assert!(
            cx.debug_bounds("native-settings.agent-status-reason")
                .is_some()
        );

        cx.update(|_, app_cx| {
            controller.update(app_cx, |controller, cx| {
                controller.availability_set(AgentAvailability::Online, cx);
            });
            app.update(app_cx, |app, cx| {
                app.navigation.back();
                cx.notify();
            });
        });
        cx.run_until_parked();
        assert!(matches!(
            controller.read_with(cx, |controller, cx| controller
                .agents()
                .host()
                .read(cx)
                .availability()
                .clone()),
            AgentAvailability::Online
        ));
        assert!(cx.debug_bounds("native-navigation-sidebar.root").is_some());
        assert_eq!(
            app.read_with(cx, |app, _| app.navigation.current().clone()),
            route
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
