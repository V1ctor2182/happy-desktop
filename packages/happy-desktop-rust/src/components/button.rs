use crate::design::theme::{Theme, UI_FONT};
use gpui::{FontWeight, IntoElement, SharedString, div, prelude::*, px, rgba};

#[derive(Clone, Copy)]
pub enum ButtonSize {
    Small,
    Medium,
    Large,
}

impl ButtonSize {
    pub const fn height(self) -> f32 {
        match self {
            Self::Small => 28.0,
            Self::Medium => 36.0,
            Self::Large => 44.0,
        }
    }

    const fn padding(self) -> f32 {
        match self {
            Self::Small => 10.0,
            Self::Medium => 14.0,
            Self::Large => 18.0,
        }
    }

    const fn font_size(self) -> f32 {
        match self {
            Self::Small => 12.0,
            Self::Medium => 13.0,
            Self::Large => 14.0,
        }
    }
}

#[derive(Clone, Copy)]
pub enum ButtonVariant {
    Primary,
    Secondary,
    Ghost,
}

pub fn button(
    id: &'static str,
    label: impl Into<SharedString>,
    size: ButtonSize,
    variant: ButtonVariant,
    theme: Theme,
) -> impl IntoElement {
    let (background, foreground, border) = match variant {
        ButtonVariant::Primary => (
            theme.primary_action,
            theme.primary_action_text,
            theme.primary_action,
        ),
        ButtonVariant::Secondary => (theme.surface, theme.text, theme.divider),
        ButtonVariant::Ghost => (rgba(0x00000000), theme.text_secondary, rgba(0x00000000)),
    };

    div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .flex()
        .items_center()
        .justify_center()
        .h(px(size.height()))
        .px(px(size.padding()))
        .rounded(px(999.0))
        .border_1()
        .border_color(border)
        .bg(background)
        .font_family(UI_FONT)
        .text_color(foreground)
        .text_size(px(size.font_size()))
        .font_weight(FontWeight::BOLD)
        .child(label.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::geometry::{rect, size_px};
    use crate::design::theme::register_fonts;
    use gpui::{TestAppContext, point, px};

    #[gpui::test]
    fn rendered_button_heights_and_padding_match_design(cx: &mut TestAppContext) {
        assert_eq!(ButtonSize::Small.padding(), 10.0);
        assert_eq!(ButtonSize::Medium.padding(), 14.0);
        assert_eq!(ButtonSize::Large.padding(), 18.0);
        register_fonts(cx.text_system());
        let cx = cx.add_empty_window();
        cx.draw(point(px(0.0), px(0.0)), size_px(200.0, 120.0), |_, _| {
            div()
                .flex()
                .flex_col()
                .items_start()
                .child(button(
                    "small",
                    "Small",
                    ButtonSize::Small,
                    ButtonVariant::Primary,
                    Theme::light(),
                ))
                .child(button(
                    "medium",
                    "Medium",
                    ButtonSize::Medium,
                    ButtonVariant::Secondary,
                    Theme::light(),
                ))
                .child(button(
                    "large",
                    "Large",
                    ButtonSize::Large,
                    ButtonVariant::Ghost,
                    Theme::light(),
                ))
        });
        assert_eq!(cx.debug_bounds("small"), Some(rect(0.0, 0.0, 58.0, 28.0)));
        assert_eq!(cx.debug_bounds("medium"), Some(rect(0.0, 28.0, 77.0, 36.0)));
        assert_eq!(cx.debug_bounds("large"), Some(rect(0.0, 64.0, 80.0, 44.0)));
    }
}
