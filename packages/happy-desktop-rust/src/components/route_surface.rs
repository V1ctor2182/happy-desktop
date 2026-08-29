use crate::components::button::{ButtonSize, ButtonVariant, button};
use crate::design::theme::{Theme, UI_FONT};
use gpui::{Div, FontWeight, div, prelude::*, px};

pub const ROUTE_SURFACE_PADDING: f32 = 32.0;
pub const ROUTE_SURFACE_GAP: f32 = 12.0;

pub fn route_surface(theme: Theme, title: &str, description: &str, action: &str) -> Div {
    div()
        .debug_selector(|| "route-surface".to_owned())
        .flex()
        .flex_1()
        .min_h_0()
        .h_full()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(ROUTE_SURFACE_GAP))
        .w_full()
        .p(px(ROUTE_SURFACE_PADDING))
        .bg(theme.surface)
        .font_family(UI_FONT)
        .child(
            div()
                .debug_selector(|| "route-surface-title".to_owned())
                .h(px(32.0))
                .text_size(px(24.0))
                .font_weight(FontWeight::BOLD)
                .text_color(theme.text)
                .child(title.to_owned()),
        )
        .child(
            div()
                .debug_selector(|| "route-surface-description".to_owned())
                .h(px(20.0))
                .text_size(px(13.0))
                .text_color(theme.text_secondary)
                .child(description.to_owned()),
        )
        .child(button(
            "route-surface-action",
            action.to_owned(),
            ButtonSize::Medium,
            ButtonVariant::Primary,
            theme,
        ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_route_surface_centers_content_with_design_padding_and_gap(cx: &mut TestAppContext) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 688.0), |_, _| {
            route_surface(
                Theme::light(),
                "Files",
                "Browse changes and all files.",
                "Open Files",
            )
        });
        assert_eq!(
            cx.debug_bounds("route-surface"),
            Some(rect(0.0, 0.0, 496.0, 688.0))
        );
        assert_eq!(
            cx.debug_bounds("route-surface-title"),
            Some(rect(212.0, 288.0, 72.0, 32.0))
        );
        assert_eq!(
            cx.debug_bounds("route-surface-description"),
            Some(rect(134.5, 332.0, 227.0, 20.0))
        );
        assert_eq!(ROUTE_SURFACE_PADDING, 32.0);
        assert_eq!(ROUTE_SURFACE_GAP, 12.0);
    }
}
