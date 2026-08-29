use gpui::{
    App, FontWeight, IntoElement, PathBuilder, RenderOnce, SharedString, Window, canvas, div,
    point, prelude::*, px,
};

use super::theme_roles::ThemeRole;
use crate::{fonts, theme::Theme};

const SYMBOL_WIDTH: f32 = 9.0;
const TEXT_WIDTH: f32 = 6.5;

fn part(id: impl Into<SharedString>, name: impl Into<SharedString>) -> impl Fn() -> String {
    let id = id.into();
    let name = name.into();
    move || format!("{id}.{name}")
}

fn modifier_symbol(id: SharedString, symbol: char, theme: Theme) -> gpui::AnyElement {
    div()
        .debug_selector(part(id, "artwork"))
        .w(px(SYMBOL_WIDTH))
        .h(px(10.0))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .child(
            canvas(
                |bounds, _, _| bounds,
                move |_, bounds, window, _| {
                    let origin = bounds.origin;
                    let p = |x: f32, y: f32| point(origin.x + px(x), origin.y + px(y));
                    let mut path = PathBuilder::stroke(px(1.0));
                    match symbol {
                        // Normalized component-owned modifier artwork. These paths occupy a
                        // fixed 9px symbol viewport instead of relying on platform font glyphs.
                        '⌘' => {
                            path.move_to(p(3.0, 3.0));
                            path.line_to(p(6.0, 3.0));
                            path.line_to(p(6.0, 7.0));
                            path.line_to(p(3.0, 7.0));
                            path.close();
                            path.move_to(p(3.0, 3.0));
                            path.cubic_bezier_to(p(3.0, 0.5), p(0.5, 3.0), p(0.5, 0.5));
                            path.cubic_bezier_to(p(6.0, 3.0), p(8.5, 3.0), p(8.5, 0.5));
                            path.cubic_bezier_to(p(6.0, 7.0), p(8.5, 7.0), p(8.5, 9.5));
                            path.cubic_bezier_to(p(3.0, 7.0), p(0.5, 7.0), p(0.5, 9.5));
                        }
                        '⇧' => {
                            path.move_to(p(0.5, 5.0));
                            path.line_to(p(4.5, 0.5));
                            path.line_to(p(8.5, 5.0));
                            path.line_to(p(6.5, 5.0));
                            path.line_to(p(6.5, 9.0));
                            path.line_to(p(2.5, 9.0));
                            path.line_to(p(2.5, 5.0));
                            path.close();
                        }
                        '⌥' => {
                            path.move_to(p(0.5, 1.0));
                            path.line_to(p(2.5, 1.0));
                            path.line_to(p(7.0, 9.0));
                            path.line_to(p(8.5, 9.0));
                            path.move_to(p(5.0, 1.0));
                            path.line_to(p(8.5, 1.0));
                            path.move_to(p(0.5, 9.0));
                            path.line_to(p(4.0, 9.0));
                        }
                        '⌃' => {
                            path.move_to(p(0.5, 7.5));
                            path.line_to(p(4.5, 2.0));
                            path.line_to(p(8.5, 7.5));
                        }
                        _ => return,
                    }
                    if let Ok(path) = path.build() {
                        window.paint_path(path, theme.role(ThemeRole::TextSecondary));
                    }
                },
            )
            .size(px(9.0)),
        )
        .into_any_element()
}

/// A normalized keyboard-shortcut cap.
///
/// Modifier symbols use fixed component-owned artwork slots. Letters, digits,
/// and named keys use separate fixed mono cells, so platform fallback glyphs
/// cannot change the chord's spacing or baseline.
#[derive(IntoElement)]
pub struct KeyCap {
    pub id: SharedString,
    pub theme: Theme,
    pub keys: SharedString,
}

