use std::rc::Rc;

use gpui::{
    AnyElement, App, Entity, FocusHandle, FontWeight, IntoElement, Window, div, prelude::*, px,
};

use super::theme_roles::ThemeRole;
use super::{
    Avatar, AvatarSize, Badge, BadgeVariant, Button, ButtonVariant, CommandPalette,
    ConnectionNotice, ConnectionNoticeState, ControlSize, Icon, IconName, InstallProgress,
    InstallProgressState, ListRow, Menu, MenuItem, Modal, ModalFocus, ModalOverlay, ModalSize,
    OverlayPlacement, ProfileOnboardingSurface, ProviderOnboardingSurface, ScrollSurface,
    ScrollbarState, SettingsCategory, SettingsShell, Sidebar, SidebarActivity, SidebarChangeStats,
    SidebarFold, SidebarFooter, SidebarFooterAction, SidebarItem, SidebarItemAvailability,
    SidebarItemLifecycle, SidebarRowAction, SidebarSection, SidebarSectionAction,
    SidebarUpdateAction, SidebarUpdateOperation, SidebarUpdateStatus, SidebarUpdateSubject,
    Splitter, SplitterDragState, StartupSurface, StartupSurfaceState, TabItem, TabSelectHandler,
    Tabs, TabsSize, TextField, TextInput, Toolbar, WELCOME_SLIDES, WelcomeDeck,
};
use crate::{
    connectivity::{OnboardingProviderId, ProviderAuthenticationState, ProviderOnboardingRow},
    fonts,
    theme::Theme,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GalleryPage {
    Buttons,
    Fields,
    Rows,
    Tabs,
    Menus,
    Modals,
    Badges,
    Avatars,
    Toolbars,
    Scrolling,
    Splitters,
    Icons,
    ConnectionNotice,
    Startup,
    Welcome,
    ProfileOnboarding,
    ProviderOnboarding,
    InstallProgress,
    Sidebar,
    Settings,
    CommandPalette,
    Theme,
}
impl GalleryPage {
    pub const ALL: [Self; 22] = [
        Self::Buttons,
        Self::Fields,
        Self::Rows,
        Self::Tabs,
        Self::Menus,
        Self::Modals,
        Self::Badges,
        Self::Avatars,
        Self::Toolbars,
        Self::Scrolling,
        Self::Splitters,
        Self::Icons,
        Self::ConnectionNotice,
        Self::Startup,
        Self::Welcome,
        Self::ProfileOnboarding,
        Self::ProviderOnboarding,
        Self::InstallProgress,
        Self::Sidebar,
        Self::Settings,
        Self::CommandPalette,
        Self::Theme,
    ];
    pub const fn id(self) -> &'static str {
        match self {
            Self::Buttons => "buttons",
            Self::Fields => "fields",
            Self::Rows => "rows",
            Self::Tabs => "tabs",
            Self::Menus => "menus",
            Self::Modals => "modals",
            Self::Badges => "badges",
            Self::Avatars => "avatars",
            Self::Toolbars => "toolbars",
            Self::Scrolling => "scrolling",
            Self::Splitters => "splitters",
            Self::Icons => "icons",
            Self::ConnectionNotice => "connection-notice",
            Self::Startup => "startup",
            Self::Welcome => "welcome",
            Self::ProfileOnboarding => "profile-onboarding",
            Self::ProviderOnboarding => "provider-onboarding",
            Self::InstallProgress => "install-progress",
            Self::Sidebar => "sidebar",
            Self::Settings => "settings",
            Self::CommandPalette => "command-palette",
            Self::Theme => "theme",
        }
    }
    pub const fn label(self) -> &'static str {
        match self {
            Self::Buttons => "Buttons",
            Self::Fields => "Fields",
            Self::Rows => "Rows",
            Self::Tabs => "Tabs",
            Self::Menus => "Menus",
            Self::Modals => "Modals",
            Self::Badges => "Badges",
            Self::Avatars => "Avatars",
            Self::Toolbars => "Toolbars",
            Self::Scrolling => "Scrolling",
            Self::Splitters => "Splitters",
            Self::Icons => "Icons",
            Self::ConnectionNotice => "Connection",
            Self::Startup => "Startup",
            Self::Welcome => "Welcome",
            Self::ProfileOnboarding => "Profile",
            Self::ProviderOnboarding => "Providers",
            Self::InstallProgress => "Install",
            Self::Sidebar => "Sidebar",
            Self::Settings => "Settings",
            Self::CommandPalette => "Command palette",
            Self::Theme => "Theme",
        }
    }
    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|page| page.id() == id)
    }
}

fn section(title: &'static str, children: Vec<AnyElement>, theme: Theme) -> impl IntoElement {
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(12.0))
        .p(px(16.0))
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .rounded(px(10.0))
        .bg(theme.role(ThemeRole::Surface))
        .child(
            div()
                .h(px(20.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.role(ThemeRole::TextSecondary))
                .child(title.to_uppercase()),
        )
        .child(
            div()
                .w_full()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(12.0))
                .children(children),
        )
}

fn button(
    theme: Theme,
    id: &'static str,
    label: &'static str,
    size: ControlSize,
    variant: ButtonVariant,
    icon: Option<IconName>,
    icon_only: bool,
    disabled: bool,
    focused: bool,
) -> AnyElement {
    Button {
        id: id.into(),
        theme,
        label: label.into(),
        size,
        variant,
        icon,
        icon_only,
        disabled,
        force_focused: focused,
        focus_handle: None,
        on_activate: (!disabled).then(|| Rc::new(|_: &mut Window, _: &mut App| {}) as _),
    }
    .into_any_element()
}

#[derive(Clone)]
pub struct GalleryModalState {
    pub focus: ModalFocus,
    pub body_scrollbar: Entity<ScrollbarState>,
}

fn modal_stage(
    theme: Theme,
    id: &'static str,
    size: ModalSize,
    state: &GalleryModalState,
) -> AnyElement {
    let first = state.focus.first.clone();
    let last = state.focus.last.clone();
    div().debug_selector(move||format!("{id}.stage")).w(px(720.0)).h(px(360.0)).flex().items_center().justify_center()
        .child(Modal{id:id.into(),theme,size,icon:Some(IconName::Settings),title:format!("{:?} native settings",size).into(),body:div().h(px(180.0)).child("Reusable GPUI dialog content with an authoritative body supplied by the product view.").into_any_element(),body_scrollbar:state.body_scrollbar.clone(),body_height:120.0,
            footer:vec![Button{id:format!("{id}-cancel").into(),theme,label:"Cancel".into(),size:ControlSize::Medium,variant:ButtonVariant::Secondary,icon:None,icon_only:false,disabled:false,force_focused:false,focus_handle:Some(first),on_activate:Some(Rc::new(|_,_|{}))}.into_any_element(),Button{id:format!("{id}-save").into(),theme,label:"Save".into(),size:ControlSize::Medium,variant:ButtonVariant::Primary,icon:None,icon_only:false,disabled:false,force_focused:false,focus_handle:Some(last),on_activate:Some(Rc::new(|_,_|{}))}.into_any_element()]})
        .into_any_element()
}

