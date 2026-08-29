use crate::components::channel_header::channel_header;
use crate::components::conversation::conversation;
use crate::components::document_surface::document_surface;
use crate::components::file_browser::file_browser;
use crate::components::file_editor::file_editor;
use crate::components::file_preview::file_preview;
use crate::components::inbox::inbox;
use crate::components::rail::{interactive_rail, rail};
use crate::components::settings::settings;
use crate::components::sidebar::{interactive_sidebar, sidebar};
use crate::components::terminal_panel::terminal_panel;
use crate::components::title_bar::title_bar;
use crate::design::geometry::sidebar_width;
use crate::design::theme::{Theme, UI_FONT};
use crate::state::runtime::RuntimeSnapshot;
use gpui::{Context, Div, FontWeight, Window, div, prelude::*, px};

pub struct AppShell {
    dark: bool,
    selected_rail: usize,
    selected_sidebar: usize,
    runtime: RuntimeSnapshot,
}

impl AppShell {
    pub fn new(
        dark: bool,
        selected_rail: usize,
        selected_sidebar: usize,
        runtime: RuntimeSnapshot,
    ) -> Self {
        Self {
            dark,
            selected_rail,
            selected_sidebar,
            runtime,
        }
    }

    pub fn render(self, window: &mut Window, cx: &mut Context<crate::HappyApp>) -> Div {
        let theme = if self.dark {
            Theme::dark()
        } else {
            Theme::light()
        };
        let window_width: f32 = window.bounds().size.width.into();
        interactive_shell(
            theme,
            self.dark,
            self.selected_rail,
            self.selected_sidebar,
            window_width,
            &self.runtime,
            cx,
        )
    }
}

