use std::borrow::Cow;

use gpui::App;

pub const UI_FAMILY: &str = "Figtree";
pub const MONO_FAMILY: &str = "JetBrains Mono";

pub fn register(cx: &App) {
    cx.text_system()
        .add_fonts(vec![
            Cow::Borrowed(include_bytes!("../assets/fonts/Figtree-Regular.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/Figtree-Italic.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/JetBrainsMono-Regular.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/JetBrainsMono-Italic.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/HappyIonicons.ttf")),
            Cow::Borrowed(include_bytes!("../assets/fonts/HappyOcticons.ttf")),
        ])
        .expect("load Happy fonts");
}

#[cfg(test)]
mod tests {
    use gpui::{App, FontWeight, TestAppContext, font, px};

    #[gpui::test]
    fn bundled_ui_and_mono_variable_faces_resolve_normal_italic_and_weight(
        cx: &mut TestAppContext,
    ) {
        cx.update(|app: &mut App| {
            super::register(app);
            for family in [super::UI_FAMILY, super::MONO_FAMILY] {
                for mut face in [font(family), font(family).italic()] {
                    for weight in [FontWeight::LIGHT, FontWeight::NORMAL, FontWeight::BOLD] {
                        face.weight = weight;
                        let id = app.text_system().resolve_font(&face);
                        let bounds = app
                            .text_system()
                            .typographic_bounds(id, px(16.0), 'm')
                            .expect("bundled variable font face must resolve");
                        assert!(bounds.size.width > px(0.0) && bounds.size.height > px(0.0));
                    }
                }
            }
        });
    }
}
