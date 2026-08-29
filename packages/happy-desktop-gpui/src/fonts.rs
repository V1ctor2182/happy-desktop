use std::borrow::Cow;

use gpui::App;

pub fn register(cx: &App) {
    cx.text_system()
        .add_fonts(vec![
            Cow::Borrowed(include_bytes!("../assets/fonts/Figtree-Variable.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/HappyIonicons.ttf")),
        ])
        .expect("load Happy fonts");
}
