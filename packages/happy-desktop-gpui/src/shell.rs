use gpui::{
    Context, FontWeight, IntoElement, Render, Window, WindowAppearance, div, prelude::*, px,
};

use crate::icons;
use crate::theme::Theme;

const TITLE_HEIGHT: f32 = 40.0;
const SIDEBAR_WIDTH: f32 = 288.0;
const PANEL_WIDTH: f32 = 340.0;
const ROW_HEIGHT: f32 = 32.0;

pub struct HappyApp {
    dark_override: Option<bool>,
}

impl HappyApp {
    pub fn new() -> Self {
        Self {
            dark_override: None,
        }
    }

    fn is_dark(&self, window: &Window) -> bool {
        self.dark_override.unwrap_or(matches!(
            window.appearance(),
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        ))
    }

    fn sidebar_row(
        &self,
        theme: Theme,
        glyph: char,
        label: &'static str,
        selected: bool,
    ) -> impl IntoElement {
        div()
            .debug_selector(|| format!("sidebar-row-{label}"))
            .flex()
            .items_center()
            .h(px(ROW_HEIGHT))
            .mx(px(6.0))
            .px(px(8.0))
            .gap(px(8.0))
            .rounded(px(6.0))
            .when(selected, |row| row.bg(theme.selected))
            .child(icons::ionicon(glyph, 16.0, theme.text))
            .child(
                div()
                    .debug_selector(|| format!("sidebar-row-label-{label}"))
                    .flex_1()
                    .text_size(px(13.0))
                    .child(label),
            )
    }

