use gpui::{
    AnyElement, App, Entity, FocusHandle, FontWeight, Hsla, IntoElement, ObjectFit, RenderOnce,
    SharedString, Window, div, img, linear_color_stop, linear_gradient, prelude::*, px, relative,
};

use std::{
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
};

use super::theme_roles::ThemeRole;
use super::{
    ActivateHandler, Badge, BadgeVariant, Button, ButtonVariant, ControlSize, Icon, IconName,
    ScrollSurface, ScrollbarState, TextField, TextInput,
};
use crate::{
    connectivity::{
        OnboardingProviderId, ProviderAuthenticationState, ProviderCredentialStatus,
        ProviderOnboardingRow,
    },
    fonts,
    theme::Theme,
};

fn part(id: SharedString, name: &'static str) -> impl Fn() -> String {
    move || format!("{id}.{name}")
}

fn onboarding_surface(
    id: SharedString,
    theme: Theme,
    scrollbar: Entity<ScrollbarState>,
    viewport_height: gpui::Pixels,
    body: AnyElement,
) -> AnyElement {
    let scroll_id: SharedString = format!("{id}-scroll").into();
    div()
        .id(id.clone())
        .debug_selector(part(id.clone(), "root"))
        .size_full()
        .bg(theme.role(ThemeRole::Surface))
        .child(ScrollSurface {
            id: scroll_id,
            theme,
            width: None,
            height: None,
            vertical: Some(scrollbar),
            horizontal: None,
            content: div()
                .debug_selector(part(id, "content"))
                .w_full()
                .min_h(viewport_height)
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .p(px(24.0))
                .child(body)
                .into_any_element(),
        })
        .into_any_element()
}

/// Progress reported while Happy Agent is being installed or started.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InstallProgressState {
    Indeterminate,
    Determinate { fraction: f32 },
}

impl InstallProgressState {
    fn fraction(self) -> f32 {
        match self {
            Self::Indeterminate => 0.32,
            Self::Determinate { fraction } => fraction.clamp(0.0, 1.0),
        }
    }
}

/// A quiet, reusable progress treatment. Indeterminate progress is deliberately
/// static so fixtures and startup rendering do not depend on a timer or effect.
#[derive(IntoElement)]
pub struct InstallProgress {
    pub id: SharedString,
    pub theme: Theme,
    pub state: InstallProgressState,
    pub label: SharedString,
}

impl RenderOnce for InstallProgress {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let fraction = self.state.fraction();
        div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "root"))
            .w_full()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .child(
                div()
                    .debug_selector(part(id.clone(), "label"))
                    .h(px(16.0))
                    .font_family(fonts::UI_FAMILY)
                    .text_size(px(12.0))
                    .line_height(px(16.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child(self.label),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "track"))
                    .w_full()
                    .h(px(8.0))
                    .flex_none()
                    .flex()
                    .overflow_hidden()
                    .rounded_full()
                    .bg(self.theme.role(ThemeRole::SurfaceHigh))
                    .child(
                        div()
                            .debug_selector(part(id, "fill"))
                            .h_full()
                            .w(relative(fraction))
                            .rounded_full()
                            .bg(self.theme.role(ThemeRole::StatusConnecting)),
                    ),
            )
    }
}

/// Every full-window state allowed before the first successful local-host mount.
#[derive(Clone, Debug, PartialEq)]
pub enum StartupSurfaceState {
    Checking {
        detail: SharedString,
    },
    AgentMissing {
        detail: SharedString,
        installable: bool,
    },
    ManagedUnavailable {
        detail: SharedString,
    },
    Starting {
        detail: SharedString,
        progress: InstallProgressState,
    },
    Connecting {
        detail: SharedString,
    },
    ProvidersMissing {
        detail: SharedString,
    },
    ProfileRequired {
        detail: SharedString,
    },
    FirstProject {
        detail: SharedString,
    },
    CompletionRequired {
        detail: SharedString,
    },
    Failed {
        message: SharedString,
    },
    Retrying {
        message: SharedString,
    },
}

struct StartupPresentation {
    icon: IconName,
    title: &'static str,
    detail: SharedString,
    progress: Option<InstallProgressState>,
    action: Option<&'static str>,
    tone: ThemeRole,
}

impl StartupSurfaceState {
    fn presentation(&self) -> StartupPresentation {
        match self {
            Self::Checking { detail } => StartupPresentation {
                icon: IconName::Search,
                title: "Checking Happy Agent",
                detail: detail.clone(),
                progress: Some(InstallProgressState::Indeterminate),
                action: None,
                tone: ThemeRole::StatusConnecting,
            },
            Self::AgentMissing {
                detail,
                installable,
            } => StartupPresentation {
                icon: IconName::Package,
                title: "Happy Agent is not installed",
                detail: detail.clone(),
                progress: None,
                action: installable.then_some("Install Happy Agent"),
                tone: ThemeRole::Warning,
            },
            Self::ManagedUnavailable { detail } => StartupPresentation {
                icon: IconName::Link,
                title: "Managed Happy Agent unavailable",
                detail: detail.clone(),
                progress: None,
                action: None,
                tone: ThemeRole::StatusDisconnected,
            },
            Self::Starting { detail, progress } => StartupPresentation {
                icon: IconName::Play,
                title: "Starting Happy Agent",
                detail: detail.clone(),
                progress: Some(*progress),
                action: None,
                tone: ThemeRole::StatusConnecting,
            },
            Self::Connecting { detail } => StartupPresentation {
                icon: IconName::Link,
                title: "Connecting to Happy Agent",
                detail: detail.clone(),
                progress: Some(InstallProgressState::Indeterminate),
                action: None,
                tone: ThemeRole::StatusConnecting,
            },
            Self::ProvidersMissing { detail } => StartupPresentation {
                icon: IconName::Plugin,
                title: "Choose an AI provider",
                detail: detail.clone(),
                progress: None,
                action: Some("Check again"),
                tone: ThemeRole::Warning,
            },
            Self::ProfileRequired { detail } => StartupPresentation {
                icon: IconName::Users,
                title: "Complete your profile",
                detail: detail.clone(),
                progress: None,
                action: Some("Continue"),
                tone: ThemeRole::StatusDefault,
            },
            Self::FirstProject { detail } => StartupPresentation {
                icon: IconName::Files,
                title: "Open your first project",
                detail: detail.clone(),
                progress: None,
                action: Some("Choose a folder"),
                tone: ThemeRole::StatusDefault,
            },
            Self::CompletionRequired { detail } => StartupPresentation {
                icon: IconName::Check,
                title: "Finish setup",
                detail: detail.clone(),
                progress: None,
                action: Some("Finish setup"),
                tone: ThemeRole::StatusDefault,
            },
            Self::Failed { message } => StartupPresentation {
                icon: IconName::Alert,
                title: "Happy could not start",
                detail: message.clone(),
                progress: None,
                action: Some("Try again"),
                tone: ThemeRole::StatusError,
            },
            Self::Retrying { message } => StartupPresentation {
                icon: IconName::History,
                title: "Trying again",
                detail: message.clone(),
                progress: Some(InstallProgressState::Indeterminate),
                action: None,
                tone: ThemeRole::StatusConnecting,
            },
        }
    }
}

