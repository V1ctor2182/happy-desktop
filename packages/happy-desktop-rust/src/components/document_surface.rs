use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const DOCUMENT_TOOLBAR_HEIGHT: f32 = 48.0;
pub const DOCUMENT_MEASURE: f32 = 680.0;
pub const DOCUMENT_PADDING: f32 = 32.0;

pub fn document_surface(theme: Theme) -> Div {
    div()
        .debug_selector(|| "document-surface".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .bg(theme.surface)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "document-toolbar".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .justify_between()
                .h(px(DOCUMENT_TOOLBAR_HEIGHT))
                .px(px(16.0))
                .text_size(px(12.0))
                .text_color(theme.text_secondary)
                .child("Saved locally · Markdown current")
                .child("Edited just now"),
        )
        .child(
            div()
                .debug_selector(|| "document-scrollport".to_owned())
                .flex()
                .flex_1()
                .min_h_0()
                .w_full()
                .justify_center()
                .overflow_hidden()
                .child(
                    div()
                        .debug_selector(|| "document-page".to_owned())
                        .flex()
                        .flex_col()
                        .gap(px(16.0))
                        .w_full()
                        .max_w(px(DOCUMENT_MEASURE))
                        .p(px(DOCUMENT_PADDING))
                        .child(div().text_size(px(28.0)).font_weight(FontWeight::BOLD).text_color(theme.text).child("Native Happy rewrite"))
                        .child(div().text_size(px(15.0)).line_height(px(24.0)).text_color(theme.text).child("This Happy Agent-owned document records the phased GPUI migration while keeping a normalized Markdown projection beside its collaborative state.")),
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
    fn rendered_document_keeps_full_scrollport_and_centered_page_padding(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(760.0, 688.0), |_, _| {
            document_surface(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("document-toolbar"),
            Some(rect(0.0, 0.0, 760.0, 48.0))
        );
        assert_eq!(
            cx.debug_bounds("document-scrollport"),
            Some(rect(0.0, 48.0, 760.0, 640.0))
        );
        assert_eq!(
            cx.debug_bounds("document-page"),
            Some(rect(40.0, 48.0, 680.0, 640.0))
        );
        assert_eq!(DOCUMENT_PADDING, 32.0);
    }
}
