use crate::components::diff_view::diff_view;
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px, rgba};

pub const FILE_TAB_BAR_HEIGHT: f32 = 32.0;
pub const FILE_MODE_BAR_HEIGHT: f32 = 32.0;

pub fn file_editor(theme: Theme) -> Div {
    div()
        .debug_selector(|| "file-editor".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .min_h_0()
        .bg(theme.surface)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "file-tab-bar".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .h(px(FILE_TAB_BAR_HEIGHT))
                .bg(theme.app)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .h_full()
                        .px(px(12.0))
                        .bg(theme.surface)
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child("app_shell.rs  •"),
                ),
        )
        .child(
            div()
                .debug_selector(|| "file-mode-bar".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .gap(px(4.0))
                .h(px(FILE_MODE_BAR_HEIGHT))
                .px(px(4.0))
                .bg(theme.surface)
                .child(mode(theme, "Preview", false))
                .child(mode(theme, "Unified", true))
                .child(mode(theme, "Split", false))
                .child(mode(theme, "Edit", false)),
        )
        .child(
            div()
                .debug_selector(|| "file-editor-content".to_owned())
                .flex()
                .flex_1()
                .min_h_0()
                .w_full()
                .child(diff_view(theme)),
        )
}

fn mode(theme: Theme, label: &str, selected: bool) -> Div {
    div()
        .flex()
        .items_center()
        .justify_center()
        .h(px(24.0))
        .px(px(8.0))
        .rounded(px(6.0))
        .bg(if selected {
            theme.selected
        } else {
            rgba(0x00000000)
        })
        .text_size(px(11.0))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(if selected {
            theme.text
        } else {
            theme.text_secondary
        })
        .child(label.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_file_editor_aligns_tabs_modes_and_full_content_region(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 688.0), |_, _| {
            file_editor(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("file-editor"),
            Some(rect(0.0, 0.0, 496.0, 688.0))
        );
        assert_eq!(
            cx.debug_bounds("file-tab-bar"),
            Some(rect(0.0, 0.0, 496.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("file-mode-bar"),
            Some(rect(0.0, 32.0, 496.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("file-editor-content"),
            Some(rect(0.0, 64.0, 496.0, 624.0))
        );
    }
}
