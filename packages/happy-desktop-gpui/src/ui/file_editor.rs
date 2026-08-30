//! Reusable, store-free file editor chrome around a caller-owned [`TextArea`].

use std::rc::Rc;

use gpui::{
    AnyElement, App, Entity, FocusHandle, FontWeight, IntoElement, MouseButton, RenderOnce,
    SharedString, Window, div, prelude::*, px,
};

use super::{
    text_area::{Save, TextArea},
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const FILE_EDITOR_TOOLBAR_HEIGHT: f32 = 32.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileEditorMode {
    Rendered,
    Source,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FileEditorState {
    pub dirty: bool,
    pub read_only: bool,
    pub saving: bool,
    pub error: Option<SharedString>,
}

#[derive(Clone)]
pub struct FileEditorFocus {
    pub wrap: FocusHandle,
    pub rendered: FocusHandle,
    pub source: FocusHandle,
    pub revert: FocusHandle,
}

pub type FileEditorHandler = Rc<dyn Fn(&mut Window, &mut App)>;
pub type FileEditorModeHandler = Rc<dyn Fn(FileEditorMode, &mut Window, &mut App)>;
pub type FileEditorWrapHandler = Rc<dyn Fn(bool, &mut Window, &mut App)>;

fn flat_control(
    id: SharedString,
    label: &'static str,
    selected: bool,
    disabled: bool,
    theme: Theme,
    focus: FocusHandle,
    activate: Option<FileEditorHandler>,
) -> AnyElement {
    let pointer = (!disabled).then_some(activate.clone()).flatten();
    let pointer_focus = focus.clone();
    div()
        .id(id.clone())
        .debug_selector(move || format!("{id}.root"))
        .h(px(24.0))
        .flex()
        .items_center()
        .px(px(8.0))
        .rounded(px(4.0))
        .font_family(fonts::UI_FAMILY)
        .text_size(px(11.0))
        .line_height(px(16.0))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(if disabled {
            theme.role(ThemeRole::TextSecondary)
        } else {
            theme.role(ThemeRole::Text)
        })
        .opacity(if disabled { 0.48 } else { 1.0 })
        .track_focus(&focus.tab_index(0).tab_stop(activate.is_some() && !disabled))
        .on_key_down(|event, window, cx| {
            if !event.is_held && event.keystroke.key.as_str() == "tab" {
                cx.stop_propagation();
                if event.keystroke.modifiers.shift {
                    window.focus_prev();
                } else {
                    window.focus_next();
                }
            }
        })
        .when(selected, |v| v.bg(theme.role(ThemeRole::SurfaceSelected)))
        .when(activate.is_some() && !disabled, |v| {
            v.tab_index(0).cursor_pointer()
        })
        .when_some(pointer, |v, handler| {
            let keyboard = handler.clone();
            v.on_mouse_down(MouseButton::Left, move |_, window, _| {
                pointer_focus.focus(window)
            })
            .on_mouse_up(MouseButton::Left, move |_, window, cx| handler(window, cx))
            .on_key_down(move |event, window, cx| {
                if !event.is_held && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                {
                    cx.stop_propagation();
                    keyboard(window, cx);
                }
            })
        })
        .child(label)
        .into_any_element()
}

/// A compact editor shell. It owns no text or product state. The passed entity
/// remains the stable native input and owns selection, IME, and scroll position.
/// Before composition, the caller reconciles `TextAreaLayout::Editor`, read-only,
/// and semantic highlight props on that entity. Render never mutates the entity.
#[derive(IntoElement)]
pub struct FileEditor {
    pub id: SharedString,
    pub theme: Theme,
    pub status: Option<SharedString>,
    pub mode: FileEditorMode,
    pub show_mode_control: bool,
    pub wrap: bool,
    pub state: FileEditorState,
    pub editor: Entity<TextArea>,
    pub rendered: Option<AnyElement>,
    pub focus: FileEditorFocus,
    pub on_mode_change: Option<FileEditorModeHandler>,
    pub on_wrap_change: Option<FileEditorWrapHandler>,
    pub on_save: Option<FileEditorHandler>,
    pub on_revert: Option<FileEditorHandler>,
}

impl RenderOnce for FileEditor {
    fn render(self, _window: &mut Window, _cx: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let save_handler = if self.state.read_only || self.state.saving {
            None
        } else {
            self.on_save.clone()
        };
        let wrap_handler = self.on_wrap_change.clone().map(|handler| {
            let next = !self.wrap;
            Rc::new(move |window: &mut Window, cx: &mut App| handler(next, window, cx))
                as FileEditorHandler
        });
        let source_handler = self.on_mode_change.clone().map(|handler| {
            Rc::new(move |window: &mut Window, cx: &mut App| {
                handler(FileEditorMode::Source, window, cx)
            }) as FileEditorHandler
        });
        let rendered_handler = self.on_mode_change.clone().map(|handler| {
            Rc::new(move |window: &mut Window, cx: &mut App| {
                handler(FileEditorMode::Rendered, window, cx)
            }) as FileEditorHandler
        });
        let status_text = if let Some(error) = &self.state.error {
            Some(error.clone())
        } else if self.state.saving {
            Some("Saving…".into())
        } else if self.state.read_only {
            Some("Read only".into())
        } else {
            self.status.clone()
        };
        let body: AnyElement = if self.mode == FileEditorMode::Rendered {
            self.rendered.unwrap_or_else(|| {
                div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(theme.role(ThemeRole::TextSecondary))
                    .child("No rendered preview")
                    .into_any_element()
            })
        } else {
            self.editor.clone().into_any_element()
        };

        div()
            .id(id.clone())
            .debug_selector(move || format!("{id}.root"))
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(theme.role(ThemeRole::Surface))
            .when_some(save_handler, |root, save| {
                root.on_action(move |_: &Save, window, cx| {
                    save(window, cx);
                    cx.stop_propagation();
                })
            })
            .child(
                div()
                    .debug_selector({
                        let id = self.id.clone();
                        move || format!("{id}.toolbar")
                    })
                    .w_full()
                    .h(px(FILE_EDITOR_TOOLBAR_HEIGHT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .px(px(8.0))
                    .font_family(fonts::UI_FAMILY)
                    .child(div().flex_1())
                    .children(status_text.map(|status| {
                        div()
                            .debug_selector({
                                let id = self.id.clone();
                                move || format!("{id}.status")
                            })
                            .max_w(px(180.0))
                            .truncate()
                            .text_size(px(11.0))
                            .text_color(if self.state.error.is_some() {
                                theme.role(ThemeRole::TextDestructive)
                            } else {
                                theme.role(ThemeRole::TextSecondary)
                            })
                            .child(status)
                    }))
                    .child(flat_control(
                        format!("{}-wrap", self.id).into(),
                        "Wrap",
                        self.wrap,
                        false,
                        theme,
                        self.focus.wrap.clone(),
                        wrap_handler,
                    ))
                    .when(self.show_mode_control, |bar| {
                        bar.child(flat_control(
                            format!("{}-rendered", self.id).into(),
                            "Rendered",
                            self.mode == FileEditorMode::Rendered,
                            false,
                            theme,
                            self.focus.rendered.clone(),
                            rendered_handler,
                        ))
                        .child(flat_control(
                            format!("{}-source", self.id).into(),
                            "Source",
                            self.mode == FileEditorMode::Source,
                            false,
                            theme,
                            self.focus.source.clone(),
                            source_handler,
                        ))
                    })
                    .when(self.state.dirty, |bar| {
                        bar.child(flat_control(
                            format!("{}-revert", self.id).into(),
                            "Revert",
                            false,
                            self.state.saving,
                            theme,
                            self.focus.revert.clone(),
                            self.on_revert,
                        ))
                    }),
            )
            .child(
                div()
                    .debug_selector({
                        let id = self.id.clone();
                        move || format!("{id}.body")
                    })
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .child(body),
            )
    }
}

#[cfg(test)]
mod phase6_file_editor_tests {
    use super::*;
    use gpui::{Context, Modifiers, Render, TestAppContext, VisualTestContext, size};
    use std::cell::Cell;

    struct Fixture {
        width: f32,
        editor: Entity<TextArea>,
        saves: Rc<Cell<usize>>,
        dirty: bool,
        focus: FileEditorFocus,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let saves = self.saves.clone();
            div().w(px(self.width)).h(px(240.0)).child(FileEditor {
                id: "test-file-editor".into(),
                theme: Theme::light(),
                status: Some("Rust".into()),
                mode: FileEditorMode::Source,
                show_mode_control: true,
                wrap: false,
                state: FileEditorState {
                    dirty: self.dirty,
                    read_only: false,
                    saving: false,
                    error: None,
                },
                editor: self.editor.clone(),
                rendered: None,
                focus: self.focus.clone(),
                on_mode_change: Some(Rc::new(|_, _, _| {})),
                on_wrap_change: Some(Rc::new(|_, _, _| {})),
                on_save: Some(Rc::new(move |_, _| saves.set(saves.get() + 1))),
                on_revert: Some(Rc::new(|_, _| {})),
            })
        }
    }
    fn render(cx: &mut TestAppContext, width: f32) -> (Entity<Fixture>, &mut VisualTestContext) {
        cx.update(|cx| {
            crate::fonts::register(cx);
            super::super::text_area::init(cx)
        });
        let (fixture, cx) = cx.add_window_view(|_, cx| {
            let editor = cx.new(|cx| {
                let mut editor = TextArea::new(
                    "test-editor-input",
                    "fn main() {\n    println!(\"hi\");\n}",
                    "",
                    Theme::light(),
                    cx,
                );
                editor.set_layout(
                    super::super::text_area::TextAreaLayout::Editor {
                        wrap: false,
                        line_numbers: true,
                    },
                    cx,
                );
                editor
            });
            Fixture {
                width,
                editor,
                saves: Rc::new(Cell::new(0)),
                dirty: true,
                focus: FileEditorFocus {
                    wrap: cx.focus_handle(),
                    rendered: cx.focus_handle(),
                    source: cx.focus_handle(),
                    revert: cx.focus_handle(),
                },
            }
        });
        cx.simulate_resize(size(px(620.0), px(300.0)));
        cx.run_until_parked();
        (fixture, cx)
    }
    #[gpui::test]
    fn real_220_and_560_editor_geometry_keeps_32px_toolbar_and_full_pane(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 220.0);
        assert_eq!(
            cx.debug_bounds("test-file-editor.root").unwrap().size.width,
            px(220.0)
        );
        assert_eq!(
            cx.debug_bounds("test-file-editor.toolbar")
                .unwrap()
                .size
                .height,
            px(32.0)
        );
        assert_eq!(
            cx.debug_bounds("test-file-editor.body")
                .unwrap()
                .size
                .height,
            px(208.0)
        );
        fixture.update(cx, |f, cx| {
            f.width = 560.0;
            cx.notify()
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("test-file-editor.root").unwrap().size.width,
            px(560.0)
        );
        assert_eq!(
            cx.debug_bounds("test-file-editor.body")
                .unwrap()
                .size
                .height,
            px(208.0)
        );
    }
    #[gpui::test]
    fn cmd_s_calls_owner_and_editor_enter_preserves_native_input(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 560.0);
        let input = fixture.read_with(cx, |f, _| f.editor.clone());
        let bounds = cx.debug_bounds("test-editor-input.root").unwrap();
        cx.simulate_click(bounds.center(), Modifiers::default());
        cx.simulate_keystrokes("cmd-s");
        assert_eq!(fixture.read_with(cx, |f, _| f.saves.get()), 1);
        cx.simulate_keystrokes("cmd-a right enter");
        assert!(input.read_with(cx, |a, _| a.value().ends_with('\n')));
    }
    #[gpui::test]
    fn toolbar_controls_keep_caller_focus_across_tab_and_shift_tab(cx: &mut TestAppContext) {
        let (fixture, cx) = render(cx, 560.0);
        let focus = fixture.read_with(cx, |f, _| f.focus.clone());
        cx.update(|window, _| focus.wrap.focus(window));
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, _| focus.rendered.is_focused(window)));
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, _| focus.wrap.is_focused(window)));
    }
}
