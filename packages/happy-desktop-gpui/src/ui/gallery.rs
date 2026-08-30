use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, HashMap},
    rc::Rc,
    sync::Arc,
};

use gpui::{
    AnyElement, App, Context, Entity, FocusHandle, Focusable, FontWeight, Image, IntoElement,
    RenderOnce, SharedString, Window, div, prelude::*, px,
};

use super::text_area::TextArea;
use super::theme_roles::ThemeRole;
use super::{
    Avatar, AvatarSize, Badge, BadgeVariant, BinaryFact, Button, ButtonVariant, CommandPalette,
    ConnectionNotice, ConnectionNoticeState, ControlSize, FileBrowser, FileBrowserChangeStats,
    FileBrowserEntry, FileBrowserEntryKind, FileBrowserFocusHandles, FileBrowserIconFamily,
    FileBrowserLayout, FileBrowserListState, FileBrowserScope, FileBrowserStatus, FileDiff,
    FileDiffFocus, FileDiffLine, FileDiffLineKind, FileDiffListState, FileDiffMode,
    FileDiffPreviewLine, FileDiffStats, FileDiffText, FileEditor, FileEditorFocus, FileEditorMode,
    FileEditorState, FilePreview, FilePreviewKind, Icon, IconName, InstallProgress,
    InstallProgressState, ListRow, Menu, MenuItem, Modal, ModalFocus, ModalOverlay, ModalSize,
    NativePreviewKind, NativePreviewSource, OverlayPlacement, PreviewMode,
    ProfileOnboardingSurface, ProviderOnboardingSurface, ScrollSurface, ScrollbarState,
    SettingsCategory, SettingsShell, Sidebar, SidebarActivity, SidebarChangeStats, SidebarFold,
    SidebarFooter, SidebarFooterAction, SidebarItem, SidebarItemAvailability, SidebarItemLifecycle,
    SidebarRowAction, SidebarSection, SidebarSectionAction, SidebarUpdateAction,
    SidebarUpdateOperation, SidebarUpdateStatus, SidebarUpdateSubject, Splitter, SplitterDragState,
    StartupSurface, StartupSurfaceState, TabItem, TabSelectHandler, Tabs, TabsSize, TextField,
    TextInput, Toolbar, WELCOME_SLIDES, WelcomeDeck,
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
    Files,
    Previews,
    Chat,
    Theme,
}
impl GalleryPage {
    pub const ALL: [Self; 25] = [
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
        Self::Files,
        Self::Previews,
        Self::Chat,
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
            Self::Files => "files",
            Self::Previews => "previews",
            Self::Chat => "chat",
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
            Self::Files => "Files",
            Self::Previews => "Previews",
            Self::Chat => "Chat",
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

#[derive(Clone)]
struct GalleryComposerFocus {
    attach: FocusHandle,
    model: FocusHandle,
    effort: FocusHandle,
    permission: FocusHandle,
    tier: FocusHandle,
    audience: FocusHandle,
    emoji: FocusHandle,
    submit: FocusHandle,
}

impl GalleryComposerFocus {
    fn new(cx: &mut Context<ChatGalleryFixture>) -> Self {
        Self {
            attach: cx.focus_handle(),
            model: cx.focus_handle(),
            effort: cx.focus_handle(),
            permission: cx.focus_handle(),
            tier: cx.focus_handle(),
            audience: cx.focus_handle(),
            emoji: cx.focus_handle(),
            submit: cx.focus_handle(),
        }
    }
}

/// Stable, caller-owned state for the complete native chat Blueprint specimen.
/// Construction allocates only local GPUI state. It never opens transport or persistence.
pub struct ChatGalleryFixture {
    pub composer_editor: Entity<super::text_area::TextArea>,
    pub ready_editor: Entity<super::text_area::TextArea>,
    pub stop_editor: Entity<super::text_area::TextArea>,
    pub free_question_editor: Entity<super::text_area::TextArea>,
    pub transcript_state: super::chat_transcript::ChatTranscriptState,
    pub transcript_scrollbar: Entity<ScrollbarState>,
    pub tabs_scrollbar: Entity<ScrollbarState>,
    pub recent_scrollbar: Entity<ScrollbarState>,
    tab_focus: HashMap<SharedString, FocusHandle>,
    tab_close_focus: HashMap<SharedString, FocusHandle>,
    tab_create_focus: FocusHandle,
    recent_toggle_focus: FocusHandle,
    recent_item_focus: HashMap<SharedString, FocusHandle>,
    pub attachment_horizontal_scrollbar: Entity<ScrollbarState>,
    pub attachment_vertical_scrollbar: Entity<ScrollbarState>,
    pub composer_toolbar_scrollbar: Entity<ScrollbarState>,
    pub ready_toolbar_scrollbar: Entity<ScrollbarState>,
    pub stop_toolbar_scrollbar: Entity<ScrollbarState>,
    pub transcript_focus: FocusHandle,
    pub picker_focus: FocusHandle,
    pub emoji_picker_focus: FocusHandle,
    composer_focus: GalleryComposerFocus,
    ready_focus: GalleryComposerFocus,
    stop_focus: GalleryComposerFocus,
    attachment_ready_open_focus: FocusHandle,
    attachment_ready_remove_focus: FocusHandle,
    attachment_ready_retry_focus: FocusHandle,
    attachment_failed_open_focus: FocusHandle,
    attachment_failed_remove_focus: FocusHandle,
    attachment_failed_retry_focus: FocusHandle,
    pub image_lightbox_overlay_focus: FocusHandle,
    pub image_lightbox_close_focus: FocusHandle,
    local_image: Arc<Image>,
    rows: Rc<Vec<super::chat_transcript::ChatTranscriptRow>>,
    events: Rc<RefCell<Vec<SharedString>>>,
    ready_picker_open: Rc<Cell<bool>>,
    ready_attachments_present: Rc<Cell<bool>>,
    callbacks: RefCell<BTreeMap<&'static str, super::chat_message::ChatActivate>>,
    id_callbacks: RefCell<BTreeMap<&'static str, super::composer_controls::IdHandler>>,
    tab_move: super::workspace_tabs::WorkspaceTabMoveHandler,
    command_active: super::composer_controls::IndexHandler,
    phase7: Phase7GalleryFixtureState,
}

/// Stable GPUI entities for the Phase 7 reusable component fixtures.
/// These are allocated with the gallery fixture, never during component rendering.
struct Phase7GalleryFixtureState {
    scrollbars: [Entity<ScrollbarState>; 12],
    terminal_focus: FocusHandle,
    terminal_input: Entity<super::terminal_panel::TerminalInputCapture>,
}

impl Phase7GalleryFixtureState {
    fn new(cx: &mut Context<ChatGalleryFixture>) -> Self {
        let preview_handles = [
            super::SharedScrollHandle::new(),
            super::SharedScrollHandle::new(),
            super::SharedScrollHandle::new(),
        ];
        let scrollbars = std::array::from_fn(|index| {
            let pair = match index {
                3 | 4 => Some((0, index == 4)),
                6 | 7 => Some((1, index == 7)),
                9 | 10 => Some((2, index == 10)),
                _ => None,
            };
            let handle = pair
                .map(|(pair, _)| preview_handles[pair].clone())
                .unwrap_or_else(super::SharedScrollHandle::new);
            cx.new(move |_| {
                if pair.is_some_and(|(_, horizontal)| horizontal) {
                    ScrollbarState::horizontal(
                        super::ScrollbarAppearance::Automatic,
                        super::ScrollbarPlacement::Overlay,
                        handle,
                    )
                } else {
                    ScrollbarState::vertical(
                        super::ScrollbarAppearance::Automatic,
                        super::ScrollbarPlacement::Overlay,
                        handle,
                    )
                }
            })
        });
        let terminal_focus = cx.focus_handle();
        let capture_focus = terminal_focus.clone();
        let terminal_input = cx.new(move |_| {
            super::terminal_panel::TerminalInputCapture::new(capture_focus, Rc::new(|_, _, _| {}))
        });
        Self {
            scrollbars,
            terminal_focus,
            terminal_input,
        }
    }
}

impl ChatGalleryFixture {
    pub fn new(cx: &mut Context<Self>) -> Self {
        use super::chat_markdown::MarkdownDocument;
        use super::chat_message::{
            ChatImageBlock, ChatMessageBlock, ChatMessageModel, CompactionBlock,
            DelegationRowModel, GenericQuestion, MessageDelivery, MessageGeneration, MessageRole,
            NoticeRowModel, ProcessRowModel, QuestionOption, QuestionRowModel, ReasoningBlock,
            SemanticTone, StatusRowModel, ToolBlock, ToolPresentation, ToolReview,
            ToolReviewStatus, ToolStatus,
        };
        use super::chat_transcript::{ChatTranscriptContent, ChatTranscriptRow};

        let events = Rc::new(RefCell::new(Vec::new()));
        let record = |name: &'static str| {
            let events = events.clone();
            Rc::new(move |_: &mut Window, _: &mut App| events.borrow_mut().push(name.into()))
        };
        let image_open: super::chat_message::ChatImageActivate = {
            let events = events.clone();
            Rc::new(move |id, _, _| events.borrow_mut().push(format!("image-open:{id}").into()))
        };
        let tool_open = record("tool-open");
        let review_allow = record("review-allow");
        let review_deny = record("review-deny");
        let question_submit = record("question-submit");
        let delegation_open = record("delegation-open");
        let process_stop = record("process-stop");
        let local_image = Arc::new(Image::empty());
        let rows = Rc::new(vec![
            ChatTranscriptRow {
                id: "user-request".into(),
                revision: 0,
                content: ChatTranscriptContent::Message(ChatMessageModel {
                    id: "gallery-user".into(),
                    role: MessageRole::User,
                    author: "You".into(),
                    initials: "YO".into(),
                    time: Some("10:42".into()),
                    context_note: Some("apps/desktop".into()),
                    delivery: MessageDelivery::Sent,
                    generation: MessageGeneration::Complete,
                    grouped: false,
                    blocks: vec![
                        ChatMessageBlock::Text(MarkdownDocument::parse(
                            "Please make the **chat loop** stable and keep `scroll identity`\n\n```rust\nfn preserve_focus() -> bool { true }\n```",
                        )),
                        ChatMessageBlock::Image(ChatImageBlock {
                            id: "local-wireframe".into(),
                            alt: "Local chat wireframe".into(),
                            image: Some(local_image.clone()),
                            width: Some(640),
                            height: Some(240),
                        }),
                    ],
                    on_image_open: Some(image_open),
                    on_link_open: None,
                    on_tool_open: None,
                    on_review_allow: None,
                    on_review_deny: None,
                }),
            },
            ChatTranscriptRow {
                id: "agent-work".into(),
                revision: 3,
                content: ChatTranscriptContent::Message(ChatMessageModel {
                    id: "gallery-agent".into(),
                    role: MessageRole::Agent,
                    author: "Happy Agent".into(),
                    initials: "HA".into(),
                    time: Some("10:43".into()),
                    context_note: None,
                    delivery: MessageDelivery::Sent,
                    generation: MessageGeneration::Streaming,
                    grouped: false,
                    blocks: vec![
                        ChatMessageBlock::Text(MarkdownDocument::parse(
                            "I will inspect the reusable components, then apply the focused change",
                        )),
                        ChatMessageBlock::Reasoning(ReasoningBlock {
                            summary: "Checked layout and identity constraints".into(),
                            detail: MarkdownDocument::parse(
                                "The transcript keeps a stable semantic anchor while its rows change height",
                            ),
                            expanded: true,
                        }),
                        ChatMessageBlock::Tool(ToolBlock {
                            title: "Run native checks".into(),
                            status: ToolStatus::Running,
                            presentation: ToolPresentation::Command {
                                command: "cargo check -p happy-desktop-gpui".into(),
                                output: Some("Checking happy-desktop-gpui…".into()),
                            },
                            review: Some(ToolReview {
                                status: ToolReviewStatus::Required,
                                prompt: "Allow the local check to read this workspace?".into(),
                            }),
                            expanded: true,
                        }),
                    ],
                    on_image_open: None,
                    on_link_open: None,
                    on_tool_open: Some(tool_open),
                    on_review_allow: Some(review_allow),
                    on_review_deny: Some(review_deny),
                }),
            },
            ChatTranscriptRow {
                id: "questions".into(),
                revision: 1,
                content: ChatTranscriptContent::Question(QuestionRowModel {
                    id: "gallery-questions".into(),
                    title: "A few choices before I continue".into(),
                    questions: vec![
                        GenericQuestion {
                            id: "single".into(),
                            prompt: "Which layout should be the reference?".into(),
                            multiple: false,
                            options: vec![
                                QuestionOption {
                                    id: "desktop".into(),
                                    label: "1280 × 800 desktop".into(),
                                    selected: true,
                                    disabled: false,
                                },
                                QuestionOption {
                                    id: "minimum".into(),
                                    label: "720 × 480 minimum".into(),
                                    selected: false,
                                    disabled: false,
                                },
                            ],
                            text_input: None,
                        },
                        GenericQuestion {
                            id: "multi".into(),
                            prompt: "Which checks should remain visible?".into(),
                            multiple: true,
                            options: vec![
                                QuestionOption {
                                    id: "focus".into(),
                                    label: "Focus".into(),
                                    selected: true,
                                    disabled: false,
                                },
                                QuestionOption {
                                    id: "scroll".into(),
                                    label: "Scroll anchor".into(),
                                    selected: true,
                                    disabled: false,
                                },
                            ],
                            text_input: None,
                        },
                        GenericQuestion {
                            id: "free".into(),
                            prompt: "Anything else?".into(),
                            multiple: false,
                            options: Vec::new(),
                            text_input: None,
                        },
                    ],
                    pending: true,
                    submit_disabled: false,
                    submit_busy: false,
                    on_select: Some({
                        let events = events.clone();
                        Rc::new(move |question, option, selected, _, _| {
                            events
                                .borrow_mut()
                                .push(format!("question:{question}:{option}:{selected}").into())
                        })
                    }),
                    on_submit: Some(question_submit),
                }),
            },
            ChatTranscriptRow {
                id: "process".into(),
                revision: 0,
                content: ChatTranscriptContent::Process {
                    model: ProcessRowModel {
                        id: "gallery-build".into(),
                        label: "Build".into(),
                        detail: "cargo check".into(),
                        running: true,
                    },
                    on_stop: Some(process_stop),
                },
            },
            ChatTranscriptRow {
                id: "delegation".into(),
                revision: 0,
                content: ChatTranscriptContent::Delegation {
                    model: DelegationRowModel {
                        id: "gallery-review".into(),
                        agent: "UI reviewer".into(),
                        task: "Review chat geometry".into(),
                        status: "Working".into(),
                        elapsed: Some("24s".into()),
                    },
                    on_open: Some(delegation_open),
                },
            },
            ChatTranscriptRow {
                id: "status".into(),
                revision: 0,
                content: ChatTranscriptContent::Status {
                    model: StatusRowModel {
                        id: "gallery-status".into(),
                        label: "3 files changed".into(),
                        detail: Some("No transport opened".into()),
                        tone: SemanticTone::Success,
                    },
                    focus: None,
                    on_open: None,
                },
            },
            ChatTranscriptRow {
                id: "notice".into(),
                revision: 0,
                content: ChatTranscriptContent::Notice(NoticeRowModel {
                    id: "gallery-notice".into(),
                    title: Some("Agent unavailable".into()),
                    text: "The draft stays editable while live actions are disabled.".into(),
                    tone: SemanticTone::Warning,
                }),
            },
            ChatTranscriptRow {
                id: "compaction".into(),
                revision: 0,
                content: ChatTranscriptContent::Message(ChatMessageModel {
                    id: "gallery-compaction".into(),
                    role: MessageRole::System,
                    author: "Context".into(),
                    initials: "CX".into(),
                    time: None,
                    context_note: None,
                    delivery: MessageDelivery::Sent,
                    generation: MessageGeneration::Complete,
                    grouped: false,
                    blocks: vec![ChatMessageBlock::Compaction(CompactionBlock {
                        title: "Earlier work compacted".into(),
                        summary: MarkdownDocument::parse(
                            "Kept the layout decisions, open review, and next command",
                        ),
                        token_count: Some(18_420),
                    })],
                    on_image_open: None,
                    on_link_open: None,
                    on_tool_open: None,
                    on_review_allow: None,
                    on_review_deny: None,
                }),
            },
        ]);
        let free_question_editor = cx.new(|cx| {
            super::text_area::TextArea::new(
                "gallery-free-question",
                "Keep the active row visible.",
                "Type a free answer",
                Theme::light(),
                cx,
            )
        });
        // Insert the caller-owned editor only after it exists; row identity remains stable afterwards.
        let mut owned_rows = (*rows).clone();
        if let ChatTranscriptContent::Question(question) = &mut owned_rows[2].content {
            question.questions[2].text_input = Some(free_question_editor.clone());
        }
        let rows = Rc::new(owned_rows);
        let transcript_state = super::chat_transcript::ChatTranscriptState::new(&rows);
        transcript_state.set_event_handler(Some({
            let events = events.clone();
            Rc::new(move |event, _, _| {
                let label = match event {
                    super::chat_transcript::ChatTranscriptEvent::AnchorChanged(_) => {
                        "transcript-anchor"
                    }
                    super::chat_transcript::ChatTranscriptEvent::StartReached => "start-reached",
                };
                events.borrow_mut().push(label.into());
            })
        }));
        let tab_move: super::workspace_tabs::WorkspaceTabMoveHandler = {
            let events = events.clone();
            Rc::new(move |id, direction, _, _| {
                events
                    .borrow_mut()
                    .push(format!("tab-move:{id}:{direction:?}").into())
            })
        };
        let command_active: super::composer_controls::IndexHandler = {
            let events = events.clone();
            Rc::new(move |index, _, _| {
                events
                    .borrow_mut()
                    .push(format!("command-active:{index}").into())
            })
        };
        let ready_picker_open = Rc::new(Cell::new(false));
        let ready_attachments_present = Rc::new(Cell::new(false));
        let ready_focus = GalleryComposerFocus::new(cx);
        let attachment_ready_open_focus = cx.focus_handle();
        let attachment_ready_remove_focus = cx.focus_handle();
        let attachment_ready_retry_focus = cx.focus_handle();
        let attachment_failed_open_focus = cx.focus_handle();
        let attachment_failed_remove_focus = cx.focus_handle();
        let attachment_failed_retry_focus = cx.focus_handle();

        let attachment_scroll_handle = super::SharedScrollHandle::new();
        let attachment_horizontal_handle = attachment_scroll_handle.clone();
        let attachment_command_handle = attachment_scroll_handle.clone();
        let attachment_horizontal_scrollbar = cx.new(move |_| {
            ScrollbarState::horizontal(
                super::ScrollbarAppearance::Always,
                super::ScrollbarPlacement::Overlay,
                attachment_horizontal_handle,
            )
        });
        let attachment_vertical_scrollbar = cx.new(move |_| {
            ScrollbarState::vertical(
                super::ScrollbarAppearance::Always,
                super::ScrollbarPlacement::Overlay,
                attachment_scroll_handle,
            )
        });
        let ready_toolbar_handle = super::SharedScrollHandle::new();
        let ready_toolbar_command_handle = ready_toolbar_handle.clone();
        let ready_toolbar_scrollbar = cx.new(move |_| {
            ScrollbarState::horizontal(
                super::ScrollbarAppearance::Automatic,
                super::ScrollbarPlacement::Overlay,
                ready_toolbar_handle,
            )
        });

        let ready_editor = cx.new(|cx| {
            super::text_area::TextArea::new(
                "gallery-ready-editor",
                "Ready to send",
                "Ask Happy Agent",
                Theme::light(),
                cx,
            )
        });
        ready_editor.update(cx, |editor, _| {
            let events = events.clone();
            let picker_open = ready_picker_open.clone();
            let attachments_present = ready_attachments_present.clone();
            let first_toolbar_focus = ready_focus.attach.clone();
            let last_attachment_focus = attachment_failed_retry_focus.clone();
            editor.set_command_handler(Some(Rc::new(move |command, window, _| match command {
                super::text_area::TextAreaCommand::FocusNext => {
                    ready_toolbar_command_handle.set_offset(gpui::point(
                        px(0.0),
                        ready_toolbar_command_handle.offset().y,
                    ));
                    first_toolbar_focus.focus(window);
                    true
                }
                super::text_area::TextAreaCommand::FocusPrevious if attachments_present.get() => {
                    let viewport_width = f32::from(attachment_command_handle.bounds().size.width);
                    let next_left = (120.0 - viewport_width).max(0.0);
                    attachment_command_handle.set_offset(gpui::point(
                        px(-next_left),
                        attachment_command_handle.offset().y,
                    ));
                    last_attachment_focus.focus(window);
                    true
                }
                super::text_area::TextAreaCommand::FocusPrevious => false,
                super::text_area::TextAreaCommand::Previous
                | super::text_area::TextAreaCommand::Next
                | super::text_area::TextAreaCommand::Commit
                    if picker_open.get() =>
                {
                    let event = match command {
                        super::text_area::TextAreaCommand::Previous => "picker-previous",
                        super::text_area::TextAreaCommand::Next => "picker-next",
                        super::text_area::TextAreaCommand::Commit => "picker-commit",
                        _ => unreachable!(),
                    };
                    events.borrow_mut().push(event.into());
                    true
                }
                super::text_area::TextAreaCommand::Previous
                | super::text_area::TextAreaCommand::Next
                | super::text_area::TextAreaCommand::Commit => false,
            })));
        });
        Self {
            composer_editor: cx.new(|cx| {
                super::text_area::TextArea::new(
                    "gallery-composer-editor",
                    "Steer the running agent without losing focus",
                    "Ask Happy Agent",
                    Theme::light(),
                    cx,
                )
            }),
            ready_editor,
            stop_editor: cx.new(|cx| {
                super::text_area::TextArea::new(
                    "gallery-stop-editor",
                    "",
                    "Agent is running",
                    Theme::light(),
                    cx,
                )
            }),
            free_question_editor,
            transcript_state,
            transcript_scrollbar: cx.new(|_| {
                ScrollbarState::vertical(
                    super::ScrollbarAppearance::Automatic,
                    super::ScrollbarPlacement::Overlay,
                    super::SharedScrollHandle::new(),
                )
            }),
            tabs_scrollbar: cx.new(|_| {
                ScrollbarState::horizontal(
                    super::ScrollbarAppearance::Automatic,
                    super::ScrollbarPlacement::Overlay,
                    super::SharedScrollHandle::new(),
                )
            }),
            recent_scrollbar: cx.new(|_| {
                ScrollbarState::vertical(
                    super::ScrollbarAppearance::Automatic,
                    super::ScrollbarPlacement::Overlay,
                    super::SharedScrollHandle::new(),
                )
            }),
            tab_focus: ["session", "file", "terminal"]
                .into_iter()
                .map(|id| (id.into(), cx.focus_handle()))
                .collect(),
            tab_close_focus: ["file", "terminal"]
                .into_iter()
                .map(|id| (id.into(), cx.focus_handle()))
                .collect(),
            tab_create_focus: cx.focus_handle(),
            recent_toggle_focus: cx.focus_handle(),
            recent_item_focus: [("previous".into(), cx.focus_handle())]
                .into_iter()
                .collect(),
            attachment_horizontal_scrollbar,
            attachment_vertical_scrollbar,
            composer_toolbar_scrollbar: cx.new(|_| {
                ScrollbarState::horizontal(
                    super::ScrollbarAppearance::Automatic,
                    super::ScrollbarPlacement::Overlay,
                    super::SharedScrollHandle::new(),
                )
            }),
            ready_toolbar_scrollbar,
            stop_toolbar_scrollbar: cx.new(|_| {
                ScrollbarState::horizontal(
                    super::ScrollbarAppearance::Automatic,
                    super::ScrollbarPlacement::Overlay,
                    super::SharedScrollHandle::new(),
                )
            }),
            transcript_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            picker_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            emoji_picker_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            composer_focus: GalleryComposerFocus::new(cx),
            ready_focus,
            stop_focus: GalleryComposerFocus::new(cx),
            attachment_ready_open_focus,
            attachment_ready_remove_focus,
            attachment_ready_retry_focus,
            attachment_failed_open_focus,
            attachment_failed_remove_focus,
            attachment_failed_retry_focus,
            image_lightbox_overlay_focus: cx.focus_handle(),
            image_lightbox_close_focus: cx.focus_handle(),
            local_image,
            rows,
            events,
            ready_picker_open,
            ready_attachments_present,
            callbacks: RefCell::new(BTreeMap::new()),
            id_callbacks: RefCell::new(BTreeMap::new()),
            tab_move,
            command_active,
            phase7: Phase7GalleryFixtureState::new(cx),
        }
    }

    #[cfg(test)]
    fn events(&self) -> Vec<SharedString> {
        self.events.borrow().clone()
    }

    fn record(&self, name: &'static str) -> super::chat_message::ChatActivate {
        if let Some(callback) = self.callbacks.borrow().get(name) {
            return callback.clone();
        }
        let events = self.events.clone();
        let callback: super::chat_message::ChatActivate =
            Rc::new(move |_, _| events.borrow_mut().push(name.into()));
        self.callbacks.borrow_mut().insert(name, callback.clone());
        callback
    }

    fn record_id(&self, prefix: &'static str) -> super::composer_controls::IdHandler {
        if let Some(callback) = self.id_callbacks.borrow().get(prefix) {
            return callback.clone();
        }
        let events = self.events.clone();
        let callback: super::composer_controls::IdHandler =
            Rc::new(move |id, _, _| events.borrow_mut().push(format!("{prefix}:{id}").into()));
        self.id_callbacks
            .borrow_mut()
            .insert(prefix, callback.clone());
        callback
    }

    fn composer_card(
        &self,
        id: &'static str,
        theme: Theme,
        editor: Entity<super::text_area::TextArea>,
        running: bool,
        send_enabled: bool,
        picker: bool,
        cx: &App,
    ) -> super::chat_composer::ComposerCard {
        use super::composer_controls::*;
        let attachments_present = id == "gallery-composer" || id == "constrained-ready";
        if editor == self.ready_editor {
            self.ready_picker_open.set(picker);
            self.ready_attachments_present.set(attachments_present);
        }
        let (toolbar_scrollbar, focus) = if editor == self.ready_editor {
            (
                self.ready_toolbar_scrollbar.clone(),
                self.ready_focus.clone(),
            )
        } else if editor == self.stop_editor {
            (self.stop_toolbar_scrollbar.clone(), self.stop_focus.clone())
        } else {
            (
                self.composer_toolbar_scrollbar.clone(),
                self.composer_focus.clone(),
            )
        };
        let command_picker = picker.then(|| {
            CommandPicker {
                id: format!("{id}-commands").into(),
                theme,
                items: vec![
                    CommandPickerItem {
                        id: "review".into(),
                        slash: "/review".into(),
                        description: "Review the current changes".into(),
                        icon: IconName::Check,
                    },
                    CommandPickerItem {
                        id: "compact".into(),
                        slash: "/compact".into(),
                        description: "Compact the current context".into(),
                        icon: IconName::Archive,
                    },
                ],
                active: 0,
                focus_handle: Some(self.picker_focus.clone()),
                on_active: Some(self.command_active.clone()),
                on_select: Some(self.record_id("command-select")),
                on_dismiss: Some(self.record("picker-dismiss")),
                restore_focus: Some(editor.read(cx).focus_handle(cx)),
            }
            .into_any_element()
        });
        super::chat_composer::ComposerCard {
            id: id.into(),
            theme,
            text_area: editor,
            disabled: false,
            pending: false,
            submit_disabled: false,
            send_enabled,
            running,
            picker_open: picker,
            attachment_previews: attachments_present.then(|| {
                AttachmentPreviews {
                    id: "gallery-attachments".into(),
                    theme,
                    items: vec![
                        AttachmentPreviewItem {
                            id: "ready".into(),
                            name: "wireframe.png".into(),
                            kind: AttachmentKind::Image,
                            image: Some(self.local_image.clone()),
                            error: None,
                            open_focus: self.attachment_ready_open_focus.clone(),
                            remove_focus: self.attachment_ready_remove_focus.clone(),
                            retry_focus: self.attachment_ready_retry_focus.clone(),
                        },
                        AttachmentPreviewItem {
                            id: "failed".into(),
                            name: "trace.txt".into(),
                            kind: AttachmentKind::File,
                            image: None,
                            error: Some("Upload failed · retry keeps the same attachment".into()),
                            open_focus: self.attachment_failed_open_focus.clone(),
                            remove_focus: self.attachment_failed_remove_focus.clone(),
                            retry_focus: self.attachment_failed_retry_focus.clone(),
                        },
                    ],
                    disabled: false,
                    horizontal_scrollbar: self.attachment_horizontal_scrollbar.clone(),
                    vertical_scrollbar: self.attachment_vertical_scrollbar.clone(),
                    on_open: Some(self.record_id("attachment-open")),
                    on_remove: Some(self.record_id("attachment-remove")),
                    on_retry: Some(self.record_id("attachment-retry")),
                }
                .into_any_element()
            }),
            leading_controls: vec![
                super::chat_composer::ComposerToolbarItem::new(
                    COMPACT_CONTROL_WIDTH,
                    vec![super::chat_composer::ComposerToolbarFocusTarget::new(
                        focus.attach.clone(),
                        0.0,
                        COMPACT_CONTROL_WIDTH,
                    )],
                    Button {
                        id: format!("{id}-attach").into(),
                        theme,
                        label: "Add inline image".into(),
                        size: ControlSize::Small,
                        variant: ButtonVariant::Ghost,
                        icon: Some(IconName::Paperclip),
                        icon_only: true,
                        disabled: false,
                        force_focused: false,
                        focus_handle: Some(focus.attach.clone()),
                        on_activate: Some(self.record("attach")),
                    }
                    .into_any_element(),
                ),
                super::chat_composer::ComposerToolbarItem::new(
                    MODEL_EFFORT_CONTROL_WIDTH,
                    vec![
                        super::chat_composer::ComposerToolbarFocusTarget::new(
                            focus.model.clone(),
                            0.0,
                            COMPACT_CONTROL_WIDTH,
                        ),
                        super::chat_composer::ComposerToolbarFocusTarget::new(
                            focus.effort.clone(),
                            COMPACT_CONTROL_WIDTH + 4.0,
                            MODEL_EFFORT_CONTROL_WIDTH,
                        ),
                    ],
                    ModelEffortControl {
                        id: format!("{id}-model-effort").into(),
                        theme,
                        model: "Claude Sonnet".into(),
                        effort: "High".into(),
                        disabled: false,
                        model_focus: focus.model.clone(),
                        effort_focus: focus.effort.clone(),
                        on_model: Some(self.record("model")),
                        on_effort: Some(self.record("effort")),
                    }
                    .into_any_element(),
                ),
                super::chat_composer::ComposerToolbarItem::new(
                    COMPACT_CONTROL_WIDTH,
                    vec![super::chat_composer::ComposerToolbarFocusTarget::new(
                        focus.permission.clone(),
                        0.0,
                        COMPACT_CONTROL_WIDTH,
                    )],
                    PermissionControl {
                        id: format!("{id}-permission").into(),
                        theme,
                        label: "Accept edits".into(),
                        disabled: false,
                        focus_handle: focus.permission.clone(),
                        on_activate: Some(self.record("permission")),
                    }
                    .into_any_element(),
                ),
                super::chat_composer::ComposerToolbarItem::new(
                    COMPACT_CONTROL_WIDTH,
                    vec![super::chat_composer::ComposerToolbarFocusTarget::new(
                        focus.tier.clone(),
                        0.0,
                        COMPACT_CONTROL_WIDTH,
                    )],
                    TierControl {
                        id: format!("{id}-tier").into(),
                        theme,
                        label: "Max".into(),
                        disabled: false,
                        focus_handle: focus.tier.clone(),
                        on_activate: Some(self.record("tier")),
                    }
                    .into_any_element(),
                ),
                super::chat_composer::ComposerToolbarItem::new(
                    AUDIENCE_UNAVAILABLE_WIDTH,
                    vec![super::chat_composer::ComposerToolbarFocusTarget::new(
                        focus.audience.clone(),
                        0.0,
                        COMPACT_CONTROL_WIDTH,
                    )],
                    AudienceControl {
                        id: format!("{id}-audience").into(),
                        theme,
                        label: "Team".into(),
                        protocol_available: false,
                        disabled: false,
                        focus_handle: focus.audience.clone(),
                        on_activate: Some(self.record("audience")),
                    }
                    .into_any_element(),
                ),
            ],
            trailing_controls: vec![
                super::chat_composer::ComposerToolbarItem::new(
                    CONTEXT_METER_WIDTH,
                    vec![],
                    ContextMeter {
                        id: format!("{id}-context").into(),
                        theme,
                        used: 48_000,
                        limit: 100_000,
                        label: "48k / 100k".into(),
                    }
                    .into_any_element(),
                ),
                super::chat_composer::ComposerToolbarItem::new(
                    COMPACT_CONTROL_WIDTH,
                    vec![super::chat_composer::ComposerToolbarFocusTarget::new(
                        focus.emoji.clone(),
                        0.0,
                        COMPACT_CONTROL_WIDTH,
                    )],
                    Button {
                        id: format!("{id}-emoji").into(),
                        theme,
                        label: "Insert emoji".into(),
                        size: ControlSize::Small,
                        variant: ButtonVariant::Ghost,
                        icon: Some(IconName::Smile),
                        icon_only: true,
                        disabled: false,
                        force_focused: false,
                        focus_handle: Some(focus.emoji.clone()),
                        on_activate: Some(self.record("emoji-toggle")),
                    }
                    .into_any_element(),
                ),
            ],
            toolbar_scrollbar,
            submit_focus: focus.submit.clone(),
            picker: command_picker,
            on_picker_previous: Some(self.record("picker-previous")),
            on_picker_next: Some(self.record("picker-next")),
            on_picker_commit: Some(self.record("picker-commit")),
            on_picker_dismiss: Some(self.record("picker-dismiss")),
            on_send: Some(self.record(if running { "steer" } else { "send" })),
            on_abort: Some(self.record("stop")),
        }
    }

    fn theme_reconcile(fixture: &Entity<Self>, theme: Theme, cx: &mut App) {
        let editors = {
            let fixture = fixture.read(cx);
            [
                fixture.composer_editor.clone(),
                fixture.ready_editor.clone(),
                fixture.stop_editor.clone(),
                fixture.free_question_editor.clone(),
            ]
        };
        for editor in editors {
            editor.update(cx, |editor, cx| editor.theme_reconcile(theme, cx));
        }
    }

    fn element(&self, theme: Theme, cx: &App) -> AnyElement {
        use super::chat_header::{
            ProjectHeader, ProjectHeaderAction, ProjectHeaderStatus, ProjectStatusTone,
        };
        use super::chat_transcript::ChatTranscript;
        use super::composer_controls::{EmojiItem, EmojiPicker};
        use super::workspace_lifecycle::{
            WorkspaceLifecycleLane, WorkspaceLifecycleNotice, WorkspaceLifecycleNoticeSize,
            WorkspaceLifecyclePhase,
        };
        use super::workspace_tabs::*;
        let lifecycle = WorkspaceLifecycleLane {
            id: "gallery-chat-lifecycle".into(),
            theme,
            name: "chat-blueprint".into(),
            phase: WorkspaceLifecyclePhase::Ready,
            detail: Some("Workspace ready".into()),
            path: Some("~/Happy/chat-blueprint".into()),
        };
        let tabs = WorkspaceTabs {
            id: "gallery-chat-tabs".into(),
            theme,
            tabs: vec![
                WorkspaceTabItem {
                    id: "session".into(),
                    label: "Chat".into(),
                    kind: WorkspaceTabKind::Session,
                    active: true,
                    preview: false,
                    dirty: false,
                    unread: false,
                    waiting: false,
                    running: true,
                    disabled: false,
                    closable: false,
                },
                WorkspaceTabItem {
                    id: "file".into(),
                    label: "gallery.rs".into(),
                    kind: WorkspaceTabKind::File,
                    active: false,
                    preview: false,
                    dirty: true,
                    unread: true,
                    waiting: false,
                    running: false,
                    disabled: false,
                    closable: true,
                },
                WorkspaceTabItem {
                    id: "terminal".into(),
                    label: "Checks".into(),
                    kind: WorkspaceTabKind::Terminal,
                    active: false,
                    preview: false,
                    dirty: false,
                    unread: false,
                    waiting: true,
                    running: true,
                    disabled: false,
                    closable: true,
                },
            ],
            create: Some(WorkspaceCreateAffordance {
                label: "New session".into(),
                disabled: false,
            }),
            recent: Some(RecentSessionsAffordance {
                label: "Recent sessions".into(),
                open: true,
                items: vec![RecentSessionItem {
                    id: "previous".into(),
                    label: "Previous chat".into(),
                    detail: Some("8 min ago".into()),
                    disabled: false,
                }],
            }),
            tabs_scrollbar: self.tabs_scrollbar.clone(),
            recent_scrollbar: Some(self.recent_scrollbar.clone()),
            tab_focus: self.tab_focus.clone(),
            close_focus: self.tab_close_focus.clone(),
            create_focus: Some(self.tab_create_focus.clone()),
            recent_toggle_focus: Some(self.recent_toggle_focus.clone()),
            recent_item_focus: self.recent_item_focus.clone(),
            on_select: Some(self.record_id("tab-select")),
            on_close: Some(self.record_id("tab-close")),
            on_move: Some(self.tab_move.clone()),
            on_create: Some(self.record("tab-create")),
            on_recent_toggle: Some(self.record("recent-toggle")),
            on_recent_select: Some(self.record_id("recent-select")),
        };
        let header = ProjectHeader {
            id: "gallery-chat-header".into(),
            theme,
            title: "Chat Work Loop".into(),
            location: Some("Happy Desktop · buenos-aires".into()),
            status: Some(ProjectHeaderStatus {
                label: "Happy Agent connected".into(),
                tone: ProjectStatusTone::Available,
            }),
            actions: vec![
                ProjectHeaderAction {
                    id: "files".into(),
                    label: "Files".into(),
                    icon: IconName::Files,
                    disabled: false,
                    selected: true,
                },
                ProjectHeaderAction {
                    id: "terminal".into(),
                    label: "Terminal".into(),
                    icon: IconName::Terminal,
                    disabled: false,
                    selected: false,
                },
            ],
            on_action: Some(self.record_id("header-action")),
        };
        let dock = super::chat_composer::ComposerDock {
            id: "gallery-chat-dock".into(),
            theme,
            above: Some(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.role(ThemeRole::TextSecondary))
                    .child("Agent is working · steering appends to the active turn")
                    .into_any_element(),
            ),
            failure: Some(super::chat_composer::ComposerFailureBanner {
                id: "gallery-composer-failure".into(),
                theme,
                message: "The last send failed. The draft is still local.".into(),
                retry_disabled: false,
                on_retry: Some(self.record("failure-retry")),
            }),
            composer: self.composer_card(
                "gallery-composer",
                theme,
                self.composer_editor.clone(),
                true,
                true,
                true,
                cx,
            ),
            footer: Some(
                div()
                    .w_full()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child("Accept edits · Max tier")
                    .child("48% context")
                    .into_any_element(),
            ),
        };
        self.transcript_state.reconcile(&self.rows);
        let work_loop = div()
            .debug_selector(|| "gallery-chat-work-loop".into())
            .w(px(720.0))
            .flex_none()
            .flex()
            .flex_col()
            .overflow_hidden()
            .border_1()
            .border_color(theme.role(ThemeRole::Divider))
            .bg(theme.role(ThemeRole::Surface))
            .child(header)
            .child(lifecycle)
            .child(tabs)
            .child(
                div()
                    .debug_selector(|| "gallery-chat-transcript-stage".into())
                    .w_full()
                    .h(px(1080.0))
                    .flex_none()
                    .child(ChatTranscript {
                        id: "gallery-chat-transcript".into(),
                        theme,
                        state: self.transcript_state.clone(),
                        scrollbar: self.transcript_scrollbar.clone(),
                        rows: self.rows.clone(),
                        focus: Some(self.transcript_focus.clone()),
                    }),
            )
            .child(dock);
        let lifecycle_states = [
            WorkspaceLifecyclePhase::Creating,
            WorkspaceLifecyclePhase::Failed,
            WorkspaceLifecyclePhase::Refused,
            WorkspaceLifecyclePhase::Missing,
        ]
        .into_iter()
        .enumerate()
        .map(|(index, phase)| {
            WorkspaceLifecycleNotice {
                id: format!("gallery-chat-lifecycle-{index}").into(),
                theme,
                name: "chat-blueprint".into(),
                phase,
                detail: Some("Caller-authored lifecycle detail".into()),
                path: Some("~/Happy/chat-blueprint".into()),
                size: WorkspaceLifecycleNoticeSize::Compact,
            }
            .into_any_element()
        })
        .collect();
        let emoji = EmojiPicker {
            id: "gallery-emoji-picker".into(),
            theme,
            columns: 5,
            active: 0,
            focus_handle: self.emoji_picker_focus.clone(),
            items: vec![
                EmojiItem {
                    id: "sparkles".into(),
                    glyph: "✨".into(),
                    name: "Sparkles".into(),
                },
                EmojiItem {
                    id: "check".into(),
                    glyph: "✅".into(),
                    name: "Check".into(),
                },
                EmojiItem {
                    id: "eyes".into(),
                    glyph: "👀".into(),
                    name: "Eyes".into(),
                },
            ],
            on_active: Some(self.command_active.clone()),
            on_select: Some(self.record_id("emoji-select")),
            on_dismiss: Some(self.record("emoji-dismiss")),
            restore_focus: Some(self.composer_editor.read(cx).focus_handle(cx)),
        };
        let lightbox = div()
            .debug_selector(|| "gallery-image-lightbox-stage".into())
            .w(px(720.0))
            .h(px(480.0))
            .flex_none()
            .relative()
            .overflow_hidden()
            .border_1()
            .border_color(theme.role(ThemeRole::Divider))
            .child(super::chat_message::InlineImageLightbox {
                id: "gallery-image-lightbox".into(),
                theme,
                image: self.local_image.clone(),
                alt: "Local chat wireframe".into(),
                overlay_focus: self.image_lightbox_overlay_focus.clone(),
                close_focus: self.image_lightbox_close_focus.clone(),
                on_close: self.record("lightbox-close"),
            })
            .into_any_element();
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(px(16.0))
            .child(work_loop)
            .child(section("Chat lifecycle states", lifecycle_states, theme))
            .child(section(
                "Picker fixtures",
                vec![emoji.into_any_element()],
                theme,
            ))
            .child(section(
                "Inline image lightbox · open",
                vec![lightbox],
                theme,
            ))
            .child(section(
                "Composer states that cannot coexist",
                vec![
                    div()
                        .w(px(560.0))
                        .child(super::chat_composer::ComposerDock {
                            id: "gallery-ready-dock".into(),
                            theme,
                            above: None,
                            failure: None,
                            composer: self.composer_card(
                                "gallery-ready-composer",
                                theme,
                                self.ready_editor.clone(),
                                false,
                                true,
                                false,
                                cx,
                            ),
                            footer: None,
                        })
                        .into_any_element(),
                    div()
                        .w(px(560.0))
                        .child(super::chat_composer::ComposerDock {
                            id: "gallery-stop-dock".into(),
                            theme,
                            above: None,
                            failure: None,
                            composer: self.composer_card(
                                "gallery-stop-composer",
                                theme,
                                self.stop_editor.clone(),
                                true,
                                false,
                                false,
                                cx,
                            ),
                            footer: None,
                        })
                        .into_any_element(),
                ],
                theme,
            ))
            .child(phase7_reusable_component_gallery_fixture(
                theme,
                &self.phase7,
            ))
            .into_any_element()
    }
}

