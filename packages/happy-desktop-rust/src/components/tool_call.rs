use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const TOOL_CALL_HEIGHT: f32 = 44.0;
pub const TOOL_CALL_PADDING_X: f32 = 12.0;

pub fn tool_call(theme: Theme, label: &str, detail: &str) -> Div {
    div()
        .debug_selector(|| "tool-call".to_owned())
        .flex()
        .items_center()
        .gap(px(10.0))
        .w_full()
        .h(px(TOOL_CALL_HEIGHT))
        .px(px(TOOL_CALL_PADDING_X))
        .rounded(px(8.0))
        .border_1()
        .border_color(theme.divider)
        .bg(theme.app)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "tool-call-status".to_owned())
                .size(px(8.0))
                .rounded(px(999.0))
                .bg(theme.teal),
        )
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .gap(px(6.0))
                .text_size(px(12.0))
                .child(
                    div()
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child(label.to_owned()),
                )
                .child(
                    div()
                        .text_color(theme.text_secondary)
                        .child(detail.to_owned()),
                ),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_tool_call_matches_height_padding_and_status_coordinates(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(410.0, 44.0), |_, _| {
            tool_call(Theme::light(), "Read", "DESIGN.md")
        });
        assert_eq!(
            cx.debug_bounds("tool-call"),
            Some(rect(0.0, 0.0, 410.0, 44.0))
        );
        assert_eq!(
            cx.debug_bounds("tool-call-status"),
            Some(rect(13.0, 18.0, 8.0, 8.0))
        );
        assert_eq!(TOOL_CALL_PADDING_X, 12.0);
    }
}
