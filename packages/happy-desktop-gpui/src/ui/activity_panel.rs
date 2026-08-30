use std::{rc::Rc, sync::Arc};

use gpui::{
    App, Entity, FocusHandle, FontWeight, IntoElement, RenderOnce, SharedString, Window, div,
    prelude::*, px,
};

use super::{
    components::{ActivateHandler, Button, ButtonVariant, ControlSize, ScrollSurface},
    icon::{Icon, IconName},
    scrollbar::ScrollbarState,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

/// The activity panel deliberately renders a bounded snapshot. The owner keeps the
/// durable collection and may replace this projection without replacing the scroll handle.
pub const ACTIVITY_PANEL_MAX_ROWS: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityGoalStatus {
    Active,
    Blocked,
    Complete,
    Paused,
}

impl ActivityGoalStatus {
    fn label(self) -> &'static str {
        match self {
            Self::Active => "Active",
            Self::Blocked => "Blocked",
            Self::Complete => "Done",
            Self::Paused => "Paused",
        }
    }
}

#[derive(Clone)]
pub struct ActivityGoal {
    pub objective: SharedString,
    pub status: ActivityGoalStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityTaskStatus {
    Pending,
    InProgress,
    Complete,
}

impl ActivityTaskStatus {
    fn label(self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::InProgress => "In progress",
            Self::Complete => "Done",
        }
    }
}

#[derive(Clone)]
pub struct ActivityTask {
    pub id: SharedString,
    pub subject: SharedString,
    pub active_form: Option<SharedString>,
    pub status: ActivityTaskStatus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActivityAgentStatus {
    Running,
    Queued,
    Idle,
    Suspended,
    Complete,
    Aborted,
    Failed,
    Archived,
}

impl ActivityAgentStatus {
    fn label(self) -> &'static str {
        match self {
            Self::Running => "Running",
            Self::Queued => "Queued",
            Self::Idle => "Idle",
            Self::Suspended => "Suspended",
            Self::Complete => "Done",
            Self::Aborted => "Aborted",
            Self::Failed => "Failed",
            Self::Archived => "Archived",
        }
    }

    fn settled(self) -> bool {
        matches!(
            self,
            Self::Complete | Self::Aborted | Self::Failed | Self::Archived
        )
    }
}

#[derive(Clone)]
pub struct ActivityAgent {
    pub session_id: SharedString,
    pub description: SharedString,
    pub task_name: Option<SharedString>,
    /// Protocol 23 does not publish a subagent model ID.
    pub model_id: Option<SharedString>,
    pub status: ActivityAgentStatus,
    /// Already formatted by the owning product surface. The component does not own a clock.
    pub elapsed: Option<SharedString>,
    pub total_tokens: Option<u64>,
    pub focus_handle: Option<FocusHandle>,
}

#[derive(Clone)]
pub struct ActivityProcess {
    /// Exact protocol CUID2. Process identity must never be hashed or inferred.
    pub id: SharedString,
    pub command: SharedString,
    /// Protocol 23 does not publish a process cwd. Callers must not fabricate one.
    pub cwd: Option<SharedString>,
    pub stop_focus_handle: Option<FocusHandle>,
}

pub type ActivityAgentSelectHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type ActivityProcessStopHandler = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type ActivityCompletedToggleHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct ActivityPanel {
    pub id: SharedString,
    pub theme: Theme,
    pub goal: Option<ActivityGoal>,
    pub tasks: Arc<Vec<ActivityTask>>,
    pub agents: Arc<Vec<ActivityAgent>>,
    pub processes: Arc<Vec<ActivityProcess>>,
    pub completed_open: bool,
    pub scrollbar: Entity<ScrollbarState>,
    pub completed_focus_handle: Option<FocusHandle>,
    pub on_completed_toggle: Option<ActivityCompletedToggleHandler>,
    pub on_agent_select: Option<ActivityAgentSelectHandler>,
    pub on_process_stop: Option<ActivityProcessStopHandler>,
}

