use crate::components::button::{ButtonSize, ButtonVariant, button};
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const COMPOSER_HEIGHT: f32 = 120.0;
pub const COMPOSER_PADDING: f32 = 12.0;
pub const COMPOSER_RADIUS: f32 = 14.0;

pub fn composer(theme: Theme) -> Div {
    div()
        .debug_selector(|| "composer".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h(px(COMPOSER_HEIGHT))
        .p(px(COMPOSER_PADDING))
        .rounded(px(COMPOSER_RADIUS))
        .border_1()
        .border_color(theme.divider)
        .bg(theme.surface)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "composer-input".to_owned())
                .flex_1()
                .min_h_0()
                .text_size(px(13.0))
                .line_height(px(20.0))
                .text_color(theme.text_secondary)
                .child("Ask Happy Agent anything…"),
        )
        .child(
            div()
                .debug_selector(|| "composer-toolbar".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .justify_between()
                .h(px(32.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text_secondary)
                        .child("GPT-5.6 Sol")
                        .child("Auto"),
                )
                .child(button(
                    "composer-send",
                    "Send",
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
    fn rendered_composer_matches_real_padding_input_and_toolbar_coordinates(
        cx: &mut TestAppContext,
    ) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(464.0, 120.0), |_, _| {
            composer(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("composer"),
            Some(rect(0.0, 0.0, 464.0, 120.0))
        );
        assert_eq!(
            cx.debug_bounds("composer-input"),
            Some(rect(13.0, 13.0, 438.0, 62.0))
        );
        assert_eq!(
            cx.debug_bounds("composer-toolbar"),
            Some(rect(13.0, 75.0, 438.0, 32.0))
        );
        assert_eq!(COMPOSER_PADDING, 12.0);
        assert_eq!(COMPOSER_RADIUS, 14.0);
    }
}