/// The only connection-related full-window surface. Product code selects an
/// explicit state and supplies the action; this component owns no transport.
#[derive(IntoElement)]
pub struct StartupSurface {
    pub id: SharedString,
    pub theme: Theme,
    pub scrollbar: Entity<ScrollbarState>,
    pub state: StartupSurfaceState,
    pub on_action: Option<ActivateHandler>,
}

impl RenderOnce for StartupSurface {
    fn render(self, window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let presentation = self.state.presentation();
        let progress: Option<AnyElement> = presentation.progress.map(|state| {
            div()
                .debug_selector(part(id.clone(), "progress-slot"))
                .w(px(400.0))
                .child(InstallProgress {
                    id: format!("{id}-progress").into(),
                    theme: self.theme,
                    state,
                    label: match state {
                        InstallProgressState::Indeterminate => "Working…".into(),
                        InstallProgressState::Determinate { fraction } => {
                            format!("{}% complete", (fraction.clamp(0.0, 1.0) * 100.0).round())
                                .into()
                        }
                    },
                })
                .into_any_element()
        });
        let action: Option<AnyElement> = presentation.action.map(|label| {
            div()
                .debug_selector(part(id.clone(), "action-slot"))
                .w(px(240.0))
                .flex()
                .justify_center()
                .child(Button {
                    id: format!("{id}-action").into(),
                    theme: self.theme,
                    label: label.into(),
                    size: ControlSize::Large,
                    variant: ButtonVariant::Primary,
                    icon: Some(IconName::ArrowRight),
                    icon_only: false,
                    disabled: self.on_action.is_none(),
                    force_focused: false,
                    focus_handle: None,
                    on_activate: self.on_action.clone(),
                })
                .into_any_element()
        });

        let body = div()
            .debug_selector(part(id.clone(), "body"))
            .w(px(560.0))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(24.0))
            .p(px(40.0))
            .font_family(fonts::UI_FAMILY)
            .child(
                div()
                    .debug_selector(part(id.clone(), "icon-slot"))
                    .size(px(120.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(Icon::decorative(
                        presentation.icon,
                        48.0,
                        self.theme.role(presentation.tone).into(),
                        format!("{id}.icon"),
                    )),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "title"))
                    .w_full()
                    .text_center()
                    .text_size(px(32.0))
                    .line_height(px(40.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(self.theme.role(ThemeRole::Text))
                    .child(presentation.title),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "detail"))
                    .w(px(400.0))
                    .text_center()
                    .text_size(px(16.0))
                    .line_height(px(24.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child(presentation.detail),
            )
            .children(progress)
            .children(action)
            .into_any_element();
        onboarding_surface(
            id,
            self.theme,
            self.scrollbar,
            window.viewport_size().height,
            body,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WelcomeSlide {
    pub title: &'static str,
    pub copy: &'static str,
    pub asset: &'static str,
    pub logo: bool,
}

pub const WELCOME_SLIDES: [WelcomeSlide; 5] = [
    WelcomeSlide {
        title: "Any team. Any model. One harness.",
        copy: "Happy integrates models, teams, and compute into one secure, open-source harness—accessible from terminal, desktop, and mobile, deployable anywhere, and adaptable to your team.",
        asset: "logo-white.png",
        logo: true,
    },
    WelcomeSlide {
        title: "Natively multiplayer",
        copy: "Bring your team into one session with every agent. Anyone can share context, steer the conversation, approve decisions, and take over in real time.",
        asset: "scene-multiplayer.png",
        logo: false,
    },
    WelcomeSlide {
        title: "One harness. Every agent.",
        copy: "Let Claude plan, Codex build, and Grok review—or run them side by side and compare. The context stays together across every handoff.",
        asset: "scene-models.png",
        logo: false,
    },
    WelcomeSlide {
        title: "Yours to run. Yours to change.",
        copy: "Happy is open source and built to be changed. Run it on your hardware, in your cloud, or in ours—then change Happy to fit your team’s needs.",
        asset: "scene-adaptable.png",
        logo: false,
    },
    WelcomeSlide {
        title: "Secure and compliant",
        copy: "No telemetry. No third-party servers by default. Run Happy safely inside corporate networks without leaking data. Every connection between agents, teammates, and mobile clients is end-to-end encrypted.",
        asset: "scene-security.png",
        logo: false,
    },
];

pub type WelcomeSelectHandler = Rc<dyn Fn(usize, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct WelcomeDeck {
    pub id: SharedString,
    pub theme: Theme,
    pub scrollbar: Entity<ScrollbarState>,
    pub slide: usize,
    pub error: Option<SharedString>,
    pub dot_focus: [FocusHandle; 5],
    pub dark: bool,
    pub appearance_icon: IconName,
    pub on_select: WelcomeSelectHandler,
    pub on_action: ActivateHandler,
    pub on_appearance: ActivateHandler,
}

fn welcome_asset_path(name: &str) -> Arc<Path> {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|executable| executable.parent().map(Path::to_path_buf))
        .map(|macos| macos.join("../Resources/welcome").join(name));
    let path = bundled.filter(|path| path.is_file()).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("assets/welcome")
            .join(name)
    });
    Arc::from(path.into_boxed_path())
}

impl RenderOnce for WelcomeDeck {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let index = self.slide.min(WELCOME_SLIDES.len() - 1);
        let slide = WELCOME_SLIDES[index];
        let white: Hsla = self.theme.role(ThemeRole::ButtonPrimaryTint).into();
        let mut scrim: Hsla = self.theme.role(ThemeRole::OverlayPanel).into();
        scrim.a = 0.68;
        let mut clear = scrim;
        clear.a = 0.0;
        let mut inactive_dot = white;
        inactive_dot.a = 0.44;
        let dots = (0..WELCOME_SLIDES.len()).map(|candidate| {
            let dot_id: SharedString = format!("{id}-dot-{candidate}").into();
            let dot_selector_id = id.clone();
            let focus = self.dot_focus[candidate].clone();
            let click_focus = focus.clone();
            let click = self.on_select.clone();
            let keyboard = self.on_select.clone();
            let focuses = self.dot_focus.clone();
            let active = candidate == index;
            div()
                .id(dot_id)
                .debug_selector(move || format!("{dot_selector_id}.dot-{candidate}"))
                .relative()
                .w(px(28.0))
                .h(px(20.0))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .track_focus(&focus.tab_index(0).tab_stop(active))
                .on_click(move |_, window, cx| {
                    click_focus.focus(window);
                    click(candidate, window, cx);
                })
                .on_key_down(move |event, window, cx| {
                    if event.is_held {
                        return;
                    }
                    let target = match event.keystroke.key.as_str() {
                        "left" => {
                            Some((candidate + WELCOME_SLIDES.len() - 1) % WELCOME_SLIDES.len())
                        }
                        "right" => Some((candidate + 1) % WELCOME_SLIDES.len()),
                        "enter" | "space" => Some(candidate),
                        _ => None,
                    };
                    if let Some(target) = target {
                        cx.stop_propagation();
                        focuses[target].focus(window);
                        keyboard(target, window, cx);
                    }
                })
                .child(
                    div()
                        .absolute()
                        .top(px(-2.0))
                        .right(px(-2.0))
                        .bottom(px(-2.0))
                        .left(px(-2.0))
                        .rounded_full()
                        .border_2()
                        .border_color(white)
                        .opacity(0.0)
                        .in_focus(|style| style.opacity(1.0)),
                )
                .child(
                    div()
                        .debug_selector(part(id.clone(), "dot-mark"))
                        .w(px(if active { 20.0 } else { 6.0 }))
                        .h(px(6.0))
                        .rounded_full()
                        .bg(if active { white } else { inactive_dot }),
                )
        });
        let deck = div()
            .debug_selector(part(id.clone(), "deck"))
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(32.0))
            .font_family(fonts::UI_FAMILY)
            .child(
                div()
                    .debug_selector(part(id.clone(), "art"))
                    .size(px(160.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        img(welcome_asset_path(slide.asset))
                            .size(px(if slide.logo { 120.0 } else { 160.0 }))
                            .object_fit(ObjectFit::Contain),
                    ),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "panel"))
                    .w_full()
                    .h(px(216.0))
                    .flex_none()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_start()
                    .gap(px(12.0))
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "title"))
                            .w_full()
                            .text_center()
                            .text_size(px(32.0))
                            .line_height(px(40.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(white)
                            .child(slide.title),
                    )
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "copy"))
                            .w(px(400.0))
                            .text_center()
                            .text_size(px(16.0))
                            .line_height(px(24.0))
                            .text_color(white)
                            .child(slide.copy),
                    ),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "dots"))
                    .h(px(20.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .children(dots),
            );
        let error = self.error.map(|message| {
            div()
                .debug_selector(part(id.clone(), "error"))
                .w(px(400.0))
                .text_center()
                .text_size(px(12.0))
                .line_height(px(16.0))
                .text_color(self.theme.role(ThemeRole::StatusError))
                .child(message)
        });
        let body = div()
            .debug_selector(part(id.clone(), "body"))
            .w_full()
            .min_h_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(40.0))
            .px(px(40.0))
            .py(px(32.0))
            .child(deck)
            .child(
                div()
                    .debug_selector(part(id.clone(), "action-slot"))
                    .min_w(px(240.0))
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(8.0))
                    .child(Button {
                        id: format!("{id}-action").into(),
                        theme: self.theme,
                        label: "Go Happy".into(),
                        size: ControlSize::Large,
                        variant: ButtonVariant::Inverse,
                        icon: None,
                        icon_only: false,
                        disabled: false,
                        force_focused: false,
                        focus_handle: None,
                        on_activate: Some(self.on_action),
                    })
                    .children(error),
            );
        let scroll_id: SharedString = format!("{id}-scroll").into();
        div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "root"))
            .size_full()
            .relative()
            .overflow_hidden()
            .bg(self.theme.role(ThemeRole::Surface))
            .child(
                img(welcome_asset_path(if self.dark {
                    "welcome-sky-dark.jpg"
                } else {
                    "welcome-sky.jpg"
                }))
                .absolute()
                .size_full()
                .object_fit(ObjectFit::Cover),
            )
            .child(
                div().absolute().size_full().flex().justify_center().child(
                    div()
                        .w(px(880.0))
                        .h_full()
                        .flex()
                        .child(div().w(px(160.0)).h_full().bg(linear_gradient(
                            90.0,
                            linear_color_stop(clear, 0.0),
                            linear_color_stop(scrim, 1.0),
                        )))
                        .child(div().w(px(560.0)).h_full().bg(scrim))
                        .child(div().w(px(160.0)).h_full().bg(linear_gradient(
                            90.0,
                            linear_color_stop(scrim, 0.0),
                            linear_color_stop(clear, 1.0),
                        ))),
                ),
            )
            .child(ScrollSurface {
                id: scroll_id,
                theme: self.theme,
                width: None,
                height: None,
                vertical: Some(self.scrollbar),
                horizontal: None,
                content: body.into_any_element(),
            })
            .child(
                div()
                    .debug_selector(part(id.clone(), "appearance"))
                    .absolute()
                    .right(px(24.0))
                    .bottom(px(24.0))
                    .child(Button {
                        id: format!("{id}-appearance").into(),
                        theme: self.theme,
                        label: "Cycle appearance".into(),
                        size: ControlSize::Small,
                        variant: ButtonVariant::Inverse,
                        icon: Some(self.appearance_icon),
                        icon_only: true,
                        disabled: false,
                        force_focused: false,
                        focus_handle: None,
                        on_activate: Some(self.on_appearance),
                    }),
            )
    }
}

