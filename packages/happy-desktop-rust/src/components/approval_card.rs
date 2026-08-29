use crate::components::button::{ButtonSize, ButtonVariant, button};
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const APPROVAL_CARD_PADDING: f32 = 16.0;
pub const APPROVAL_CARD_GAP: f32 = 12.0;

pub fn approval_card(theme: Theme) -> Div {
    div()
        .debug_selector(|| "approval-card".to_owned())
        .flex()
        .flex_col()
        .gap(px(APPROVAL_CARD_GAP))
        .w_full()
        .p(px(APPROVAL_CARD_PADDING))
        .rounded(px(10.0))
        .border_1()
        .border_color(theme.divider)
        .bg(theme.surface)
        .font_family(UI_FONT)
        .child(
            div()
                .h(px(20.0))
                .text_size(px(13.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child("Permission requested"),
        )
        .child(
            div()
                .h(px(40.0))
                .text_size(px(12.0))
                .line_height(px(20.0))
                .text_color(theme.text_secondary)
                .child("Run the release build and assemble the signed macOS application."),
        )
        .child(
            div()
                .debug_selector(|| "approval-actions".to_owned())
                .flex()
                .justify_end()
                .gap(px(8.0))
                .w_full()
                .child(button(
                    "approval-deny",
                    "Deny",
                    ButtonSize::Small,
                    ButtonVariant::Secondary,
                    theme,
                ))
                .child(button(
                    "approval-allow",
                    "Allow",
                    ButtonSize::Small,
                    ButtonVariant::Primary,
                    theme,
                )),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_approval_card_matches_padding_gap_and_action_row(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(410.0, 136.0), |_, _| {
            approval_card(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("approval-card"),
            Some(rect(0.0, 0.0, 410.0, 146.0))
        );
        assert_eq!(
            cx.debug_bounds("approval-actions"),
            Some(rect(17.0, 101.0, 376.0, 28.0))
        );
        assert_eq!(APPROVAL_CARD_PADDING, 16.0);
        assert_eq!(APPROVAL_CARD_GAP, 12.0);
    }
}