fn heading(
    id: SharedString,
    theme: Theme,
    label: &'static str,
    count: Option<usize>,
) -> impl IntoElement {
    div()
        .debug_selector(move || format!("{id}.heading-{label}"))
        .h(px(20.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(8.0))
        .text_size(px(12.0))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(theme.role(ThemeRole::TextSecondary))
        .child(label)
        .children(count.map(|count| {
            div()
                .font_family(fonts::MONO_FAMILY)
                .text_size(px(11.0))
                .font_weight(FontWeight::MEDIUM)
                .child(count.to_string())
        }))
}

fn readout_row(
    selector: String,
    theme: Theme,
    icon: IconName,
    verb: &'static str,
    subject: SharedString,
    meta: SharedString,
) -> impl IntoElement {
    div()
        .debug_selector(move || selector.clone())
        .w_full()
        .min_w_0()
        .h(px(40.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(8.0))
        .child(Icon::decorative(
            icon,
            14.0,
            theme.role(ThemeRole::TextSecondary).into(),
            "activity-row-icon",
        ))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .h(px(20.0))
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .min_w_0()
                        .child(
                            div()
                                .flex_none()
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .child(verb),
                        )
                        .child(div().flex_1().min_w_0().truncate().child(subject)),
                )
                .child(
                    div()
                        .h(px(16.0))
                        .truncate()
                        .font_family(fonts::MONO_FAMILY)
                        .text_size(px(11.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(meta),
                ),
        )
}

impl RenderOnce for ActivityPanel {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let mut tasks: Vec<_> = self.tasks.iter().collect();
        tasks.sort_by_key(|task| match task.status {
            ActivityTaskStatus::InProgress => 0,
            ActivityTaskStatus::Pending => 1,
            ActivityTaskStatus::Complete => 2,
        });
        let mut agents: Vec<_> = self.agents.iter().collect();
        agents.sort_by_key(|agent| match agent.status {
            ActivityAgentStatus::Running => 0,
            ActivityAgentStatus::Queued => 1,
            ActivityAgentStatus::Idle => 2,
            ActivityAgentStatus::Suspended => 3,
            ActivityAgentStatus::Complete => 4,
            ActivityAgentStatus::Aborted
            | ActivityAgentStatus::Failed
            | ActivityAgentStatus::Archived => 5,
        });
        let mut budget = ACTIVITY_PANEL_MAX_ROWS;
        let running_agents: Vec<_> = agents
            .iter()
            .filter(|agent| !agent.status.settled())
            .take(budget)
            .cloned()
            .cloned()
            .collect();
        budget = budget.saturating_sub(running_agents.len());
        let processes: Vec<_> = self.processes.iter().take(budget).cloned().collect();
        budget = budget.saturating_sub(processes.len());
        let tasks: Vec<_> = tasks.into_iter().take(budget).cloned().collect();
        budget = budget.saturating_sub(tasks.len());
        let completed_agents: Vec<_> = agents
            .into_iter()
            .filter(|agent| agent.status.settled())
            .take(budget)
            .cloned()
            .collect();
        let empty = self.goal.is_none()
            && running_agents.is_empty()
            && processes.is_empty()
            && tasks.is_empty()
            && completed_agents.is_empty();

        let select = self.on_agent_select;
        let stop = self.on_process_stop;
        let running_count = running_agents.len();
        let completed_count = completed_agents.len();
        let task_count = tasks.len();
        let process_count = processes.len();

        let content = div()
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
            .font_family(fonts::UI_FAMILY)
            .text_size(px(13.0))
            .text_color(theme.role(ThemeRole::Text))
            .when(empty, |v| {
                v.child(
                    div()
                        .debug_selector({
                            let id = id.clone();
                            move || format!("{id}.empty")
                        })
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(
                            "No goal, tasks, agents, or background terminals for this session yet.",
                        ),
                )
            })
            .when(running_count + process_count > 0, |v| {
                v.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.0))
                        .child(heading(id.clone(), theme, "Running", None))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(12.0))
                                .when(running_count > 0, |v| {
                                    v.child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(8.0))
                                            .child(heading(
                                                id.clone(),
                                                theme,
                                                "Agents",
                                                Some(running_count),
                                            ))
                                            .children(running_agents.into_iter().map(|agent| {
                                                let session_id = agent.session_id.clone();
                                                let handler = select.clone();
                                                let interactive = handler.is_some();
                                                let selector =
                                                    format!("{}.agent-{}", id, agent.session_id);
                                                let meta = format!(
                                                    "{}{}{}",
                                                    agent.status.label(),
                                                    agent
                                                        .model_id
                                                        .as_ref()
                                                        .map(|v| format!(" · {v}"))
                                                        .unwrap_or_default(),
                                                    agent
                                                        .elapsed
                                                        .as_ref()
                                                        .map(|v| format!(" · {v}"))
                                                        .unwrap_or_default()
                                                );
                                                div()
                                                    .id(agent.session_id.clone())
                                                    .when(interactive, |v| v.tab_index(0))
                                                    .when_some(agent.focus_handle, |v, focus| {
                                                        v.track_focus(
                                                            &focus
                                                                .tab_index(0)
                                                                .tab_stop(interactive),
                                                        )
                                                    })
                                                    .when_some(handler, |v, handler| {
                                                        let keyboard = handler.clone();
                                                        let keyboard_id = session_id.clone();
                                                        v.on_click(move |_, window, cx| {
                                                            handler(session_id.clone(), window, cx)
                                                        })
                                                        .on_key_down(move |event, window, cx| {
                                                            if !event.is_held
                                                                && matches!(
                                                                    event.keystroke.key.as_str(),
                                                                    "enter" | "space"
                                                                )
                                                            {
                                                                cx.stop_propagation();
                                                                keyboard(
                                                                    keyboard_id.clone(),
                                                                    window,
                                                                    cx,
                                                                );
                                                            }
                                                        })
                                                    })
                                                    .child(readout_row(
                                                        selector,
                                                        theme,
                                                        IconName::Agents,
                                                        "Agent",
                                                        agent
                                                            .task_name
                                                            .unwrap_or(agent.description),
                                                        meta.into(),
                                                    ))
                                            })),
                                    )
                                })
                                .when(process_count > 0, |v| {
                                    v.child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(8.0))
                                            .child(heading(
                                                id.clone(),
                                                theme,
                                                "Terminals",
                                                Some(process_count),
                                            ))
                                            .children(processes.into_iter().map(|process| {
                                                let process_id = process.id.clone();
                                                let process_id_for_action = process_id.clone();
                                                let handler = stop.clone();
                                                let detail: SharedString = process
                                                    .cwd
                                                    .map(|cwd| format!("running · {cwd}").into())
                                                    .unwrap_or_else(|| "running".into());
                                                div()
                                                    .w_full()
                                                    .flex()
                                                    .items_center()
                                                    .child(
                                                        div().flex_1().min_w_0().child(
                                                            readout_row(
                                                                format!(
                                                                    "{}.process-{process_id}",
                                                                    id
                                                                ),
                                                                theme,
                                                                IconName::Terminal,
                                                                "Terminal",
                                                                process.command,
                                                                detail,
                                                            ),
                                                        ),
                                                    )
                                                    .children(handler.map(|handler| {
                                                        Button {
                                                            id: format!(
                                                                "{}.process-{process_id}-stop",
                                                                id
                                                            )
                                                            .into(),
                                                            theme,
                                                            label: "Stop".into(),
                                                            size: ControlSize::Small,
                                                            variant: ButtonVariant::Ghost,
                                                            icon: None,
                                                            icon_only: false,
                                                            disabled: false,
                                                            force_focused: false,
                                                            focus_handle: process.stop_focus_handle,
                                                            on_activate: Some(Rc::new(
                                                                move |window: &mut Window, cx: &mut App| {
                                                                    handler(
                                                                        process_id_for_action.clone(),
                                                                        window,
                                                                        cx,
                                                                    )
                                                                },
                                                            )
                                                                as ActivateHandler),
                                                        }
                                                    }))
                                            })),
                                    )
                                }),
                        ),
                )
            })
            .children(self.goal.map(|goal| {
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .child(heading(id.clone(), theme, "Goal", None))
                    .child(readout_row(
                        format!("{}.goal", id),
                        theme,
                        IconName::Tasks,
                        "Goal",
                        goal.objective,
                        goal.status.label().into(),
                    ))
            }))
            .when(task_count > 0, |v| {
                v.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.0))
                        .child(heading(id.clone(), theme, "Tasks", Some(task_count)))
                        .children(tasks.into_iter().map(|task| {
                            let label = if task.status == ActivityTaskStatus::InProgress {
                                task.active_form.unwrap_or(task.subject)
                            } else {
                                task.subject
                            };
                            readout_row(
                                format!("{}.task-{}", id, task.id),
                                theme,
                                IconName::Tasks,
                                "Task",
                                label,
                                task.status.label().into(),
                            )
                        })),
                )
            })
            .when(completed_count > 0, |v| {
                let open = self.completed_open;
                let toggle = self.on_completed_toggle;
                v.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.0))
                        .child(
                            div()
                                .id(SharedString::from(format!("{}-completed", id)))
                                .debug_selector({
                                    let id = id.clone();
                                    move || format!("{id}.completed")
                                })
                                .h(px(24.0))
                                .flex()
                                .items_center()
                                .gap(px(6.0))
                                .px(px(8.0))
                                .rounded(px(6.0))
                                .text_color(theme.role(ThemeRole::TextSecondary))
                                .when(toggle.is_some(), |v| v.tab_index(0))
                                .when_some(self.completed_focus_handle, |v, focus| {
                                    v.track_focus(&focus.tab_index(0).tab_stop(toggle.is_some()))
                                })
                                .when_some(toggle, |v, toggle| {
                                    let keyboard = toggle.clone();
                                    v.on_click(move |_, window, cx| toggle(!open, window, cx))
                                        .on_key_down(move |event, window, cx| {
                                            if !event.is_held
                                                && matches!(
                                                    event.keystroke.key.as_str(),
                                                    "enter" | "space"
                                                )
                                            {
                                                cx.stop_propagation();
                                                keyboard(!open, window, cx);
                                            }
                                        })
                                })
                                .child(Icon::decorative(
                                    IconName::ChevronRight,
                                    12.0,
                                    theme.role(ThemeRole::TextSecondary).into(),
                                    format!("{}.completed-chevron", id),
                                ))
                                .child("Completed")
                                .child(
                                    div()
                                        .font_family(fonts::MONO_FAMILY)
                                        .text_size(px(11.0))
                                        .child(completed_count.to_string()),
                                ),
                        )
                        .when(open, |v| {
                            v.children(completed_agents.into_iter().map(|agent| {
                                let session_id = agent.session_id.clone();
                                let handler = select.clone();
                                let interactive = handler.is_some();
                                let selector = format!("{}.agent-{}", id, agent.session_id);
                                div()
                                    .id(agent.session_id.clone())
                                    .when(interactive, |v| v.tab_index(0))
                                    .when_some(agent.focus_handle, |v, focus| {
                                        v.track_focus(&focus.tab_index(0).tab_stop(interactive))
                                    })
                                    .when_some(handler, |v, handler| {
                                        v.on_click(move |_, window, cx| {
                                            handler(session_id.clone(), window, cx)
                                        })
                                    })
                                    .child(readout_row(
                                        selector,
                                        theme,
                                        IconName::Agents,
                                        "Agent",
                                        agent.task_name.unwrap_or(agent.description),
                                        format!(
                                            "{}{}",
                                            agent.status.label(),
                                            agent
                                                .model_id
                                                .as_ref()
                                                .map(|v| format!(" · {v}"))
                                                .unwrap_or_default()
                                        )
                                        .into(),
                                    ))
                            }))
                        }),
                )
            });

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
            .child(ScrollSurface {
                id: format!("{}-scroll", id).into(),
                theme,
                width: None,
                height: None,
                vertical: Some(self.scrollbar),
                horizontal: None,
                content: content.into_any_element(),
            })
    }
}