/// Native provider discovery and authentication results from Happy Agent plus the resolved PATH.
#[derive(IntoElement)]
pub struct ProviderOnboardingSurface {
    pub id: SharedString,
    pub theme: Theme,
    pub scrollbar: Entity<ScrollbarState>,
    pub rows: Vec<ProviderOnboardingRow>,
    pub busy: bool,
    pub continue_available: bool,
    pub error: Option<SharedString>,
    pub on_scan: Option<ActivateHandler>,
    pub on_continue: Option<ActivateHandler>,
}

impl RenderOnce for ProviderOnboardingSurface {
    fn render(self, window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let row_for = |provider: OnboardingProviderId| {
            self.rows.iter().find(|row| row.id == provider).cloned()
        };
        let rows = OnboardingProviderId::ALL.into_iter().map(|provider| {
            let row_selector_id = id.clone();
            let path_selector_id = id.clone();
            let row = row_for(provider);
            let label = match provider {
                OnboardingProviderId::Claude => "Claude",
                OnboardingProviderId::Codex => "Codex",
                OnboardingProviderId::Grok => "Grok",
            };
            let (status, variant) = match row.as_ref().and_then(|row| row.authentication) {
                Some(ProviderAuthenticationState::Valid) => {
                    ("Authenticated", BadgeVariant::Success)
                }
                Some(ProviderAuthenticationState::Invalid) => {
                    ("Sign in required", BadgeVariant::Danger)
                }
                Some(ProviderAuthenticationState::Error) => ("Check failed", BadgeVariant::Danger),
                None if self.busy && row.as_ref().is_some_and(|row| row.command_path.is_some()) => {
                    ("Checking…", BadgeVariant::Info)
                }
                None => match row
                    .as_ref()
                    .and_then(|row| row.scan.as_ref())
                    .map(|scan| scan.credentials)
                {
                    Some(ProviderCredentialStatus::Available) => {
                        ("Credentials found", BadgeVariant::Info)
                    }
                    Some(ProviderCredentialStatus::Error) => {
                        ("Credential error", BadgeVariant::Danger)
                    }
                    Some(ProviderCredentialStatus::Missing) => {
                        ("Credentials missing", BadgeVariant::Warning)
                    }
                    None => ("Not checked", BadgeVariant::Neutral),
                },
            };
            let path: SharedString = row
                .as_ref()
                .and_then(|row| row.command_path.as_ref())
                .map(|path| path.display().to_string().into())
                .unwrap_or_else(|| "Command not found on the login PATH".into());
            div()
                .debug_selector(move || format!("{row_selector_id}.provider-{}", provider.as_str()))
                .w(px(400.0))
                .min_h(px(56.0))
                .flex()
                .flex_col()
                .justify_center()
                .gap(px(4.0))
                .px(px(12.0))
                .border_1()
                .border_color(self.theme.role(ThemeRole::Divider))
                .rounded(px(8.0))
                .child(
                    div()
                        .w_full()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(self.theme.role(ThemeRole::Text))
                                .child(label),
                        )
                        .child(Badge {
                            id: format!("{id}-{}-status", provider.as_str()).into(),
                            theme: self.theme,
                            label: status.into(),
                            variant,
                        }),
                )
                .child(
                    div()
                        .debug_selector(move || {
                            format!("{path_selector_id}.provider-{}.path", provider.as_str())
                        })
                        .w_full()
                        .overflow_hidden()
                        .font_family(fonts::MONO_FAMILY)
                        .text_size(px(11.0))
                        .line_height(px(16.0))
                        .text_color(self.theme.role(ThemeRole::TextSecondary))
                        .child(path),
                )
        });
        let action = if self.continue_available {
            self.on_continue
        } else {
            self.on_scan
        };
        let body = div()
            .debug_selector(part(id.clone(), "body"))
            .w(px(560.0))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(16.0))
            .p(px(40.0))
            .font_family(fonts::UI_FAMILY)
            .child(
                div()
                    .debug_selector(part(id.clone(), "icon-slot"))
                    .size(px(80.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(Icon::decorative(
                        IconName::Agents,
                        44.0,
                        self.theme.role(ThemeRole::StatusDefault).into(),
                        format!("{id}.icon"),
                    )),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "title"))
                    .w_full()
                    .text_center()
                    .text_size(px(32.0))
                    .line_height(px(40.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(self.theme.role(ThemeRole::Text))
                    .child("Connect an AI provider"),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "detail"))
                    .w(px(400.0))
                    .text_center()
                    .text_size(px(14.0))
                    .line_height(px(20.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child("Happy checks the commands found by your login shell and asks Happy Agent to verify their authentication."),
            )
            .children(rows)
            .children(self.error.map(|error| {
                div()
                    .debug_selector(part(id.clone(), "error"))
                    .w(px(400.0))
                    .text_center()
                    .text_size(px(12.0))
                    .line_height(px(16.0))
                    .text_color(self.theme.role(ThemeRole::StatusError))
                    .child(error)
            }))
            .child(
                div()
                    .debug_selector(part(id.clone(), "action-slot"))
                    .w(px(240.0))
                    .child(Button {
                        id: format!("{id}-action").into(),
                        theme: self.theme,
                        label: if self.continue_available {
                            "Continue"
                        } else if self.busy {
                            "Checking providers…"
                        } else {
                            "Check again"
                        }
                        .into(),
                        size: ControlSize::Large,
                        variant: ButtonVariant::Primary,
                        icon: Some(IconName::ArrowRight),
                        icon_only: false,
                        disabled: self.busy || action.is_none(),
                        force_focused: false,
                        focus_handle: None,
                        on_activate: action,
                    }),
            )
            .into_any_element();
        onboarding_surface(
            id,
            self.theme,
            self.scrollbar,
            window.viewport_size().height,
            body,
        )
    }
}

