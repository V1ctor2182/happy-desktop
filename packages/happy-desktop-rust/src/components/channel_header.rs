use crate::components::button::{ButtonSize, ButtonVariant, button};
use crate::design::geometry::SURFACE_HEADER_HEIGHT;
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub fn channel_header(theme: Theme, title: &str, subtitle: &str, action_label: &str) -> Div {
    div()
        .debug_selector(|| "channel-header".to_owned())
        .flex()
        .flex_none()
        .items_center()
        .gap(px(12.0))
        .w_full()
        .h(px(SURFACE_HEADER_HEIGHT))
        .px(px(16.0))
        .bg(theme.surface)
        .font_family(UI_FONT)
        .text_color(theme.text)
        .child(
            div()
                .debug_selector(|| "channel-header-info".to_owned())
                .flex()
                .flex_1()
                .items_center()
                .gap(px(8.0))
                .child(div().text_color(theme.text_secondary).child("#"))
                .child(
                    div()
                        .text_size(px(15.0))
                        .font_weight(FontWeight::BOLD)
                        .child(title.to_owned()),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .child(subtitle.to_owned()),
                ),
        )
        .child(button(
            "new-session",
            action_label.to_owned(),
            ButtonSize::Small,
            ButtonVariant::Primary,
            theme,
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_channel_header_matches_surface_header_contract(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 56.0), |_, _| {
            channel_header(
                Theme::light(),
                "Rust rewrite",
                "Native GPUI app parity",
                "New session",
            )
        });
        assert_eq!(
            cx.debug_bounds("channel-header"),
            Some(rect(0.0, 0.0, 496.0, 56.0))
        );
        assert_eq!(
            cx.debug_bounds("channel-header-info"),
            Some(rect(16.0, 15.0, 350.0, 26.0))
        );
        assert_eq!(
            cx.debug_bounds("new-session"),
            Some(rect(378.0, 14.0, 102.0, 28.0))
        );
    }
}