#[derive(IntoElement)]
struct ChatGallerySpecimen {
    fixture: Entity<ChatGalleryFixture>,
    theme: Theme,
}
impl RenderOnce for ChatGallerySpecimen {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        ChatGalleryFixture::theme_reconcile(&self.fixture, self.theme, cx);
        self.fixture.read(cx).element(self.theme, cx)
    }
}

fn file_browser_gallery_specimen(
    theme: Theme,
    scrollbar: Entity<ScrollbarState>,
    focus: FileBrowserFocusHandles,
) -> AnyElement {
    let entries = Rc::new(vec![
        FileBrowserEntry {
            id: "src".into(),
            name: "src".into(),
            directory: None,
            depth: 0,
            kind: FileBrowserEntryKind::Directory { expanded: true },
            icon: FileBrowserIconFamily::Directory { expanded: true },
            icon_role: ThemeRole::TextLink,
            status: None,
            changes: None,
        },
        FileBrowserEntry {
            id: "ui".into(),
            name: "ui".into(),
            directory: Some("packages/happy-desktop-gpui/src".into()),
            depth: 1,
            kind: FileBrowserEntryKind::Directory { expanded: true },
            icon: FileBrowserIconFamily::Directory { expanded: true },
            icon_role: ThemeRole::BoxWarningText,
            status: None,
            changes: None,
        },
        FileBrowserEntry {
            id: "file-browser".into(),
            name: "file_browser.rs".into(),
            directory: Some("packages/happy-desktop-gpui/src/ui".into()),
            depth: 2,
            kind: FileBrowserEntryKind::File,
            icon: FileBrowserIconFamily::Code,
            icon_role: ThemeRole::TextLink,
            status: Some(FileBrowserStatus {
                label: "Created".into(),
                role: ThemeRole::DiffSuccess,
            }),
            changes: Some(FileBrowserChangeStats {
                files: 0,
                added: Some(412),
                deleted: Some(0),
                counts_exact: true,
            }),
        },
        FileBrowserEntry {
            id: "gallery".into(),
            name: "gallery.rs".into(),
            directory: Some("packages/happy-desktop-gpui/src/ui".into()),
            depth: 2,
            kind: FileBrowserEntryKind::File,
            icon: FileBrowserIconFamily::Code,
            icon_role: ThemeRole::BoxWarningText,
            status: Some(FileBrowserStatus {
                label: "Modified".into(),
                role: ThemeRole::BoxWarningText,
            }),
            changes: Some(FileBrowserChangeStats {
                files: 0,
                added: None,
                deleted: Some(4),
                counts_exact: false,
            }),
        },
        FileBrowserEntry {
            id: "more-ui".into(),
            name: "Load more files…".into(),
            directory: None,
            depth: 0,
            kind: FileBrowserEntryKind::LoadMore,
            icon: FileBrowserIconFamily::Other,
            icon_role: ThemeRole::TextSecondary,
            status: None,
            changes: None,
        },
    ]);
    let list_state = FileBrowserListState::new(&entries);
    section(
        "FileBrowser · controlled 340px permanent Files inspector",
        vec![
            div()
                .debug_selector(|| "gallery-file-browser-stage".into())
                .w(px(340.0))
                .h(px(360.0))
                .flex_none()
                .border_1()
                .border_color(theme.role(ThemeRole::Divider))
                .child(FileBrowser {
                    id: "gallery-file-browser".into(),
                    theme,
                    width: 338.0,
                    scope: FileBrowserScope::Changes,
                    layout: FileBrowserLayout::Tree,
                    change_stats: FileBrowserChangeStats {
                        files: 12,
                        added: Some(448),
                        deleted: Some(21),
                        counts_exact: false,
                    },
                    entries,
                    selected_entry_id: Some("file-browser".into()),
                    list_state,
                    focus,
                    scrollbar,
                    on_scope_change: Some(Rc::new(|_, _, _| {})),
                    on_layout_change: Some(Rc::new(|_, _, _| {})),
                    on_entry_select: Some(Rc::new(|_, _, _| {})),
                    on_entry_open: Some(Rc::new(|_, _, _| {})),
                    on_entry_toggle: Some(Rc::new(|_, _, _| {})),
                })
                .into_any_element(),
        ],
        theme,
    )
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
    chat_fixture: Entity<ChatGalleryFixture>,
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
        GalleryPage::Files => file_browser_gallery_specimen(
            theme,
            connectivity_scrollbars[23].clone(),
            FileBrowserFocusHandles {
                root: welcome_focus[20].clone(),
                all_files: welcome_focus[21].clone(),
                changes: welcome_focus[22].clone(),
                list: welcome_focus[23].clone(),
                tree: welcome_focus[24].clone(),
            },
        ),
        GalleryPage::Previews => {
            let image = Arc::new(Image::empty());
            let preview = |id: &'static str, kind: FilePreviewKind| {
                div().w(px(560.0)).h(px(320.0)).child(FilePreview {
                    id: id.into(), theme, size: "24 KB".into(), updating: false,
                    mode: Some(PreviewMode::Rendered), mode_focus: None, on_markdown_link_open: None, on_mode_select: None, native_visible: true, kind,
                }).into_any_element()
            };
            section("File previews · typed props-only kinds", vec![
                preview("gallery-preview-image", FilePreviewKind::Image { image, dimensions: Some((1280, 720)), alt: "Aurora".into(), focus_handle: None, on_open_lightbox: None }),
                preview("gallery-preview-markdown", FilePreviewKind::Markdown(super::chat_markdown::MarkdownDocument::parse("# Rendered Markdown\n\nReusable `ChatMarkdown` body."))),
                preview("gallery-preview-html", FilePreviewKind::Html(NativePreviewSource::gallery_fixture(NativePreviewKind::Html))),
                preview("gallery-preview-audio", FilePreviewKind::Audio(NativePreviewSource::gallery_fixture(NativePreviewKind::Audio))),
                preview("gallery-preview-video", FilePreviewKind::Video { source: NativePreviewSource::gallery_fixture(NativePreviewKind::Video), focus_handle: None, on_open_lightbox: None }),
                preview("gallery-preview-pdf", FilePreviewKind::Pdf(NativePreviewSource::gallery_fixture(NativePreviewKind::Pdf))),
                preview("gallery-preview-binary", FilePreviewKind::Binary(vec![BinaryFact { label: "Type".into(), value: "application/octet-stream".into() }, BinaryFact { label: "Bytes".into(), value: "24576".into() }])),
                preview("gallery-preview-text", FilePreviewKind::Text("A deterministic plain-text preview.".into())),
            ], theme).into_any_element()
        }
        GalleryPage::Chat => ChatGallerySpecimen { fixture: chat_fixture, theme }.into_any_element(),
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

