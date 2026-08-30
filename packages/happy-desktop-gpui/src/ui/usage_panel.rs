use std::sync::Arc;

use gpui::{
    App, Entity, FontWeight, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px,
};

use super::{components::ScrollSurface, scrollbar::ScrollbarState, theme_roles::ThemeRole};
use crate::{fonts, theme::Theme};

pub const USAGE_PANEL_MAX_GROUPS: usize = 100;
pub const USAGE_PANEL_MAX_QUOTAS: usize = 24;

#[derive(Clone)]
pub struct UsageGroup {
    pub provider_id: SharedString,
    pub model_id: SharedString,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub total_tokens: u64,
    /// None when the authoritative protocol does not publish pricing.
    pub cost_usd: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UsageQuotaWindowKind {
    FiveHour,
    Weekly,
}

impl UsageQuotaWindowKind {
    fn label(self) -> &'static str {
        match self {
            Self::FiveHour => "5 hours",
            Self::Weekly => "Week",
        }
    }
}

#[derive(Clone)]
pub struct UsageQuotaWindow {
    pub kind: UsageQuotaWindowKind,
    pub used_percent: f32,
    /// A caller-formatted local reset label. Time-zone ownership stays outside this component.
    pub reset_label: SharedString,
}

#[derive(Clone)]
pub struct UsageQuota {
    pub provider_id: SharedString,
    pub windows: Vec<UsageQuotaWindow>,
}

#[derive(Clone)]
pub struct UsageContext {
    pub total_tokens: u64,
    pub approximate: bool,
    pub model_id: Option<SharedString>,
}

#[derive(Clone)]
pub struct UsageSnapshot {
    pub groups: Vec<UsageGroup>,
    pub total_tokens: u64,
    /// None when no authoritative cost is available.
    pub total_cost_usd: Option<f64>,
    pub context: Option<UsageContext>,
    pub quotas: Vec<UsageQuota>,
}

#[derive(IntoElement)]
pub struct UsagePanel {
    pub id: SharedString,
    pub theme: Theme,
    pub usage: Option<Arc<UsageSnapshot>>,
    pub loading: bool,
    pub error: Option<SharedString>,
    pub compact: bool,
    pub scrollbar: Entity<ScrollbarState>,
}

fn tokens(value: u64, compact: bool) -> String {
    if !compact {
        return with_grouping(value);
    }
    if value >= 1_000_000 {
        let v = value as f64 / 1_000_000.0;
        return format!("{:.1}M", v).replace(".0M", "M");
    }
    if value >= 1_000 {
        let v = value as f64 / 1_000.0;
        return format!("{:.1}K", v).replace(".0K", "K");
    }
    value.to_string()
}
fn with_grouping(value: u64) -> String {
    let source = value.to_string();
    let mut result = String::new();
    for (index, ch) in source.chars().enumerate() {
        if index > 0 && (source.len() - index) % 3 == 0 {
            result.push(',');
        }
        result.push(ch);
    }
    result
}
fn cost(value: f64) -> String {
    if value > 0.0 && value < 0.01 {
        format!("${value:.4}")
    } else {
        format!("${value:.2}")
    }
}
fn numeric_cell(width: f32, value: String, theme: Theme) -> impl IntoElement {
    div()
        .w(px(width))
        .flex_none()
        .flex()
        .justify_end()
        .truncate()
        .font_family(fonts::MONO_FAMILY)
        .text_color(theme.role(ThemeRole::Text))
        .child(value)
}
fn accounting_row(id: String, theme: Theme, compact: bool, group: UsageGroup) -> impl IntoElement {
    let numeric_width = if compact { 38.0 } else { 68.0 };
    let cost_width = if compact { 48.0 } else { 64.0 };
    div()
        .debug_selector(move || id.clone())
        .w_full()
        .min_w_0()
        .h(px(29.0))
        .flex()
        .items_center()
        .gap(px(if compact { 2.0 } else { 8.0 }))
        .px(px(if compact { 3.0 } else { 8.0 }))
        .border_b_1()
        .border_color(theme.role(ThemeRole::Divider))
        .text_size(px(if compact { 11.0 } else { 12.0 }))
        .child(div().flex_1().min_w_0().truncate().child(group.model_id))
        .child(numeric_cell(
            numeric_width,
            tokens(group.input_tokens, compact),
            theme,
        ))
        .child(numeric_cell(
            numeric_width,
            tokens(group.output_tokens, compact),
            theme,
        ))
        .child(numeric_cell(
            numeric_width,
            tokens(group.cache_read_tokens + group.cache_write_tokens, compact),
            theme,
        ))
        .child(numeric_cell(
            numeric_width,
            tokens(group.total_tokens, compact),
            theme,
        ))
        .child(numeric_cell(
            cost_width,
            group.cost_usd.map(cost).unwrap_or_else(|| "—".into()),
            theme,
        ))
}

