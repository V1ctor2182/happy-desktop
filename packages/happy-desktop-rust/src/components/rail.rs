use crate::design::geometry::RAIL_WIDTH;
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, IntoElement, div, prelude::*, px, rgba};

const ITEMS: [(&str, &str); 4] = [
    ("◉", "Chats"),
    ("⌁", "Files"),
    ("✓", "Inbox"),
    ("⚙", "Settings"),
];

pub fn rail(theme: Theme, selected: usize) -> Div {
    let mut items = div()
        .debug_selector(|| "rail-items".to_owned())
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.0))
        .w_full();
    for (index, (icon, label)) in ITEMS.into_iter().enumerate() {
        items = items.child(rail_item(theme, index, icon, label, index == selected));
    }

    div()
        .debug_selector(|| "rail".to_owned())
        .flex()
        .flex_none()
        .flex_col()
        .items_center()
        .w(px(RAIL_WIDTH))
        .h_full()
        .pt(px(12.0))
        .pb(px(16.0))
        .bg(theme.chrome)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "rail-brand".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(32.0))
                .mb(px(8.0))
                .rounded(px(8.0))
                .bg(theme.primary_action)
                .text_color(theme.primary_action_text)
                .font_weight(FontWeight::BOLD)
                .child("H"),
        )
        .child(items)
        .child(div().flex_1())
        .child(
            div()
                .debug_selector(|| "rail-create".to_owned())
                .flex()
                .items_center()
                .justify_center()
                .size(px(36.0))
                .rounded(px(999.0))
                .bg(theme.primary_action)
                .text_color(theme.primary_action_text)
                .text_size(px(20.0))
                .child("+"),
        )
}

fn rail_item(
    theme: Theme,
    index: usize,
    icon: &str,
    label: &str,
    selected: bool,
) -> impl IntoElement {
    let selector = format!("rail-item-{index}");
    div()
        .id(index)
        .debug_selector(move || selector.clone())
        .flex()
        .flex_none()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(4.0))
        .w(px(52.0))
        .h(px(48.0))
        .rounded(px(8.0))
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
        .child(div().h(px(20.0)).text_size(px(18.0)).child(icon.to_owned()))
        .child(
            div()
                .h(px(12.0))
                .text_size(px(10.0))
                .font_weight(FontWeight::BOLD)
                .child(label.to_owned()),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_rail_matches_reference_coordinates_and_gaps(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(64.0, 744.0), |_, _| {
            rail(Theme::light(), 0)
        });
        assert_eq!(cx.debug_bounds("rail"), Some(rect(0.0, 0.0, 64.0, 744.0)));
        assert_eq!(
            cx.debug_bounds("rail-brand"),
            Some(rect(16.0, 12.0, 32.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("rail-item-0"),
            Some(rect(6.0, 52.0, 52.0, 48.0))
        );
        assert_eq!(
            cx.debug_bounds("rail-item-1"),
            Some(rect(6.0, 104.0, 52.0, 48.0))
        );
        assert_eq!(
            cx.debug_bounds("rail-create"),
            Some(rect(14.0, 692.0, 36.0, 36.0))
        );
    }
}
