use gpui::Rgba;

use crate::ui::theme_roles::ThemeRole;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Theme {
    dark: bool,
}

impl Theme {
    pub const fn dark() -> Self {
        Self { dark: true }
    }
    pub const fn light() -> Self {
        Self { dark: false }
    }
    pub fn role(self, role: ThemeRole) -> Rgba {
        role.resolve(self.dark)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_palette_carries_every_authoritative_color_role_in_both_appearances() {
        assert_eq!(ThemeRole::ALL.len(), 172);
        assert_eq!(Theme::light().role(ThemeRole::Text), gpui::rgba(0x000000ff));
        assert_eq!(Theme::dark().role(ThemeRole::Text), gpui::rgba(0xffffffff));
        assert_eq!(
            Theme::light().role(ThemeRole::Surface),
            gpui::rgba(0xffffffff)
        );
        assert_eq!(
            Theme::dark().role(ThemeRole::Surface),
            gpui::rgba(0x212121ff)
        );
        assert_eq!(
            Theme::light().role(ThemeRole::TextLink),
            Theme::dark().role(ThemeRole::TextLink)
        );
    }
}
