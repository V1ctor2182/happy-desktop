use crate::HappyApp;
use crate::design::geometry::{SIDEBAR_ROW_GAP, SIDEBAR_ROW_HEIGHT};
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Context, Div, FontWeight, Stateful, div, prelude::*, px, rgba};

const ROWS: [(&str, &str); 7] = [
    ("⌂", "All chats"),
    ("◆", "Happy Desktop"),
    ("", "Rust rewrite"),
    ("", "Sidebar polish"),
    ("◆", "Happy Agent"),
    ("", "Realtime reconnect"),
    ("", "Document model"),
];

pub fn sidebar(theme: Theme, selected: usize, width: f32) -> Div {
    let mut rows = div()
        .debug_selector(|| "sidebar-rows".to_owned())
        .flex()
        .flex_col()
        .gap(px(SIDEBAR_ROW_GAP))
        .px(px(6.0));
    for (index, (icon, label)) in ROWS.into_iter().enumerate() {
        rows = rows.child(sidebar_row(theme, index, icon, label, index == selected));
    }
    sidebar_root(theme, width, rows)
}

pub fn interactive_sidebar(
    theme: Theme,
    selected: usize,
    width: f32,
    cx: &mut Context<HappyApp>,
) -> Div {
    let mut rows = div()
        .debug_selector(|| "sidebar-rows".to_owned())
        .flex()
        .flex_col()
        .gap(px(SIDEBAR_ROW_GAP))
        .px(px(6.0));
    for (index, (icon, label)) in ROWS.into_iter().enumerate() {
        rows = rows.child(
            sidebar_row(theme, index, icon, label, index == selected).on_click(cx.listener(
                move |this, _, _, cx| {
                    this.selected_sidebar = index;
                    cx.notify();
                },
            )),
        );
    }
    sidebar_root(theme, width, rows)
}

fn sidebar_root(theme: Theme, width: f32, rows: Div) -> Div {
    div()
        .debug_selector(|| "sidebar".to_owned())
        .flex()
        .flex_none()
        .flex_col()
        .w(px(width))
        .h_full()
        .bg(theme.app)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "sidebar-header".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .h(px(56.0))
                .pl(px(20.0))
                .pr(px(16.0))
                .text_color(theme.text)
                .text_size(px(15.0))
                .font_weight(FontWeight::BOLD)
                .child("Chats"),
        )
        .child(
            div()
                .mx(px(16.0))
                .mb(px(10.0))
                .h(px(32.0))
                .flex()
                .items_center()
                .px(px(10.0))
                .rounded(px(6.0))
                .border_1()
                .border_color(theme.divider)
                .bg(theme.input)
                .text_color(theme.text_secondary)
                .text_size(px(12.0))
                .child("Search conversations"),
        )
        .child(
            div()
                .px(px(16.0))
                .pb(px(6.0))
                .text_size(px(11.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.text_secondary)
                .child("PROJECTS"),
        )
        .child(rows)
}

fn sidebar_row(
    theme: Theme,
    index: usize,
    icon: &str,
    label: &str,
    selected: bool,
) -> Stateful<Div> {
    let selector = format!("sidebar-row-{index}");
    div()
        .id(("sidebar-row", index))
        .debug_selector(move || selector.clone())
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.0))
        .w_full()
        .h(px(SIDEBAR_ROW_HEIGHT))
        .px(px(10.0))
        .rounded(px(6.0))
        .bg(if selected {
            theme.selected
        } else {
            rgba(0x00000000)
        })
        .text_color(if selected {
            theme.text
        } else {
            theme.text_secondary
        })
        .text_size(px(13.0))
        .child(div().w(px(20.0)).flex_none().child(icon.to_owned()))
        .child(label.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_sidebar_rows_match_real_insets_height_and_gap(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(360.0, 744.0), |_, _| {
            sidebar(Theme::light(), 1, 360.0)
        });
        assert_eq!(
            cx.debug_bounds("sidebar"),
            Some(rect(0.0, 0.0, 360.0, 744.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-header"),
            Some(rect(0.0, 0.0, 360.0, 56.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-row-0"),
            Some(rect(6.0, 122.0, 348.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("sidebar-row-1"),
            Some(rect(6.0, 156.0, 348.0, 32.0))
        );
    }
}