// ===== PHASE 6 FILE SURFACE GALLERY FIXTURES (isolated; no product/store/transport) =====

pub fn phase6_file_editor_gallery_fixture(
    theme: Theme,
    editor: Entity<TextArea>,
    focus: FileEditorFocus,
) -> AnyElement {
    div()
        .debug_selector(|| "gallery-phase6-file-editor-stage".into())
        .w(px(560.0))
        .h(px(360.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(FileEditor {
            id: "gallery-phase6-file-editor".into(),
            theme,
            status: Some("Rust".into()),
            mode: FileEditorMode::Source,
            show_mode_control: true,
            wrap: false,
            state: FileEditorState {
                dirty: true,
                read_only: false,
                saving: false,
                error: None,
            },
            editor,
            rendered: None,
            focus,
            on_mode_change: Some(Rc::new(|_, _, _| {})),
            on_wrap_change: Some(Rc::new(|_, _, _| {})),
            on_save: Some(Rc::new(|_, _| {})),
            on_revert: Some(Rc::new(|_, _| {})),
        })
        .into_any_element()
}

pub fn phase6_file_diff_gallery_fixture(
    theme: Theme,
    vertical_scrollbar: Entity<ScrollbarState>,
    horizontal_scrollbar: Entity<ScrollbarState>,
    list_state: FileDiffListState,
    preview_list_state: FileDiffListState,
    preview_scrollbar: Entity<ScrollbarState>,
    focus: FileDiffFocus,
) -> AnyElement {
    let lines = vec![
        FileDiffLine {
            id: "gallery-diff-0".into(),
            kind: FileDiffLineKind::Context,
            old_line: Some(18),
            new_line: Some(18),
            old_text: Some("pub fn render() {".into()),
            new_text: Some("pub fn render() {".into()),
        },
        FileDiffLine {
            id: "gallery-diff-1".into(),
            kind: FileDiffLineKind::Removed,
            old_line: Some(19),
            new_line: None,
            old_text: Some("    old_surface();".into()),
            new_text: None,
        },
        FileDiffLine {
            id: "gallery-diff-2".into(),
            kind: FileDiffLineKind::Added,
            old_line: None,
            new_line: Some(19),
            old_text: None,
            new_text: Some("    reusable_surface();".into()),
        },
        FileDiffLine {
            id: "gallery-diff-3".into(),
            kind: FileDiffLineKind::Context,
            old_line: Some(20),
            new_line: Some(20),
            old_text: Some("}".into()),
            new_text: Some("}".into()),
        },
    ];
    div()
        .debug_selector(|| "gallery-phase6-file-diff-stage".into())
        .w(px(560.0))
        .h(px(360.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(FileDiff {
            id: "gallery-phase6-file-diff".into(),
            theme,
            text: FileDiffText {
                old: "pub fn render() {\n    old_surface();\n}".into(),
                new: "pub fn render() {\n    reusable_surface();\n}".into(),
            },
            lines: Rc::new(lines),
            list_state,
            preview_lines: Rc::new(vec![
                FileDiffPreviewLine {
                    id: "preview-1".into(),
                    line: 1,
                    text: "pub fn render() {".into(),
                },
                FileDiffPreviewLine {
                    id: "preview-2".into(),
                    line: 2,
                    text: "    reusable_surface();".into(),
                },
                FileDiffPreviewLine {
                    id: "preview-3".into(),
                    line: 3,
                    text: "}".into(),
                },
            ]),
            preview_list_state,
            mode: FileDiffMode::Split,
            wrap: false,
            stats: Some(FileDiffStats {
                added: 1,
                removed: 1,
                counts_exact: true,
            }),
            content_widths: super::FileDiffContentWidths {
                preview: 240.0,
                unified: 320.0,
                split_old: 220.0,
                split_new: 220.0,
            },
            notice: None,
            scrollbar: vertical_scrollbar,
            preview_scrollbar,
            horizontal_scrollbar,
            editor: None,
            focus,
            on_mode_change: Some(Rc::new(|_, _, _| {})),
            on_wrap_change: Some(Rc::new(|_, _, _| {})),
            on_save: None,
        })
        .into_any_element()
}

// ===== END PHASE 6 FILE SURFACE GALLERY FIXTURES =====

// ===== PHASE 7 REUSABLE COMPONENT GALLERY FIXTURES =====

fn phase7_reusable_component_gallery_fixture(
    theme: Theme,
    state: &Phase7GalleryFixtureState,
) -> AnyElement {
    use super::activity_panel::{
        ActivityAgent, ActivityAgentStatus, ActivityGoal, ActivityGoalStatus, ActivityPanel,
        ActivityProcess, ActivityTask, ActivityTaskStatus,
    };
    use super::agent_trace_panel::{
        AgentTraceEntry, AgentTraceEntryStatus, AgentTraceKind, AgentTracePanel,
        AgentTracePanelStatus,
    };
    use super::terminal_panel::{
        TerminalAvailability, TerminalCell, TerminalCellStyle, TerminalColorScheme, TerminalGrid,
        TerminalInputModes, TerminalPanel, TerminalPanelLayout, TerminalRow, TerminalScrollState,
        TerminalStatus,
    };
    use super::tool_call_preview::{
        ToolCallPresentation, ToolCallPreview, ToolCallPreviewData, ToolCallStatus, ToolDiffFile,
        ToolDiffFileKind, ToolDiffLine, ToolDiffLineKind, ToolSearchSource, ToolSearchTarget,
    };
    use super::usage_panel::{UsageContext, UsageGroup, UsagePanel, UsageSnapshot};

    let activity = div()
        .debug_selector(|| "gallery-phase7-activity-stage".into())
        .w(px(340.0))
        .h(px(420.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(ActivityPanel {
            id: "gallery-phase7-activity".into(),
            theme,
            goal: Some(ActivityGoal {
                objective: "Ship the native reusable surfaces".into(),
                status: ActivityGoalStatus::Active,
            }),
            tasks: Arc::new(vec![
                ActivityTask {
                    id: "task-fixtures".into(),
                    subject: "Add deterministic Gallery fixtures".into(),
                    active_form: Some("Adding deterministic Gallery fixtures".into()),
                    status: ActivityTaskStatus::InProgress,
                },
                ActivityTask {
                    id: "task-check".into(),
                    subject: "Run the native package check".into(),
                    active_form: None,
                    status: ActivityTaskStatus::Pending,
                },
                ActivityTask {
                    id: "task-contract".into(),
                    subject: "Keep protocol truth explicit".into(),
                    active_form: None,
                    status: ActivityTaskStatus::Complete,
                },
            ]),
            agents: Arc::new(vec![
                ActivityAgent {
                    session_id: "phase7-worker".into(),
                    description: "Review the reusable panels".into(),
                    task_name: Some("Panel review".into()),
                    model_id: None,
                    status: ActivityAgentStatus::Running,
                    elapsed: Some("01:24".into()),
                    total_tokens: Some(18_420),
                    focus_handle: None,
                },
                ActivityAgent {
                    session_id: "phase7-done".into(),
                    description: "Confirm bounded fixture data".into(),
                    task_name: None,
                    model_id: None,
                    status: ActivityAgentStatus::Complete,
                    elapsed: Some("00:42".into()),
                    total_tokens: Some(4_096),
                    focus_handle: None,
                },
            ]),
            processes: Arc::new(vec![ActivityProcess {
                id: "proc_phase7_check_01".into(),
                command: "cargo check -p happy-desktop-gpui".into(),
                cwd: None,
                stop_focus_handle: None,
            }]),
            completed_open: true,
            scrollbar: state.scrollbars[0].clone(),
            completed_focus_handle: None,
            on_completed_toggle: None,
            on_agent_select: None,
            on_process_stop: None,
        })
        .into_any_element();

    let trace = div()
        .debug_selector(|| "gallery-phase7-agent-trace-stage".into())
        .w(px(560.0))
        .h(px(360.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(AgentTracePanel {
            id: "gallery-phase7-agent-trace".into(),
            theme,
            title: "Phase 7 fixture run".into(),
            status: AgentTracePanelStatus::Complete,
            entries: Arc::new(vec![
                AgentTraceEntry {
                    id: "reasoning".into(),
                    kind: AgentTraceKind::Reasoning,
                    title: "Read the component contracts".into(),
                    detail: Some("DESIGN.md · reusable GPUI surfaces".into()),
                    status: AgentTraceEntryStatus::Complete,
                    occurred_at: 45_296_000,
                    completed_at: Some(45_300_000),
                },
                AgentTraceEntry {
                    id: "tool".into(),
                    kind: AgentTraceKind::Tool,
                    title: "Rendered typed fixtures".into(),
                    detail: Some("No transport or WebKit".into()),
                    status: AgentTraceEntryStatus::Complete,
                    occurred_at: 45_301_000,
                    completed_at: Some(45_304_000),
                },
                AgentTraceEntry {
                    id: "response".into(),
                    kind: AgentTraceKind::Response,
                    title: "Native surfaces are ready".into(),
                    detail: None,
                    status: AgentTraceEntryStatus::Complete,
                    occurred_at: 45_305_000,
                    completed_at: Some(45_306_000),
                },
            ]),
            entry_count: 3,
            entry_count_exact: true,
            loading: false,
            error: None,
            scrollbar: state.scrollbars[1].clone(),
            close_focus_handle: None,
            on_close: None,
        })
        .into_any_element();

    let usage = div()
        .debug_selector(|| "gallery-phase7-usage-stage".into())
        .w(px(560.0))
        .h(px(360.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(UsagePanel {
            id: "gallery-phase7-usage".into(),
            theme,
            usage: Some(Arc::new(UsageSnapshot {
                groups: vec![
                    UsageGroup {
                        provider_id: "openai".into(),
                        model_id: "gpt-5.4".into(),
                        input_tokens: 12_480,
                        output_tokens: 3_120,
                        cache_read_tokens: 8_192,
                        cache_write_tokens: 512,
                        total_tokens: 24_304,
                        cost_usd: None,
                    },
                    UsageGroup {
                        provider_id: "anthropic".into(),
                        model_id: "claude-opus-4-6".into(),
                        input_tokens: 2_400,
                        output_tokens: 860,
                        cache_read_tokens: 0,
                        cache_write_tokens: 0,
                        total_tokens: 3_260,
                        cost_usd: None,
                    },
                ],
                total_tokens: 27_564,
                total_cost_usd: None,
                context: Some(UsageContext {
                    total_tokens: 31_220,
                    approximate: true,
                    model_id: None,
                }),
                quotas: Vec::new(),
            })),
            loading: false,
            error: None,
            compact: false,
            scrollbar: state.scrollbars[2].clone(),
        })
        .into_any_element();

    let tool_stage = |id: &'static str,
                      tool: ToolCallPreviewData,
                      vertical: Entity<ScrollbarState>,
                      horizontal: Entity<ScrollbarState>,
                      terminal: Entity<ScrollbarState>| {
        div()
            .debug_selector(move || format!("{id}-stage"))
            .w(px(560.0))
            .h(px(360.0))
            .flex_none()
            .overflow_hidden()
            .border_1()
            .border_color(theme.role(ThemeRole::Divider))
            .child(ToolCallPreview {
                id: id.into(),
                theme,
                tool: Arc::new(tool),
                vertical_scrollbar: vertical,
                horizontal_scrollbar: horizontal,
                terminal_scrollbar: terminal,
                open_terminal_focus: None,
                open_terminal_disabled: false,
                on_open_terminal: None,
            })
            .into_any_element()
    };
    let diff_tool = tool_stage(
        "gallery-phase7-tool-diff",
        ToolCallPreviewData {
            tool_name: "apply_patch".into(),
            tool_label: "Edit gallery fixture".into(),
            status: ToolCallStatus::Completed,
            presentation: ToolCallPresentation::FileDiff {
                files: vec![ToolDiffFile {
                    path: "packages/happy-desktop-gpui/src/ui/gallery.rs".into(),
                    kind: ToolDiffFileKind::Update,
                    language: Some("Rust".into()),
                    added: 2,
                    deleted: 1,
                    omitted_lines: None,
                    lines: vec![
                        ToolDiffLine {
                            kind: ToolDiffLineKind::Context,
                            old_number: Some(41),
                            new_number: Some(41),
                            text: "fn gallery_fixture() {".into(),
                        },
                        ToolDiffLine {
                            kind: ToolDiffLineKind::Delete,
                            old_number: Some(42),
                            new_number: None,
                            text: "    placeholder();".into(),
                        },
                        ToolDiffLine {
                            kind: ToolDiffLineKind::Add,
                            old_number: None,
                            new_number: Some(42),
                            text: "    render_typed_fixture();".into(),
                        },
                    ],
                }],
                omitted_files: None,
            },
            result: Some("Updated one file".into()),
            failure: None,
        },
        state.scrollbars[3].clone(),
        state.scrollbars[4].clone(),
        state.scrollbars[5].clone(),
    );
    let search_tool = tool_stage(
        "gallery-phase7-tool-search",
        ToolCallPreviewData {
            tool_name: "web_search".into(),
            tool_label: "Search component guidance".into(),
            status: ToolCallStatus::Completed,
            presentation: ToolCallPresentation::Search {
                query: "GPUI deterministic gallery fixtures".into(),
                target: ToolSearchTarget::Web,
                sources: vec![
                    ToolSearchSource {
                        title: "GPUI documentation".into(),
                        url: "https://gpui.rs/".into(),
                    },
                    ToolSearchSource {
                        title: "Happy design system".into(),
                        url: "https://happy.engineering/design".into(),
                    },
                ],
                omitted_sources: None,
            },
            result: Some("2 sources".into()),
            failure: None,
        },
        state.scrollbars[6].clone(),
        state.scrollbars[7].clone(),
        state.scrollbars[8].clone(),
    );
    let terminal_tool = tool_stage(
        "gallery-phase7-tool-terminal",
        ToolCallPreviewData {
            tool_name: "exec_command".into(),
            tool_label: "Check native package".into(),
            status: ToolCallStatus::Completed,
            presentation: ToolCallPresentation::ExecCommand {
                command: "cargo check -p happy-desktop-gpui".into(),
                output: "Checking happy-desktop-gpui v0.1.0\nFinished dev profile".into(),
                terminal_id: None,
            },
            result: Some("Process exited with code 0".into()),
            failure: None,
        },
        state.scrollbars[9].clone(),
        state.scrollbars[10].clone(),
        state.scrollbars[11].clone(),
    );

    let terminal_row = |row: u64, text: &'static str| TerminalRow {
        row,
        wrapped: false,
        cells: Rc::new(
            text.chars()
                .take(80)
                .enumerate()
                .map(|(column, character)| TerminalCell {
                    column: column as u16,
                    width: 1,
                    text: character.to_string().into(),
                    foreground: None,
                    background: None,
                    style: TerminalCellStyle::default(),
                    hyperlink: None,
                })
                .collect(),
        ),
    };
    let terminal = div()
        .debug_selector(|| "gallery-phase7-terminal-stage".into())
        .w(px(720.0))
        .h(px(360.0))
        .flex_none()
        .overflow_hidden()
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .child(TerminalPanel {
            id: "gallery-phase7-terminal".into(),
            theme,
            color_scheme: if theme == Theme::dark() {
                TerminalColorScheme::Dark
            } else {
                TerminalColorScheme::Light
            },
            layout: TerminalPanelLayout::Fill,
            status: TerminalStatus::Exited,
            availability: TerminalAvailability::Unavailable,
            notice: Some("Studio Mac is offline · final output remains readable".into()),
            exit_code: Some(0),
            grid: Some(Rc::new(TerminalGrid {
                columns: 80,
                rows: Rc::new(vec![
                    terminal_row(0, "$ cargo check -p happy-desktop-gpui"),
                    terminal_row(1, "    Checking happy-desktop-gpui v0.1.0"),
                    terminal_row(2, "    Finished dev profile in 1.42s"),
                    terminal_row(3, "[process exited with code 0]"),
                ]),
                cursor: None,
                omitted_before: None,
                input_modes: TerminalInputModes::default(),
            })),
            scroll: TerminalScrollState::default(),
            selection: None,
            hovered_link: None,
            focused: false,
            focus: state.terminal_focus.clone(),
            input_capture: state.terminal_input.clone(),
            reported_size: None,
            on_input: Rc::new(|_, _, _| {}),
            on_resize: Rc::new(|_, _, _| {}),
            on_scroll: Rc::new(|_, _, _| {}),
            on_selection: Rc::new(|_, _, _| {}),
            on_copy: Rc::new(|_, _, _| {}),
            on_open_link: None,
            on_hover_link: None,
            on_reconnect: Rc::new(|_, _| {}),
        })
        .into_any_element();

    div()
        .debug_selector(|| "gallery-phase7-reusable-components".into())
        .w_full()
        .flex()
        .flex_col()
        .gap(px(16.0))
        .child(section(
            "Phase 7 · ActivityPanel · absent model and cwd stay absent",
            vec![activity],
            theme,
        ))
        .child(section(
            "Phase 7 · AgentTracePanel · completed deterministic UTC trace",
            vec![trace],
            theme,
        ))
        .child(section(
            "Phase 7 · UsagePanel · authoritative missing cost and model",
            vec![usage],
            theme,
        ))
        .child(section(
            "Phase 7 · ToolCallPreview · typed file diff, search, terminal",
            vec![diff_tool, search_tool, terminal_tool],
            theme,
        ))
        .child(section(
            "Phase 7 · TerminalPanel · offline final grid",
            vec![terminal],
            theme,
        ))
        .into_any_element()
}

// ===== END PHASE 7 REUSABLE COMPONENT GALLERY FIXTURES =====

pub fn gallery(
    theme: Theme,
    inputs: [Entity<TextInput>; 4],
    scrollbars: [Entity<ScrollbarState>; 5],
    connectivity_scrollbars: [Entity<ScrollbarState>; 24],
    welcome_focus: [FocusHandle; 25],
    modal_states: [GalleryModalState; 5],
    command_palette: Entity<CommandPalette>,
    chat_fixture: Entity<ChatGalleryFixture>,
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
            chat_fixture,
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
        Bounds, Context, Modifiers, Render, ScrollDelta, ScrollWheelEvent, TestAppContext,
        VisualTestContext, point, size,
    };

    struct Fixture {
        inputs: [Entity<TextInput>; 4],
        scrollbars: [Entity<ScrollbarState>; 5],
        connectivity_scrollbars: [Entity<ScrollbarState>; 24],
        welcome_focus: [FocusHandle; 25],
        modal_states: [GalleryModalState; 5],
        command_palette: Entity<CommandPalette>,
        chat_fixture: Entity<ChatGalleryFixture>,
        page: GalleryPage,
        theme: Theme,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            gallery(
                self.theme,
                self.inputs.clone(),
                self.scrollbars.clone(),
                self.connectivity_scrollbars.clone(),
                self.welcome_focus.clone(),
                self.modal_states.clone(),
                self.command_palette.clone(),
                self.chat_fixture.clone(),
                self.page,
                Rc::new(|_, _, _| {}),
            )
        }
    }
    fn render_page_theme(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        page: GalleryPage,
        theme: Theme,
    ) -> &mut VisualTestContext {
        cx.update(|cx| {
            crate::fonts::register(cx);
            super::super::text_input::init(cx);
            super::super::text_area::init(cx);
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
                chat_fixture: cx.new(ChatGalleryFixture::new),
                page,
                theme,
            }
        });
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }
    fn render_page(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        page: GalleryPage,
    ) -> &mut VisualTestContext {
        render_page_theme(cx, width, height, page, Theme::light())
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
            (GalleryPage::Files, "gallery-file-browser.root"),
            (GalleryPage::Previews, "gallery-preview-image.root"),
            (GalleryPage::Chat, "gallery-chat-work-loop"),
            (GalleryPage::Theme, "gallery-content"),
        ] {
            let cx = render_page(cx, 900.0, 700.0, page);
            assert!(
                cx.debug_bounds(selector).is_some(),
                "{page:?} page wires {selector}"
            );
        }
    }

    #[gpui::test]
    fn file_browser_gallery_fixture_uses_real_inspector_geometry(cx: &mut TestAppContext) {
        assert_eq!(GalleryPage::from_id("files"), Some(GalleryPage::Files));
        let cx = render_page(cx, 900.0, 700.0, GalleryPage::Files);
        let stage = cx.debug_bounds("gallery-file-browser-stage").unwrap();
        let browser = cx.debug_bounds("gallery-file-browser.root").unwrap();
        assert_eq!(stage.size, size(px(340.0), px(360.0)));
        assert_eq!(browser.size, size(px(338.0), px(358.0)));
        assert_eq!(
            cx.debug_bounds("gallery-file-browser.scope-all")
                .unwrap()
                .size
                .height,
            px(24.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-file-browser.layout-tree")
                .unwrap()
                .size
                .height,
            px(24.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-file-browser.entry-file-browser")
                .unwrap()
                .size
                .height,
            px(28.0)
        );
        assert_eq!(
            cx.debug_bounds("gallery-file-browser.entry-more-ui")
                .unwrap()
                .size
                .height,
            px(28.0)
        );
        assert!(
            cx.debug_bounds("gallery-file-browser.entry-more-ui.path")
                .is_none()
        );
        assert!(
            cx.debug_bounds("gallery-file-browser.entry-more-ui.status")
                .is_none()
        );
    }

    #[gpui::test]
    fn preview_gallery_fixture_names_every_typed_preview(cx: &mut TestAppContext) {
        assert_eq!(
            GalleryPage::from_id("previews"),
            Some(GalleryPage::Previews)
        );
        let cx = render_page(cx, 1280.0, 800.0, GalleryPage::Previews);
        for (root, header) in [
            ("gallery-preview-image.root", "gallery-preview-image.header"),
            (
                "gallery-preview-markdown.root",
                "gallery-preview-markdown.header",
            ),
            ("gallery-preview-html.root", "gallery-preview-html.header"),
            ("gallery-preview-audio.root", "gallery-preview-audio.header"),
            ("gallery-preview-video.root", "gallery-preview-video.header"),
            ("gallery-preview-pdf.root", "gallery-preview-pdf.header"),
            (
                "gallery-preview-binary.root",
                "gallery-preview-binary.header",
            ),
            ("gallery-preview-text.root", "gallery-preview-text.header"),
        ] {
            let bounds = cx.debug_bounds(root).unwrap();
            assert_eq!(bounds.size, size(px(560.0), px(320.0)));
            assert_eq!(cx.debug_bounds(header).unwrap().size.height, px(32.0));
        }
    }

    #[gpui::test]
    fn chat_gallery_renders_reference_and_minimum_windows_in_light_and_dark_at_two_x(
        cx: &mut TestAppContext,
    ) {
        assert_eq!(GalleryPage::from_id("chat"), Some(GalleryPage::Chat));
        assert_eq!(GalleryPage::Chat.id(), "chat");
        assert_eq!(GalleryPage::Chat.label(), "Chat");
        for (width, height, theme) in [
            (1280.0, 800.0, Theme::light()),
            (1280.0, 800.0, Theme::dark()),
            (720.0, 480.0, Theme::light()),
            (720.0, 480.0, Theme::dark()),
        ] {
            let cx = render_page_theme(cx, width, height, GalleryPage::Chat, theme);
            assert_eq!(
                cx.debug_bounds("gallery-root").unwrap().size,
                size(px(width), px(height))
            );
            assert_eq!(
                cx.debug_bounds("gallery-chat-work-loop")
                    .unwrap()
                    .size
                    .width,
                px(720.0)
            );
            assert_eq!(
                cx.debug_bounds("gallery-chat-header.root")
                    .unwrap()
                    .size
                    .height,
                px(56.0)
            );
            assert_eq!(
                cx.debug_bounds("gallery-chat-tabs.root")
                    .unwrap()
                    .size
                    .height,
                px(32.0)
            );
            assert_eq!(
                cx.debug_bounds("gallery-chat-transcript-stage")
                    .unwrap()
                    .size
                    .height,
                px(1080.0)
            );
            assert!(
                cx.debug_bounds("gallery-chat-transcript.viewport")
                    .is_some()
            );
            assert!(cx.debug_bounds("gallery-composer.root").is_some());
            assert!(cx.debug_bounds("gallery-emoji-picker.root").is_some());
            assert!(cx.debug_bounds("gallery-image-lightbox.root").is_some());
            assert_eq!(
                cx.debug_bounds("gallery-image-lightbox-stage")
                    .unwrap()
                    .size,
                size(px(720.0), px(480.0))
            );
            assert!(cx.debug_bounds("gallery-ready-composer.root").is_some());
            assert!(cx.debug_bounds("gallery-stop-composer.root").is_some());
        }
    }

    struct ConstrainedChatFixture {
        fixture: Entity<ChatGalleryFixture>,
        width: f32,
        theme: Theme,
        stop: bool,
        picker: bool,
    }
    impl Render for ConstrainedChatFixture {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            ChatGalleryFixture::theme_reconcile(&self.fixture, self.theme, cx);
            let fixture = self.fixture.read(cx);
            let editor = if self.stop {
                fixture.stop_editor.clone()
            } else {
                fixture.ready_editor.clone()
            };
            let card = fixture.composer_card(
                if self.picker {
                    "constrained-picker"
                } else if self.stop {
                    "constrained-stop"
                } else {
                    "constrained-ready"
                },
                self.theme,
                editor,
                self.stop,
                !self.stop,
                self.picker,
                cx,
            );
            div()
                .debug_selector(|| "constrained-chat-content".into())
                .w(px(self.width))
                .flex()
                .flex_col()
                .child(super::super::chat_composer::ComposerFailureBanner {
                    id: "constrained-failure".into(),
                    theme: self.theme,
                    message: "Send failed; the local draft remains available.".into(),
                    retry_disabled: false,
                    on_retry: Some(fixture.record("failure-retry")),
                })
                .child(card)
        }
    }

    #[gpui::test]
    fn chat_gallery_constrained_geometry_callbacks_and_focus_are_real(cx: &mut TestAppContext) {
        cx.update(|cx| {
            crate::fonts::register(cx);
            super::super::text_area::init(cx);
            super::super::components::init(cx);
        });
        for (width, theme, stop, picker) in [
            (220.0, Theme::light(), false, false),
            (220.0, Theme::dark(), true, false),
            (560.0, Theme::light(), true, false),
            (560.0, Theme::dark(), false, false),
            (560.0, Theme::dark(), false, true),
            (116.0, Theme::light(), false, false),
        ] {
            let chat = cx.update(|cx| cx.new(ChatGalleryFixture::new));
            let view_chat = chat.clone();
            let (_, cx) = cx.add_window_view(move |_, _| ConstrainedChatFixture {
                fixture: view_chat,
                width,
                theme,
                stop,
                picker,
            });
            cx.simulate_resize(size(
                px(if width == 220.0 { 720.0 } else { 1280.0 }),
                px(if width == 220.0 { 480.0 } else { 800.0 }),
            ));
            cx.run_until_parked();
            assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
            assert_eq!(
                cx.debug_bounds("constrained-chat-content")
                    .unwrap()
                    .size
                    .width,
                px(width)
            );
            let card = if picker {
                "constrained-picker.root"
            } else if stop {
                "constrained-stop.root"
            } else {
                "constrained-ready.root"
            };
            assert_eq!(cx.debug_bounds(card).unwrap().size.width, px(width));
            let toolbar_content = if picker {
                "constrained-picker.toolbar-content"
            } else if stop {
                "constrained-stop.toolbar-content"
            } else {
                "constrained-ready.toolbar-content"
            };
            let expected_toolbar_width = 4.0
                * super::super::composer_controls::COMPACT_CONTROL_WIDTH
                + super::super::composer_controls::MODEL_EFFORT_CONTROL_WIDTH
                + super::super::composer_controls::AUDIENCE_UNAVAILABLE_WIDTH
                + super::super::composer_controls::CONTEXT_METER_WIDTH
                + 6.0 * 8.0;
            assert_eq!(
                cx.debug_bounds(toolbar_content).unwrap().size.width,
                px(expected_toolbar_width),
                "seven exported width-bearing toolbar items plus six 8px gaps"
            );
            if width == 220.0 && !stop && !picker {
                let (focus, editor_focus) = chat.read_with(cx, |fixture, app| {
                    (
                        fixture.ready_focus.clone(),
                        fixture.ready_editor.read(app).focus_handle(app),
                    )
                });
                cx.update(|window, _| editor_focus.focus(window));
                cx.simulate_keystrokes("tab");
                cx.run_until_parked();
                assert!(cx.update(|window, _| focus.attach.is_focused(window)));
                for _ in 0..6 {
                    cx.simulate_keystrokes("tab");
                    cx.run_until_parked();
                }
                assert!(cx.update(|window, _| focus.emoji.is_focused(window)));
                let viewport = cx
                    .debug_bounds("constrained-ready-toolbar-scroll.viewport")
                    .unwrap();
                let emoji = cx.debug_bounds("constrained-ready-emoji.root").unwrap();
                assert!(emoji.left() >= viewport.left() && emoji.right() <= viewport.right());
                cx.simulate_keystrokes("space");
                assert!(chat.read_with(cx, |fixture, _| {
                    fixture
                        .events()
                        .iter()
                        .any(|event| event.as_ref() == "emoji-toggle")
                }));
            }
            if width == 116.0 {
                let (editor_focus, retry) = chat.read_with(cx, |fixture, app| {
                    (
                        fixture.ready_editor.read(app).focus_handle(app),
                        fixture.attachment_failed_retry_focus.clone(),
                    )
                });
                cx.update(|window, _| editor_focus.focus(window));
                cx.simulate_keystrokes("shift-tab");
                cx.run_until_parked();
                assert!(cx.update(|window, _| retry.is_focused(window)));
                let viewport = cx
                    .debug_bounds("gallery-attachments-scroll.viewport")
                    .unwrap();
                let target = cx.debug_bounds("gallery-attachments.retry").unwrap();
                assert!(target.left() >= viewport.left() && target.right() <= viewport.right());
                cx.simulate_keystrokes("space");
                assert!(chat.read_with(cx, |fixture, _| {
                    fixture
                        .events()
                        .iter()
                        .any(|event| event.as_ref() == "attachment-retry:failed")
                }));
                continue;
            }
            if picker {
                let editor_focus = chat.read_with(cx, |fixture, app| {
                    fixture.ready_editor.read(app).focus_handle(app)
                });
                cx.update(|window, _| editor_focus.focus(window));
                assert!(cx.update(|window, _| editor_focus.is_focused(window)));
                cx.simulate_keystrokes("up down enter escape");
                for expected in [
                    "picker-previous",
                    "picker-next",
                    "picker-commit",
                    "picker-dismiss",
                ] {
                    let events = chat.read_with(cx, |fixture, _| fixture.events());
                    assert!(
                        events.iter().any(|event| event.as_ref() == expected),
                        "missing {expected}; events={events:?}"
                    );
                }
            } else {
                let submit = if stop {
                    "constrained-stop.submit"
                } else {
                    "constrained-ready.submit"
                };
                let submit_center = cx.debug_bounds(submit).unwrap().center();
                cx.simulate_click(submit_center, Modifiers::default());
                let expected = if stop { "stop" } else { "send" };
                assert!(chat.read_with(cx, |fixture, _| {
                    fixture
                        .events()
                        .iter()
                        .any(|event| event.as_ref() == expected)
                }));
                assert!(cx.update(|window, app| {
                    let fixture = chat.read(app);
                    let editor = if stop {
                        &fixture.stop_editor
                    } else {
                        &fixture.ready_editor
                    };
                    editor.read(app).focus_handle(app).is_focused(window)
                }));
            }
            let failure_center = cx
                .debug_bounds("constrained-failure.retry")
                .unwrap()
                .center();
            cx.simulate_click(failure_center, Modifiers::default());
            assert!(chat.read_with(cx, |fixture, _| {
                fixture
                    .events()
                    .iter()
                    .any(|event| event.as_ref() == "failure-retry")
            }));
        }
    }

    #[gpui::test]
    fn chat_gallery_composed_work_loop_callbacks_use_stable_fixture_state(cx: &mut TestAppContext) {
        cx.update(|cx| {
            crate::fonts::register(cx);
            super::super::text_area::init(cx);
            super::super::components::init(cx);
        });
        let chat = cx.update(|cx| cx.new(ChatGalleryFixture::new));
        let view_chat = chat.clone();
        struct WorkLoop {
            fixture: Entity<ChatGalleryFixture>,
        }
        impl Render for WorkLoop {
            fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
                ChatGalleryFixture::theme_reconcile(&self.fixture, Theme::dark(), cx);
                self.fixture.read(cx).element(Theme::dark(), cx)
            }
        }
        let (_, cx) = cx.add_window_view(move |_, _| WorkLoop { fixture: view_chat });
        cx.simulate_resize(size(px(1280.0), px(2400.0)));
        cx.run_until_parked();
        let lightbox_close_focus =
            chat.read_with(cx, |fixture, _| fixture.image_lightbox_close_focus.clone());
        assert!(cx.update(|window, _| lightbox_close_focus.is_focused(window)));
        for (selector, event) in [
            ("gallery-chat-header.action-files", "header-action:files"),
            ("gallery-chat-tabs.create", "tab-create"),
            ("gallery-composer-failure.retry", "failure-retry"),
            ("gallery-attachments.retry", "attachment-retry:failed"),
        ] {
            let bounds = cx
                .debug_bounds(selector)
                .unwrap_or_else(|| panic!("missing {selector}"));
            cx.simulate_click(bounds.center(), Modifiers::default());
            assert!(
                chat.read_with(cx, |fixture, _| fixture
                    .events()
                    .iter()
                    .any(|value| value.as_ref() == event)),
                "missing callback {event}"
            );
        }
        let emoji_center = cx
            .debug_bounds("gallery-emoji-picker.cell")
            .unwrap()
            .center();
        cx.simulate_click(emoji_center, Modifiers::default());
        assert!(chat.read_with(cx, |fixture, _| {
            fixture
                .events()
                .iter()
                .any(|value| value.as_ref().starts_with("emoji-select:"))
        }));
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