/// Profile step backed by the same native text-input entities used by product fields.
#[derive(IntoElement)]
pub struct ProfileOnboardingSurface {
    pub id: SharedString,
    pub theme: Theme,
    pub scrollbar: Entity<ScrollbarState>,
    pub name: Entity<TextInput>,
    pub email: Entity<TextInput>,
    pub error: Option<SharedString>,
    pub busy: bool,
    pub on_submit: Option<ActivateHandler>,
}

impl RenderOnce for ProfileOnboardingSurface {
    fn render(self, window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let valid = !self.name.read(_cx).value().trim().is_empty()
            && !self.email.read(_cx).value().trim().is_empty();
        let body = div()
            .debug_selector(part(id.clone(), "body"))
            .w(px(560.0))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(16.0))
            .p(px(40.0))
            .font_family(fonts::UI_FAMILY)
            .child(
                div()
                    .debug_selector(part(id.clone(), "icon-slot"))
                    .size(px(120.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(Icon::decorative(
                        IconName::Users,
                        48.0,
                        self.theme.role(ThemeRole::StatusDefault).into(),
                        format!("{id}.icon"),
                    )),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "title"))
                    .w_full()
                    .text_center()
                    .text_size(px(32.0))
                    .line_height(px(40.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(self.theme.role(ThemeRole::Text))
                    .child("Complete your profile"),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "fields"))
                    .w(px(400.0))
                    .flex()
                    .gap(px(12.0))
                    .child(TextField {
                        id: format!("{id}-name").into(),
                        theme: self.theme,
                        label: Some("Name".into()),
                        input: self.name,
                        size: ControlSize::Medium,
                        width: Some(194.0),
                        icon: None,
                        hint: None,
                        invalid: false,
                        force_focused: false,
                    })
                    .child(TextField {
                        id: format!("{id}-email").into(),
                        theme: self.theme,
                        label: Some("Git email".into()),
                        input: self.email,
                        size: ControlSize::Medium,
                        width: Some(194.0),
                        icon: None,
                        hint: None,
                        invalid: false,
                        force_focused: false,
                    }),
            )
            .children(self.error.map(|error| {
                div()
                    .debug_selector(part(id.clone(), "error"))
                    .w(px(400.0))
                    .text_center()
                    .text_size(px(12.0))
                    .line_height(px(16.0))
                    .text_color(self.theme.role(ThemeRole::StatusError))
                    .child(error)
            }))
            .child(
                div()
                    .debug_selector(part(id.clone(), "action-slot"))
                    .w(px(240.0))
                    .flex()
                    .justify_center()
                    .child(Button {
                        id: format!("{id}-action").into(),
                        theme: self.theme,
                        label: if self.busy {
                            "Creating profile…"
                        } else {
                            "Create profile"
                        }
                        .into(),
                        size: ControlSize::Large,
                        variant: ButtonVariant::Primary,
                        icon: Some(IconName::ArrowRight),
                        icon_only: false,
                        disabled: self.busy || !valid || self.on_submit.is_none(),
                        force_focused: false,
                        focus_handle: None,
                        on_activate: self.on_submit,
                    }),
            )
            .into_any_element();
        onboarding_surface(
            id,
            self.theme,
            self.scrollbar,
            window.viewport_size().height,
            body,
        )
    }
}

