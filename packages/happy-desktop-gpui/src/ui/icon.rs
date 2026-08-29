use gpui::{
    App, Bounds, Hsla, IntoElement, Pixels, RenderOnce, SharedString, Window, canvas, div, point,
    prelude::*, px, quad, size, transparent_black,
};

use super::icon_data::{self, UpstreamIcon};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DrawnPanelGlyph {
    OpenLeft,
    CollapsedLeft,
    OpenRight,
    CollapsedRight,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum IconSource {
    Upstream(UpstreamIcon),
    DrawnPanel(DrawnPanelGlyph),
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct DrawnPanelGeometry {
    outline: Bounds<Pixels>,
    rail: Bounds<Pixels>,
}

/// Ports the one already-authorized drawn family from `happy-desktop-ui`.
/// No other curated name may use this path; all other icons remain upstream font glyphs.
fn drawn_panel_geometry(bounds: Bounds<Pixels>, glyph: DrawnPanelGlyph) -> DrawnPanelGeometry {
    let scale = bounds.size.width.min(bounds.size.height) / px(16.0);
    let origin = point(
        bounds.origin.x + (bounds.size.width - px(16.0) * scale) / 2.0,
        bounds.origin.y + (bounds.size.height - px(16.0) * scale) / 2.0,
    );
    let panel = |x: f32, y: f32, width: f32, height: f32| {
        Bounds::new(
            point(origin.x + px(x) * scale, origin.y + px(y) * scale),
            size(px(width) * scale, px(height) * scale),
        )
    };
    let rail = match glyph {
        DrawnPanelGlyph::OpenLeft => panel(5.0, 2.0, 1.0, 12.0),
        DrawnPanelGlyph::CollapsedLeft => panel(3.0, 4.0, 1.0, 8.0),
        DrawnPanelGlyph::OpenRight => panel(10.0, 2.0, 1.0, 12.0),
        DrawnPanelGlyph::CollapsedRight => panel(12.0, 4.0, 1.0, 8.0),
    };
    DrawnPanelGeometry {
        outline: panel(1.0, 2.0, 14.0, 12.0),
        rail,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconName {
    Home,
    Inbox,
    Chat,
    Agents,
    Tasks,
    Files,
    Search,
    Settings,
    Clock,
    History,
    Plus,
    Send,
    Check,
    CheckCircle,
    Copy,
    ChevronDown,
    ChevronRight,
    Close,
    Branch,
    Merge,
    Spark,
    Doc,
    Code,
    Braces,
    Plugin,
    Package,
    Image,
    Play,
    Stop,
    Pause,
    At,
    Hash,
    Bell,
    More,
    ArrowRight,
    ArrowUp,
    Shield,
    Lock,
    Eye,
    Link,
    Mobile,
    Smile,
    Paperclip,
    Mic,
    Users,
    Star,
    Reply,
    Zap,
    Terminal,
    Globe,
    Filter,
    Edit,
    Sun,
    Moon,
    Contrast,
    SidebarCollapse,
    SidebarExpand,
    PanelCollapse,
    PanelExpand,
    Trash,
    Archive,
    Alert,
    Unlink,
    Dot,
}

impl IconName {
    pub const ALL: [Self; 64] = [
        Self::Home,
        Self::Inbox,
        Self::Chat,
        Self::Agents,
        Self::Tasks,
        Self::Files,
        Self::Search,
        Self::Settings,
        Self::Clock,
        Self::History,
        Self::Plus,
        Self::Send,
        Self::Check,
        Self::CheckCircle,
        Self::Copy,
        Self::ChevronDown,
        Self::ChevronRight,
        Self::Close,
        Self::Branch,
        Self::Merge,
        Self::Spark,
        Self::Doc,
        Self::Code,
        Self::Braces,
        Self::Plugin,
        Self::Package,
        Self::Image,
        Self::Play,
        Self::Stop,
        Self::Pause,
        Self::At,
        Self::Hash,
        Self::Bell,
        Self::More,
        Self::ArrowRight,
        Self::ArrowUp,
        Self::Shield,
        Self::Lock,
        Self::Eye,
        Self::Link,
        Self::Mobile,
        Self::Smile,
        Self::Paperclip,
        Self::Mic,
        Self::Users,
        Self::Star,
        Self::Reply,
        Self::Zap,
        Self::Terminal,
        Self::Globe,
        Self::Filter,
        Self::Edit,
        Self::Sun,
        Self::Moon,
        Self::Contrast,
        Self::SidebarCollapse,
        Self::SidebarExpand,
        Self::PanelCollapse,
        Self::PanelExpand,
        Self::Trash,
        Self::Archive,
        Self::Alert,
        Self::Unlink,
        Self::Dot,
    ];

    const fn upstream_glyph(self) -> UpstreamIcon {
        match self {
            Self::Home => icon_data::ionicons::HOME_OUTLINE,
            Self::Inbox => icon_data::ionicons::FILE_TRAY_OUTLINE,
            Self::Chat => icon_data::ionicons::CHATBUBBLE_OUTLINE,
            Self::Agents => icon_data::ionicons::HARDWARE_CHIP_OUTLINE,
            Self::Tasks => icon_data::ionicons::CHECKBOX_OUTLINE,
            Self::Files => icon_data::ionicons::DOCUMENTS_OUTLINE,
            Self::Search => icon_data::ionicons::SEARCH_OUTLINE,
            Self::Settings => icon_data::ionicons::SETTINGS_OUTLINE,
            Self::Clock => icon_data::ionicons::TIME_OUTLINE,
            Self::History => icon_data::octicons::HISTORY,
            Self::Plus => icon_data::ionicons::ADD_OUTLINE,
            Self::Send => icon_data::ionicons::PAPER_PLANE_OUTLINE,
            Self::Check => icon_data::ionicons::CHECKMARK_OUTLINE,
            Self::CheckCircle => icon_data::ionicons::CHECKMARK_CIRCLE_OUTLINE,
            Self::Copy => icon_data::ionicons::COPY_OUTLINE,
            Self::ChevronDown => icon_data::ionicons::CHEVRON_DOWN_OUTLINE,
            Self::ChevronRight => icon_data::ionicons::CHEVRON_FORWARD_OUTLINE,
            Self::Close => icon_data::ionicons::CLOSE_OUTLINE,
            Self::Branch => icon_data::octicons::GIT_BRANCH,
            Self::Merge => icon_data::octicons::GIT_MERGE,
            Self::Spark => icon_data::ionicons::SPARKLES_OUTLINE,
            Self::Doc => icon_data::ionicons::DOCUMENT_TEXT_OUTLINE,
            Self::Code => icon_data::ionicons::CODE_SLASH_OUTLINE,
            Self::Braces => icon_data::octicons::CODE,
            Self::Plugin => icon_data::ionicons::EXTENSION_PUZZLE_OUTLINE,
            Self::Package => icon_data::ionicons::CUBE_OUTLINE,
            Self::Image => icon_data::ionicons::IMAGE_OUTLINE,
            Self::Play => icon_data::ionicons::PLAY_OUTLINE,
            Self::Stop => icon_data::ionicons::SQUARE,
            Self::Pause => icon_data::ionicons::PAUSE_OUTLINE,
            Self::At => icon_data::ionicons::AT_OUTLINE,
            Self::Hash => icon_data::octicons::HASH,
            Self::Bell => icon_data::ionicons::NOTIFICATIONS_OUTLINE,
            Self::More => icon_data::ionicons::ELLIPSIS_HORIZONTAL,
            Self::ArrowRight => icon_data::ionicons::ARROW_FORWARD_OUTLINE,
            Self::ArrowUp => icon_data::ionicons::ARROW_UP_OUTLINE,
            Self::Shield => icon_data::ionicons::SHIELD_CHECKMARK_OUTLINE,
            Self::Lock => icon_data::ionicons::LOCK_CLOSED_OUTLINE,
            Self::Eye => icon_data::ionicons::EYE_OUTLINE,
            Self::Link => icon_data::ionicons::LINK_OUTLINE,
            Self::Mobile => icon_data::ionicons::PHONE_PORTRAIT_OUTLINE,
            Self::Smile => icon_data::ionicons::HAPPY_OUTLINE,
            Self::Paperclip => icon_data::ionicons::ATTACH_OUTLINE,
            Self::Mic => icon_data::ionicons::MIC_OUTLINE,
            Self::Users => icon_data::ionicons::PEOPLE_OUTLINE,
            Self::Star => icon_data::ionicons::STAR_OUTLINE,
            Self::Reply => icon_data::ionicons::ARROW_UNDO_OUTLINE,
            Self::Zap => icon_data::ionicons::FLASH_OUTLINE,
            Self::Terminal => icon_data::ionicons::TERMINAL_OUTLINE,
            Self::Globe => icon_data::ionicons::GLOBE_OUTLINE,
            Self::Filter => icon_data::ionicons::FUNNEL_OUTLINE,
            Self::Edit => icon_data::ionicons::CREATE_OUTLINE,
            Self::Sun => icon_data::ionicons::SUNNY_OUTLINE,
            Self::Contrast => icon_data::ionicons::CONTRAST_OUTLINE,
            Self::Moon => icon_data::ionicons::MOON_OUTLINE,
            Self::SidebarCollapse
            | Self::SidebarExpand
            | Self::PanelCollapse
            | Self::PanelExpand => {
                panic!("the authorized panel family is drawn, not an upstream glyph")
            }
            Self::Trash => icon_data::ionicons::TRASH_OUTLINE,
            Self::Archive => icon_data::ionicons::ARCHIVE_OUTLINE,
            Self::Alert => icon_data::ionicons::ALERT_CIRCLE_OUTLINE,
            Self::Unlink => icon_data::ionicons::UNLINK_OUTLINE,
            Self::Dot => icon_data::ionicons::ELLIPSE,
        }
    }
}

impl IconName {
    const fn source(self) -> IconSource {
        match self {
            Self::SidebarCollapse => IconSource::DrawnPanel(DrawnPanelGlyph::OpenLeft),
            Self::SidebarExpand => IconSource::DrawnPanel(DrawnPanelGlyph::CollapsedLeft),
            Self::PanelCollapse => IconSource::DrawnPanel(DrawnPanelGlyph::OpenRight),
            Self::PanelExpand => IconSource::DrawnPanel(DrawnPanelGlyph::CollapsedRight),
            _ => IconSource::Upstream(self.upstream_glyph()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IconPurpose {
    Decorative,
    Labelled(SharedString),
}

#[derive(IntoElement)]
pub struct Icon {
    source: IconSource,
    size: f32,
    color: Hsla,
    selector: String,
    purpose: IconPurpose,
}

impl Icon {
    pub fn decorative(name: IconName, size: f32, color: Hsla, selector: impl Into<String>) -> Self {
        Self {
            source: name.source(),
            size,
            color,
            selector: selector.into(),
            purpose: IconPurpose::Decorative,
        }
    }

    pub fn labelled(
        name: IconName,
        label: impl Into<SharedString>,
        size: f32,
        color: Hsla,
        selector: impl Into<String>,
    ) -> Self {
        Self {
            source: name.source(),
            size,
            color,
            selector: selector.into(),
            purpose: IconPurpose::Labelled(label.into()),
        }
    }

    #[allow(dead_code)] // Full upstream API is consumed as later product surfaces are ported.
    pub fn upstream(
        glyph: UpstreamIcon,
        size: f32,
        color: Hsla,
        selector: impl Into<String>,
    ) -> Self {
        Self {
            source: IconSource::Upstream(glyph),
            size,
            color,
            selector: selector.into(),
            purpose: IconPurpose::Decorative,
        }
    }
}

impl RenderOnce for Icon {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let selector = self.selector;
        let label_selector = format!("{selector}.accessible-label");
        let purpose = self.purpose;
        let size = self.size;
        let color = self.color;
        let content = match self.source {
            IconSource::Upstream(glyph) => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .font_family(glyph.family)
                .text_size(px(size))
                .line_height(px(size))
                .child(glyph.glyph.to_string())
                .into_any_element(),
            IconSource::DrawnPanel(glyph) => canvas(
                move |bounds, _, _| bounds,
                move |bounds, _, window, _| {
                    let geometry = drawn_panel_geometry(bounds, glyph);
                    let scale = bounds.size.width.min(bounds.size.height) / px(16.0);
                    window.paint_quad(quad(
                        geometry.outline,
                        px(2.0) * scale,
                        transparent_black(),
                        px(1.0) * scale,
                        color,
                        Default::default(),
                    ));
                    window.paint_quad(quad(
                        geometry.rail,
                        px(0.5) * scale,
                        color,
                        px(0.0),
                        transparent_black(),
                        Default::default(),
                    ));
                },
            )
            .size_full()
            .into_any_element(),
        };
        div()
            .debug_selector(move || selector.clone())
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .size(px(size))
            .text_color(color)
            .child(content)
            .children(match purpose {
                IconPurpose::Decorative => None,
                IconPurpose::Labelled(label) => Some(
                    div()
                        .debug_selector(move || label_selector.clone())
                        .absolute()
                        .size(px(0.0))
                        .overflow_hidden()
                        .child(label),
                ),
            })
    }
}

#[cfg(test)]
mod geometry_tests {
    use super::*;
    use gpui::{
        App, Bounds, Context, Pixels, Render, TestAppContext, VisualTestContext, Window, div, px,
        size,
    };

    struct Fixture;
    impl Render for Fixture {
        fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .flex()
                .child(Icon::decorative(
                    IconName::Home,
                    20.0,
                    gpui::rgb(0).into(),
                    "test-icon",
                ))
                .child(Icon::labelled(
                    IconName::Search,
                    "Search",
                    20.0,
                    gpui::rgb(0).into(),
                    "test-labelled-icon",
                ))
                .child(Icon::decorative(
                    IconName::SidebarCollapse,
                    16.0,
                    gpui::rgb(0).into(),
                    "panel-open-left",
                ))
                .child(Icon::decorative(
                    IconName::SidebarExpand,
                    16.0,
                    gpui::rgb(0).into(),
                    "panel-collapsed-left",
                ))
                .child(Icon::decorative(
                    IconName::PanelCollapse,
                    16.0,
                    gpui::rgb(0).into(),
                    "panel-open-right",
                ))
                .child(Icon::decorative(
                    IconName::PanelExpand,
                    16.0,
                    gpui::rgb(0).into(),
                    "panel-collapsed-right",
                ))
        }
    }
    fn render(cx: &mut TestAppContext) -> &mut VisualTestContext {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let (_, cx) = cx.add_window_view(|_, _| Fixture);
        cx.simulate_resize(size(px(120.0), px(80.0)));
        cx.run_until_parked();
        cx
    }
    #[gpui::test]
    fn icon_resolves_square_and_both_complete_upstream_fonts_paint(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_eq!(
            cx.debug_bounds("test-icon"),
            Some(Bounds::new(
                gpui::point(px(0.0), px(0.0)),
                size(px(20.0), px(20.0))
            ))
        );
        assert_eq!(
            cx.debug_bounds("test-labelled-icon"),
            Some(Bounds::new(
                gpui::point(px(20.0), px(0.0)),
                size(px(20.0), px(20.0))
            ))
        );
        assert_eq!(
            cx.debug_bounds("test-labelled-icon.accessible-label")
                .unwrap()
                .size,
            size(px(0.0), px(0.0))
        );
        cx.update(|window, app| {
            assert_eq!(
                window.scale_factor(),
                2.0,
                "GPUI test platform resolves Retina geometry at 2×"
            );
            for glyph in [
                icon_data::ionicons::ACCESSIBILITY,
                icon_data::ionicons::HOME_OUTLINE,
                icon_data::ionicons::WOMAN_SHARP,
                icon_data::octicons::ACCESSIBILITY,
                icon_data::octicons::GIT_BRANCH,
                icon_data::octicons::ZOOM_OUT,
            ] {
                let face = app.text_system().resolve_font(&gpui::font(glyph.family));
                let ink = app
                    .text_system()
                    .typographic_bounds(face, px(20.0), glyph.glyph)
                    .expect("registered upstream glyph must resolve");
                assert!(
                    ink.size.width > Pixels::ZERO && ink.size.height > Pixels::ZERO,
                    "{} U+{:04X} paints ink",
                    glyph.family,
                    glyph.glyph as u32
                );
            }
        });
    }

    #[gpui::test]
    fn authorized_panel_family_renders_exact_ionicon_box_metrics_and_mirrors(
        cx: &mut TestAppContext,
    ) {
        let cx = render(cx);
        for (selector, x) in [
            ("panel-open-left", 40.0),
            ("panel-collapsed-left", 56.0),
            ("panel-open-right", 72.0),
            ("panel-collapsed-right", 88.0),
        ] {
            assert_eq!(
                cx.debug_bounds(selector),
                Some(Bounds::new(
                    gpui::point(px(x), px(0.0)),
                    size(px(16.0), px(16.0))
                ))
            );
        }

        let bounds = Bounds::new(gpui::point(px(0.0), px(0.0)), size(px(16.0), px(16.0)));
        let expected_outline = Bounds::new(gpui::point(px(1.0), px(2.0)), size(px(14.0), px(12.0)));
        for (glyph, expected_rail) in [
            (
                DrawnPanelGlyph::OpenLeft,
                Bounds::new(gpui::point(px(5.0), px(2.0)), size(px(1.0), px(12.0))),
            ),
            (
                DrawnPanelGlyph::CollapsedLeft,
                Bounds::new(gpui::point(px(3.0), px(4.0)), size(px(1.0), px(8.0))),
            ),
            (
                DrawnPanelGlyph::OpenRight,
                Bounds::new(gpui::point(px(10.0), px(2.0)), size(px(1.0), px(12.0))),
            ),
            (
                DrawnPanelGlyph::CollapsedRight,
                Bounds::new(gpui::point(px(12.0), px(4.0)), size(px(1.0), px(8.0))),
            ),
        ] {
            let geometry = drawn_panel_geometry(bounds, glyph);
            assert_eq!(geometry.outline, expected_outline);
            assert_eq!(geometry.rail, expected_rail);
        }
        assert!(matches!(
            IconName::SidebarCollapse.source(),
            IconSource::DrawnPanel(_)
        ));
        assert!(matches!(
            IconName::PanelExpand.source(),
            IconSource::DrawnPanel(_)
        ));
        assert!(matches!(IconName::Home.source(), IconSource::Upstream(_)));
    }
}
