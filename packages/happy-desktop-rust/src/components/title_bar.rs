use crate::design::geometry::TITLE_BAR_HEIGHT;
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub fn title_bar(theme: Theme) -> Div {
    div()
        .debug_selector(|| "title-bar".to_owned())
        .flex()
        .flex_none()
        .items_center()
        .gap(px(12.0))
        .w_full()
        .h(px(TITLE_BAR_HEIGHT))
        .px(px(12.0))
        .bg(theme.chrome)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "title-bar-leading".to_owned())
                .flex()
                .flex_1()
                .items_center()
                .h_full()
                .text_size(px(13.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_secondary)
                .child(div().w(px(66.0)).flex_none())
                .child("Happy"),
        )
        .child(
            div()
                .debug_selector(|| "title-bar-search".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .gap(px(8.0))
                .w(px(420.0))
                .h(px(32.0))
                .px(px(8.0))
                .rounded(px(6.0))
                .border_1()
                .border_color(theme.divider)
                .bg(theme.input)
                .text_color(theme.text_secondary)
                .text_size(px(12.0))
                .child("⌕")
                .child("Search"),
        )
        .child(
            div()
                .debug_selector(|| "title-bar-trailing".to_owned())
                .flex()
                .flex_1()
                .justify_end()
                .items_center()
                .h_full()
                .text_color(theme.text_secondary)
                .child("⌘K"),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_title_bar_matches_reference_coordinates(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(1280.0, 56.0), |_, _| {
            title_bar(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("title-bar"),
            Some(rect(0.0, 0.0, 1280.0, 56.0))
        );
        assert_eq!(
            cx.debug_bounds("title-bar-search"),
            Some(rect(430.0, 12.0, 420.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("title-bar-leading"),
            Some(rect(12.0, 0.0, 406.0, 56.0))
        );
        assert_eq!(
            cx.debug_bounds("title-bar-trailing"),
            Some(rect(862.0, 0.0, 406.0, 56.0))
        );
    }
}