fn onboarding_stage(theme: Theme, child: AnyElement) -> AnyElement {
    div()
        .w(px(720.0))
        .h(px(480.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(child)
        .into_any_element()
}

fn connectivity_specimens(
    page: GalleryPage,
    theme: Theme,
    profile_name: Entity<TextInput>,
    profile_email: Entity<TextInput>,
    scrollbars: &[Entity<ScrollbarState>; 24],
    welcome_focus: &[FocusHandle; 25],
) -> AnyElement {
    let action = || Some(Rc::new(|_: &mut Window, _: &mut App| {}) as _);
    match page {
        GalleryPage::ConnectionNotice => {
            let states = vec![
                ("connecting", ConnectionNoticeState::Connecting),
                (
                    "reconnecting",
                    ConnectionNoticeState::Reconnecting {
                        attempt: 3,
                        reason: Some(
                            "The authenticated stream ended; reconnecting automatically.".into(),
                        ),
                    },
                ),
                (
                    "offline",
                    ConnectionNoticeState::Offline {
                        reason: "The owner-managed socket is unavailable; drafts remain local."
                            .into(),
                    },
                ),
                (
                    "error",
                    ConnectionNoticeState::Error {
                        message: "The authenticated route closed unexpectedly.".into(),
                    },
                ),
                (
                    "restricted",
                    ConnectionNoticeState::Restricted {
                        reason: "Live mutations are unavailable on this route.".into(),
                    },
                ),
            ];
            section(
                "ConnectionNotice · every agent-local availability state",
                states
                    .into_iter()
                    .map(|(id, state)| {
                        ConnectionNotice {
                            id: format!("gallery-connection-{id}").into(),
                            theme,
                            agent_name: "Studio Mac".into(),
                            state,
                            on_action: action(),
                        }
                        .into_any_element()
                    })
                    .collect(),
                theme,
            )
            .into_any_element()
        }
        GalleryPage::Startup => {
            let states = vec![
                StartupSurfaceState::Checking {
                    detail: "Looking for the local Happy Agent.".into(),
                },
                StartupSurfaceState::AgentMissing {
                    detail: "No running Happy Agent was found.".into(),
                    installable: true,
                },
                StartupSurfaceState::ManagedUnavailable {
                    detail: "The owner-managed route is unavailable; check its host.".into(),
                },
                StartupSurfaceState::Starting {
                    detail: "Preparing the local service.".into(),
                    progress: InstallProgressState::Determinate { fraction: 0.56 },
                },
                StartupSurfaceState::Connecting {
                    detail: "Opening the authenticated local connection.".into(),
                },
                StartupSurfaceState::ProvidersMissing {
                    detail: "Connect at least one supported AI provider.".into(),
                },
                StartupSurfaceState::ProfileRequired {
                    detail: "Add the name and Git email used for your work.".into(),
                },
                StartupSurfaceState::FirstProject {
                    detail: "Choose the first project folder.".into(),
                },
                StartupSurfaceState::CompletionRequired {
                    detail: "Persist the explicit final onboarding acknowledgement.".into(),
                },
                StartupSurfaceState::Failed {
                    message: "Happy Agent returned an incompatible protocol.".into(),
                },
                StartupSurfaceState::Retrying {
                    message: "Automatic reconnect is in progress.".into(),
                },
            ];
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(24.0))
                .children(states.into_iter().enumerate().map(|(index, state)| {
                    onboarding_stage(
                        theme,
                        StartupSurface {
                            id: format!("gallery-startup-{index}").into(),
                            theme,
                            scrollbar: scrollbars[index].clone(),
                            state,
                            on_action: action(),
                        }
                        .into_any_element(),
                    )
                }))
                .into_any_element()
        }
        GalleryPage::Welcome => div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(24.0))
            .children((0..WELCOME_SLIDES.len()).map(|slide| {
                let dot_focus =
                    std::array::from_fn(|dot| welcome_focus[slide * 5 + dot].clone());
                onboarding_stage(
                    theme,
                    WelcomeDeck {
                        id: format!("gallery-welcome-{slide}").into(),
                        theme,
                        scrollbar: scrollbars[10 + slide].clone(),
                        slide,
                        error: (slide == 4).then(|| {
                            "Happy could not save your welcome choice. Check Application Support and try again."
                                .into()
                        }),
                        dot_focus,
                        dark: slide % 2 == 1,
                        appearance_icon: if slide % 2 == 1 {
                            IconName::Moon
                        } else {
                            IconName::Contrast
                        },
                        on_select: Rc::new(|_, _, _| {}),
                        on_action: Rc::new(|_, _| {}),
                        on_appearance: Rc::new(|_, _| {}),
                    }
                    .into_any_element(),
                )
            }))
            .into_any_element(),
        GalleryPage::ProfileOnboarding => div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(24.0))
            .children([
                onboarding_stage(
                    theme,
                    ProfileOnboardingSurface {
                        id: "gallery-profile-onboarding".into(),
                        theme,
                        scrollbar: scrollbars[15].clone(),
                        name: profile_name.clone(),
                        email: profile_email.clone(),
                        error: None,
                        busy: false,
                        on_submit: Some(Rc::new(|_, _| {})),
                    }
                    .into_any_element(),
                ),
                onboarding_stage(
                    theme,
                    ProfileOnboardingSurface {
                        id: "gallery-profile-error".into(),
                        theme,
                        scrollbar: scrollbars[19].clone(),
                        name: profile_name.clone(),
                        email: profile_email.clone(),
                        error: Some(
                            "The profile version changed. Review the current values and try again. "
                                .repeat(10)
                                .into(),
                        ),
                        busy: false,
                        on_submit: Some(Rc::new(|_, _| {})),
                    }
                    .into_any_element(),
                ),
                onboarding_stage(
                    theme,
                    ProfileOnboardingSurface {
                        id: "gallery-profile-busy".into(),
                        theme,
                        scrollbar: scrollbars[20].clone(),
                        name: profile_name,
                        email: profile_email,
                        error: None,
                        busy: true,
                        on_submit: Some(Rc::new(|_, _| {})),
                    }
                    .into_any_element(),
                ),
            ])
            .into_any_element(),
        GalleryPage::ProviderOnboarding => {
            let discovered_rows = |authentication: [Option<ProviderAuthenticationState>; 3]| {
                OnboardingProviderId::ALL
                    .into_iter()
                    .zip(authentication)
                    .map(|(id, authentication)| ProviderOnboardingRow {
                        id,
                        command_path: Some(std::path::PathBuf::from(format!(
                            "/opt/happy/bin/{}",
                            id.as_str()
                        ))),
                        scan: None,
                        authentication,
                    })
                    .collect::<Vec<_>>()
            };
            let checking = discovered_rows([None, None, None]);
            let results = discovered_rows([
                Some(ProviderAuthenticationState::Valid),
                Some(ProviderAuthenticationState::Invalid),
                Some(ProviderAuthenticationState::Error),
            ]);
            div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(24.0))
                .children([
                    onboarding_stage(
                        theme,
                        ProviderOnboardingSurface {
                            id: "gallery-providers-checking".into(),
                            theme,
                            scrollbar: scrollbars[16].clone(),
                            rows: checking,
                            busy: true,
                            continue_available: false,
                            error: None,
                            on_scan: Some(Rc::new(|_, _| {})),
                            on_continue: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                    onboarding_stage(
                        theme,
                        ProviderOnboardingSurface {
                            id: "gallery-providers-results".into(),
                            theme,
                            scrollbar: scrollbars[17].clone(),
                            rows: results,
                            busy: false,
                            continue_available: true,
                            error: None,
                            on_scan: Some(Rc::new(|_, _| {})),
                            on_continue: Some(Rc::new(|_, _| {})),
                        }
                        .into_any_element(),
                    ),
                    onboarding_stage(
                        theme,
                        ProviderOnboardingSurface {
                            id: "gallery-providers-error".into(),
                            theme,
                            scrollbar: scrollbars[18].clone(),
                            rows: Vec::new(),
                            busy: false,
                            continue_available: false,
                            error: Some(
                                "Happy Agent could not verify the provider credentials.".into(),
                            ),
                            on_scan: Some(Rc::new(|_, _| {})),
                            on_continue: None,
                        }
                        .into_any_element(),
                    ),
                ])
                .into_any_element()
        }
        GalleryPage::InstallProgress => section(
            "InstallProgress · indeterminate and bounded determinate",
            vec![
                InstallProgress {
                    id: "gallery-progress-indeterminate".into(),
                    theme,
                    state: InstallProgressState::Indeterminate,
                    label: "Installing Happy Agent".into(),
                }
                .into_any_element(),
                div()
                    .w(px(400.0))
                    .child(InstallProgress {
                        id: "gallery-progress-determinate".into(),
                        theme,
                        state: InstallProgressState::Determinate { fraction: 0.56 },
                        label: "Downloading Happy Agent".into(),
                    })
                    .into_any_element(),
            ],
            theme,
        )
        .into_any_element(),
        _ => unreachable!("connectivity specimen called for a non-connectivity page"),
    }
}

