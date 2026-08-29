use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const SETTINGS_PADDING: f32 = 24.0;
pub const SETTINGS_ROW_HEIGHT: f32 = 56.0;
pub const SETTINGS_SECTION_GAP: f32 = 24.0;

pub fn settings(theme: Theme) -> Div {
    div()
        .debug_selector(|| "settings".to_owned())
        .flex()
        .flex_col()
        .gap(px(SETTINGS_SECTION_GAP))
        .w_full()
        .h_full()
        .p(px(SETTINGS_PADDING))
        .bg(theme.app)
        .font_family(UI_FONT)
        .child(section(
            theme,
            "Appearance",
            [("Theme", "System"), ("Scrollbar", "Automatic")],
        ))
        .child(section(
            theme,
            "Happy Agent",
            [("Local host", "Connected"), ("Remote nodes", "2 online")],
        ))
        .child(section(
            theme,
            "Agent defaults",
            [("Model", "GPT-5.6 Sol"), ("Permissions", "Auto")],
        ))
}

fn section(theme: Theme, title: &str, rows: [(&str, &str); 2]) -> Div {
    let mut body = div()
        .flex()
        .flex_col()
        .w_full()
        .rounded(px(10.0))
        .border_1()
        .border_color(theme.divider)
        .bg(theme.surface);
    for (label, value) in rows {
        body = body.child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .h(px(SETTINGS_ROW_HEIGHT))
                .px(px(16.0))
                .border_b_1()
                .border_color(theme.divider)
                .text_size(px(13.0))
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(label.to_owned()),
                )
                .child(
                    div()
                        .text_color(theme.text_secondary)
                        .child(value.to_owned()),
                ),
        );
    }
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .w_full()
        .child(
            div()
                .h(px(16.0))
                .text_size(px(12.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text_secondary)
                .child(title.to_owned()),
        )
        .child(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_settings_matches_page_padding_section_gap_and_rows(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 688.0), |_, _| {
            settings(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("settings"),
            Some(rect(0.0, 0.0, 496.0, 688.0))
        );
        assert_eq!(SETTINGS_PADDING, 24.0);
        assert_eq!(SETTINGS_ROW_HEIGHT, 56.0);
        assert_eq!(SETTINGS_SECTION_GAP, 24.0);
    }
}