fn interactive_shell(
    theme: Theme,
    dark: bool,
    selected_rail: usize,
    selected_sidebar: usize,
    width: f32,
    runtime: &RuntimeSnapshot,
    cx: &mut Context<crate::HappyApp>,
) -> Div {
    let sidebar_width = sidebar_width(width);
    let content = div()
        .debug_selector(|| "app-shell-content".to_owned())
        .flex()
        .flex_1()
        .min_h_0()
        .w_full()
        .child(interactive_rail(theme, selected_rail, dark, cx))
        .child(if selected_rail == 1 {
            file_browser(theme, sidebar_width)
        } else {
            interactive_sidebar(theme, selected_sidebar, sidebar_width, cx)
        })
        .child(workspace(
            theme,
            selected_rail,
            selected_sidebar,
            Some(runtime),
        ))
        .child(if selected_rail == 1 {
            file_preview(theme, sidebar_width)
        } else {
            terminal_panel(theme, sidebar_width)
        });

    div()
        .debug_selector(|| "app-shell".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .min_w(px(720.0))
        .min_h(px(480.0))
        .overflow_hidden()
        .bg(theme.chrome)
        .font_family(UI_FONT)
        .text_color(theme.text)
        .child(title_bar(theme))
        .child(content)
}

pub fn shell(
    theme: Theme,
    selected_rail: usize,
    selected_sidebar: usize,
    width: f32,
    panel: bool,
) -> Div {
    let sidebar_width = sidebar_width(width);
    let mut content = div()
        .debug_selector(|| "app-shell-content".to_owned())
        .flex()
        .flex_1()
        .min_h_0()
        .w_full()
        .child(rail(theme, selected_rail))
        .child(sidebar(theme, selected_sidebar, sidebar_width))
        .child(workspace(theme, selected_rail, selected_sidebar, None));
    if panel {
        content = content.child(inspector(theme, sidebar_width));
    }

    div()
        .debug_selector(|| "app-shell".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .min_w(px(720.0))
        .min_h(px(480.0))
        .overflow_hidden()
        .bg(theme.chrome)
        .font_family(UI_FONT)
        .text_color(theme.text)
        .child(title_bar(theme))
        .child(content)
}

fn workspace(
    theme: Theme,
    selected_rail: usize,
    selected_sidebar: usize,
    runtime: Option<&RuntimeSnapshot>,
) -> Div {
    let body = match selected_rail {
        0 if selected_sidebar == 6 => document_surface(theme),
        0 => conversation(theme),
        1 => file_editor(theme),
        2 => inbox(theme),
        _ => settings(theme),
    };
    let (title, fixture_subtitle, action) = match selected_rail {
        0 if selected_sidebar == 6 => ("Documents", "Owned by this Happy Agent", "New document"),
        0 => ("Rust rewrite", "Native GPUI app parity", "New session"),
        1 => ("Files", "Changes and all files", "New file"),
        2 => ("Inbox", "Activity across Happy Agents", "Mark all read"),
        _ => ("Settings", "Local and remote Happy Agents", "Done"),
    };
    let subtitle = runtime
        .map(|snapshot| snapshot.message.as_ref())
        .unwrap_or(fixture_subtitle);
    div()
        .debug_selector(|| "app-shell-workspace".to_owned())
        .flex()
        .flex_1()
        .min_w_0()
        .flex_col()
        .h_full()
        .bg(theme.surface)
        .child(channel_header(theme, title, subtitle, action))
        .child(body)
}

fn inspector(theme: Theme, width: f32) -> Div {
    div()
        .debug_selector(|| "app-shell-panel".to_owned())
        .flex()
        .flex_none()
        .flex_col()
        .w(px(width))
        .h_full()
        .border_l_1()
        .border_color(theme.divider)
        .bg(theme.surface)
        .child(
            div()
                .flex()
                .items_center()
                .h(px(56.0))
                .px(px(16.0))
                .text_size(px(15.0))
                .font_weight(FontWeight::BOLD)
                .child("Activity"),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(12.0))
                .p(px(16.0))
                .text_size(px(13.0))
                .text_color(theme.text_secondary)
                .child("●  Reading the design contract")
                .child("●  Building the native shell")
                .child("○  Porting conversations next"),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::HappyApp;
    use crate::design::geometry::{RAIL_WIDTH, TITLE_BAR_HEIGHT, point_px, rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{Modifiers, TestAppContext, point, px};

    #[gpui::test]
    fn rendered_shell_matches_design_reference_regions(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(1280.0, 800.0), |_, _| {
            shell(Theme::light(), 0, 1, 1280.0, true)
        });
        assert_eq!(
            cx.debug_bounds("app-shell"),
            Some(rect(0.0, 0.0, 1280.0, 800.0))
        );
        assert_eq!(
            cx.debug_bounds("title-bar"),
            Some(rect(0.0, 0.0, 1280.0, TITLE_BAR_HEIGHT))
        );
        assert_eq!(
            cx.debug_bounds("app-shell-content"),
            Some(rect(0.0, 56.0, 1280.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("rail"),
            Some(rect(0.0, 56.0, RAIL_WIDTH, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar"),
            Some(rect(64.0, 56.0, 360.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("app-shell-workspace"),
            Some(rect(424.0, 56.0, 496.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("app-shell-panel"),
            Some(rect(920.0, 56.0, 360.0, 744.0))
        );
    }

    #[gpui::test]
    fn pointer_navigation_updates_stable_app_state_at_rendered_coordinates(
        cx: &mut TestAppContext,
    ) {
        register_fonts(cx.text_system());
        let (app, cx) = cx.add_window_view(|_, _| HappyApp::default());
        cx.simulate_resize(size_px(1280.0, 800.0));
        cx.run_until_parked();

        assert_eq!(cx.read(|app_cx| app.read(app_cx).selected_rail), 0);
        assert_eq!(cx.read(|app_cx| app.read(app_cx).selected_sidebar), 1);
        assert!(!cx.read(|app_cx| app.read(app_cx).dark));

        // The Files rail item is x=6…58, y=160…208 in the complete window.
        cx.simulate_click(point_px(32.0, 184.0), Modifiers::default());
        assert_eq!(cx.read(|app_cx| app.read(app_cx).selected_rail), 1);
        assert!(cx.debug_bounds("file-browser").is_some());
        assert!(cx.debug_bounds("file-editor").is_some());

        // Return to Chats so the chat hierarchy owns the navigation lane again.
        cx.simulate_click(point_px(32.0, 132.0), Modifiers::default());
        assert_eq!(cx.read(|app_cx| app.read(app_cx).selected_rail), 0);

        // Sidebar row 3 is x=70…418, y=280…312 in the complete window.
        cx.simulate_click(point_px(100.0, 296.0), Modifiers::default());
        assert_eq!(cx.read(|app_cx| app.read(app_cx).selected_sidebar), 3);

        // The Documents row is row 6 at y=382…414 and replaces only the workspace body.
        cx.simulate_click(point_px(100.0, 398.0), Modifiers::default());
        assert_eq!(cx.read(|app_cx| app.read(app_cx).selected_sidebar), 6);
        assert!(cx.debug_bounds("document-surface").is_some());

        // Appearance control is x=18…46, y=710…738 in the complete window.
        cx.simulate_click(point_px(32.0, 724.0), Modifiers::default());
        assert!(cx.read(|app_cx| app.read(app_cx).dark));
    }
}
