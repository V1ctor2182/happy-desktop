use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const MESSAGE_AVATAR_SIZE: f32 = 28.0;
pub const MESSAGE_GAP: f32 = 10.0;

pub fn message(theme: Theme, author: &str, body: &str, user: bool) -> Div {
    div()
        .debug_selector(|| "message".to_owned())
        .flex()
        .items_start()
        .gap(px(MESSAGE_GAP))
        .w_full()
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "message-avatar".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(MESSAGE_AVATAR_SIZE))
                .rounded(px(8.0))
                .bg(if user {
                    theme.selected
                } else {
                    theme.primary_action
                })
                .text_color(if user {
                    theme.text
                } else {
                    theme.primary_action_text
                })
                .text_size(px(11.0))
                .font_weight(FontWeight::BOLD)
                .child(if user { "SK" } else { "H" }),
        )
        .child(
            div()
                .debug_selector(|| "message-content".to_owned())
                .flex()
                .flex_1()
                .min_w_0()
                .flex_col()
                .gap(px(4.0))
                .child(
                    div()
                        .h(px(18.0))
                        .text_size(px(12.0))
                        .font_weight(FontWeight::BOLD)
                        .text_color(theme.text)
                        .child(author.to_owned()),
                )
                .child(
                    div()
                        .min_h(px(20.0))
                        .text_size(px(13.0))
                        .line_height(px(20.0))
                        .text_color(theme.text)
                        .child(body.to_owned()),
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
    fn rendered_message_uses_real_avatar_content_and_gap_geometry(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(448.0, 64.0), |_, _| {
            message(
                Theme::light(),
                "Happy Agent",
                "I’m implementing the native conversation surface.",
                false,
            )
        });
        assert_eq!(
            cx.debug_bounds("message"),
            Some(rect(0.0, 0.0, 448.0, 42.0))
        );
        assert_eq!(
            cx.debug_bounds("message-avatar"),
            Some(rect(0.0, 0.0, 28.0, 28.0))
        );
        assert_eq!(
            cx.debug_bounds("message-content"),
            Some(rect(38.0, 0.0, 410.0, 42.0))
        );
        assert_eq!(MESSAGE_GAP, 10.0);
    }
}