/// An in-place, Happy-Agent-local availability state shown after app startup.
#[derive(Clone, Debug, PartialEq)]
pub enum ConnectionNoticeState {
    Connecting,
    Reconnecting {
        attempt: u32,
        reason: Option<SharedString>,
    },
    Offline {
        reason: SharedString,
    },
    Error {
        message: SharedString,
    },
    Restricted {
        reason: SharedString,
    },
}

#[derive(IntoElement)]
pub struct ConnectionNotice {
    pub id: SharedString,
    pub theme: Theme,
    pub agent_name: SharedString,
    pub state: ConnectionNoticeState,
    pub on_action: Option<ActivateHandler>,
}

impl RenderOnce for ConnectionNotice {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let (icon, title, detail, tone, action): (_, SharedString, SharedString, _, _) =
            match self.state {
                ConnectionNoticeState::Connecting => (
                    IconName::Link,
                    format!("Connecting to {}", self.agent_name).into(),
                    "Live actions will resume when the connection is ready.".into(),
                    ThemeRole::StatusConnecting,
                    None,
                ),
                ConnectionNoticeState::Reconnecting { attempt, reason } => (
                    IconName::History,
                    format!("Reconnecting to {}", self.agent_name).into(),
                    reason.unwrap_or_else(|| {
                        format!("Attempt {attempt}. Your open work stays in place.").into()
                    }),
                    ThemeRole::StatusConnecting,
                    None,
                ),
                ConnectionNoticeState::Offline { reason } => (
                    IconName::Unlink,
                    format!("{} is offline", self.agent_name).into(),
                    reason,
                    ThemeRole::StatusDisconnected,
                    Some("Try again"),
                ),
                ConnectionNoticeState::Error { message } => (
                    IconName::Alert,
                    format!("{} has a connection error", self.agent_name).into(),
                    message,
                    ThemeRole::StatusError,
                    Some("Try again"),
                ),
                ConnectionNoticeState::Restricted { reason } => (
                    IconName::Lock,
                    format!("{} is restricted", self.agent_name).into(),
                    reason,
                    ThemeRole::Warning,
                    None,
                ),
            };
        let action: Option<AnyElement> = action.map(|label| {
            Button {
                id: format!("{id}-action").into(),
                theme: self.theme,
                label: label.into(),
                size: ControlSize::Small,
                variant: ButtonVariant::Secondary,
                icon: None,
                icon_only: false,
                disabled: self.on_action.is_none(),
                force_focused: false,
                focus_handle: None,
                on_activate: self.on_action.clone(),
            }
            .into_any_element()
        });
        div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "root"))
            .w_full()
            .min_h(px(64.0))
            .flex()
            .items_center()
            .gap(px(12.0))
            .p(px(12.0))
            .border_1()
            .border_color(self.theme.role(tone))
            .rounded(px(8.0))
            .bg(self.theme.role(ThemeRole::SurfaceHigh))
            .child(
                div()
                    .debug_selector(part(id.clone(), "icon-slot"))
                    .size(px(32.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(Icon::decorative(
                        icon,
                        20.0,
                        self.theme.role(tone).into(),
                        format!("{id}.icon"),
                    )),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "copy"))
                    .min_w(px(0.0))
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .font_family(fonts::UI_FAMILY)
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "title"))
                            .text_size(px(13.0))
                            .line_height(px(16.0))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(self.theme.role(ThemeRole::Text))
                            .child(title),
                    )
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "detail"))
                            .text_size(px(12.0))
                            .line_height(px(16.0))
                            .text_color(self.theme.role(ThemeRole::TextSecondary))
                            .child(detail),
                    ),
            )
            .children(action)
    }
}

#[cfg(test)]
mod geometry_tests {
    use super::*;
    use gpui::{
        AnyElement, App, Bounds, Context, IntoElement, Modifiers, Pixels, Render, ScrollDelta,
        ScrollWheelEvent, TestAppContext, VisualTestContext, Window, div, point, px, size,
    };
    use std::{cell::Cell, rc::Rc};

    #[derive(Clone)]
    enum FixtureKind {
        Startup(StartupSurfaceState),
        Notice(ConnectionNoticeState),
        Progress(InstallProgressState),
        Profile,
        ProfileLong,
        Provider {
            rows: Vec<ProviderOnboardingRow>,
            busy: bool,
            continue_available: bool,
            error: Option<SharedString>,
        },
        Welcome(usize),
    }

