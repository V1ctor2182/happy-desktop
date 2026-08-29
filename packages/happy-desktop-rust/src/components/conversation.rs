use crate::components::approval_card::approval_card;
use crate::components::composer::composer;
use crate::components::message::message;
use crate::components::tool_call::tool_call;
use crate::design::theme::Theme;
use gpui::{Div, div, prelude::*, px};

pub const COMPOSER_DOCK_HEIGHT: f32 = 152.0;
pub const COMPOSER_DOCK_PADDING: f32 = 16.0;
pub const TRANSCRIPT_PADDING: f32 = 24.0;
pub const TRANSCRIPT_GAP: f32 = 16.0;

pub fn conversation(theme: Theme) -> Div {
    div()
        .debug_selector(|| "conversation".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .min_h_0()
        .bg(theme.surface)
        .child(
            div()
                .debug_selector(|| "transcript-scrollport".to_owned())
                .flex()
                .flex_1()
                .min_h_0()
                .w_full()
                .overflow_hidden()
                .child(
                    div()
                        .debug_selector(|| "transcript-content".to_owned())
                        .flex()
                        .flex_col()
                        .gap(px(TRANSCRIPT_GAP))
                        .w_full()
                        .p(px(TRANSCRIPT_PADDING))
                        .child(message(
                            theme,
                            "Steve",
                            "Rewrite the entire desktop app in Rust with GPUI and preserve the original.",
                            true,
                        ))
                        .child(message(
                            theme,
                            "Happy Agent",
                            "Phase one is shipped. I’m porting the native conversation stack now.",
                            false,
                        ))
                        .child(tool_call(theme, "Read", "DESIGN.md and the master plans"))
                        .child(approval_card(theme)),
                ),
        )
        .child(
            div()
                .debug_selector(|| "composer-dock".to_owned())
                .flex()
                .flex_none()
                .items_center()
                .w_full()
                .h(px(COMPOSER_DOCK_HEIGHT))
                .p(px(COMPOSER_DOCK_PADDING))
                .bg(theme.surface)
                .child(composer(theme)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_conversation_keeps_full_bleed_scrollport_and_inset_content(
        cx: &mut TestAppContext,
    ) {
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 688.0), |_, _| {
            conversation(Theme::light())
        });
        assert_eq!(
            cx.debug_bounds("conversation"),
            Some(rect(0.0, 0.0, 496.0, 688.0))
        );
        assert_eq!(
            cx.debug_bounds("transcript-scrollport"),
            Some(rect(0.0, 0.0, 496.0, 536.0))
        );
        assert_eq!(
            cx.debug_bounds("transcript-content"),
            Some(rect(0.0, 0.0, 496.0, 536.0))
        );
        assert_eq!(
            cx.debug_bounds("composer-dock"),
            Some(rect(0.0, 536.0, 496.0, 152.0))
        );
        assert_eq!(
            cx.debug_bounds("composer"),
            Some(rect(16.0, 552.0, 464.0, 120.0))
        );
        assert_eq!(TRANSCRIPT_PADDING, 24.0);
        assert_eq!(COMPOSER_DOCK_PADDING, 16.0);
    }
}
