use crate::HappyApp;
use crate::design::geometry::{SIDEBAR_ROW_GAP, SIDEBAR_ROW_HEIGHT};
use crate::design::theme::{Theme, UI_FONT};
use crate::state::runtime::{AgentSnapshot, AgentStatus, ProjectSnapshot, WorkspaceSnapshot};
use gpui::{Context, Div, FontWeight, ScrollHandle, Stateful, div, prelude::*, px, rgba};

const ROWS: [(&str, &str); 7] = [
    ("⌂", "All chats"),
    ("◆", "Happy Desktop"),
    ("", "Rust rewrite"),
    ("", "Sidebar polish"),
    ("◆", "Happy Agent"),
    ("", "Realtime reconnect"),
    ("", "Document model"),
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SidebarItem {
    pub id: String,
    pub icon: &'static str,
    pub label: String,
    pub depth: usize,
}

pub fn project_sidebar_items(
    projects: &[ProjectSnapshot],
    workspaces: &[WorkspaceSnapshot],
) -> Vec<SidebarItem> {
    let mut items = vec![SidebarItem {
        id: "all-chats".to_owned(),
        icon: "⌂",
        label: "All chats".to_owned(),
        depth: 0,
    }];
    for project in projects {
        items.push(SidebarItem {
            id: format!("project/{}", project.id),
            icon: "◆",
            label: project.name.clone(),
            depth: 0,
        });
        let root_agents = workspaces
            .iter()
            .find(|workspace| workspace.id == project.id)
            .map(|workspace| workspace.agents.as_slice())
            .unwrap_or(&project.agents);
        items.extend(root_agents.iter().map(|agent| agent_item(agent, 1)));
        for workspace in workspaces.iter().filter(|workspace| {
            workspace.project_id.as_deref() == Some(project.id.as_str())
                && workspace.id != project.id
        }) {
            items.push(SidebarItem {
                id: format!("workspace/{}", workspace.id),
                icon: "◇",
                label: workspace.name.clone(),
                depth: 1,
            });
            items.extend(workspace.agents.iter().map(|agent| agent_item(agent, 2)));
        }
    }
    items.push(SidebarItem {
        id: "documents".to_owned(),
        icon: "▤",
        label: "Documents".to_owned(),
        depth: 0,
    });
    items
}

fn agent_item(agent: &AgentSnapshot, depth: usize) -> SidebarItem {
    SidebarItem {
        id: format!("agent/{}", agent.id),
        icon: match agent.status {
            AgentStatus::Idle => "",
            AgentStatus::Thinking
            | AgentStatus::Working
            | AgentStatus::GeneratingTools
            | AgentStatus::RunningTools => "●",
        },
        label: agent
            .title
            .clone()
            .unwrap_or_else(|| "New conversation".to_owned()),
        depth,
    }
}

pub fn sidebar(theme: Theme, selected: usize, width: f32) -> Div {
    let mut rows = sidebar_rows_root(None);
    for (index, (icon, label)) in ROWS.into_iter().enumerate() {
        rows = rows.child(sidebar_row(theme, index, icon, label, index == selected));
    }
    sidebar_root(theme, width, rows)
}

pub fn interactive_sidebar(
    theme: Theme,
    selected: usize,
    width: f32,
    cx: &mut Context<HappyApp>,
) -> Div {
    let mut rows = sidebar_rows_root(None);
    for (index, (icon, label)) in ROWS.into_iter().enumerate() {
        rows = rows.child(
            sidebar_row(theme, index, icon, label, index == selected).on_click(cx.listener(
                move |this, _, _, cx| {
                    this.selected_sidebar = index;
                    cx.notify();
                },
            )),
        );
    }
    sidebar_root(theme, width, rows)
}

pub fn project_sidebar(
    theme: Theme,
    selected: usize,
    width: f32,
    projects: &[ProjectSnapshot],
    workspaces: &[WorkspaceSnapshot],
) -> Div {
    let items = project_sidebar_items(projects, workspaces);
    let mut rows = sidebar_rows_root(None);
    for (index, item) in items.iter().enumerate() {
        rows = rows.child(sidebar_item_row(theme, index, item, index == selected));
    }
    sidebar_root(theme, width, rows)
}

pub fn interactive_project_sidebar(
    theme: Theme,
    selected: usize,
    width: f32,
    projects: &[ProjectSnapshot],
    workspaces: &[WorkspaceSnapshot],
    scroll: &ScrollHandle,
    cx: &mut Context<HappyApp>,
) -> Div {
    let items = project_sidebar_items(projects, workspaces);
    let mut rows = sidebar_rows_root(Some(scroll));
    for (index, item) in items.iter().enumerate() {
        let item_id = item.id.clone();
        rows = rows.child(
            sidebar_item_row(theme, index, item, index == selected).on_click(cx.listener(
                move |this, _, _, cx| {
                    this.sidebar_select(index, item_id.clone(), cx);
                },
            )),
        );
    }
    sidebar_root(theme, width, rows)
}

fn sidebar_rows_root(scroll: Option<&ScrollHandle>) -> Stateful<Div> {
    let rows = div()
        .debug_selector(|| "sidebar-rows".to_owned())
        .id("sidebar-rows-scroll")
        .flex()
        .flex_1()
        .min_h_0()
        .flex_col()
        .gap(px(SIDEBAR_ROW_GAP))
        .px(px(6.0));
    match scroll {
        Some(handle) => rows.overflow_y_scroll().track_scroll(handle),
        None => rows.overflow_hidden(),
    }
}

fn sidebar_root(theme: Theme, width: f32, rows: impl IntoElement) -> Div {
    div()
        .debug_selector(|| "sidebar".to_owned())
        .flex()
        .flex_none()
        .flex_col()
        .w(px(width))
        .h_full()
        .bg(theme.app)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "sidebar-header".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .h(px(56.0))
                .pl(px(20.0))
                .pr(px(16.0))
                .text_color(theme.text)
                .text_size(px(15.0))
                .font_weight(FontWeight::BOLD)
                .child("Chats"),
        )
        .child(
            div()
                .mx(px(16.0))
                .mb(px(10.0))
                .h(px(32.0))
                .flex()
                .items_center()
                .px(px(10.0))
                .rounded(px(6.0))
                .border_1()
                .border_color(theme.divider)
                .bg(theme.input)
                .text_color(theme.text_secondary)
                .text_size(px(12.0))
                .child("Search conversations"),
        )
        .child(
            div()
                .px(px(16.0))
                .pb(px(6.0))
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_secondary)
                .child("PROJECTS"),
        )
        .child(rows)
}

