use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const INBOX_TOOLBAR_HEIGHT: f32 = 48.0;
pub const INBOX_ROW_HEIGHT: f32 = 64.0;
pub const INBOX_PADDING: f32 = 16.0;

const ITEMS: [(&str, &str, &str); 4] = [
    (
        "Approval needed",
        "Rust rewrite",
        "Release build wants permission",
    ),
    ("Agent finished", "Sidebar polish", "3 files changed"),
    ("Mention", "Happy Agent", "Steve asked for review"),
    ("Build passed", "Native app", "17 geometry tests passed"),
];

pub fn inbox(theme: Theme) -> Div {
    let mut rows = div().flex().flex_col().w_full();
    for (index, (title, source, detail)) in ITEMS.into_iter().enumerate() {
        let selector = format!("inbox-row-{index}");
        rows = rows.child(
            div()
                .debug_selector(move || selector.clone())
                .flex()
                .flex_none()
                .items_center()
                .gap(px(12.0))
                .h(px(INBOX_ROW_HEIGHT))
                .px(px(INBOX_PADDING))
                .border_b_1()
                .border_color(theme.divider)
                .child(div().size(px(8.0)).rounded(px(999.0)).bg(theme.teal))
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .flex_col()
                        .gap(px(4.0))
                        .child(
                            div()
                                .text_size(px(13.0))
                                .font_weight(FontWeight::BOLD)
                                .text_color(theme.text)
                                .child(title.to_owned()),
                        )
                        .child(
                            div()
                                .text_size(px(12.0))
                                .text_color(theme.text_secondary)
                                .child(format!("{source} · {detail}")),
                        ),
                ),
        );
    }
    div()
        .debug_selector(|| "inbox".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .bg(theme.surface)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "inbox-toolbar".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .justify_between()
                .h(px(INBOX_TOOLBAR_HEIGHT))
                .px(px(INBOX_PADDING))
                .text_size(px(12.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_secondary)
                .child("All activity")
                .child("Unread 2"),
        )
        .child(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_inbox_matches_toolbar_rows_and_padding(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 688.0), |_, _| {
            inbox(Theme::light())
        });
        assert_eq!(cx.debug_bounds("inbox"), Some(rect(0.0, 0.0, 496.0, 688.0)));
        assert_eq!(
            cx.debug_bounds("inbox-toolbar"),
            Some(rect(0.0, 0.0, 496.0, 48.0))
        );
        assert_eq!(
            cx.debug_bounds("inbox-row-0"),
            Some(rect(0.0, 48.0, 496.0, 64.0))
        );
        assert_eq!(
            cx.debug_bounds("inbox-row-1"),
            Some(rect(0.0, 112.0, 496.0, 64.0))
        );
        assert_eq!(INBOX_PADDING, 16.0);
    }
}
