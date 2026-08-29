use gpui::{Rgba, TextSystem, rgb};
use std::borrow::Cow;

pub const UI_FONT: &str = "Figtree";
pub const MONO_FONT: &str = "JetBrains Mono";

const FIGTREE: &[u8] = include_bytes!("../assets/fonts/Figtree-Variable.woff2");
const JETBRAINS_MONO: &[u8] = include_bytes!("../assets/fonts/JetBrainsMono-Variable.woff2");

pub fn register_fonts(text_system: &TextSystem) {
    text_system
        .add_fonts(vec![Cow::Borrowed(FIGTREE), Cow::Borrowed(JETBRAINS_MONO)])
        .expect("register Happy's bundled Figtree and JetBrains Mono fonts");
}

#[derive(Clone, Copy)]
pub struct Theme {
    pub app: Rgba,
    pub chrome: Rgba,
    pub divider: Rgba,
    pub input: Rgba,
    pub primary_action: Rgba,
    pub primary_action_text: Rgba,
    pub selected: Rgba,
    pub surface: Rgba,
    pub text: Rgba,
    pub text_secondary: Rgba,
    pub teal: Rgba,
}

impl Theme {
    pub fn light() -> Self {
        Self {
            app: rgb(0xf5f5f5),
            chrome: rgb(0xffffff),
            divider: rgb(0xeaeaea),
            input: rgb(0xf5f5f5),
            primary_action: rgb(0x000000),
            primary_action_text: rgb(0xffffff),
            selected: rgb(0xeaeaea),
            surface: rgb(0xffffff),
            text: rgb(0x000000),
            text_secondary: rgb(0x49454f),
            teal: rgb(0x2baccc),
        }
    }

    pub fn dark() -> Self {
        Self {
            app: rgb(0x1e1e1e),
            chrome: rgb(0x212121),
            divider: rgb(0x292929),
            input: rgb(0x303030),
            primary_action: rgb(0x000000),
            primary_action_text: rgb(0xffffff),
            selected: rgb(0x2c2c2e),
            surface: rgb(0x212121),
            text: rgb(0xffffff),
            text_secondary: rgb(0xcac4d0),
            teal: rgb(0x2baccc),
        }
    }
}