fn sidebar_row(
    theme: Theme,
    index: usize,
    icon: &str,
    label: &str,
    selected: bool,
) -> Stateful<Div> {
    let selector = format!("sidebar-row-{index}");
    div()
        .id(("sidebar-row", index))
        .debug_selector(move || selector.clone())
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.0))
        .w_full()
        .h(px(SIDEBAR_ROW_HEIGHT))
        .px(px(10.0))
        .rounded(px(6.0))
        .bg(if selected {
            theme.selected
        } else {
            rgba(0x00000000)
        })
        .text_color(if selected {
            theme.text
        } else {
            theme.text_secondary
        })
        .text_size(px(13.0))
        .child(div().w(px(20.0)).flex_none().child(icon.to_owned()))
        .child(label.to_owned())
}

fn sidebar_item_row(
    theme: Theme,
    index: usize,
    item: &SidebarItem,
    selected: bool,
) -> Stateful<Div> {
    let selector = format!("sidebar-row-{index}");
    div()
        .id(("project-sidebar-row", index))
        .debug_selector(move || selector.clone())
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.0))
        .w_full()
        .h(px(SIDEBAR_ROW_HEIGHT))
        .pl(px(10.0 + item.depth as f32 * 16.0))
        .pr(px(10.0))
        .rounded(px(6.0))
        .bg(if selected {
            theme.selected
        } else {
            rgba(0x00000000)
        })
        .text_color(if selected {
            theme.text
        } else {
            theme.text_secondary
        })
        .text_size(px(13.0))
        .child(div().w(px(20.0)).flex_none().child(item.icon.to_owned()))
        .child(item.label.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_sidebar_rows_match_real_insets_height_and_gap(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(360.0, 744.0), |_, _| {
            sidebar(Theme::light(), 1, 360.0)
        });
        assert_eq!(
            cx.debug_bounds("sidebar"),
            Some(rect(0.0, 0.0, 360.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-header"),
            Some(rect(0.0, 0.0, 360.0, 56.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-row-0"),
            Some(rect(6.0, 122.0, 348.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-row-1"),
            Some(rect(6.0, 156.0, 348.0, 32.0))
        );
    }

    #[gpui::test]
    fn rendered_live_project_hierarchy_keeps_row_and_depth_geometry(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        let projects = vec![ProjectSnapshot {
            archived_at: None,
            agents: vec![crate::state::runtime::AgentSnapshot {
                archived_at: None,
                id: "a1".to_owned(),
                order_key: Some("a".to_owned()),
                status: AgentStatus::Working,
                title: Some("Native navigation".to_owned()),
                workspace_id: "w1".to_owned(),
            }],
            id: "p1".to_owned(),
            name: "Happy Desktop".to_owned(),
            order_key: "a".to_owned(),
            status: crate::state::runtime::CatalogStatus::Active,
        }];
        cx.draw(point(px(0.0), px(0.0)), size_px(360.0, 744.0), |_, _| {
            project_sidebar(Theme::light(), 2, 360.0, &projects, &[])
        });
        assert_eq!(
            cx.debug_bounds("sidebar-row-0"),
            Some(rect(6.0, 122.0, 348.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-row-1"),
            Some(rect(6.0, 156.0, 348.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-row-2"),
            Some(rect(6.0, 190.0, 348.0, 32.0))
        );
        assert_eq!(project_sidebar_items(&projects, &[])[2].depth, 1);
    }
}