    struct Fixture {
        kind: FixtureKind,
        profile_name: Entity<TextInput>,
        profile_email: Entity<TextInput>,
        scrollbar: Entity<ScrollbarState>,
        welcome_focus: [FocusHandle; 5],
    }

    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            let theme = Theme::light();
            let child: AnyElement = match self.kind.clone() {
                FixtureKind::Startup(state) => StartupSurface {
                    id: "startup-test".into(),
                    theme,
                    scrollbar: self.scrollbar.clone(),
                    state,
                    on_action: Some(Rc::new(|_, _| {})),
                }
                .into_any_element(),
                FixtureKind::Notice(state) => ConnectionNotice {
                    id: "notice-test".into(),
                    theme,
                    agent_name: "Studio Mac".into(),
                    state,
                    on_action: Some(Rc::new(|_, _| {})),
                }
                .into_any_element(),
                FixtureKind::Progress(state) => InstallProgress {
                    id: "progress-test".into(),
                    theme,
                    state,
                    label: "Installing Happy Agent".into(),
                }
                .into_any_element(),
                FixtureKind::Provider {
                    rows,
                    busy,
                    continue_available,
                    error,
                } => ProviderOnboardingSurface {
                    id: "provider-test".into(),
                    theme,
                    scrollbar: self.scrollbar.clone(),
                    rows,
                    busy,
                    continue_available,
                    error,
                    on_scan: Some(Rc::new(|_, _| {})),
                    on_continue: Some(Rc::new(|_, _| {})),
                }
                .into_any_element(),
                FixtureKind::Welcome(slide) => WelcomeDeck {
                    id: "welcome-test".into(),
                    theme,
                    scrollbar: self.scrollbar.clone(),
                    slide,
                    error: (slide == 4).then(|| "Welcome choice could not be saved.".into()),
                    dot_focus: self.welcome_focus.clone(),
                    dark: false,
                    appearance_icon: IconName::Contrast,
                    on_select: Rc::new(|_, _, _| {}),
                    on_action: Rc::new(|_, _| {}),
                    on_appearance: Rc::new(|_, _| {}),
                }
                .into_any_element(),
                FixtureKind::Profile | FixtureKind::ProfileLong => ProfileOnboardingSurface {
                    id: "profile-test".into(),
                    theme,
                    scrollbar: self.scrollbar.clone(),
                    name: self.profile_name.clone(),
                    email: self.profile_email.clone(),
                    error: Some(if matches!(self.kind, FixtureKind::ProfileLong) {
                        "Happy Agent returned a localized profile error that wraps across many lines. The complete reason remains reachable at the minimum supported window size, including remediation details and the action below it. ".repeat(8).into()
                    } else {
                        "Use a valid Git email.".into()
                    }),
                    busy: false,
                    on_submit: Some(Rc::new(|_, _| {})),
                }
                .into_any_element(),
            };
            match self.kind {
                FixtureKind::Startup(_)
                | FixtureKind::Profile
                | FixtureKind::ProfileLong
                | FixtureKind::Provider { .. }
                | FixtureKind::Welcome(_) => div().size_full().child(child),
                FixtureKind::Notice(_) => div()
                    .size_full()
                    .flex()
                    .items_start()
                    .p(px(24.0))
                    .child(child),
                FixtureKind::Progress(_) => div()
                    .size_full()
                    .flex()
                    .items_start()
                    .p(px(24.0))
                    .child(div().w(px(480.0)).child(child)),
            }
        }
    }

    struct DotFixture {
        selected: Rc<Cell<usize>>,
        actions: Rc<Cell<usize>>,
        scrollbar: Entity<ScrollbarState>,
        focus: [FocusHandle; 5],
    }

    impl Render for DotFixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let selected = self.selected.clone();
            let actions = self.actions.clone();
            WelcomeDeck {
                id: "dot-welcome".into(),
                theme: Theme::light(),
                scrollbar: self.scrollbar.clone(),
                slide: 0,
                error: None,
                dot_focus: self.focus.clone(),
                dark: false,
                appearance_icon: IconName::Contrast,
                on_select: Rc::new(move |index, _, _| selected.set(index)),
                on_action: Rc::new(move |_, _| actions.set(actions.get() + 1)),
                on_appearance: Rc::new(|_, _| {}),
            }
        }
    }

    fn render(
        cx: &mut TestAppContext,
        kind: FixtureKind,
        width: f32,
        height: f32,
    ) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| {
            crate::fonts::register(cx);
            super::super::text_input::init(cx);
            super::super::components::init(cx);
        });
        let (_, cx) = cx.add_window_view(move |_, cx| Fixture {
            kind,
            profile_name: cx
                .new(|cx| TextInput::new("profile-test-name", "Steve", "Name", Theme::light(), cx)),
            profile_email: cx.new(|cx| {
                TextInput::new(
                    "profile-test-email",
                    "steve@example.com",
                    "Git email",
                    Theme::light(),
                    cx,
                )
            }),
            scrollbar: cx.new(|_| {
                ScrollbarState::vertical(
                    super::super::ScrollbarAppearance::Automatic,
                    super::super::ScrollbarPlacement::Overlay,
                    super::super::SharedScrollHandle::new(),
                )
            }),
            welcome_focus: std::array::from_fn(|_| cx.focus_handle()),
        });
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }

    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector)
            .unwrap_or_else(|| panic!("missing rendered geometry for {selector}"))
    }

    fn startup_states() -> Vec<(StartupSurfaceState, bool, bool)> {
        vec![
            (
                StartupSurfaceState::Checking {
                    detail: "Looking for the local service.".into(),
                },
                true,
                false,
            ),
            (
                StartupSurfaceState::AgentMissing {
                    detail: "Happy will keep looking.".into(),
                    installable: true,
                },
                false,
                true,
            ),
            (
                StartupSurfaceState::ManagedUnavailable {
                    detail: "This route is externally managed.".into(),
                },
                false,
                false,
            ),
            (
                StartupSurfaceState::Starting {
                    detail: "Preparing the local service.".into(),
                    progress: InstallProgressState::Determinate { fraction: 0.5 },
                },
                true,
                false,
            ),
            (
                StartupSurfaceState::Connecting {
                    detail: "Opening an authenticated connection.".into(),
                },
                true,
                false,
            ),
            (
                StartupSurfaceState::ProvidersMissing {
                    detail: "Select a provider before continuing.".into(),
                },
                false,
                true,
            ),
            (
                StartupSurfaceState::ProfileRequired {
                    detail: "Add the profile used for your work.".into(),
                },
                false,
                true,
            ),
            (
                StartupSurfaceState::FirstProject {
                    detail: "Choose a folder you work in.".into(),
                },
                false,
                true,
            ),
            (
                StartupSurfaceState::CompletionRequired {
                    detail: "Save the final setup state.".into(),
                },
                false,
                true,
            ),
            (
                StartupSurfaceState::Failed {
                    message: "The local service did not respond.".into(),
                },
                false,
                true,
            ),
            (
                StartupSurfaceState::Retrying {
                    message: "The next attempt is in progress.".into(),
                },
                true,
                false,
            ),
        ]
    }

    #[gpui::test]
    fn startup_surface_renders_every_typed_state_at_both_desktop_contract_sizes(
        cx: &mut TestAppContext,
    ) {
        for (state, has_progress, has_action) in startup_states() {
            for (width, height) in [(1280.0, 800.0), (720.0, 480.0)] {
                let cx = render(cx, FixtureKind::Startup(state.clone()), width, height);
                let root = bounds(cx, "startup-test.root");
                assert_eq!(root.origin.x, px(0.0));
                assert_eq!(root.origin.y, px(0.0));
                assert_eq!(root.size, size(px(width), px(height)));
                let body = bounds(cx, "startup-test.body");
                assert_eq!(body.size.width, px(560.0));
                assert_eq!(body.origin.x, px((width - 560.0) / 2.0));
                assert_eq!(body.origin.y, (px(height) - body.size.height) / 2.0);
                let icon = bounds(cx, "startup-test.icon-slot");
                assert_eq!(icon.size, size(px(120.0), px(120.0)));
                let title = bounds(cx, "startup-test.title");
                let detail = bounds(cx, "startup-test.detail");
                assert_eq!(title.origin.y - icon.bottom(), px(24.0));
                assert!(
                    matches!(title.size.height, value if value == px(40.0) || value == px(80.0))
                );
                assert_eq!(detail.origin.y - title.bottom(), px(24.0));
                assert_eq!(detail.size, size(px(400.0), px(24.0)));
                if has_progress {
                    assert_eq!(
                        bounds(cx, "startup-test.progress-slot").size.width,
                        px(400.0)
                    );
                }
                if has_action {
                    assert_eq!(bounds(cx, "startup-test.action-slot").size.width, px(240.0));
                }
                assert_eq!(
                    cx.debug_bounds("startup-test-progress.root").is_some(),
                    has_progress
                );
                assert_eq!(
                    cx.debug_bounds("startup-test-action.root").is_some(),
                    has_action
                );
            }
        }
    }

    #[gpui::test]
    fn startup_surface_long_error_uses_full_bleed_shared_scroll_at_720_by_480(
        cx: &mut TestAppContext,
    ) {
        let cx = render(
            cx,
            FixtureKind::Startup(StartupSurfaceState::Failed {
                message: "A localized Happy Agent failure can include detailed remediation without hiding the retry action. ".repeat(14).into(),
            }),
            720.0,
            480.0,
        );
        let viewport = bounds(cx, "startup-test-scroll.viewport");
        assert_eq!(viewport.origin, point(px(0.0), px(0.0)));
        assert_eq!(viewport.size, size(px(720.0), px(480.0)));
        assert_eq!(bounds(cx, "startup-test-scroll.track").size.width, px(8.0));
        let before = bounds(cx, "startup-test.body");
        assert_eq!(before.origin.y, px(24.0));
        assert!(before.bottom() > px(456.0));
        cx.simulate_event(ScrollWheelEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-1600.0))),
            modifiers: Modifiers::default(),
            ..Default::default()
        });
        assert!(bounds(cx, "startup-test.action-slot").bottom() <= px(456.0));
    }

    #[gpui::test]
    fn welcome_deck_renders_all_five_slides_at_both_desktop_contract_sizes(
        cx: &mut TestAppContext,
    ) {
        for slide in 0..WELCOME_SLIDES.len() {
            for (width, height) in [(1280.0, 800.0), (720.0, 480.0)] {
                let cx = render(cx, FixtureKind::Welcome(slide), width, height);
                assert_eq!(
                    bounds(cx, "welcome-test.root").size,
                    size(px(width), px(height))
                );
                let deck = bounds(cx, "welcome-test.deck");
                assert_eq!(deck.size.width, px(width - 80.0));
                assert!(deck.origin.y >= px(24.0), "resolved welcome deck: {deck:?}");
                if deck.bottom() > px(height - 24.0) {
                    cx.simulate_event(ScrollWheelEvent {
                        position: point(px(width / 2.0), px(height / 2.0)),
                        delta: ScrollDelta::Pixels(point(px(0.0), px(-160.0))),
                        modifiers: Modifiers::default(),
                        ..Default::default()
                    });
                    let scrolled = bounds(cx, "welcome-test.deck");
                    assert!(scrolled.origin.y < deck.origin.y);
                    assert!(scrolled.bottom() <= px(height - 24.0));
                }
                assert_eq!(
                    bounds(cx, "welcome-test.art").size,
                    size(px(160.0), px(160.0))
                );
                assert_eq!(bounds(cx, "welcome-test.copy").size.width, px(400.0));
                assert_eq!(bounds(cx, "welcome-test.dots").size.height, px(20.0));
                assert_eq!(
                    bounds(cx, "welcome-test.action-slot").size.width,
                    px(if slide == 4 { 400.0 } else { 240.0 })
                );
                let appearance = bounds(cx, "welcome-test.appearance");
                assert_eq!(px(width) - appearance.right(), px(24.0));
                assert_eq!(px(height) - appearance.bottom(), px(24.0));
            }
        }
    }

    #[gpui::test]
    fn welcome_dots_support_pointer_roving_arrows_and_primary_action(cx: &mut TestAppContext) {
        cx.update(|cx: &mut App| {
            crate::fonts::register(cx);
            super::super::components::init(cx);
        });
        let selected = Rc::new(Cell::new(usize::MAX));
        let actions = Rc::new(Cell::new(0));
        let selected_for_view = selected.clone();
        let actions_for_view = actions.clone();
        let (_, cx) = cx.add_window_view(move |_, cx| DotFixture {
            selected: selected_for_view,
            actions: actions_for_view,
            scrollbar: cx.new(|_| {
                ScrollbarState::vertical(
                    super::super::ScrollbarAppearance::Automatic,
                    super::super::ScrollbarPlacement::Overlay,
                    super::super::SharedScrollHandle::new(),
                )
            }),
            focus: std::array::from_fn(|_| cx.focus_handle()),
        });
        cx.simulate_resize(size(px(1280.0), px(800.0)));
        cx.run_until_parked();
        let fourth = cx.debug_bounds("dot-welcome.dot-3").unwrap().center();
        cx.simulate_click(fourth, Modifiers::default());
        assert_eq!(selected.get(), 3);
        cx.simulate_keystrokes("right");
        assert_eq!(selected.get(), 4);
        let action = cx.debug_bounds("dot-welcome-action.root").unwrap().center();
        cx.simulate_click(action, Modifiers::default());
        assert_eq!(actions.get(), 1);
    }

    fn provider_rows(
        states: [Option<ProviderAuthenticationState>; 3],
    ) -> Vec<ProviderOnboardingRow> {
        OnboardingProviderId::ALL
            .into_iter()
            .zip(states)
            .map(|(id, authentication)| ProviderOnboardingRow {
                id,
                command_path: Some(PathBuf::from(format!("/opt/happy/bin/{}", id.as_str()))),
                scan: None,
                authentication,
            })
            .collect()
    }

    #[gpui::test]
    fn provider_onboarding_renders_checking_results_continue_and_error_at_both_sizes(
        cx: &mut TestAppContext,
    ) {
        let states = [
            (provider_rows([None, None, None]), true, false, None),
            (
                provider_rows([
                    Some(ProviderAuthenticationState::Valid),
                    Some(ProviderAuthenticationState::Invalid),
                    Some(ProviderAuthenticationState::Error),
                ]),
                false,
                true,
                None,
            ),
            (
                Vec::new(),
                false,
                false,
                Some("Provider verification failed with a displayable route error.".into()),
            ),
        ];
        for (rows, busy, continue_available, error) in states {
            for (width, height) in [(1280.0, 800.0), (720.0, 480.0)] {
                let cx = render(
                    cx,
                    FixtureKind::Provider {
                        rows: rows.clone(),
                        busy,
                        continue_available,
                        error: error.clone(),
                    },
                    width,
                    height,
                );
                assert_eq!(
                    bounds(cx, "provider-test.root").size,
                    size(px(width), px(height))
                );
                assert_eq!(bounds(cx, "provider-test.body").size.width, px(560.0));
                for selector in [
                    "provider-test.provider-claude",
                    "provider-test.provider-codex",
                    "provider-test.provider-grok",
                ] {
                    assert_eq!(cx.debug_bounds(selector).unwrap().size.width, px(400.0));
                }
                assert_eq!(
                    bounds(cx, "provider-test.action-slot").size.width,
                    px(240.0)
                );
            }
        }
    }

    #[gpui::test]
    fn profile_onboarding_long_error_uses_full_bleed_shared_scroll_at_720_by_480(
        cx: &mut TestAppContext,
    ) {
        let cx = render(cx, FixtureKind::ProfileLong, 720.0, 480.0);
        let viewport = bounds(cx, "profile-test-scroll.viewport");
        assert_eq!(viewport.origin, point(px(0.0), px(0.0)));
        assert_eq!(viewport.size, size(px(720.0), px(480.0)));
        assert_eq!(bounds(cx, "profile-test-scroll.track").size.width, px(8.0));
        let before = bounds(cx, "profile-test.body");
        assert_eq!(before.origin.y, px(24.0));
        assert!(before.bottom() > px(456.0));
        cx.simulate_event(ScrollWheelEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(px(0.0), px(-1200.0))),
            modifiers: Modifiers::default(),
            ..Default::default()
        });
        let after = bounds(cx, "profile-test.body");
        assert!(after.origin.y < before.origin.y);
        assert!(bounds(cx, "profile-test.action-slot").bottom() <= px(456.0));
    }

    #[gpui::test]
    fn profile_onboarding_uses_native_fields_and_fits_both_desktop_contract_sizes(
        cx: &mut TestAppContext,
    ) {
        for (width, height) in [(1280.0, 800.0), (720.0, 480.0)] {
            let cx = render(cx, FixtureKind::Profile, width, height);
            assert_eq!(
                bounds(cx, "profile-test.root").size,
                size(px(width), px(height))
            );
            let body = bounds(cx, "profile-test.body");
            assert_eq!(body.size.width, px(560.0));
            assert!(body.origin.y >= px(24.0));
            assert!(body.bottom() <= px(height - 24.0));
            assert_eq!(
                bounds(cx, "profile-test.icon-slot").size,
                size(px(120.0), px(120.0))
            );
            let fields = bounds(cx, "profile-test.fields");
            assert_eq!(fields.size.width, px(400.0));
            assert_eq!(
                bounds(cx, "profile-test-name.control").size.width,
                px(194.0)
            );
            assert_eq!(
                bounds(cx, "profile-test-email.control").size.width,
                px(194.0)
            );
            assert!(bounds(cx, "profile-test.error").size.height >= px(16.0));
            assert_eq!(bounds(cx, "profile-test.action-slot").size.width, px(240.0));
        }
    }

    fn notice_states() -> Vec<ConnectionNoticeState> {
        vec![
            ConnectionNoticeState::Connecting,
            ConnectionNoticeState::Reconnecting {
                attempt: 3,
                reason: Some("The authenticated stream ended; reconnecting automatically.".into()),
            },
            ConnectionNoticeState::Offline {
                reason: "The authenticated socket is unavailable. Drafts remain local.".into(),
            },
            ConnectionNoticeState::Error {
                message: "The route closed unexpectedly.".into(),
            },
            ConnectionNoticeState::Restricted {
                reason: "This route is read-only.".into(),
            },
        ]
    }

    #[gpui::test]
    fn connection_notice_renders_every_typed_state_at_both_desktop_contract_sizes(
        cx: &mut TestAppContext,
    ) {
        for state in notice_states() {
            for (width, height) in [(1280.0, 800.0), (720.0, 480.0)] {
                let cx = render(cx, FixtureKind::Notice(state.clone()), width, height);
                let root = bounds(cx, "notice-test.root");
                assert_eq!(root.origin.x, px(24.0));
                assert_eq!(root.origin.y, px(24.0));
                assert_eq!(root.size.width, px(width - 48.0));
                assert!(root.size.height >= px(64.0));
                let icon = bounds(cx, "notice-test.icon-slot");
                assert_eq!(icon.size, size(px(32.0), px(32.0)));
                let copy = bounds(cx, "notice-test.copy");
                assert_eq!(copy.origin.x - icon.right(), px(12.0));
                assert_eq!(root.right() - copy.right() >= px(12.0), true);
            }
        }
    }

    #[gpui::test]
    fn install_progress_renders_determinate_and_indeterminate_states_at_both_sizes(
        cx: &mut TestAppContext,
    ) {
        for state in [
            InstallProgressState::Indeterminate,
            InstallProgressState::Determinate { fraction: 0.5 },
        ] {
            for (width, height) in [(1280.0, 800.0), (720.0, 480.0)] {
                let cx = render(cx, FixtureKind::Progress(state), width, height);
                let root = bounds(cx, "progress-test.root");
                assert_eq!(root.origin.x, px(24.0));
                assert_eq!(root.origin.y, px(24.0));
                assert_eq!(root.size.width, px(480.0));
                let label = bounds(cx, "progress-test.label");
                let track = bounds(cx, "progress-test.track");
                let fill = bounds(cx, "progress-test.fill");
                assert_eq!(label.size.height, px(16.0));
                assert_eq!(track.origin.y - label.bottom(), px(8.0));
                assert_eq!(track.size, size(px(480.0), px(8.0)));
                let expected = match state {
                    InstallProgressState::Indeterminate => px(153.5),
                    InstallProgressState::Determinate { .. } => px(240.0),
                };
                assert_eq!(fill.size.width, expected);
            }
        }
    }
}