    fn section_label(&self, theme: Theme, label: &'static str) -> impl IntoElement {
        div()
            .h(px(28.0))
            .flex()
            .items_center()
            .px(px(14.0))
            .text_size(px(11.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(theme.secondary_text)
            .child(label)
    }

    fn title_bar(&self, theme: Theme, label: &'static str) -> impl IntoElement {
        div()
            .debug_selector(|| format!("title-bar-{label}"))
            .h(px(TITLE_HEIGHT))
            .flex_none()
            .flex()
            .items_center()
            .px(px(12.0))
            .border_b_1()
            .border_color(theme.divider)
            .font_weight(FontWeight::SEMIBOLD)
            .text_size(px(13.0))
            .child(label)
    }

    fn sidebar(&self, theme: Theme, cx: &mut Context<Self>) -> impl IntoElement {
        let toggle_label = if self.dark_override == Some(true) {
            "Light appearance"
        } else {
            "Dark appearance"
        };

        div()
            .debug_selector(|| "sidebar-root".into())
            .w(px(SIDEBAR_WIDTH))
            .min_w(px(220.0))
            .flex_none()
            .flex()
            .flex_col()
            .bg(theme.chrome)
            .border_r_1()
            .border_color(theme.divider)
            .child(
                div()
                    .debug_selector(|| "sidebar-header".into())
                    .h(px(TITLE_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_end()
                    .px(px(10.0))
                    .border_b_1()
                    .border_color(theme.divider)
                    .child(
                        div()
                            .id("new-workspace")
                            .flex()
                            .items_center()
                            .gap(px(5.0))
                            .px(px(7.0))
                            .h(px(28.0))
                            .rounded(px(6.0))
                            .text_color(theme.link)
                            .child(icons::ionicon(icons::ADD, 16.0, theme.link))
                            .child(div().text_size(px(12.0)).child("New")),
                    ),
            )
            .child(
                div()
                    .debug_selector(|| "sidebar-body".into())
                    .flex_1()
                    .overflow_hidden()
                    .pt(px(6.0))
                    .child(self.sidebar_row(theme, icons::CHAT, "Create", false))
                    .child(self.sidebar_row(theme, icons::PEOPLE, "Happy Social", false))
                    .child(self.section_label(theme, "THIS MAC"))
                    .child(self.sidebar_row(theme, icons::HOME, "Happy", true))
                    .child(div().ml(px(18.0)).child(self.sidebar_row(
                        theme,
                        icons::CHAT,
                        "GPUI rewrite",
                        false,
                    )))
                    .child(self.section_label(theme, "PROJECTS"))
                    .child(self.sidebar_row(theme, icons::DOCUMENTS, "happy-desktop", false))
                    .child(div().ml(px(18.0)).child(self.sidebar_row(
                        theme,
                        icons::CHAT,
                        "Native app",
                        false,
                    ))),
            )
            .child(
                div()
                    .debug_selector(|| "sidebar-footer".into())
                    .h(px(40.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .px(px(8.0))
                    .gap(px(4.0))
                    .border_t_1()
                    .border_color(theme.divider)
                    .child(
                        div()
                            .id("theme-toggle")
                            .flex_1()
                            .h(px(28.0))
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .px(px(7.0))
                            .rounded(px(6.0))
                            .cursor_pointer()
                            .hover(move |button| button.bg(theme.inset))
                            .child(icons::ionicon(icons::SETTINGS, 16.0, theme.text))
                            .child(div().text_size(px(12.0)).child(toggle_label))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.dark_override = Some(!this.is_dark(window));
                                cx.notify();
                            })),
                    ),
            )
    }

    fn tabs(&self, theme: Theme) -> impl IntoElement {
        div()
            .debug_selector(|| "tabs-root".into())
            .h(px(40.0))
            .flex_none()
            .flex()
            .items_end()
            .px(px(8.0))
            .border_b_1()
            .border_color(theme.divider)
            .child(
                div()
                    .debug_selector(|| "tabs-selected".into())
                    .h(px(32.0))
                    .flex()
                    .items_center()
                    .gap(px(7.0))
                    .px(px(10.0))
                    .bg(theme.selected)
                    .rounded_t(px(6.0))
                    .text_size(px(12.0))
                    .child(div().size(px(8.0)).rounded_full().bg(theme.link))
                    .child(
                        div()
                            .debug_selector(|| "tabs-selected-label".into())
                            .child("Native Happy rewrite"),
                    ),
            )
            .child(
                div()
                    .h(px(32.0))
                    .flex()
                    .items_center()
                    .px(px(10.0))
                    .text_color(theme.secondary_text)
                    .text_size(px(12.0))
                    .child("Cargo.toml"),
            )
    }

    fn transcript(&self, theme: Theme) -> impl IntoElement {
        div()
            .debug_selector(|| "transcript-root".into())
            .flex_1()
            .overflow_hidden()
            .bg(theme.surface)
            .child(
                div()
                    .debug_selector(|| "transcript-content".into())
                    .h_full()
                    .flex()
                    .flex_col()
                    .justify_end()
                    .gap(px(18.0))
                    .px(px(32.0))
                    .pb(px(24.0))
                    .child(
                        div()
                            .debug_selector(|| "transcript-first-message".into())
                            .flex()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .size(px(28.0))
                                    .rounded(px(8.0))
                                    .bg(theme.inset)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_size(px(11.0))
                                    .child("S"),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .gap(px(5.0))
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child("Steve"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .line_height(px(20.0))
                                            .child("Rewrite Happy as a native Rust app with GPUI, while keeping the Electron app intact."),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(10.0))
                            .child(
                                div()
                                    .size(px(28.0))
                                    .rounded_full()
                                    .bg(theme.link)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child(icons::ionicon(icons::TERMINAL, 14.0, theme.surface)),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .gap(px(8.0))
                                    .child(
                                        div()
                                            .text_size(px(12.0))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child("Happy"),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .line_height(px(20.0))
                                            .child("Phase 1 establishes the native window, exact shell geometry, theme tokens, and versioned macOS packaging."),
                                    )
                                    .child(
                                        div()
                                            .h(px(34.0))
                                            .flex()
                                            .items_center()
                                            .gap(px(8.0))
                                            .px(px(10.0))
                                            .rounded(px(6.0))
                                            .bg(theme.raised)
                                            .text_size(px(12.0))
                                            .text_color(theme.secondary_text)
                                            .child(icons::ionicon(
                                                icons::TERMINAL,
                                                14.0,
                                                theme.secondary_text,
                                            ))
                                            .child("cargo build --release"),
                                    ),
                            ),
                    ),
            )
    }

    fn composer(&self, theme: Theme) -> impl IntoElement {
        div()
            .debug_selector(|| "composer-wrap".into())
            .flex_none()
            .px(px(24.0))
            .pb(px(18.0))
            .bg(theme.surface)
            .child(
                div()
                    .debug_selector(|| "composer-card".into())
                    .h(px(92.0))
                    .flex()
                    .flex_col()
                    .justify_between()
                    .p(px(12.0))
                    .rounded(px(10.0))
                    .border_1()
                    .border_color(theme.divider)
                    .bg(theme.root)
                    .child(
                        div()
                            .debug_selector(|| "composer-placeholder".into())
                            .text_size(px(14.0))
                            .text_color(theme.secondary_text)
                            .child("Message Happy in “happy-desktop”…"),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .flex()
                                    .gap(px(12.0))
                                    .text_size(px(11.0))
                                    .text_color(theme.secondary_text)
                                    .child("Codex")
                                    .child("Full access")
                                    .child("High"),
                            )
                            .child(
                                div()
                                    .size(px(28.0))
                                    .rounded(px(6.0))
                                    .bg(theme.text)
                                    .text_color(theme.surface)
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child("↑"),
                            ),
                    ),
            )
    }

    fn workspace(&self, theme: Theme) -> impl IntoElement {
        div()
            .debug_selector(|| "workspace-root".into())
            .flex_1()
            .flex()
            .flex_col()
            .min_w(px(140.0))
            .bg(theme.surface)
            .child(self.title_bar(
                theme,
                "happy-desktop  ·  /Users/steve/Happy/Workspaces/happy-desktop",
            ))
            .child(self.tabs(theme))
            .child(self.transcript(theme))
            .child(self.composer(theme))
    }

    fn inspector(&self, theme: Theme) -> impl IntoElement {
        div()
            .debug_selector(|| "inspector-root".into())
            .w(px(PANEL_WIDTH))
            .min_w(px(280.0))
            .flex_none()
            .flex()
            .flex_col()
            .bg(theme.surface)
            .border_l_1()
            .border_color(theme.divider)
            .child(self.title_bar(theme, "Files"))
            .child(
                div()
                    .debug_selector(|| "inspector-scope".into())
                    .h(px(32.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .px(px(8.0))
                    .child(
                        div()
                            .debug_selector(|| "inspector-scope-changes".into())
                            .h(px(24.0))
                            .flex()
                            .items_center()
                            .px(px(8.0))
                            .rounded(px(6.0))
                            .bg(theme.selected)
                            .text_size(px(11.0))
                            .child("Changes"),
                    )
                    .child(
                        div()
                            .h(px(24.0))
                            .flex()
                            .items_center()
                            .px(px(8.0))
                            .text_size(px(11.0))
                            .text_color(theme.secondary_text)
                            .child("All Files"),
                    ),
            )
            .child(
                div()
                    .px(px(6.0))
                    .pt(px(6.0))
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(file_row(
                        theme,
                        "M",
                        "src/main.rs",
                        "+214  −0",
                        theme.warning,
                    ))
                    .child(file_row(
                        theme,
                        "A",
                        "src/theme.rs",
                        "+52  −0",
                        theme.success,
                    ))
                    .child(file_row(
                        theme,
                        "A",
                        "scripts/package-macos.sh",
                        "+61  −0",
                        theme.success,
                    ))
                    .child(file_row(
                        theme,
                        "A",
                        "docs/plans/native-gpui-rewrite.md",
                        "+118  −0",
                        theme.success,
                    )),
            )
    }
}

fn file_row(
    theme: Theme,
    status: &'static str,
    path: &'static str,
    stats: &'static str,
    status_color: gpui::Rgba,
) -> impl IntoElement {
    div()
        .debug_selector(|| format!("file-row-{path}"))
        .h(px(32.0))
        .flex()
        .items_center()
        .gap(px(7.0))
        .px(px(7.0))
        .rounded(px(6.0))
        .text_size(px(12.0))
        .child(
            div()
                .debug_selector(|| format!("file-row-status-{path}"))
                .w(px(14.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(status_color)
                .child(status),
        )
        .child(
            div()
                .debug_selector(|| format!("file-row-path-{path}"))
                .flex_1()
                .overflow_hidden()
                .child(path),
        )
        .child(
            div()
                .debug_selector(|| format!("file-row-stats-{path}"))
                .text_size(px(10.0))
                .text_color(theme.secondary_text)
                .child(stats),
        )
}

impl Render for HappyApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = if self.is_dark(window) {
            Theme::dark()
        } else {
            Theme::light()
        };

        div()
            .debug_selector(|| "app-shell-root".into())
            .size_full()
            .flex()
            .bg(theme.root)
            .text_color(theme.text)
            .font_family("Figtree")
            .child(self.sidebar(theme, cx))
            .child(self.workspace(theme))
            .child(self.inspector(theme))
    }
}

#[cfg(test)]
mod geometry_tests {
    use gpui::{Bounds, Pixels, TestAppContext, VisualTestContext, px, size};

    use super::HappyApp;

    const WIDTH: f32 = 1280.0;
    const HEIGHT: f32 = 800.0;

    fn render(cx: &mut TestAppContext) -> &mut VisualTestContext {
        cx.update(|cx| crate::fonts::register(cx));
        let (_, cx) = cx.add_window_view(|_, _| HappyApp::new());
        cx.simulate_resize(size(px(WIDTH), px(HEIGHT)));
        cx.run_until_parked();
        cx
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
        assert_rect(bounds(cx, "sidebar-root"), 0.0, 0.0, 288.0, 800.0);
        assert_rect(bounds(cx, "workspace-root"), 288.0, 0.0, 652.0, 800.0);
        assert_rect(bounds(cx, "inspector-root"), 940.0, 0.0, 340.0, 800.0);
    }

    #[gpui::test]
    fn sidebar_resolves_header_body_footer_and_row_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(bounds(cx, "sidebar-header"), 0.0, 0.0, 287.0, 40.0);
        assert_rect(bounds(cx, "sidebar-body"), 0.0, 40.0, 287.0, 720.0);
        assert_rect(bounds(cx, "sidebar-footer"), 0.0, 760.0, 287.0, 40.0);

        let row = bounds(cx, "sidebar-row-Happy");
        assert_rect(row, 6.0, 138.0, 275.0, 32.0);
        let icon = bounds(cx, "ionicon-44");
        assert_rect(icon, 14.0, 146.0, 16.0, 16.0);
        let label = bounds(cx, "sidebar-row-label-Happy");
        assert_eq!(
            label.origin.x - row.origin.x,
            px(32.0),
            "8px left padding + 16px icon + 8px gap"
        );
        assert_eq!(
            row.right() - label.right(),
            px(8.0),
            "resolved right padding"
        );
    }

    #[gpui::test]
    fn workspace_resolves_native_header_tabs_transcript_and_composer(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(
            bounds(
                cx,
                "title-bar-happy-desktop  ·  /Users/steve/Happy/Workspaces/happy-desktop",
            ),
            288.0,
            0.0,
            652.0,
            40.0,
        );
        assert_rect(bounds(cx, "tabs-root"), 288.0, 40.0, 652.0, 40.0);
        assert_rect(bounds(cx, "transcript-root"), 288.0, 80.0, 652.0, 610.0);
        assert_rect(bounds(cx, "composer-wrap"), 288.0, 690.0, 652.0, 110.0);
    }

    #[gpui::test]
    fn tabs_resolve_inset_selected_tab_and_content_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        let tabs = bounds(cx, "tabs-root");
        let selected = bounds(cx, "tabs-selected");
        let label = bounds(cx, "tabs-selected-label");
        assert_eq!(selected.origin.x, px(296.0), "resolved selected-tab x");
        assert_eq!(
            selected.origin.y,
            px(47.0),
            "32px tab sits above the 1px strip rule"
        );
        assert_eq!(selected.size.height, px(32.0), "small tab height");
        assert_eq!(
            selected.origin.x - tabs.origin.x,
            px(8.0),
            "tab strip inset"
        );
        assert_eq!(
            label.origin.x - selected.origin.x,
            px(25.0),
            "10px padding + 8px dot + 7px gap"
        );
        assert_eq!(
            selected.right() - label.right(),
            px(10.0),
            "selected tab right padding"
        );
    }

    #[gpui::test]
    fn transcript_resolves_full_bleed_scroll_region_and_inner_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        let transcript = bounds(cx, "transcript-root");
        let content = bounds(cx, "transcript-content");
        let first_message = bounds(cx, "transcript-first-message");
        assert_eq!(
            content, transcript,
            "the scroll/content region stays full bleed"
        );
        assert_eq!(
            first_message.origin.x - content.origin.x,
            px(32.0),
            "inner left padding"
        );
        assert_eq!(
            content.right() - first_message.right(),
            px(32.0),
            "inner right padding"
        );
    }

    #[gpui::test]
    fn composer_resolves_outer_gutter_card_height_and_card_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        let wrap = bounds(cx, "composer-wrap");
        let card = bounds(cx, "composer-card");
        let placeholder = bounds(cx, "composer-placeholder");
        assert_rect(card, 312.0, 690.0, 604.0, 92.0);
        assert_eq!(
            card.origin.x - wrap.origin.x,
            px(24.0),
            "composer left gutter"
        );
        assert_eq!(
            wrap.right() - card.right(),
            px(24.0),
            "composer right gutter"
        );
        assert_eq!(
            wrap.bottom() - card.bottom(),
            px(18.0),
            "composer bottom gutter"
        );
        assert_eq!(
            placeholder.origin.x - card.origin.x,
            px(13.0),
            "1px border plus 12px card left padding"
        );
        assert_eq!(
            placeholder.origin.y - card.origin.y,
            px(13.0),
            "1px border plus 12px card top padding"
        );
    }