fn gallery_sidebar_item(
    id: impl Into<gpui::SharedString>,
    label: impl Into<gpui::SharedString>,
    icon: IconName,
    depth: usize,
    fold: SidebarFold,
) -> SidebarItem {
    SidebarItem {
        id: id.into(),
        label: label.into(),
        icon,
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

fn sidebar_specimen(theme: Theme, scrollbar: Entity<ScrollbarState>) -> AnyElement {
    let mut inbox = gallery_sidebar_item("inbox", "Inbox", IconName::Inbox, 0, SidebarFold::Leaf);
    inbox.unread = true;
    let mut bot = gallery_sidebar_item(
        "bot-builder",
        "Builder bot",
        IconName::Agents,
        0,
        SidebarFold::Expanded,
    );
    bot.activity = SidebarActivity::Working;
    let mut bot_session = gallery_sidebar_item(
        "bot-session",
        "Refine sidebar fixtures",
        IconName::Chat,
        1,
        SidebarFold::Leaf,
    );
    bot_session.lifecycle = SidebarItemLifecycle::Creating;
    bot_session.lifecycle_label = Some("Starting…".into());
    let mut project = gallery_sidebar_item(
        "project-happy",
        "Happy Desktop",
        IconName::Files,
        0,
        SidebarFold::Expanded,
    );
    project.change_stats = Some(SidebarChangeStats {
        added: 128,
        deleted: 37,
    });
    let mut offline = gallery_sidebar_item(
        "worktree-offline",
        "Remote agent workspace",
        IconName::Branch,
        1,
        SidebarFold::Leaf,
    );
    offline.availability = SidebarItemAvailability::Unavailable;
    offline.lifecycle_label = Some("Offline".into());
    offline.unread = true;
    let mut failed = gallery_sidebar_item(
        "worktree-failed",
        "Failed checkout",
        IconName::Alert,
        1,
        SidebarFold::Leaf,
    );
    failed.lifecycle = SidebarItemLifecycle::Failed;
    failed.action = Some(SidebarRowAction {
        id: "retry".into(),
        label: "Retry checkout".into(),
        icon: IconName::ArrowRight,
        disabled: false,
    });
    let collapsed = gallery_sidebar_item(
        "project-archive",
        "Archived projects",
        IconName::Archive,
        0,
        SidebarFold::Collapsed,
    );
    let overflow = (0..12).map(|index| {
        gallery_sidebar_item(
            format!("overflow-{index}"),
            format!("Overflow project {:02}", index + 1),
            IconName::Branch,
            0,
            SidebarFold::Leaf,
        )
    });
    let mut project_items = vec![project, offline, failed, collapsed];
    project_items.extend(overflow);

    div()
        .debug_selector(|| "gallery-sidebar-stage".into())
        .w(px(360.0))
        .h(px(520.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(Sidebar {
            id: "gallery-sidebar".into(),
            theme,
            title: "Happy".into(),
            subtitle: Some("Studio Mac · offline".into()),
            width: Some(360.0),
            selected_item_id: Some("project-happy".into()),
            sections: vec![
                SidebarSection {
                    id: "pinned".into(),
                    label: Some("Pinned".into()),
                    items: vec![inbox],
                    collapsed: false,
                    action: None,
                    error: None,
                },
                SidebarSection {
                    id: "bots".into(),
                    label: Some("Bots".into()),
                    items: vec![bot, bot_session],
                    collapsed: false,
                    action: Some(SidebarSectionAction {
                        label: "New bot".into(),
                        icon: IconName::Plus,
                        disabled: false,
                        busy: false,
                    }),
                    error: None,
                },
                SidebarSection {
                    id: "projects".into(),
                    label: Some("Projects".into()),
                    items: project_items,
                    collapsed: false,
                    action: Some(SidebarSectionAction {
                        label: "Add project".into(),
                        icon: IconName::Plus,
                        disabled: false,
                        busy: false,
                    }),
                    error: None,
                },
            ],
            footer: SidebarFooter {
                name: Some("Steve".into()),
                online: false,
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
                    version: Some("Happy 2.4.0".into()),
                    detail: Some("Downloaded and ready".into()),
                    open: true,
                    disabled: false,
                }),
            },
            body_scrollbar: scrollbar,
            on_item_select: Some(Rc::new(|_, _, _| {})),
            on_item_action: Some(Rc::new(|_, _, _, _| {})),
            on_item_collapse_toggle: Some(Rc::new(|_, _, _| {})),
            on_section_action: Some(Rc::new(|_, _, _| {})),
            on_footer_action: Some(Rc::new(|_, _, _| {})),
            on_update_toggle: Some(Rc::new(|_, _| {})),
            on_update_apply: Some(Rc::new(|_, _| {})),
        })
        .into_any_element()
}

fn settings_specimen(theme: Theme, scrollbar: Entity<ScrollbarState>) -> AnyElement {
    let categories = [
        ("general", "General", IconName::Settings),
        ("appearance", "Appearance", IconName::Contrast),
        ("agents", "Agents", IconName::Agents),
        ("providers", "Providers", IconName::Spark),
        ("projects", "Projects", IconName::Files),
        ("notifications", "Notifications", IconName::Bell),
        ("security", "Security", IconName::Shield),
        ("advanced", "Advanced", IconName::Braces),
    ]
    .into_iter()
    .map(|(id, label, icon)| SettingsCategory {
        id: id.into(),
        label: label.into(),
        icon,
    })
    .collect();
    let body = div()
        .debug_selector(|| "gallery-settings-body-fixture".into())
        .w_full()
        .flex()
        .flex_col()
        .gap(px(16.0))
        .children((0..14).map(|index| {
            div()
                .w_full()
                .h(px(56.0))
                .flex_none()
                .flex()
                .items_center()
                .px(px(16.0))
                .rounded(px(8.0))
                .bg(theme.role(ThemeRole::InputBackground))
                .child(format!("General preference {:02}", index + 1))
        }))
        .into_any_element();
    div()
        .debug_selector(|| "gallery-settings-stage".into())
        .w(px(720.0))
        .h(px(520.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(SettingsShell {
            id: "gallery-settings".into(),
            theme,
            navigation_width: 250.0,
            categories,
            selected_category_id: "general".into(),
            navigation_title: "Settings".into(),
            title: "General".into(),
            description: Some("Core application preferences".into()),
            close_label: "Close settings".into(),
            body_scrollbar: scrollbar,
            body,
            on_category_select: Rc::new(|_, _, _| {}),
            on_close: Rc::new(|_, _| {}),
        })
        .into_any_element()
}

fn specimens(
    theme: Theme,
    page: GalleryPage,
    inputs: &[Entity<TextInput>; 4],
    scrollbars: &[Entity<ScrollbarState>; 5],
    connectivity_scrollbars: &[Entity<ScrollbarState>; 24],
    welcome_focus: &[FocusHandle; 25],
    modal_states: &[GalleryModalState; 5],
    command_palette: Entity<CommandPalette>,
) -> AnyElement {
    match page {
        GalleryPage::Buttons => section(
            "Buttons · sizes, variants, focus, icons, disabled",
            vec![
                button(
                    theme,
                    "gallery-button-small",
                    "Small",
                    ControlSize::Small,
                    ButtonVariant::Primary,
                    Some(IconName::Plus),
                    false,
                    false,
                    false,
                ),
                button(
                    theme,
                    "gallery-button-inverse",
                    "Sky action",
                    ControlSize::Large,
                    ButtonVariant::Inverse,
                    None,
                    false,
                    false,
                    false,
                ),
                button(
                    theme,
                    "gallery-button-medium",
                    "Focused",
                    ControlSize::Medium,
                    ButtonVariant::Secondary,
                    Some(IconName::Spark),
                    false,
                    false,
                    true,
                ),
                button(
                    theme,
                    "gallery-button-large",
                    "Large action",
                    ControlSize::Large,
                    ButtonVariant::Primary,
                    Some(IconName::Send),
                    false,
                    false,
                    false,
                ),
                button(
                    theme,
                    "gallery-button-danger",
                    "Delete",
                    ControlSize::Medium,
                    ButtonVariant::Danger,
                    Some(IconName::Trash),
                    false,
                    false,
                    false,
                ),
                button(
                    theme,
                    "gallery-button-success",
                    "Approve",
                    ControlSize::Medium,
                    ButtonVariant::Success,
                    Some(IconName::Check),
                    false,
                    false,
                    false,
                ),
                button(
                    theme,
                    "gallery-button-ghost",
                    "Ghost",
                    ControlSize::Medium,
                    ButtonVariant::Ghost,
                    None,
                    false,
                    false,
                    false,
                ),
                button(
                    theme,
                    "gallery-button-icon",
                    "Search",
                    ControlSize::Medium,
                    ButtonVariant::Ghost,
                    Some(IconName::Search),
                    true,
                    false,
                    false,
                ),
                button(
                    theme,
                    "gallery-button-disabled",
                    "Disabled",
                    ControlSize::Medium,
                    ButtonVariant::Secondary,
                    None,
                    false,
                    true,
                    false,
                ),
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Fields => section(
            "Fields · 28 / 36 / 44, focus and invalid",
            vec![
                TextField {
                    id: "gallery-field-small".into(),
                    theme,
                    label: Some("Small".into()),
                    input: inputs[0].clone(),
                    size: ControlSize::Small,
                    width: Some(220.0),
                    icon: None,
                    hint: None,
                    invalid: false,
                    force_focused: false,
                }
                .into_any_element(),
                TextField {
                    id: "gallery-field-medium".into(),
                    theme,
                    label: Some("Project name".into()),
                    input: inputs[1].clone(),
                    size: ControlSize::Medium,
                    width: Some(240.0),
                    icon: Some(IconName::Search),
                    hint: Some("Authoritative dynamic value".into()),
                    invalid: false,
                    force_focused: true,
                }
                .into_any_element(),
                TextField {
                    id: "gallery-field-large".into(),
                    theme,
                    label: Some("Repository".into()),
                    input: inputs[2].clone(),
                    size: ControlSize::Large,
                    width: Some(280.0),
                    icon: None,
                    hint: None,
                    invalid: false,
                    force_focused: false,
                }
                .into_any_element(),
                TextField {
                    id: "gallery-field-error".into(),
                    theme,
                    label: Some("Invalid field".into()),
                    input: inputs[3].clone(),
                    size: ControlSize::Medium,
                    width: Some(240.0),
                    icon: Some(IconName::Alert),
                    hint: Some("Choose an existing repository.".into()),
                    invalid: true,
                    force_focused: false,
                }
                .into_any_element(),
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Rows => section(
            "Rows · selected, default, disabled and dynamic trailing data",
            vec![
                ListRow {
                    id: "gallery-row-selected".into(),
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
                    on_activate: Some(Rc::new(|_, _| {})),
                }
                .into_any_element(),
                ListRow {
                    id: "gallery-row-default".into(),
                    theme,
                    label: "Dynamic server row".into(),
                    width: 360.0,
                    horizontal_padding: 10.0,
                    gap: 8.0,
                    icon: Some(IconName::Chat),
                    trailing: Some("3 unread".into()),
                    selected: false,
                    disabled: false,
                    focus_handle: None,
                    on_activate: Some(Rc::new(|_, _| {})),
                }
                .into_any_element(),
                ListRow {
                    id: "gallery-row-disabled".into(),
                    theme,
                    label: "Unavailable".into(),
                    width: 280.0,
                    horizontal_padding: 10.0,
                    gap: 8.0,
                    icon: Some(IconName::Lock),
                    trailing: None,
                    selected: false,
                    disabled: true,
                    focus_handle: None,
                    on_activate: None,
                }
                .into_any_element(),
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Tabs => section(
            "Tabs · 32 / 40 / 48 and disabled",
            [TabsSize::Small, TabsSize::Medium, TabsSize::Large]
                .into_iter()
                .enumerate()
                .map(|(ix, size)| {
                    Tabs {
                        id: format!("gallery-tabs-{ix}").into(),
                        theme,
                        size,
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
                    .into_any_element()
                })
                .collect(),
            theme,
        )
        .into_any_element(),
        GalleryPage::Menus => section(
            "Menu · 220 / 28 / 4 / 8 with selection and disabled state",
            vec![
                Menu {
                    id: "gallery-menu".into(),
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
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Modals => section(
            "Modal overlays · 360 / 480 / 640 and center / top / fill",
            vec![
                modal_stage(
                    theme,
                    "gallery-modal-small",
                    ModalSize::Small,
                    &modal_states[0],
                ),
                modal_stage(
                    theme,
                    "gallery-modal-medium",
                    ModalSize::Medium,
                    &modal_states[1],
                ),
                modal_stage(
                    theme,
                    "gallery-modal-large",
                    ModalSize::Large,
                    &modal_states[2],
                ),
                div().debug_selector(||"gallery-modal-top.stage".into()).w(px(720.0)).h(px(360.0)).relative()
                    .child(ModalOverlay{id:"gallery-modal-top".into(),theme,placement:OverlayPlacement::Top,focus:modal_states[3].focus.clone(),on_dismiss:Some(Rc::new(|_,_|{})),content:
                        div().debug_selector(||"gallery-modal-top.content".into()).w(px(360.0)).h(px(48.0)).flex().items_center().justify_between().px(px(12.0)).rounded(px(10.0)).bg(theme.role(ThemeRole::SurfaceHigh))
                            .child("Transient type-ahead results")
                            .child(Button{id:"gallery-modal-top-close".into(),theme,label:"Close".into(),size:ControlSize::Small,variant:ButtonVariant::Ghost,icon:Some(IconName::Close),icon_only:true,disabled:false,force_focused:false,focus_handle:Some(modal_states[3].focus.first.clone()),on_activate:Some(Rc::new(|_,_|{}))}).into_any_element()})
                    .into_any_element(),
                div().debug_selector(||"gallery-modal-fill-stage".into()).w(px(720.0)).h(px(360.0)).relative().overflow_hidden()
                    .child(ModalOverlay{id:"gallery-modal-fill".into(),theme,placement:OverlayPlacement::Fill,focus:modal_states[4].focus.clone(),on_dismiss:Some(Rc::new(|_,_|{})),content:
                        div().debug_selector(||"gallery-modal-fill-content".into()).size_full().bg(theme.role(ThemeRole::SurfaceHigh)).flex().flex_col().items_center().justify_center().gap(px(16.0))
                            .child("Lightbox Fill preview; the real overlay is clipped only by this gallery stage.")
                            .child(Button{id:"gallery-modal-fill-close".into(),theme,label:"Close".into(),size:ControlSize::Medium,variant:ButtonVariant::Secondary,icon:Some(IconName::Close),icon_only:false,disabled:false,force_focused:false,focus_handle:Some(modal_states[4].focus.first.clone()),on_activate:Some(Rc::new(|_,_|{}))}).into_any_element()})
                    .into_any_element(),
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Badges => section(
            "Badges · complete semantic variants",
            [
                BadgeVariant::Neutral,
                BadgeVariant::Accent,
                BadgeVariant::Success,
                BadgeVariant::Warning,
                BadgeVariant::Danger,
                BadgeVariant::Info,
                BadgeVariant::Outline,
            ]
            .into_iter()
            .enumerate()
            .map(|(ix, variant)| {
                Badge {
                    id: format!("gallery-badge-{ix}").into(),
                    theme,
                    label: [
                        "Neutral", "Accent", "Success", "Warning", "Danger", "Info", "Outline",
                    ][ix]
                        .into(),
                    variant,
                }
                .into_any_element()
            })
            .collect(),
            theme,
        )
        .into_any_element(),
        GalleryPage::Avatars => section(
            "Avatars · 20 / 28 / 36 / 44, person / agent, presence",
            vec![
                Avatar {
                    id: "gallery-avatar-xs".into(),
                    theme,
                    initials: "S".into(),
                    icon: None,
                    size: AvatarSize::Xs,
                    agent: false,
                    online: false,
                }
                .into_any_element(),
                Avatar {
                    id: "gallery-avatar-sm".into(),
                    theme,
                    initials: "GP".into(),
                    icon: None,
                    size: AvatarSize::Sm,
                    agent: true,
                    online: true,
                }
                .into_any_element(),
                Avatar {
                    id: "gallery-avatar-md".into(),
                    theme,
                    initials: "H".into(),
                    icon: Some(IconName::Terminal),
                    size: AvatarSize::Md,
                    agent: true,
                    online: true,
                }
                .into_any_element(),
                Avatar {
                    id: "gallery-avatar-lg".into(),
                    theme,
                    initials: "AI".into(),
                    icon: None,
                    size: AvatarSize::Lg,
                    agent: false,
                    online: true,
                }
                .into_any_element(),
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Toolbars => section(
            "Toolbars · fluid and constrained composition",
            vec![
                Toolbar {
                    id: "gallery-toolbar-fluid".into(),
                    theme,
                    title: "Project tools".into(),
                    subtitle: Some("happy-desktop".into()),
                    width: None,
                    height: 48.0,
                    leading_icon: Some(IconName::Home),
                    search: Some(
                        TextField {
                            id: "gallery-toolbar-search".into(),
                            theme,
                            label: None,
                            input: inputs[0].clone(),
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
                Toolbar {
                    id: "gallery-toolbar-constrained".into(),
                    theme,
                    title: "Compact toolbar".into(),
                    subtitle: None,
                    width: Some(480.0),
                    height: 40.0,
                    leading_icon: None,
                    search: None,
                    trailing: Some(button(
                        theme,
                        "toolbar-action",
                        "New",
                        ControlSize::Small,
                        ButtonVariant::Primary,
                        Some(IconName::Plus),
                        false,
                        false,
                        false,
                    )),
                }
                .into_any_element(),
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Scrolling => section(
            "Scroll surfaces · real overflow, 8px track / 6px thumb, hidden without overflow",
            vec![
                ScrollSurface {
                    id: "gallery-scroll-overflow".into(),
                    theme,
                    width: Some(320.0),
                    height: Some(160.0),
                    vertical: Some(scrollbars[0].clone()),
                    horizontal: None,
                    content: div()
                        .w_full()
                        .h(px(480.0))
                        .flex_none()
                        .p(px(16.0))
                        .child("Wheel-scroll this 480 px document")
                        .into_any_element(),
                }
                .into_any_element(),
                ScrollSurface {
                    id: "gallery-scroll-fit".into(),
                    theme,
                    width: Some(320.0),
                    height: Some(160.0),
                    vertical: Some(scrollbars[1].clone()),
                    horizontal: None,
                    content: div()
                        .w_full()
                        .h(px(80.0))
                        .flex_none()
                        .p(px(16.0))
                        .child("No thumb when content fits")
                        .into_any_element(),
                }
                .into_any_element(),
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Splitters => section(
            "Splitters · 8px hit target / 1px hairline",
            vec![
                Splitter {
                    id: "gallery-splitter".into(),
                    theme,
                    width: 320.0,
                    height: 160.0,
                    primary_size: 88.0,
                    drag_state: SplitterDragState::new(),
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
            ],
            theme,
        )
        .into_any_element(),
        GalleryPage::Icons => section(
            "Curated Ionicons and Octicons · glyph plus owned vocabulary name",
            IconName::ALL
                .into_iter()
                .enumerate()
                .map(|(ix, name)| {
                    div()
                        .w(px(160.0))
                        .h(px(40.0))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(Icon::labelled(
                            name,
                            format!("{name:?}"),
                            20.0,
                            theme.role(ThemeRole::Text).into(),
                            format!("gallery-icon-{ix}"),
                        ))
                        .child(
                            div()
                                .font_family(fonts::MONO_FAMILY)
                                .text_size(px(10.0))
                                .child(format!("{name:?}")),
                        )
                        .into_any_element()
                })
                .collect(),
            theme,
        )
        .into_any_element(),
        page @ (GalleryPage::ConnectionNotice
        | GalleryPage::Startup
        | GalleryPage::Welcome
        | GalleryPage::ProfileOnboarding
        | GalleryPage::ProviderOnboarding
        | GalleryPage::InstallProgress) => connectivity_specimens(
            page,
            theme,
            inputs[0].clone(),
            inputs[1].clone(),
            connectivity_scrollbars,
            welcome_focus,
        ),
        GalleryPage::Sidebar => {
            sidebar_specimen(theme, connectivity_scrollbars[21].clone())
        }
        GalleryPage::Settings => {
            settings_specimen(theme, connectivity_scrollbars[22].clone())
        }
        GalleryPage::CommandPalette => div()
            .debug_selector(|| "gallery-command-palette-stage".into())
            .w(px(720.0))
            .h(px(600.0))
            .flex_none()
            .relative()
            .overflow_hidden()
            .border_1()
            .border_color(theme.role(ThemeRole::Divider))
            .child(command_palette)
            .into_any_element(),
        GalleryPage::Theme => section(
            "All authoritative light/dark generated roles",
            ThemeRole::ALL
                .into_iter()
                .enumerate()
                .map(|(ix, role)| {
                    div()
                        .w(px(208.0))
                        .h(px(32.0))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .child(
                            div()
                                .debug_selector(move || format!("gallery-theme-{ix}.swatch"))
                                .size(px(28.0))
                                .rounded(px(6.0))
                                .border_1()
                                .border_color(theme.role(ThemeRole::Divider))
                                .bg(theme.role(role)),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .font_family(fonts::MONO_FAMILY)
                                .text_size(px(10.0))
                                .child(role.name()),
                        )
                        .into_any_element()
                })
                .collect(),
            theme,
        )
        .into_any_element(),
    }
}

pub fn gallery(
    theme: Theme,
    inputs: [Entity<TextInput>; 4],
    scrollbars: [Entity<ScrollbarState>; 5],
    connectivity_scrollbars: [Entity<ScrollbarState>; 24],
    welcome_focus: [FocusHandle; 25],
    modal_states: [GalleryModalState; 5],
    command_palette: Entity<CommandPalette>,
    page: GalleryPage,
    on_select: TabSelectHandler,
) -> impl IntoElement {
    let page_tabs = Tabs {
        id: "gallery-pages".into(),
        theme,
        size: TabsSize::Medium,
        items: GalleryPage::ALL
            .into_iter()
            .map(|candidate| TabItem {
                id: candidate.id().into(),
                label: candidate.label().into(),
                icon: None,
                selected: candidate == page,
                disabled: false,
            })
            .collect(),
        on_select,
    };
    let content = div()
        .debug_selector(|| "gallery-content".into())
        .w_full()
        .min_w(px(768.0))
        .flex()
        .flex_col()
        .p(px(24.0))
        .child(specimens(
            theme,
            page,
            &inputs,
            &scrollbars,
            &connectivity_scrollbars,
            &welcome_focus,
            &modal_states,
            command_palette,
        ))
        .into_any_element();
    div()
        .debug_selector(|| "gallery-root".into())
        .size_full()
        .min_w_0()
        .flex()
        .flex_col()
        .bg(theme.role(ThemeRole::GrouppedBackground))
        .font_family(fonts::UI_FAMILY)
        .text_color(theme.role(ThemeRole::Text))
        .child(
            div()
                .debug_selector(|| "gallery-toolbar".into())
                .h(px(42.0))
                .flex_none()
                .flex()
                .items_center()
                .justify_between()
                .px(px(16.0))
                .border_b_1()
                .border_color(theme.role(ThemeRole::Divider))
                .bg(theme.role(ThemeRole::HeaderBackground))
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(FontWeight::BOLD)
                        .child("GPUI component gallery"),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_family(fonts::MONO_FAMILY)
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child("100% · DESIGN.md geometry"),
                ),
        )
        .child(ScrollSurface {
            id: "gallery-page-scroll".into(),
            theme,
            width: None,
            height: Some(40.0),
            vertical: None,
            horizontal: Some(scrollbars[4].clone()),
            content: page_tabs.into_any_element(),
        })
        .child(ScrollSurface {
            id: "gallery-scrollport".into(),
            theme,
            width: None,
            height: None,
            vertical: Some(scrollbars[2].clone()),
            horizontal: Some(scrollbars[3].clone()),
            content,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::command_palette::{
        CommandPaletteCallbacks, CommandPaletteCommandRow, CommandPaletteControlRow,
        CommandPaletteFocus, CommandPaletteRow, CommandPaletteSection,
    };
    use crate::ui::{ScrollbarAppearance, ScrollbarPlacement, SharedScrollHandle};
    use gpui::{
        Bounds, Context, Render, ScrollDelta, ScrollWheelEvent, TestAppContext, VisualTestContext,
        point, size,
    };

    struct Fixture {
        inputs: [Entity<TextInput>; 4],
        scrollbars: [Entity<ScrollbarState>; 5],
        connectivity_scrollbars: [Entity<ScrollbarState>; 24],
        welcome_focus: [FocusHandle; 25],
        modal_states: [GalleryModalState; 5],
        command_palette: Entity<CommandPalette>,
        page: GalleryPage,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            gallery(
                Theme::light(),
                self.inputs.clone(),
                self.scrollbars.clone(),
                self.connectivity_scrollbars.clone(),
                self.welcome_focus.clone(),
                self.modal_states.clone(),
                self.command_palette.clone(),
                self.page,
                Rc::new(|_, _, _| {}),
            )
        }
    }
    fn render_page(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        page: GalleryPage,
    ) -> &mut VisualTestContext {
        cx.update(|cx| {
            crate::fonts::register(cx);
            super::super::text_input::init(cx);
            super::super::components::init(cx)
        });
        let (_, cx) = cx.add_window_view(|_, cx| {
            let workbench = SharedScrollHandle::new();
            let modal_states = std::array::from_fn(|_| {
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
            let connectivity_scrollbars = std::array::from_fn(|_| {
                cx.new(|_| {
                    ScrollbarState::vertical(
                        ScrollbarAppearance::Automatic,
                        ScrollbarPlacement::Overlay,
                        SharedScrollHandle::new(),
                    )
                })
            });
            let palette_focus = CommandPaletteFocus {
                container: cx.focus_handle(),
                last: cx.focus_handle(),
            };
            let command_palette = cx.new({
                let scrollbar = connectivity_scrollbars[23].clone();
                move |cx| {
                    CommandPalette::new(
                        "gallery-command-palette",
                        Theme::light(),
                        "happy",
                        "Search Happy",
                        vec![
                            CommandPaletteSection {
                                id: "suggested".into(),
                                caption: Some("Suggested".into()),
                                rows: (0..7)
                                    .map(|index| {
                                        CommandPaletteRow::Command(CommandPaletteCommandRow {
                                            id: format!("suggestion-{index}").into(),
                                            title: format!("Open Happy project {:02}", index + 1)
                                                .into(),
                                            meta: Some("Projects · local agent".into()),
                                            icon: Some(IconName::Files),
                                            shortcut: (index == 0).then(|| "⌘1".into()),
                                            disabled: false,
                                        })
                                    })
                                    .collect(),
                            },
                            CommandPaletteSection {
                                id: "actions".into(),
                                caption: Some("Actions".into()),
                                rows: vec![
                                    CommandPaletteRow::Command(CommandPaletteCommandRow {
                                        id: "new-project".into(),
                                        title: "Create new project".into(),
                                        meta: None,
                                        icon: Some(IconName::Plus),
                                        shortcut: Some("⌘N".into()),
                                        disabled: false,
                                    }),
                                    CommandPaletteRow::Control(CommandPaletteControlRow {
                                        id: "appearance".into(),
                                        label: "Appearance".into(),
                                        description: Some("Match the system appearance".into()),
                                        disabled: false,
                                        control: Rc::new(|theme, _, _| {
                                            div()
                                                .debug_selector(|| {
                                                    "gallery-command-palette.control".into()
                                                })
                                                .text_color(theme.role(ThemeRole::TextSecondary))
                                                .child("System")
                                                .into_any_element()
                                        }),
                                    }),
                                ],
                            },
                        ],
                        0,
                        scrollbar,
                        palette_focus,
                        CommandPaletteCallbacks {
                            query_changed: Rc::new(|_, _| {}),
                            active_changed: Rc::new(|_, _, _, _| {}),
                            committed: Rc::new(|_, _, _, _| {}),
                            dismissed: Rc::new(|_, _| {}),
                        },
                        cx,
                    )
                }
            });
            Fixture {
                inputs: [
                    cx.new(|cx| TextInput::new("gallery-test-1", "", "Small", Theme::light(), cx)),
                    cx.new(|cx| TextInput::new("gallery-test-2", "", "Medium", Theme::light(), cx)),
                    cx.new(|cx| TextInput::new("gallery-test-3", "", "Large", Theme::light(), cx)),
                    cx.new(|cx| {
                        TextInput::new("gallery-test-4", "", "Invalid", Theme::light(), cx)
                    }),
                ],
                scrollbars: [
                    cx.new(|_| {
                        ScrollbarState::vertical(
                            ScrollbarAppearance::Automatic,
                            ScrollbarPlacement::BesideWhenOverflowing,
                            SharedScrollHandle::new(),
                        )
                    }),
                    cx.new(|_| {
                        ScrollbarState::vertical(
                            ScrollbarAppearance::Automatic,
                            ScrollbarPlacement::BesideWhenOverflowing,
                            SharedScrollHandle::new(),
                        )
                    }),
                    cx.new(|_| {
                        ScrollbarState::vertical(
                            ScrollbarAppearance::Automatic,
                            ScrollbarPlacement::Overlay,
                            workbench.clone(),
                        )
                    }),
                    cx.new(|_| {
                        ScrollbarState::horizontal(
                            ScrollbarAppearance::Automatic,
                            ScrollbarPlacement::Overlay,
                            workbench,
                        )
                    }),
                    cx.new(|_| {
                        ScrollbarState::horizontal(
                            ScrollbarAppearance::Automatic,
                            ScrollbarPlacement::Overlay,
                            SharedScrollHandle::new(),
                        )
                    }),
                ],
                connectivity_scrollbars,
                welcome_focus: std::array::from_fn(|_| cx.focus_handle()),
                modal_states,
                command_palette,
                page,
            }
        });
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }
    #[gpui::test]
    fn gallery_resolves_toolbar_page_selector_and_scrollable_full_scale_workbench(
        cx: &mut TestAppContext,
    ) {
        let cx = render_page(cx, 432.0, 480.0, GalleryPage::Buttons);
        assert_eq!(
            cx.debug_bounds("gallery-root"),
            Some(Bounds::new(
                point(px(0.0), px(0.0)),
                size(px(432.0), px(480.0))
            ))
        );
        assert_eq!(
            cx.debug_bounds("gallery-toolbar").unwrap().size.height,
            px(42.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-pages.root").unwrap().size.height,
            px(40.0)
        );
        let content = cx.debug_bounds("gallery-content").unwrap();
        assert_eq!(
            content.size.width,
            px(768.0),
            "100% specimens remain inspectable through horizontal scroll"
        );
        assert_eq!(content.origin.x, px(0.0));
        let port = cx.debug_bounds("gallery-scrollport.viewport").unwrap();
        cx.simulate_event(ScrollWheelEvent {
            position: port.center(),
            delta: ScrollDelta::Pixels(point(px(-240.0), px(0.0))),
            ..Default::default()
        });
        assert!(
            cx.debug_bounds("gallery-content").unwrap().origin.x < px(0.0),
            "horizontal wheel input reaches oversized 100% specimens"
        );
    }
    #[gpui::test]
    fn gallery_pages_render_complete_field_tab_and_modal_size_contracts(cx: &mut TestAppContext) {
        let cx = render_page(cx, 900.0, 700.0, GalleryPage::Fields);
        assert_eq!(
            cx.debug_bounds("gallery-field-small.control")
                .unwrap()
                .size
                .height,
            px(28.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-field-medium.control")
                .unwrap()
                .size
                .height,
            px(36.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-field-large.control")
                .unwrap()
                .size
                .height,
            px(44.0)
        );
        assert!(cx.debug_bounds("gallery-field-error.message").is_some());
        let cx = render_page(cx, 900.0, 700.0, GalleryPage::Tabs);
        assert_eq!(
            cx.debug_bounds("gallery-tabs-0.root").unwrap().size.height,
            px(32.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-tabs-1.root").unwrap().size.height,
            px(40.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-tabs-2.root").unwrap().size.height,
            px(48.0)
        );
        let cx = render_page(cx, 900.0, 1500.0, GalleryPage::Modals);
        assert_eq!(
            cx.debug_bounds("gallery-modal-small.dialog")
                .unwrap()
                .size
                .width,
            px(360.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-modal-medium.dialog")
                .unwrap()
                .size
                .width,
            px(480.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-modal-large.dialog")
                .unwrap()
                .size
                .width,
            px(640.0)
        );
        let modal_viewport = cx
            .debug_bounds("gallery-modal-small-body-scroll.viewport")
            .unwrap();
        assert_eq!(
            cx.debug_bounds("gallery-modal-small-body-scroll.track")
                .unwrap()
                .size
                .width,
            px(8.0)
        );
        let body_before = cx
            .debug_bounds("gallery-modal-small.body-content")
            .unwrap()
            .origin
            .y;
        cx.simulate_event(ScrollWheelEvent {
            position: modal_viewport.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-60.0))),
            ..Default::default()
        });
        assert!(
            cx.debug_bounds("gallery-modal-small.body-content")
                .unwrap()
                .origin
                .y
                < body_before,
            "overflowing modal body uses shared scrolling"
        );
        let top_stage = cx.debug_bounds("gallery-modal-top.stage").unwrap();
        assert_eq!(
            cx.debug_bounds("gallery-modal-top.overlay").unwrap(),
            top_stage
        );
        assert_eq!(
            cx.debug_bounds("gallery-modal-top.content")
                .unwrap()
                .origin
                .y,
            top_stage.origin.y + px(128.0)
        );
        let fill_stage = cx.debug_bounds("gallery-modal-fill-stage").unwrap();
        assert_eq!(
            cx.debug_bounds("gallery-modal-fill.overlay").unwrap(),
            fill_stage
        );
        let fill_content = cx.debug_bounds("gallery-modal-fill-content").unwrap();
        assert_eq!(fill_content.origin, fill_stage.origin);
        assert!(fill_content.size.width >= fill_stage.size.width);
        assert!(fill_content.size.height >= fill_stage.size.height);
        for (page, selector) in [
            (GalleryPage::Rows, "gallery-row-selected.root"),
            (GalleryPage::Menus, "gallery-menu.root"),
            (GalleryPage::Badges, "gallery-badge-0.root"),
            (GalleryPage::Avatars, "gallery-avatar-lg.root"),
            (GalleryPage::Toolbars, "gallery-toolbar-fluid.root"),
            (GalleryPage::Scrolling, "gallery-scroll-overflow.root"),
            (GalleryPage::Splitters, "gallery-splitter.root"),
            (GalleryPage::Icons, "gallery-icon-0"),
            (
                GalleryPage::ConnectionNotice,
                "gallery-connection-connecting.root",
            ),
            (GalleryPage::Startup, "gallery-startup-0.root"),
            (GalleryPage::Welcome, "gallery-welcome-0.root"),
            (
                GalleryPage::ProfileOnboarding,
                "gallery-profile-onboarding.root",
            ),
            (
                GalleryPage::ProviderOnboarding,
                "gallery-providers-checking.root",
            ),
            (
                GalleryPage::InstallProgress,
                "gallery-progress-determinate.root",
            ),
            (GalleryPage::Sidebar, "gallery-sidebar.root"),
            (GalleryPage::Settings, "gallery-settings.root"),
            (GalleryPage::CommandPalette, "gallery-command-palette.card"),
            (GalleryPage::Theme, "gallery-content"),
        ] {
            let cx = render_page(cx, 900.0, 700.0, page);
            assert!(
                cx.debug_bounds(selector).is_some(),
                "{page:?} page wires {selector}"
            );
        }
    }

    macro_rules! gallery_wiring_test {
        ($name:ident, $page:expr, [$($selector:literal),+ $(,)?]) => {
            #[gpui::test]
            fn $name(cx: &mut TestAppContext) {
                let cx = render_page(cx, 800.0, 600.0, $page);
                $(assert!(cx.debug_bounds($selector).is_some(), "missing gallery fixture {}", $selector);)+
            }
        };
    }

    gallery_wiring_test!(
        gallery_rows_page_wires_reusable_rows,
        GalleryPage::Rows,
        [
            "gallery-row-selected.root",
            "gallery-row-default.root",
            "gallery-row-disabled.root"
        ]
    );
    gallery_wiring_test!(
        gallery_menus_page_wires_reusable_menu,
        GalleryPage::Menus,
        [
            "gallery-menu.root",
            "gallery-menu.item-open",
            "gallery-menu.item-delete"
        ]
    );
    gallery_wiring_test!(
        gallery_badges_page_wires_semantic_variants,
        GalleryPage::Badges,
        ["gallery-badge-0.root", "gallery-badge-6.root"]
    );
    gallery_wiring_test!(
        gallery_avatars_page_wires_sizes_and_presence,
        GalleryPage::Avatars,
        ["gallery-avatar-xs.root", "gallery-avatar-lg.root"]
    );
    gallery_wiring_test!(
        gallery_toolbars_page_wires_real_search_and_action,
        GalleryPage::Toolbars,
        [
            "gallery-toolbar-fluid.root",
            "gallery-toolbar-search.control",
            "toolbar-action.root"
        ]
    );
    gallery_wiring_test!(
        gallery_scrolling_page_wires_overflow_and_fit_surfaces,
        GalleryPage::Scrolling,
        [
            "gallery-scroll-overflow.viewport",
            "gallery-scroll-overflow.track",
            "gallery-scroll-fit.viewport"
        ]
    );
    gallery_wiring_test!(
        gallery_splitters_page_wires_reusable_splitter,
        GalleryPage::Splitters,
        [
            "gallery-splitter.root",
            "gallery-splitter.handle",
            "gallery-splitter.line"
        ]
    );
    gallery_wiring_test!(
        gallery_icons_page_wires_complete_curated_range,
        GalleryPage::Icons,
        ["gallery-icon-0", "gallery-icon-63"]
    );
    gallery_wiring_test!(
        gallery_connection_notice_page_wires_every_availability_state,
        GalleryPage::ConnectionNotice,
        [
            "gallery-connection-connecting.root",
            "gallery-connection-reconnecting.root",
            "gallery-connection-offline.root",
            "gallery-connection-error.root",
            "gallery-connection-restricted.root"
        ]
    );
    gallery_wiring_test!(
        gallery_startup_page_wires_every_startup_state,
        GalleryPage::Startup,
        [
            "gallery-startup-0.root",
            "gallery-startup-2.root",
            "gallery-startup-8.root",
            "gallery-startup-10.root"
        ]
    );
    gallery_wiring_test!(
        gallery_welcome_page_wires_all_slides_and_persistence_error,
        GalleryPage::Welcome,
        ["gallery-welcome-0.root", "gallery-welcome-4.error"]
    );
    gallery_wiring_test!(
        gallery_profile_onboarding_page_wires_normal_error_and_busy,
        GalleryPage::ProfileOnboarding,
        [
            "gallery-profile-onboarding.root",
            "gallery-profile-error.root",
            "gallery-profile-busy.root"
        ]
    );
    gallery_wiring_test!(
        gallery_provider_onboarding_page_wires_checking_results_and_error,
        GalleryPage::ProviderOnboarding,
        [
            "gallery-providers-checking.root",
            "gallery-providers-results.root",
            "gallery-providers-error.root"
        ]
    );
    gallery_wiring_test!(
        gallery_install_progress_page_wires_both_progress_modes,
        GalleryPage::InstallProgress,
        [
            "gallery-progress-indeterminate.root",
            "gallery-progress-determinate.root"
        ]
    );
    gallery_wiring_test!(
        gallery_sidebar_page_wires_complete_product_fixture,
        GalleryPage::Sidebar,
        [
            "gallery-sidebar.root",
            "gallery-sidebar.section-pinned.heading",
            "gallery-sidebar.section-bots.heading",
            "gallery-sidebar.section-projects.heading",
            "gallery-sidebar.item-project-archive",
            "gallery-sidebar.item-worktree-offline",
            "gallery-sidebar.footer",
            "gallery-sidebar.update.panel",
            "gallery-sidebar-body.track"
        ]
    );
    gallery_wiring_test!(
        gallery_settings_page_wires_all_categories_and_overflowing_general_body,
        GalleryPage::Settings,
        [
            "gallery-settings.root",
            "gallery-settings.category-general",
            "gallery-settings.category-advanced",
            "gallery-settings-body-fixture",
            "gallery-settings-body-scroll.track"
        ]
    );
    gallery_wiring_test!(
        gallery_command_palette_page_wires_caller_owned_grouped_fixture,
        GalleryPage::CommandPalette,
        [
            "gallery-command-palette.card",
            "gallery-command-palette.input",
            "gallery-command-palette.section-suggested",
            "gallery-command-palette.section-actions",
            "gallery-command-palette.control",
            "gallery-command-palette-body-scroll.track"
        ]
    );
    gallery_wiring_test!(
        gallery_theme_page_wires_first_and_last_generated_roles,
        GalleryPage::Theme,
        ["gallery-theme-0.swatch", "gallery-theme-171.swatch"]
    );
}
