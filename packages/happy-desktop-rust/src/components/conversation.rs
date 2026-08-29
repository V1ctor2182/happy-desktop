use crate::components::approval_card::approval_card;
use crate::components::composer::composer;
use crate::components::message::message;
use crate::components::tool_call::tool_call;
use crate::design::theme::Theme;
use crate::state::conversation::{ConversationRow, ConversationState};
use gpui::{Div, ScrollHandle, SharedString, Stateful, div, prelude::*, px};

pub const COMPOSER_DOCK_HEIGHT: f32 = 152.0;
pub const COMPOSER_DOCK_PADDING: f32 = 16.0;
pub const TRANSCRIPT_PADDING: f32 = 24.0;
pub const TRANSCRIPT_GAP: f32 = 16.0;

pub fn conversation(theme: Theme) -> Div {
    let content = div()
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
        .child(approval_card(theme));
    conversation_layout(theme, content, None)
}

pub fn conversation_state(theme: Theme, state: &ConversationState) -> Div {
    conversation_state_inner(theme, state, None)
}

pub fn scrollable_conversation_state(
    theme: Theme,
    state: &ConversationState,
    scroll: &ScrollHandle,
) -> Div {
    conversation_state_inner(theme, state, Some(scroll))
}

fn conversation_state_inner(
    theme: Theme,
    state: &ConversationState,
    scroll: Option<&ScrollHandle>,
) -> Div {
    match state {
        ConversationState::Fixture => conversation(theme),
        ConversationState::Empty => conversation_layout(
            theme,
            transcript_status(theme, "Select a conversation"),
            scroll,
        ),
        ConversationState::Loading => conversation_layout(
            theme,
            transcript_status(theme, "Loading the confirmed conversation…"),
            scroll,
        ),
        ConversationState::Error(error) => {
            conversation_layout(theme, transcript_status(theme, error), scroll)
        }
        ConversationState::Ready(snapshot) => {
            let mut content = div()
                .debug_selector(|| "transcript-content".to_owned())
                .flex()
                .flex_col()
                .gap(px(TRANSCRIPT_GAP))
                .w_full()
                .p(px(TRANSCRIPT_PADDING));
            if snapshot.has_more {
                content = content.child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.text_secondary)
                        .child("Earlier runs are available"),
                );
            }
            for row in snapshot.rows.iter() {
                let identity = row.id().to_owned();
                content = content.child(div().id(SharedString::from(identity)).w_full().child(
                    match row {
                        ConversationRow::Message {
                            author, body, user, ..
                        } => message(theme, author, body, *user),
                        ConversationRow::Activity { label, detail, .. } => {
                            tool_call(theme, label, detail)
                        }
                    },
                ));
            }
            conversation_layout(theme, content, scroll)
        }
    }
}

fn transcript_status(theme: Theme, text: &str) -> Div {
    div()
        .debug_selector(|| "transcript-content".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .items_center()
        .justify_center()
        .p(px(TRANSCRIPT_PADDING))
        .text_size(px(13.0))
        .text_color(theme.text_secondary)
        .child(text.to_owned())
}

fn conversation_layout(theme: Theme, content: Div, scroll: Option<&ScrollHandle>) -> Div {
    let scrollport = transcript_scrollport(content, scroll);
    div()
        .debug_selector(|| "conversation".to_owned())
        .flex()
        .flex_col()
        .w_full()
        .h_full()
        .min_h_0()
        .bg(theme.surface)
        .child(scrollport)
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

fn transcript_scrollport(content: Div, scroll: Option<&ScrollHandle>) -> Stateful<Div> {
    let scrollport = div()
        .debug_selector(|| "transcript-scrollport".to_owned())
        .id("transcript-scrollport-scroll")
        .flex()
        .flex_1()
        .min_h_0()
        .w_full()
        .child(content);
    match scroll {
        Some(handle) => scrollport.overflow_y_scroll().track_scroll(handle),
        None => scrollport.overflow_hidden(),
    }
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

    #[gpui::test]
    fn rendered_live_conversation_keeps_rows_inside_the_exact_transcript_inset(
        cx: &mut TestAppContext,
    ) {
        use crate::state::conversation::{ConversationRow, ConversationSnapshot};
        use std::sync::Arc;

        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        let state = ConversationState::Ready(Arc::new(ConversationSnapshot {
            agent_id: Arc::from("a1"),
            has_more: false,
            rows: vec![ConversationRow::Message {
                id: Arc::from("m1"),
                author: "You",
                body: Arc::from("Native transcript"),
                user: true,
            }]
            .into(),
        }));
        cx.draw(point(px(0.0), px(0.0)), size_px(496.0, 688.0), |_, _| {
            conversation_state(Theme::light(), &state)
        });
        assert_eq!(
            cx.debug_bounds("transcript-content"),
            Some(rect(0.0, 0.0, 496.0, 536.0))
        );
        assert_eq!(
            cx.debug_bounds("message-avatar"),
            Some(rect(24.0, 24.0, 28.0, 28.0))
        );
    }
}
