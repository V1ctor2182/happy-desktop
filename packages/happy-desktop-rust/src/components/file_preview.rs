use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const PREVIEW_HEADER_HEIGHT: f32 = 56.0;
pub const PREVIEW_GUTTER: f32 = 24.0;

pub fn file_preview(theme: Theme, width: f32) -> Div {
    div()
        .debug_selector(|| "file-preview".to_owned())
        .flex()
        .flex_col()
        .w(px(width))
        .h_full()
        .border_l_1()
        .border_color(theme.divider)
        .bg(theme.surface)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "file-preview-header".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .h(px(PREVIEW_HEADER_HEIGHT))
                .px(px(16.0))
                .text_size(px(15.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child("Preview"),
        )
        .child(
            div()
                .debug_selector(|| "file-preview-stage".to_owned())
                .flex()
                .flex_1()
                .min_h_0()
                .items_center()
                .justify_center()
                .p(px(PREVIEW_GUTTER))
                .bg(theme.app)
                .child(
                    div()
                        .debug_selector(|| "file-preview-image".to_owned())
                        .w_full()
                        .h(px(180.0))
                        .rounded(px(8.0))
                        .bg(theme.teal),
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
    fn rendered_file_preview_matches_header_stage_gutter_and_media_bounds(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(360.0, 744.0), |_, _| {
            file_preview(Theme::light(), 360.0)
        });
        assert_eq!(
            cx.debug_bounds("file-preview"),
            Some(rect(0.0, 0.0, 360.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("file-preview-header"),
            Some(rect(1.0, 0.0, 359.0, 56.0))
        );
        assert_eq!(
            cx.debug_bounds("file-preview-stage"),
            Some(rect(1.0, 56.0, 359.0, 688.0))
        );
        assert_eq!(
            cx.debug_bounds("file-preview-image"),
            Some(rect(25.0, 310.0, 311.0, 180.0))
        );
        assert_eq!(PREVIEW_GUTTER, 24.0);
    }
}
