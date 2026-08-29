use crate::components::button::{ButtonSize, ButtonVariant, button};
use crate::components::channel_header::channel_header;
use crate::components::rail::rail;
use crate::components::sidebar::sidebar;
use crate::components::title_bar::title_bar;
use crate::design::geometry::sidebar_width;
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Context, Div, FontWeight, Window, div, prelude::*, px};

pub struct AppShell {
    dark: bool,
    selected_rail: usize,
    selected_sidebar: usize,
}

impl AppShell {
    pub fn new(dark: bool, selected_rail: usize, selected_sidebar: usize) -> Self {
        Self {
            dark,
            selected_rail,
            selected_sidebar,
        }
    }

    pub fn render(self, window: &mut Window, _cx: &mut Context<crate::HappyApp>) -> Div {
        let theme = if self.dark {
            Theme::dark()
        } else {
            Theme::light()
        };
        let window_width: f32 = window.bounds().size.width.into();
        shell(
            theme,
            self.selected_rail,
            self.selected_sidebar,
            window_width,
            true,
        )
    }
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
        .child(workspace(theme));
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

fn workspace(theme: Theme) -> Div {
    div()
        .debug_selector(|| "app-shell-workspace".to_owned())
        .flex()
        .flex_1()
        .min_w_0()
        .flex_col()
        .h_full()
        .bg(theme.surface)
        .child(channel_header(theme))
        .child(
            div()
                .flex()
                .flex_1()
                .min_h_0()
                .flex_col()
                .justify_center()
                .items_center()
                .gap(px(12.0))
                .px(px(32.0))
                .bg(theme.surface)
                .child(
                    div()
                        .text_size(px(24.0))
                        .font_weight(FontWeight::BOLD)
                        .child("Happy, now native."),
                )
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.text_secondary)
                        .child("The GPUI shell is ready for conversations, files, and terminals."),
                )
                .child(button(
                    "start-session",
                    "Start a session",
                    ButtonSize::Medium,
                    ButtonVariant::Primary,
                    theme,
                )),
        )
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
    use crate::design::geometry::{RAIL_WIDTH, TITLE_BAR_HEIGHT, rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

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
}
