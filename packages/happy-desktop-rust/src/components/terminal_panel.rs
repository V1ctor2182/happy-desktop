use crate::design::theme::{MONO_FONT, Theme};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const TERMINAL_HEADER_HEIGHT: f32 = 40.0;
pub const TERMINAL_PADDING: f32 = 12.0;
pub const TERMINAL_LINE_HEIGHT: f32 = 18.0;

pub fn terminal_panel(theme: Theme, width: f32) -> Div {
    div()
        .debug_selector(|| "terminal-panel".to_owned())
        .flex()
        .flex_col()
        .w(px(width))
        .h_full()
        .border_l_1()
        .border_color(theme.divider)
        .bg(theme.surface)
        .font_family(MONO_FONT)
        .child(
            div()
                .debug_selector(|| "terminal-header".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .justify_between()
                .h(px(TERMINAL_HEADER_HEIGHT))
                .px(px(12.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child("Terminal")
                .child("zsh"),
        )
        .child(
            div()
                .debug_selector(|| "terminal-viewport".to_owned())
                .flex()
                .flex_1()
                .min_h_0()
                .flex_col()
                .gap(px(2.0))
                .w_full()
                .p(px(TERMINAL_PADDING))
                .bg(theme.app)
                .text_size(px(12.0))
                .line_height(px(TERMINAL_LINE_HEIGHT))
                .text_color(theme.text)
                .child("$ cargo test")
                .child("running 17 tests")
                .child("test result: ok. 17 passed")
                .child("$ _"),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_terminal_matches_header_viewport_and_inner_padding(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(360.0, 744.0), |_, _| {
            terminal_panel(Theme::light(), 360.0)
        });
        assert_eq!(
            cx.debug_bounds("terminal-panel"),
            Some(rect(0.0, 0.0, 360.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("terminal-header"),
            Some(rect(1.0, 0.0, 359.0, 40.0))
        );
        assert_eq!(
            cx.debug_bounds("terminal-viewport"),
            Some(rect(1.0, 40.0, 359.0, 704.0))
        );
        assert_eq!(TERMINAL_PADDING, 12.0);
    }
}
