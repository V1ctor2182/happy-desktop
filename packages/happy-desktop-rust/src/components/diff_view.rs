use crate::design::theme::{MONO_FONT, Theme};
use gpui::{Div, div, prelude::*, px};

pub const DIFF_LINE_HEIGHT: f32 = 20.0;
pub const DIFF_GUTTER_WIDTH: f32 = 48.0;

const LINES: [(&str, &str); 8] = [
    (
        "  1",
        " use crate::components::channel_header::channel_header;",
    ),
    ("  2", "+use crate::components::file_browser::file_browser;"),
    ("  3", "+use crate::components::file_editor::file_editor;"),
    (
        "  4",
        " use crate::components::rail::{interactive_rail, rail};",
    ),
    ("  5", ""),
    (
        "  6",
        " fn workspace(theme: Theme, selected_rail: usize) -> Div {",
    ),
    ("  7", "-    let body = conversation(theme);"),
    (
        "  8",
        "+    let body = workspace_body(theme, selected_rail);",
    ),
];

pub fn diff_view(theme: Theme) -> Div {
    let mut lines = div()
        .debug_selector(|| "diff-lines".to_owned())
        .flex()
        .flex_col()
        .w_full();
    for (index, (number, text)) in LINES.into_iter().enumerate() {
        lines = lines.child(diff_line(theme, index, number, text));
    }
    div()
        .debug_selector(|| "diff-view".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .overflow_hidden()
        .bg(theme.surface)
        .font_family(MONO_FONT)
        .text_size(px(12.0))
        .child(lines)
}

fn diff_line(theme: Theme, index: usize, number: &str, text: &str) -> Div {
    let added = text.starts_with('+');
    let removed = text.starts_with('-');
    let selector = format!("diff-line-{index}");
    div()
        .debug_selector(move || selector.clone())
        .flex()
        .flex_none()
        .items_center()
        .w_full()
        .h(px(DIFF_LINE_HEIGHT))
        .bg(if added {
            theme.diff_added
        } else if removed {
            theme.diff_removed
        } else {
            theme.surface
        })
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_end()
                .w(px(DIFF_GUTTER_WIDTH))
                .h_full()
                .pr(px(8.0))
                .text_color(theme.text_secondary)
                .child(number.to_owned()),
        )
        .child(
            div()
                .pl(px(8.0))
                .text_color(theme.text)
                .child(text.to_owned()),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_diff_uses_fixed_gutter_and_line_coordinates(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 624.0), |_, _| {
            diff_view(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("diff-view"),
            Some(rect(0.0, 0.0, 496.0, 624.0))
        );
        assert_eq!(
            cx.debug_bounds("diff-line-0"),
            Some(rect(0.0, 0.0, 496.0, 20.0))
        );
        assert_eq!(
            cx.debug_bounds("diff-line-1"),
            Some(rect(0.0, 20.0, 496.0, 20.0))
        );
        assert_eq!(DIFF_GUTTER_WIDTH, 48.0);
        assert_eq!(DIFF_LINE_HEIGHT, 20.0);
    }
}
