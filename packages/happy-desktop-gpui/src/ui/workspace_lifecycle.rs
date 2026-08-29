//! Workspace-local lifecycle notices. The lane is always part of the workspace tree.

use gpui::{
    AnyElement, App, FontWeight, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px,
};

use super::{
    icon::{Icon, IconName},
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const LIFECYCLE_LANE_TOP_PADDING: f32 = 8.0;
pub const LIFECYCLE_LANE_HORIZONTAL_PADDING: f32 = 12.0;
pub const LIFECYCLE_COMPACT_MEDIA_SIZE: f32 = 18.0;
pub const LIFECYCLE_PANEL_MEDIA_SIZE: f32 = 40.0;

fn part(id: SharedString, name: &'static str) -> impl Fn() -> String {
    move || format!("{id}.{name}")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceLifecyclePhase {
    Ready,
    Creating,
    Archiving,
    Archived,
    Failed,
    Refused,
    Missing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceLifecycleNoticeSize {
    Panel,
    Compact,
}

struct Presentation {
    icon: IconName,
    tone: ThemeRole,
    border: ThemeRole,
    background: ThemeRole,
    title: SharedString,
    body: &'static str,
}

fn presentation(phase: WorkspaceLifecyclePhase, name: &SharedString) -> Option<Presentation> {
    match phase {
        WorkspaceLifecyclePhase::Ready => None,
        WorkspaceLifecyclePhase::Creating => Some(Presentation {
            icon: IconName::Clock,
            tone: ThemeRole::TextSecondary,
            border: ThemeRole::Divider,
            background: ThemeRole::SurfaceHigh,
            title: format!("Creating “{name}”").into(),
            body: "Happy Agent is preparing this workspace's checkout. Chats can be started and written into now; Happy Agent runs their work as soon as the checkout is there.",
        }),
        WorkspaceLifecyclePhase::Archiving => Some(Presentation {
            icon: IconName::Clock,
            tone: ThemeRole::BoxWarningText,
            border: ThemeRole::BoxWarningBorder,
            background: ThemeRole::BoxWarningBackground,
            title: format!("Archiving “{name}”").into(),
            body: "Happy Agent is archiving this workspace and removing its checkout from disk.",
        }),
        WorkspaceLifecyclePhase::Archived => Some(Presentation {
            icon: IconName::Archive,
            tone: ThemeRole::TextSecondary,
            border: ThemeRole::Divider,
            background: ThemeRole::SurfaceHigh,
            title: format!("“{name}” is archived").into(),
            body: "Happy Agent archived this workspace and removed its checkout from disk.",
        }),
        WorkspaceLifecyclePhase::Failed => Some(Presentation {
            icon: IconName::Alert,
            tone: ThemeRole::BoxErrorText,
            border: ThemeRole::BoxErrorBorder,
            background: ThemeRole::BoxErrorBackground,
            title: format!("“{name}” could not be created").into(),
            body: "Happy Agent started preparing this workspace's checkout and stopped. Nothing further will happen to it.",
        }),
        WorkspaceLifecyclePhase::Refused => Some(Presentation {
            icon: IconName::Alert,
            tone: ThemeRole::BoxErrorText,
            border: ThemeRole::BoxErrorBorder,
            background: ThemeRole::BoxErrorBackground,
            title: format!("“{name}” was not created").into(),
            body: "Happy Agent declined the request, so no checkout was started and there is nothing left of this workspace on the machine.",
        }),
        WorkspaceLifecyclePhase::Missing => Some(Presentation {
            icon: IconName::Unlink,
            tone: ThemeRole::BoxWarningText,
            border: ThemeRole::BoxWarningBorder,
            background: ThemeRole::BoxWarningBackground,
            title: format!("“{name}” is no longer on disk").into(),
            body: "Happy Agent prepared this workspace's checkout and its directory is not there any more. It was removed outside Happy.",
        }),
    }
}

/// Fact-only lifecycle treatment. It contains no retry, delete, or refresh guess.
#[derive(IntoElement)]
pub struct WorkspaceLifecycleNotice {
    pub id: SharedString,
    pub theme: Theme,
    pub name: SharedString,
    pub phase: WorkspaceLifecyclePhase,
    pub detail: Option<SharedString>,
    pub path: Option<SharedString>,
    pub size: WorkspaceLifecycleNoticeSize,
}

impl RenderOnce for WorkspaceLifecycleNotice {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let theme = self.theme;
        let Some(presentation) = presentation(self.phase, &self.name) else {
            return div()
                .id(id.clone())
                .debug_selector(part(id, "root"))
                .w_full()
                .h(px(0.0))
                .into_any_element();
        };
        let compact = self.size == WorkspaceLifecycleNoticeSize::Compact;
        let media_size = if compact {
            LIFECYCLE_COMPACT_MEDIA_SIZE
        } else {
            LIFECYCLE_PANEL_MEDIA_SIZE
        };
        let notice = div()
            .id(id.clone())
            .debug_selector(part(id.clone(), "root"))
            .w_full()
            .when(!compact, |v| {
                v.h_full()
                    .items_center()
                    .justify_center()
                    .gap(px(16.0))
                    .px(px(32.0))
                    .py(px(40.0))
            })
            .when(compact, |v| {
                v.items_start()
                    .gap(px(10.0))
                    .px(px(12.0))
                    .py(px(10.0))
                    .border_1()
                    .border_color(theme.role(presentation.border))
                    .rounded(px(8.0))
                    .bg(theme.role(presentation.background))
            })
            .flex()
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .child(
                div()
                    .debug_selector(part(id.clone(), "media"))
                    .size(px(media_size))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .when(!compact, |v| {
                        v.border_1()
                            .border_color(theme.role(ThemeRole::Divider))
                            .rounded(px(8.0))
                            .bg(theme.role(ThemeRole::InputBackground))
                    })
                    .child(Icon::labelled(
                        presentation.icon,
                        presentation.title.clone(),
                        if compact { 14.0 } else { 20.0 },
                        theme.role(presentation.tone).into(),
                        format!("{id}.icon"),
                    )),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "content"))
                    .min_w_0()
                    .when(!compact, |v| v.max_w(px(420.0)))
                    .flex()
                    .flex_col()
                    .gap(px(if compact { 4.0 } else { 6.0 }))
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "title"))
                            .text_size(px(if compact { 13.0 } else { 15.0 }))
                            .line_height(px(if compact { 18.0 } else { 20.0 }))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(presentation.title),
                    )
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "body"))
                            .text_size(px(13.0))
                            .line_height(px(18.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(presentation.body),
                    )
                    .children(self.detail.map(|detail| {
                        div()
                            .debug_selector(part(id.clone(), "detail"))
                            .font_family(fonts::MONO_FAMILY)
                            .text_size(px(12.0))
                            .line_height(px(18.0))
                            .text_color(theme.role(ThemeRole::Text))
                            .child(detail)
                    }))
                    .children(self.path.map(|path| {
                        div()
                            .debug_selector(part(id.clone(), "path"))
                            .font_family(fonts::MONO_FAMILY)
                            .text_size(px(11.0))
                            .line_height(px(16.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(path)
                    })),
            );
        notice.into_any_element()
    }
}

