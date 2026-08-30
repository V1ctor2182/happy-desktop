use std::sync::Arc;

use gpui::{
    App, Entity, FocusHandle, FontWeight, IntoElement, RenderOnce, SharedString, Window, div,
    prelude::*, px,
};

use super::{
    components::{
        ActivateHandler, Badge, BadgeVariant, Button, ButtonVariant, ControlSize, ScrollSurface,
        Toolbar,
    },
    icon::{Icon, IconName},
    metrics::SURFACE_HEADER_HEIGHT,
    scrollbar::ScrollbarState,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const AGENT_TRACE_PANEL_MAX_ENTRIES: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentTracePanelStatus {
    Pending,
    Running,
    Complete,
    Aborted,
    Failed,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentTraceKind {
    Reasoning,
    Response,
    Tool,
    Subagent,
    Terminal,
    Status,
}

impl AgentTraceKind {
    fn icon(self) -> IconName {
        match self {
            Self::Reasoning => IconName::Spark,
            Self::Response | Self::Status => IconName::CheckCircle,
            Self::Tool | Self::Terminal => IconName::Terminal,
            Self::Subagent => IconName::Branch,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentTraceEntryStatus {
    Running,
    Complete,
    Stopped,
    Failed,
}

#[derive(Clone)]
pub struct AgentTraceEntry {
    pub id: SharedString,
    pub kind: AgentTraceKind,
    pub title: SharedString,
    pub detail: Option<SharedString>,
    pub status: AgentTraceEntryStatus,
    /// Epoch milliseconds. The component formats this as deterministic UTC HH:MM:SS.
    pub occurred_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(IntoElement)]
pub struct AgentTracePanel {
    pub id: SharedString,
    pub theme: Theme,
    pub title: SharedString,
    pub status: AgentTracePanelStatus,
    pub entries: Arc<Vec<AgentTraceEntry>>,
    pub entry_count: usize,
    pub entry_count_exact: bool,
    pub loading: bool,
    pub error: Option<SharedString>,
    pub scrollbar: Entity<ScrollbarState>,
    pub close_focus_handle: Option<FocusHandle>,
    pub on_close: Option<ActivateHandler>,
}

fn utc_clock(epoch_ms: i64) -> String {
    let total_seconds = epoch_ms.div_euclid(1_000);
    let day_seconds = total_seconds.rem_euclid(86_400);
    format!(
        "{:02}:{:02}:{:02}",
        day_seconds / 3_600,
        (day_seconds % 3_600) / 60,
        day_seconds % 60
    )
}

impl RenderOnce for AgentTracePanel {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let (badge_label, badge_variant) = match self.status {
            AgentTracePanelStatus::Pending => ("PENDING", BadgeVariant::Neutral),
            AgentTracePanelStatus::Running => ("RUNNING", BadgeVariant::Accent),
            AgentTracePanelStatus::Complete => ("COMPLETE", BadgeVariant::Success),
            AgentTracePanelStatus::Aborted => ("ABORTED", BadgeVariant::Warning),
            AgentTracePanelStatus::Failed => ("FAILED", BadgeVariant::Danger),
            AgentTracePanelStatus::Unavailable => ("UNAVAILABLE", BadgeVariant::Neutral),
        };
        let trailing = div()
            .flex()
            .items_center()
            .gap(px(8.0))
            .child(Badge {
                id: format!("{}-status", id).into(),
                theme,
                label: badge_label.into(),
                variant: badge_variant,
            })
            .children(self.on_close.map(|on_close| Button {
                id: format!("{}-close", id).into(),
                theme,
                label: "Close trace".into(),
                size: ControlSize::Small,
                variant: ButtonVariant::Ghost,
                icon: Some(IconName::Close),
                icon_only: true,
                disabled: false,
                force_focused: false,
                focus_handle: self.close_focus_handle,
                on_activate: Some(on_close),
            }));
        let state_text = if self.loading {
            Some(("loading", SharedString::from("Loading activity…")))
        } else if let Some(error) = self.error {
            Some(("error", error))
        } else if self.entries.is_empty() {
            Some(("empty", SharedString::from("No activity yet")))
        } else {
            None
        };
        let shown_entry_count = self.entries.len().min(AGENT_TRACE_PANEL_MAX_ENTRIES);
        let entries = self
            .entries
            .iter()
            .take(AGENT_TRACE_PANEL_MAX_ENTRIES)
            .cloned();
        let body = if let Some((state, text)) = state_text {
            div()
                .debug_selector({
                    let id = id.clone();
                    move || format!("{id}.state-{state}")
                })
                .size_full()
                .min_h(px(160.0))
                .flex()
                .items_center()
                .justify_center()
                .p(px(16.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::MEDIUM)
                .text_color(if state == "error" {
                    theme.role(ThemeRole::TextDestructive)
                } else {
                    theme.role(ThemeRole::TextSecondary)
                })
                .child(text)
                .into_any_element()
        } else {
            div()
                .debug_selector({
                    let id = id.clone();
                    move || format!("{id}.entries")
                })
                .w_full()
                .flex_none()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .p(px(12.0))
                .children(entries.map(|entry| {
                    let dot_color = match entry.status {
                        AgentTraceEntryStatus::Running => theme.role(ThemeRole::TextLink),
                        AgentTraceEntryStatus::Complete => theme.role(ThemeRole::Success),
                        AgentTraceEntryStatus::Stopped => theme.role(ThemeRole::Warning),
                        AgentTraceEntryStatus::Failed => theme.role(ThemeRole::TextDestructive),
                    };
                    div()
                        .debug_selector({
                            let selector = format!("{}.entry-{}", id, entry.id);
                            move || selector.clone()
                        })
                        .w_full()
                        .min_w_0()
                        .flex()
                        .items_start()
                        .gap(px(8.0))
                        .child(
                            div()
                                .w(px(5.0))
                                .h(px(16.0))
                                .flex_none()
                                .flex()
                                .items_center()
                                .child(div().size(px(5.0)).rounded_full().bg(dot_color)),
                        )
                        .child(div().h(px(16.0)).flex_none().flex().items_center().child(
                            Icon::decorative(
                                entry.kind.icon(),
                                14.0,
                                theme.role(ThemeRole::TextSecondary).into(),
                                format!("trace-kind-{}", entry.id),
                            ),
                        ))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(px(4.0))
                                .child(
                                    div()
                                        .h(px(16.0))
                                        .truncate()
                                        .text_size(px(12.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(entry.title),
                                )
                                .children(entry.detail.map(|detail| {
                                    div()
                                        .h(px(14.0))
                                        .truncate()
                                        .font_family(fonts::MONO_FAMILY)
                                        .text_size(px(11.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child(detail)
                                })),
                        )
                        .child(
                            div()
                                .h(px(16.0))
                                .flex_none()
                                .font_family(fonts::MONO_FAMILY)
                                .text_size(px(11.0))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child(utc_clock(entry.occurred_at)),
                        )
                }))
                .into_any_element()
        };
        div()
            .debug_selector({
                let id = id.clone();
                move || format!("{id}.root")
            })
            .size_full()
            .min_h_0()
            .flex()
            .flex_col()
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .child(Toolbar {
                id: format!("{}-header", id).into(),
                theme,
                title: self.title,
                subtitle: Some(
                    if self.entry_count_exact {
                        format!(
                            "{} of {} {}",
                            shown_entry_count,
                            self.entry_count,
                            if self.entry_count == 1 {
                                "step"
                            } else {
                                "steps"
                            }
                        )
                    } else {
                        format!(
                            "{} of at least {} steps",
                            shown_entry_count, self.entry_count
                        )
                    }
                    .into(),
                ),
                width: None,
                height: SURFACE_HEADER_HEIGHT,
                leading_icon: None,
                search: None,
                trailing: Some(trailing.into_any_element()),
            })
            .child(div().flex_1().min_h_0().child(ScrollSurface {
                id: format!("{}-body", id).into(),
                theme,
                width: None,
                height: None,
                vertical: Some(self.scrollbar),
                horizontal: None,
                content: body,
            }))
    }
}