impl RenderOnce for KeyCap {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id;
        let theme = self.theme;
        div()
            .debug_selector(part(id.clone(), "root"))
            .h(px(18.0))
            .flex_none()
            .flex()
            .items_center()
            .px(px(4.0))
            .rounded(px(4.0))
            .bg(theme.role(ThemeRole::InputBackground))
            .text_color(theme.role(ThemeRole::TextSecondary))
            .child(
                div()
                    .debug_selector(part(id.clone(), "label"))
                    .h(px(10.0))
                    .flex()
                    .items_center()
                    .children(self.keys.chars().enumerate().map(|(index, key)| {
                        let token_id: SharedString = format!("{id}.token-{index}").into();
                        let is_modifier = matches!(key, '⌘' | '⇧' | '⌥' | '⌃');
                        div()
                            .debug_selector(part(token_id.clone(), "slot"))
                            .w(px(if is_modifier {
                                SYMBOL_WIDTH
                            } else {
                                TEXT_WIDTH
                            }))
                            .h(px(10.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .when(is_modifier, |token| {
                                token.child(modifier_symbol(token_id.clone(), key, theme))
                            })
                            .when(!is_modifier, |token| {
                                token.child(
                                    div()
                                        .debug_selector(part(token_id, "text"))
                                        .w(px(TEXT_WIDTH))
                                        .h(px(10.0))
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .font_family(fonts::MONO_FAMILY)
                                        .text_size(px(10.8))
                                        .line_height(px(10.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(key.to_string()),
                                )
                            })
                    })),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{
        App, Bounds, Context, Pixels, Render, TestAppContext, VisualTestContext, Window, size,
    };

    struct Fixture;
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
                .size_full()
                .flex()
                .items_start()
                .gap(px(8.0))
                .child(KeyCap {
                    id: "cap-command".into(),
                    theme: Theme::light(),
                    keys: "⌘K".into(),
                })
                .child(KeyCap {
                    id: "cap-shift".into(),
                    theme: Theme::light(),
                    keys: "⇧⌘P".into(),
                })
                .child(KeyCap {
                    id: "cap-option".into(),
                    theme: Theme::light(),
                    keys: "⌥A".into(),
                })
                .child(KeyCap {
                    id: "cap-control".into(),
                    theme: Theme::light(),
                    keys: "⌃1".into(),
                })
                .child(KeyCap {
                    id: "cap-narrow".into(),
                    theme: Theme::light(),
                    keys: "I".into(),
                })
                .child(KeyCap {
                    id: "cap-wide".into(),
                    theme: Theme::light(),
                    keys: "W".into(),
                })
                .child(KeyCap {
                    id: "cap-escape".into(),
                    theme: Theme::light(),
                    keys: "ESC".into(),
                })
                .child(KeyCap {
                    id: "cap-enter".into(),
                    theme: Theme::light(),
                    keys: "ENTER".into(),
                })
        }
    }

    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector)
            .unwrap_or_else(|| panic!("missing rendered geometry for {selector}"))
    }

    #[gpui::test]
    fn key_caps_separate_modifier_artwork_and_fixed_mono_cells_at_2x(cx: &mut TestAppContext) {
        cx.update(|cx: &mut App| crate::fonts::register(cx));
        let (_view, cx) = cx.add_window_view(|_, _| Fixture);
        cx.simulate_resize(size(px(400.0), px(80.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);

        for (id, width) in [
            ("cap-command", 23.5),
            ("cap-shift", 32.5),
            ("cap-option", 23.5),
            ("cap-control", 23.5),
            ("cap-narrow", 14.5),
            ("cap-wide", 14.5),
            ("cap-escape", 27.5),
            ("cap-enter", 40.5),
        ] {
            assert_eq!(
                bounds(cx, Box::leak(format!("{id}.root").into_boxed_str())).size,
                size(px(width), px(18.0))
            );
        }
        for id in ["cap-command", "cap-shift", "cap-option", "cap-control"] {
            assert_eq!(
                bounds(cx, Box::leak(format!("{id}.token-0.slot").into_boxed_str())).size,
                size(px(9.0), px(10.0))
            );
            assert_eq!(
                bounds(
                    cx,
                    Box::leak(format!("{id}.token-0.artwork").into_boxed_str())
                )
                .size,
                size(px(9.0), px(10.0))
            );
        }
        assert_eq!(bounds(cx, "cap-shift.token-1.slot").size.width, px(9.0));
        assert_eq!(bounds(cx, "cap-shift.token-2.slot").size.width, px(6.5));
        assert_eq!(
            bounds(cx, "cap-narrow.token-0.text").size,
            size(px(6.5), px(10.0))
        );
        assert_eq!(
            bounds(cx, "cap-wide.token-0.text").size,
            size(px(6.5), px(10.0))
        );
        assert_eq!(
            bounds(cx, "cap-enter.token-4.text").size,
            size(px(6.5), px(10.0))
        );
        let command = bounds(cx, "cap-command.root");
        let label = bounds(cx, "cap-command.label");
        assert_eq!(label.origin.x - command.origin.x, px(4.0));
        assert_eq!(command.right() - label.right(), px(4.0));
    }
}
