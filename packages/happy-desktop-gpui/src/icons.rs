use gpui::{Div, Rgba, Styled, StyledText, TextRun, div, font, prelude::*, px};

pub const ADD: char = 'A';
pub const CHAT: char = 'B';
pub const DOCUMENTS: char = 'C';
pub const HOME: char = 'D';
pub const PEOPLE: char = 'E';
pub const SETTINGS: char = 'F';
pub const TERMINAL: char = 'G';

pub fn ionicon(glyph: char, size: f32, color: Rgba) -> Div {
    let text = glyph.to_string();
    let run = TextRun {
        len: text.len(),
        font: font("Happy Ionicons"),
        color: color.into(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };

    div()
        .debug_selector(|| format!("ionicon-{:x}", glyph as u32))
        .flex()
        .items_center()
        .justify_center()
        .size(px(size))
        .text_size(px(size))
        .child(StyledText::new(text).with_runs(vec![run]))
}