/// Fixed identity lane above workspace content. Ready hides only its contents.
#[derive(IntoElement)]
pub struct WorkspaceLifecycleLane {
    pub id: SharedString,
    pub theme: Theme,
    pub name: SharedString,
    pub phase: WorkspaceLifecyclePhase,
    pub detail: Option<SharedString>,
    pub path: Option<SharedString>,
}

impl RenderOnce for WorkspaceLifecycleLane {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let visible = self.phase != WorkspaceLifecyclePhase::Ready;
        let notice: Option<AnyElement> = visible.then(|| {
            WorkspaceLifecycleNotice {
                id: format!("{id}-notice").into(),
                theme: self.theme,
                name: self.name,
                phase: self.phase,
                detail: self.detail,
                path: self.path,
                size: WorkspaceLifecycleNoticeSize::Compact,
            }
            .into_any_element()
        });
        div()
            .id(id.clone())
            .debug_selector(part(id, "root"))
            .w_full()
            .h(px(if visible { 0.0 } else { 0.0 }))
            .when(visible, |v| {
                v.h_auto()
                    .pt(px(LIFECYCLE_LANE_TOP_PADDING))
                    .px(px(LIFECYCLE_LANE_HORIZONTAL_PADDING))
            })
            .flex_none()
            .flex()
            .children(notice)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        App, Bounds, Context, Pixels, Render, TestAppContext, VisualTestContext, Window, px, size,
    };

    struct Fixture {
        theme: Theme,
        phase: WorkspaceLifecyclePhase,
        width: f32,
    }
    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            div()
                .w(px(self.width))
                .h_full()
                .flex()
                .flex_col()
                .child(WorkspaceLifecycleLane {
                    id: "lane".into(),
                    theme: self.theme,
                    name: "Native rewrite".into(),
                    phase: self.phase,
                    detail: Some("Host supplied detail".into()),
                    path: Some("/tmp/native-rewrite".into()),
                })
                .child(
                    div()
                        .debug_selector(|| "tabs-mounted".to_string())
                        .h(px(32.0))
                        .w_full(),
                )
        }
    }
    fn render(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        theme: Theme,
        phase: WorkspaceLifecyclePhase,
    ) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let (_, cx) = cx.add_window_view(move |_, _| Fixture {
            theme,
            phase,
            width,
        });
        cx.simulate_resize(size(px(width.max(720.0)), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        cx
    }
    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector).unwrap()
    }

    #[gpui::test]
    fn ready_lane_is_mounted_without_moving_the_mounted_tabs(cx: &mut TestAppContext) {
        let cx = render(
            cx,
            1280.0,
            800.0,
            Theme::light(),
            WorkspaceLifecyclePhase::Ready,
        );
        assert_eq!(bounds(cx, "lane.root").size, size(px(1280.0), px(0.0)));
        assert_eq!(bounds(cx, "tabs-mounted").size, size(px(1280.0), px(32.0)));
    }

    #[gpui::test]
    fn compact_failure_wraps_at_220_width_in_dark_geometry(cx: &mut TestAppContext) {
        let cx = render(
            cx,
            220.0,
            480.0,
            Theme::dark(),
            WorkspaceLifecyclePhase::Failed,
        );
        let lane = bounds(cx, "lane.root");
        let notice = bounds(cx, "lane-notice.root");
        let media = bounds(cx, "lane-notice.media");
        assert_eq!(notice.origin.x - lane.origin.x, px(12.0));
        assert_eq!(notice.size.width, px(196.0));
        assert_eq!(media.size, size(px(18.0), px(18.0)));
        assert!(
            notice.size.height > px(56.0),
            "narrow text wraps inside the notice"
        );
        assert_eq!(bounds(cx, "tabs-mounted").origin.y, lane.bottom());
    }

    #[gpui::test]
    fn every_non_ready_phase_renders_real_notice_content(cx: &mut TestAppContext) {
        for phase in [
            WorkspaceLifecyclePhase::Creating,
            WorkspaceLifecyclePhase::Archiving,
            WorkspaceLifecyclePhase::Archived,
            WorkspaceLifecyclePhase::Failed,
            WorkspaceLifecyclePhase::Refused,
            WorkspaceLifecyclePhase::Missing,
        ] {
            let cx = render(cx, 720.0, 480.0, Theme::light(), phase);
            assert!(bounds(cx, "lane-notice.body").size.height >= px(18.0));
        }
    }

    #[gpui::test]
    fn archiving_and_archived_have_distinct_real_presentations(cx: &mut TestAppContext) {
        let cx = render(
            cx,
            220.0,
            480.0,
            Theme::dark(),
            WorkspaceLifecyclePhase::Archiving,
        );
        assert_eq!(
            bounds(cx, "lane-notice.media").size,
            size(px(18.0), px(18.0))
        );
        assert!(bounds(cx, "lane-notice.title").size.height >= px(18.0));
        assert!(bounds(cx, "lane-notice.body").size.height >= px(18.0));

        let cx = render(
            cx,
            560.0,
            480.0,
            Theme::light(),
            WorkspaceLifecyclePhase::Archived,
        );
        assert_eq!(bounds(cx, "lane-notice.root").size.width, px(536.0));
        assert_eq!(
            bounds(cx, "lane-notice.media").size,
            size(px(18.0), px(18.0))
        );
        assert!(bounds(cx, "lane-notice.body").size.height >= px(18.0));
    }
}