    #[gpui::test]
    fn inspector_resolves_header_scope_and_file_list_insets(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(bounds(cx, "title-bar-Files"), 941.0, 0.0, 339.0, 40.0);
        assert_rect(bounds(cx, "inspector-scope"), 941.0, 40.0, 339.0, 32.0);
        let changes = bounds(cx, "inspector-scope-changes");
        assert_eq!(
            changes.origin.x,
            px(949.0),
            "scope left padding after panel border"
        );
        assert_eq!(changes.origin.y, px(44.0), "scope vertical centering");
        assert_eq!(changes.size.height, px(24.0), "file sub-control height");
        let row = bounds(cx, "file-row-src/main.rs");
        assert_rect(row, 947.0, 78.0, 327.0, 32.0);
    }

    #[gpui::test]
    fn file_row_resolves_status_path_stats_and_padding(cx: &mut TestAppContext) {
        let cx = render(cx);
        let row = bounds(cx, "file-row-src/main.rs");
        let status = bounds(cx, "file-row-status-src/main.rs");
        let path = bounds(cx, "file-row-path-src/main.rs");
        let stats = bounds(cx, "file-row-stats-src/main.rs");
        assert_eq!(status.origin.x - row.origin.x, px(7.0), "row left padding");
        assert_eq!(status.size.width, px(14.0), "fixed status lane");
        assert_eq!(path.origin.x - status.right(), px(7.0), "status/path gap");
        assert_eq!(stats.origin.x - path.right(), px(7.0), "path/stats gap");
        assert_eq!(row.right() - stats.right(), px(7.0), "row right padding");
        assert_eq!(row.size.height, px(32.0), "design-system row height");
    }

    #[gpui::test]
    fn ionicon_component_resolves_declared_square(cx: &mut TestAppContext) {
        let cx = render(cx);
        assert_rect(bounds(cx, "ionicon-44"), 14.0, 146.0, 16.0, 16.0);
        let ink = cx.update(|_, app| {
            let face = app
                .text_system()
                .resolve_font(&gpui::font("Happy Ionicons"));
            app.text_system()
                .typographic_bounds(face, px(16.0), crate::icons::HOME)
                .expect("the exact upstream home-outline glyph must resolve")
        });
        assert!(ink.size.width > px(0.0), "font glyph paints horizontal ink");
        assert!(ink.size.height > px(0.0), "font glyph paints vertical ink");
    }
}
