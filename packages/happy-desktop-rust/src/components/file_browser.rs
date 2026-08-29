use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px, rgba};

pub const FILE_BROWSER_HEADER_HEIGHT: f32 = 56.0;
pub const FILE_BROWSER_SCOPE_HEIGHT: f32 = 32.0;
pub const FILE_BROWSER_ROW_HEIGHT: f32 = 32.0;
pub const FILE_BROWSER_ROW_GAP: f32 = 2.0;
pub const FILE_BROWSER_PANEL_INSET: f32 = 6.0;

const FILES: [(&str, &str, &str, &str); 6] = [
    ("M", "app_shell.rs", "src/components", "+42 −8"),
    ("A", "file_browser.rs", "src/components", "+136"),
    ("A", "file_editor.rs", "src/components", "+118"),
    ("M", "Cargo.toml", "packages/happy-desktop-rust", "+1 −1"),
    ("M", "Cargo.lock", "packages/happy-desktop-rust", "+2 −2"),
    ("A", "file_preview.rs", "src/components", "+84"),
];

pub fn file_browser(theme: Theme, width: f32) -> Div {
    let mut rows = div()
        .debug_selector(|| "file-browser-rows".to_owned())
        .flex()
        .flex_col()
        .gap(px(FILE_BROWSER_ROW_GAP))
        .w_full()
        .px(px(FILE_BROWSER_PANEL_INSET));
    for (index, (status, name, path, stats)) in FILES.into_iter().enumerate() {
        rows = rows.child(file_row(
            theme,
            index,
            status,
            name,
            path,
            stats,
            index == 0,
        ));
    }

    div()
        .debug_selector(|| "file-browser".to_owned())
        .flex()
        .flex_none()
        .flex_col()
        .w(px(width))
        .h_full()
        .bg(theme.app)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "file-browser-header".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .justify_between()
                .h(px(FILE_BROWSER_HEADER_HEIGHT))
                .px(px(16.0))
                .text_size(px(15.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child("Files")
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .child("List"),
                ),
        )
        .child(
            div()
                .debug_selector(|| "file-browser-scope".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .gap(px(4.0))
                .h(px(FILE_BROWSER_SCOPE_HEIGHT))
                .px(px(FILE_BROWSER_PANEL_INSET))
                .child(scope_option(theme, "Changes", true))
                .child(scope_option(theme, "All Files", false)),
        )
        .child(
            div()
                .debug_selector(|| "file-browser-scrollport".to_owned())
                .flex()
                .flex_1()
                .min_h_0()
                .w_full()
                .overflow_hidden()
                .child(rows),
        )
}

fn scope_option(theme: Theme, label: &str, selected: bool) -> Div {
    div()
        .flex()
        .items_center()
        .justify_center()
        .h(px(28.0))
        .px(px(10.0))
        .rounded(px(6.0))
        .bg(if selected {
            theme.selected
        } else {
            rgba(0x00000000)
        })
        .text_size(px(12.0))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(if selected {
            theme.text
        } else {
            theme.text_secondary
        })
        .child(label.to_owned())
}

fn file_row(
    theme: Theme,
    index: usize,
    status: &str,
    name: &str,
    path: &str,
    stats: &str,
    selected: bool,
) -> Div {
    let selector = format!("file-browser-row-{index}");
    div()
        .debug_selector(move || selector.clone())
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.0))
        .w_full()
        .h(px(FILE_BROWSER_ROW_HEIGHT))
        .px(px(10.0))
        .rounded(px(6.0))
        .bg(if selected {
            theme.selected
        } else {
            rgba(0x00000000)
        })
        .text_size(px(12.0))
        .child(
            div()
                .w(px(14.0))
                .flex_none()
                .font_weight(FontWeight::BOLD)
                .text_color(theme.teal)
                .child(status.to_owned()),
        )
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .gap(px(5.0))
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme.text)
                        .child(name.to_owned()),
                )
                .child(
                    div()
                        .text_color(theme.text_secondary)
                        .child(path.to_owned()),
                ),
        )
        .child(
            div()
                .flex_none()
                .text_color(theme.text_secondary)
                .child(stats.to_owned()),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_file_browser_matches_flat_scope_full_scrollport_and_row_geometry(
        cx: &mut TestAppContext,
    ) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(360.0, 744.0), |_, _| {
            file_browser(Theme::light(), 360.0)
        });
        assert_eq!(
            cx.debug_bounds("file-browser"),
            Some(rect(0.0, 0.0, 360.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("file-browser-header"),
            Some(rect(0.0, 0.0, 360.0, 56.0))
        );
        assert_eq!(
            cx.debug_bounds("file-browser-scope"),
            Some(rect(0.0, 56.0, 360.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("file-browser-scrollport"),
            Some(rect(0.0, 88.0, 360.0, 656.0))
        );
        assert_eq!(
            cx.debug_bounds("file-browser-row-0"),
            Some(rect(6.0, 88.0, 348.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("file-browser-row-1"),
            Some(rect(6.0, 122.0, 348.0, 32.0))
        );
        assert_eq!(FILE_BROWSER_PANEL_INSET, 6.0);
    }
}