impl RenderOnce for UsagePanel {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let compact = self.compact;
        let state = if let Some(error) = self.error {
            Some((true, error))
        } else if self.usage.is_none() {
            Some((false, "Loading usage…".into()))
        } else {
            None
        };
        let content = if let Some((failed, text)) = state {
            div()
                .debug_selector({
                    let id = id.clone();
                    move || format!("{id}.state")
                })
                .w_full()
                .flex_none()
                .p(px(12.0))
                .text_size(px(13.0))
                .text_color(if failed {
                    theme.role(ThemeRole::StatusError)
                } else {
                    theme.role(ThemeRole::TextSecondary)
                })
                .child(text)
                .into_any_element()
        } else {
            let usage = self.usage.expect("usage checked above");
            let groups: Vec<_> = usage
                .groups
                .iter()
                .cloned()
                .take(USAGE_PANEL_MAX_GROUPS)
                .collect();
            let quotas: Vec<_> = usage
                .quotas
                .iter()
                .cloned()
                .take(USAGE_PANEL_MAX_QUOTAS)
                .collect();
            let numeric_width = if compact { 38.0 } else { 68.0 };
            let cost_width = if compact { 48.0 } else { 64.0 };
            div()
                .debug_selector({
                    let id = id.clone();
                    move || format!("{id}.content")
                })
                .w_full()
                .flex_none()
                .flex()
                .flex_col()
                .gap(px(16.0))
                .p(px(12.0))
                .child(
                    div()
                        .flex()
                        .gap(px(24.0))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .h(px(26.0))
                                        .text_size(px(20.0))
                                        .font_weight(FontWeight::BOLD)
                                        .child(with_grouping(usage.total_tokens)),
                                )
                                .child(
                                    div()
                                        .h(px(16.0))
                                        .font_family(fonts::MONO_FAMILY)
                                        .text_size(px(11.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child("TOKENS"),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .h(px(26.0))
                                        .text_size(px(20.0))
                                        .font_weight(FontWeight::BOLD)
                                        .child(
                                            usage
                                                .total_cost_usd
                                                .map(cost)
                                                .unwrap_or_else(|| "—".into()),
                                        ),
                                )
                                .child(
                                    div()
                                        .h(px(16.0))
                                        .font_family(fonts::MONO_FAMILY)
                                        .text_size(px(11.0))
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child("COST"),
                                ),
                        ),
                )
                .child(if groups.is_empty() {
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child("No model usage yet.")
                        .into_any_element()
                } else {
                    div()
                        .w_full()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .w_full()
                                .h(px(25.0))
                                .flex()
                                .items_center()
                                .gap(px(if compact { 2.0 } else { 8.0 }))
                                .px(px(if compact { 3.0 } else { 8.0 }))
                                .border_b_1()
                                .border_color(theme.role(ThemeRole::Divider))
                                .text_size(px(if compact { 10.0 } else { 12.0 }))
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child(div().flex_1().min_w_0().child("Model"))
                                .child(numeric_cell(numeric_width, "In".into(), theme))
                                .child(numeric_cell(numeric_width, "Out".into(), theme))
                                .child(numeric_cell(numeric_width, "Cache".into(), theme))
                                .child(numeric_cell(numeric_width, "Total".into(), theme))
                                .child(numeric_cell(cost_width, "Cost".into(), theme)),
                        )
                        .children(groups.into_iter().map(|group| {
                            accounting_row(
                                format!("{}.group-{}-{}", id, group.provider_id, group.model_id),
                                theme,
                                compact,
                                group,
                            )
                        }))
                        .into_any_element()
                })
                .children(usage.context.clone().map(|context| {
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(format!(
                            "Context: {} tokens{}{}",
                            with_grouping(context.total_tokens),
                            if context.approximate {
                                " (approximate)"
                            } else {
                                ""
                            },
                            context
                                .model_id
                                .as_ref()
                                .map(|model| format!(" on {model}"))
                                .unwrap_or_default()
                        ))
                }))
                .when(!quotas.is_empty(), |v| {
                    v.child(
                        div()
                            .w_full()
                            .flex()
                            .flex_col()
                            .gap(px(12.0))
                            .pt(px(12.0))
                            .border_t_1()
                            .border_color(theme.role(ThemeRole::Divider))
                            .children(quotas.into_iter().map(|quota| {
                                let provider = quota.provider_id;
                                let windows = quota.windows;
                                div()
                                    .w_full()
                                    .flex()
                                    .flex_col()
                                    .gap(px(6.0))
                                    .child(
                                        div()
                                            .h(px(18.0))
                                            .text_size(px(13.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(provider),
                                    )
                                    .when(windows.is_empty(), |v| {
                                        v.child(
                                            div()
                                                .text_size(px(12.0))
                                                .text_color(theme.role(ThemeRole::TextSecondary))
                                                .child("No limits reported"),
                                        )
                                    })
                                    .children(windows.into_iter().take(2).map(|window| {
                                        let percent = window.used_percent.clamp(0.0, 100.0);
                                        let tone = if percent >= 90.0 {
                                            ThemeRole::StatusError
                                        } else if percent >= 75.0 {
                                            ThemeRole::BoxWarningText
                                        } else {
                                            ThemeRole::Text
                                        };
                                        div()
                                            .w_full()
                                            .min_w_0()
                                            .min_h(px(20.0))
                                            .flex()
                                            .items_center()
                                            .gap(px(8.0))
                                            .text_size(px(13.0))
                                            .child(
                                                div()
                                                    .w(px(56.0))
                                                    .flex_none()
                                                    .child(window.kind.label()),
                                            )
                                            .child(
                                                div()
                                                    .flex_1()
                                                    .min_w(px(40.0))
                                                    .h(px(4.0))
                                                    .rounded_full()
                                                    .bg(theme.role(ThemeRole::SurfaceSelected))
                                                    .overflow_hidden()
                                                    .child(
                                                        div()
                                                            .w(gpui::relative(percent / 100.0))
                                                            .h_full()
                                                            .rounded_full()
                                                            .bg(theme.role(tone)),
                                                    ),
                                            )
                                            .child(
                                                div()
                                                    .w(px(36.0))
                                                    .flex_none()
                                                    .flex()
                                                    .justify_end()
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .text_color(theme.role(tone))
                                                    .child(format!("{}%", percent.round())),
                                            )
                                            .when(!compact, |v| {
                                                v.child(
                                                    div()
                                                        .w(px(152.0))
                                                        .flex_none()
                                                        .flex()
                                                        .justify_end()
                                                        .truncate()
                                                        .text_color(
                                                            theme.role(ThemeRole::TextSecondary),
                                                        )
                                                        .child(window.reset_label),
                                                )
                                            })
                                    }))
                            })),
                    )
                })
                .into_any_element()
        };
        div()
            .debug_selector({
                let id = id.clone();
                move || format!("{id}.root")
            })
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .when(self.loading, |v| v.opacity(0.88))
            .child(ScrollSurface {
                id: format!("{}-scroll", id).into(),
                theme,
                width: None,
                height: None,
                vertical: Some(self.scrollbar),
                horizontal: None,
                content,
            })
    }
}
