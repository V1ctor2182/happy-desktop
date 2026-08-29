use std::rc::Rc;

use gpui::{
    App, Context, Entity, FocusHandle, Focusable, FontWeight, IntoElement, KeyBinding, MouseButton,
    Render, SharedString, Window, actions, div, prelude::*, px, transparent_black,
};

use super::{
    components::{ActivateHandler, ModalFocus, ModalOverlay, OverlayPlacement, ScrollSurface},
    icon::{Icon, IconName},
    key_cap::KeyCap,
    scrollbar::ScrollbarState,
    text_input::{TextInput, TextInputEvent},
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

actions!(
    happy_command_palette,
    [
        CommandPaletteNext,
        CommandPalettePrevious,
        CommandPaletteCommit,
        CommandPaletteDismiss,
        CommandPaletteToggle
    ]
);

const KEY_CONTEXT: &str = "HappyCommandPalette";

/// Installs the palette-only keyboard bindings. Call once during app initialization.
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("down", CommandPaletteNext, Some(KEY_CONTEXT)),
        KeyBinding::new("up", CommandPalettePrevious, Some(KEY_CONTEXT)),
        KeyBinding::new("enter", CommandPaletteCommit, Some(KEY_CONTEXT)),
        KeyBinding::new("escape", CommandPaletteDismiss, Some(KEY_CONTEXT)),
        KeyBinding::new("cmd-k", CommandPaletteToggle, Some(KEY_CONTEXT)),
    ]);
}

fn part(id: impl Into<SharedString>, name: &'static str) -> impl Fn() -> String {
    let id = id.into();
    move || format!("{id}.{name}")
}

pub type QueryChangedHandler = Rc<dyn Fn(SharedString, &mut App)>;
pub type ActiveChangedHandler = Rc<dyn Fn(usize, SharedString, &mut Window, &mut App)>;
pub type CommitHandler = Rc<dyn Fn(usize, SharedString, &mut Window, &mut App)>;
pub type ControlRenderer = Rc<dyn Fn(Theme, &mut Window, &mut App) -> gpui::AnyElement>;

#[derive(Clone)]
pub struct CommandPaletteCommandRow {
    pub id: SharedString,
    pub title: SharedString,
    pub meta: Option<SharedString>,
    pub icon: Option<IconName>,
    pub shortcut: Option<SharedString>,
    pub disabled: bool,
}

/// A settings result whose live control is supplied by the settings surface.
/// The row itself never converts a pointer click into a command commit.
#[derive(Clone)]
pub struct CommandPaletteControlRow {
    pub id: SharedString,
    pub label: SharedString,
    pub description: Option<SharedString>,
    pub control: ControlRenderer,
    pub disabled: bool,
}

#[derive(Clone)]
pub enum CommandPaletteRow {
    Command(CommandPaletteCommandRow),
    Control(CommandPaletteControlRow),
}

impl CommandPaletteRow {
    pub fn id(&self) -> &SharedString {
        match self {
            Self::Command(row) => &row.id,
            Self::Control(row) => &row.id,
        }
    }

    pub fn disabled(&self) -> bool {
        match self {
            Self::Command(row) => row.disabled,
            Self::Control(row) => row.disabled,
        }
    }
}

#[derive(Clone)]
pub struct CommandPaletteSection {
    pub id: SharedString,
    pub caption: Option<SharedString>,
    pub rows: Vec<CommandPaletteRow>,
}

#[derive(Clone)]
pub struct CommandPaletteCallbacks {
    pub query_changed: QueryChangedHandler,
    pub active_changed: ActiveChangedHandler,
    pub committed: CommitHandler,
    pub dismissed: ActivateHandler,
}

/// Stable focus handles supplied by the host. The input is the first stop and
/// `last` is attached to the close control so both directions trap predictably.
#[derive(Clone)]
pub struct CommandPaletteFocus {
    pub container: FocusHandle,
    pub last: FocusHandle,
}

/// Controlled, router- and store-free global command palette.
///
/// The owner reconciles `query`, `sections`, and `active_index`; callbacks only
/// report user intent. The owned native [`TextInput`] preserves selection and
/// IME marked text, while external query reconciliation never re-emits output.
pub struct CommandPalette {
    id: SharedString,
    theme: Theme,
    sections: Vec<CommandPaletteSection>,
    active_index: usize,
    input: Entity<TextInput>,
    body_scrollbar: Entity<ScrollbarState>,
    focus: CommandPaletteFocus,
    callbacks: CommandPaletteCallbacks,
}

impl CommandPalette {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: impl Into<SharedString>,
        theme: Theme,
        query: impl Into<SharedString>,
        placeholder: impl Into<SharedString>,
        sections: Vec<CommandPaletteSection>,
        active_index: usize,
        body_scrollbar: Entity<ScrollbarState>,
        focus: CommandPaletteFocus,
        callbacks: CommandPaletteCallbacks,
        cx: &mut Context<Self>,
    ) -> Self {
        let id = id.into();
        let query = query.into();
        let placeholder = placeholder.into();
        let input = cx.new({
            let id = id.clone();
            let query = query.clone();
            let placeholder = placeholder.clone();
            move |cx| TextInput::new(format!("{id}-input"), query, placeholder, theme, cx)
        });
        cx.subscribe(&input, |palette, _, event, cx| {
            let TextInputEvent::Changed { value } = event;
            (palette.callbacks.query_changed)(value.clone(), cx);
            cx.notify();
        })
        .detach();
        let mut palette = Self {
            id,
            theme,
            sections,
            active_index,
            input,
            body_scrollbar,
            focus,
            callbacks,
        };
        palette.clamp_active();
        palette
    }

    pub fn input(&self) -> &Entity<TextInput> {
        &self.input
    }

    pub fn query_reconcile(&mut self, query: impl Into<SharedString>, cx: &mut Context<Self>) {
        let query = query.into();
        self.input
            .update(cx, |input, cx| input.set_value(query, cx));
        cx.notify();
    }

    pub fn results_reconcile(
        &mut self,
        sections: Vec<CommandPaletteSection>,
        active_index: usize,
        cx: &mut Context<Self>,
    ) {
        self.sections = sections;
        self.active_index = active_index;
        self.clamp_active();
        cx.notify();
    }

    pub fn active_reconcile(&mut self, active_index: usize, cx: &mut Context<Self>) {
        self.active_index = active_index;
        self.clamp_active();
        cx.notify();
    }

    pub fn theme_reconcile(&mut self, theme: Theme, cx: &mut Context<Self>) {
        self.theme = theme;
        self.input
            .update(cx, |input, _| input.theme_reconcile(theme));
        cx.notify();
    }

    fn flat_rows(&self) -> Vec<&CommandPaletteRow> {
        self.sections
            .iter()
            .flat_map(|section| section.rows.iter())
            .collect()
    }

    fn clamp_active(&mut self) {
        let rows = self.flat_rows();
        if rows.is_empty() {
            self.active_index = 0;
        } else {
            self.active_index = self.active_index.min(rows.len() - 1);
        }
    }

    fn move_active(&self, direction: isize, window: &mut Window, cx: &mut Context<Self>) {
        let rows = self.flat_rows();
        if rows.is_empty() || rows.iter().all(|row| row.disabled()) {
            return;
        }
        let count = rows.len() as isize;
        let mut next = self.active_index.min(rows.len() - 1) as isize;
        loop {
            next = (next + direction).rem_euclid(count);
            if !rows[next as usize].disabled() {
                break;
            }
        }
        let index = next as usize;
        let id = rows[index].id().clone();
        (self.callbacks.active_changed)(index, id, window, cx);
    }

    fn commit_active(&self, window: &mut Window, cx: &mut App) {
        let rows = self.flat_rows();
        if let Some(row) = rows.get(self.active_index).filter(|row| !row.disabled()) {
            (self.callbacks.committed)(self.active_index, row.id().clone(), window, cx);
        }
    }
}

impl Render for CommandPalette {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = self.theme;
        let id = self.id.clone();
        let input_focus = self.input.read(cx).focus_handle(cx);
        let callbacks = self.callbacks.clone();
        let viewport = window.viewport_size();
        let card_width = (viewport.width - px(48.0)).min(px(640.0)).max(px(320.0));
        let active = self.active_index;
        let mut flat_index = 0usize;
        let mut section_elements = Vec::new();

        for section in self.sections.clone() {
            if section.rows.is_empty() {
                continue;
            }
            let section_id = section.id.clone();
            let mut rows = Vec::new();
            for row in section.rows {
                let index = flat_index;
                flat_index += 1;
                let row_id = row.id().clone();
                let disabled = row.disabled();
                let is_command = matches!(row, CommandPaletteRow::Command(_));
                let selected = index == active;
                let active_handler = callbacks.active_changed.clone();
                let commit_handler = callbacks.committed.clone();
                let base = div()
                    .id(SharedString::from(format!("{id}-row-{row_id}")))
                    .debug_selector({
                        let id = id.clone();
                        move || format!("{id}.row-{index}")
                    })
                    .w_full()
                    .when(is_command, |row| row.h(px(44.0)))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .px(px(10.0))
                    .rounded(px(6.0))
                    .when(selected, |row| {
                        row.bg(theme.role(ThemeRole::SurfaceSelected))
                    })
                    .hover(move |row| {
                        if disabled {
                            row
                        } else {
                            row.bg(theme.role(ThemeRole::SurfaceRipple))
                        }
                    })
                    .opacity(if disabled { 0.48 } else { 1.0 })
                    .on_mouse_move({
                        let row_id = row_id.clone();
                        move |_, window, cx| {
                            if !disabled && !selected {
                                active_handler(index, row_id.clone(), window, cx);
                            }
                        }
                    });
                rows.push(match row {
                    CommandPaletteRow::Command(row) => base
                        .when(!disabled, |element| {
                            let row_id = row_id.clone();
                            element.on_click(move |_, window, cx| {
                                commit_handler(index, row_id.clone(), window, cx)
                            })
                        })
                        .child(
                            div()
                                .debug_selector({
                                    let id = id.clone();
                                    move || format!("{id}.row-{index}-leading")
                                })
                                .size(px(28.0))
                                .flex_none()
                                .flex()
                                .items_center()
                                .justify_center()
                                .children(row.icon.map(|icon| {
                                    Icon::decorative(
                                        icon,
                                        18.0,
                                        theme.role(ThemeRole::TextSecondary).into(),
                                        format!("{id}.row-{index}-icon"),
                                    )
                                })),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .justify_center()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .debug_selector({
                                            let id = id.clone();
                                            move || format!("{id}.row-{index}-title")
                                        })
                                        .h(px(20.0))
                                        .truncate()
                                        .text_size(px(15.0))
                                        .line_height(px(20.0))
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(row.title),
                                )
                                .children(row.meta.map(|meta| {
                                    div()
                                        .h(px(16.0))
                                        .truncate()
                                        .text_size(px(13.0))
                                        .line_height(px(16.0))
                                        .font_weight(FontWeight::NORMAL)
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child(meta)
                                })),
                        )
                        .children(row.shortcut.map(|shortcut| KeyCap {
                            id: format!("{id}.row-{index}-shortcut").into(),
                            theme,
                            keys: shortcut,
                        }))
                        .into_any_element(),
                    CommandPaletteRow::Control(row) => base
                        .min_h(px(64.0))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .justify_center()
                                .gap(px(2.0))
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(px(15.0))
                                        .line_height(px(20.0))
                                        .text_color(theme.role(ThemeRole::Text))
                                        .child(row.label),
                                )
                                .children(row.description.map(|description| {
                                    div()
                                        .truncate()
                                        .text_size(px(13.0))
                                        .line_height(px(18.0))
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child(description)
                                })),
                        )
                        .child(
                            div()
                                .flex_none()
                                .flex()
                                .items_center()
                                .child((row.control)(theme, window, cx)),
                        )
                        .into_any_element(),
                });
            }
            section_elements.push(
                div()
                    .debug_selector({
                        let id = id.clone();
                        let section_id = section_id.clone();
                        move || format!("{id}.section-{section_id}")
                    })
                    .w_full()
                    .flex_none()
                    .flex()
                    .flex_col()
                    .children(section.caption.map(|caption| {
                        div()
                            .debug_selector({
                                let id = id.clone();
                                move || format!("{id}.caption-{section_id}")
                            })
                            .h(px(28.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .px(px(10.0))
                            .truncate()
                            .font_family(fonts::MONO_FAMILY)
                            .text_size(px(11.0))
                            .line_height(px(16.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(caption.to_uppercase())
                    }))
                    .children(rows),
            );
        }

        let dismiss_action = callbacks.dismissed.clone();
        let toggle_action = callbacks.dismissed.clone();
        let commit_entity = cx.entity().downgrade();
        let commit_dismiss = callbacks.dismissed.clone();
        let commit_close_focus = self.focus.last.clone();
        let next_entity = cx.entity().downgrade();
        let previous_entity = cx.entity().downgrade();
        let close = callbacks.dismissed.clone();
        let close_keyboard = close.clone();
        let close_focus = self.focus.last.clone();
        let card = div()
            .debug_selector(part(id.clone(), "card"))
            .w(card_width)
            .h((viewport.height
                - (viewport.height - px(552.0)).clamp(px(48.0), px(128.0))
                - px(24.0))
            .min(px(461.0)))
            .flex_none()
            .flex()
            .flex_col()
            .overflow_hidden()
            .border_1()
            .border_color(theme.role(ThemeRole::ModalBorder))
            .rounded(px(14.0))
            .bg(theme.role(ThemeRole::SurfaceHigh))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .key_context(KEY_CONTEXT)
            .on_action(move |_: &CommandPaletteNext, window, cx| {
                cx.stop_propagation();
                let _ = next_entity.update(cx, |palette, cx| palette.move_active(1, window, cx));
            })
            .on_action(move |_: &CommandPalettePrevious, window, cx| {
                cx.stop_propagation();
                let _ =
                    previous_entity.update(cx, |palette, cx| palette.move_active(-1, window, cx));
            })
            .on_action(move |_: &CommandPaletteCommit, window, cx| {
                cx.stop_propagation();
                if commit_close_focus.is_focused(window) {
                    commit_dismiss(window, cx);
                } else if let Some(entity) = commit_entity.upgrade() {
                    let _ = entity.update(cx, |palette, cx| palette.commit_active(window, cx));
                }
            })
            .on_action(move |_: &CommandPaletteDismiss, window, cx| {
                cx.stop_propagation();
                dismiss_action(window, cx);
            })
            .on_action(move |_: &CommandPaletteToggle, window, cx| {
                cx.stop_propagation();
                toggle_action(window, cx);
            })
            .child(
                div()
                    .debug_selector(part(id.clone(), "header"))
                    .h(px(60.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(12.0))
                    .pl(px(20.0))
                    .pr(px(16.0))
                    .border_b_1()
                    .border_color(theme.role(ThemeRole::Divider))
                    .child(Icon::decorative(
                        IconName::Search,
                        18.0,
                        theme.role(ThemeRole::TextSecondary).into(),
                        format!("{id}.search-icon"),
                    ))
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "input"))
                            .flex_1()
                            .min_w_0()
                            .h(px(40.0))
                            .flex()
                            .items_center()
                            .text_size(px(16.0))
                            .line_height(px(40.0))
                            .font_weight(FontWeight::MEDIUM)
                            .child(self.input.clone()),
                    )
                    .child(
                        div()
                            .debug_selector(part(id.clone(), "escape-hint"))
                            .h(px(18.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .px(px(4.0))
                            .rounded(px(4.0))
                            .bg(theme.role(ThemeRole::InputBackground))
                            .font_family(fonts::MONO_FAMILY)
                            .text_size(px(10.0))
                            .font_weight(FontWeight::BOLD)
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child("ESC"),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("{id}-close")))
                            .debug_selector(part(id.clone(), "close"))
                            .relative()
                            .size(px(28.0))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded_full()
                            .border_2()
                            .border_color(transparent_black())
                            .focus(|style| style.border_color(theme.role(ThemeRole::RadioActive)))
                            .cursor_pointer()
                            .track_focus(&close_focus.tab_index(0).tab_stop(true))
                            .hover(|button| button.bg(theme.role(ThemeRole::SurfaceRipple)))
                            .on_mouse_down(MouseButton::Left, {
                                let close_focus = self.focus.last.clone();
                                move |_, window, cx| {
                                    close_focus.focus(window);
                                    close(window, cx);
                                }
                            })
                            .on_key_down(move |event, window, cx| {
                                if !event.is_held
                                    && matches!(
                                        event.keystroke.key.as_str(),
                                        "enter" | "space" | " "
                                    )
                                {
                                    cx.stop_propagation();
                                    close_keyboard(window, cx);
                                }
                            })
                            .child(Icon::labelled(
                                IconName::Close,
                                "Close",
                                14.0,
                                theme.role(ThemeRole::TextSecondary).into(),
                                format!("{id}.close-icon"),
                            )),
                    ),
            )
            .child(
                div()
                    .debug_selector(part(id.clone(), "body"))
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .child(ScrollSurface {
                        id: format!("{id}-body-scroll").into(),
                        theme,
                        width: None,
                        height: None,
                        vertical: Some(self.body_scrollbar.clone()),
                        horizontal: None,
                        content: div()
                            .debug_selector(part(id.clone(), "body-content"))
                            .w_full()
                            .min_h_full()
                            .flex()
                            .flex_col()
                            .gap(px(8.0))
                            .p(px(8.0))
                            .children(section_elements)
                            .into_any_element(),
                    }),
            )
            .into_any_element();

        ModalOverlay {
            id,
            theme,
            placement: OverlayPlacement::Top,
            content: card,
            focus: ModalFocus {
                container: self.focus.container.clone(),
                initial: input_focus.clone(),
                first: input_focus,
                last: self.focus.last.clone(),
            },
            on_dismiss: Some(self.callbacks.dismissed.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::scrollbar::{ScrollbarAppearance, ScrollbarPlacement, SharedScrollHandle};
    use gpui::{App, Bounds, Pixels, TestAppContext, VisualTestContext, size};
    use std::{cell::RefCell, rc::Rc};

    fn sections() -> Vec<CommandPaletteSection> {
        vec![
            CommandPaletteSection {
                id: "recent".into(),
                caption: Some("Recent".into()),
                rows: vec![
                    CommandPaletteRow::Command(CommandPaletteCommandRow {
                        id: "one".into(),
                        title: "Palette results list".into(),
                        meta: Some("seville · main".into()),
                        icon: Some(IconName::Chat),
                        shortcut: None,
                        disabled: false,
                    }),
                    CommandPaletteRow::Command(CommandPaletteCommandRow {
                        id: "disabled".into(),
                        title: "Unavailable".into(),
                        meta: None,
                        icon: Some(IconName::Lock),
                        shortcut: None,
                        disabled: true,
                    }),
                ],
            },
            CommandPaletteSection {
                id: "actions".into(),
                caption: Some("Actions".into()),
                rows: vec![
                    CommandPaletteRow::Command(CommandPaletteCommandRow {
                        id: "three".into(),
                        title: "New workspace".into(),
                        meta: None,
                        icon: Some(IconName::Branch),
                        shortcut: Some("⌘N".into()),
                        disabled: false,
                    }),
                    CommandPaletteRow::Control(CommandPaletteControlRow {
                        id: "theme".into(),
                        label: "Theme".into(),
                        description: Some("Match the system appearance".into()),
                        disabled: false,
                        control: Rc::new(|theme, _, _| {
                            div()
                                .debug_selector(|| "palette.control-theme".into())
                                .w_full()
                                .h(px(64.0))
                                .flex()
                                .items_center()
                                .child("Theme")
                                .text_color(theme.role(ThemeRole::Text))
                                .into_any_element()
                        }),
                    }),
                ],
            },
            CommandPaletteSection {
                id: "more".into(),
                caption: Some("More".into()),
                rows: (0..8)
                    .map(|index| {
                        CommandPaletteRow::Command(CommandPaletteCommandRow {
                            id: format!("more-{index}").into(),
                            title: format!("Additional result {index}").into(),
                            meta: None,
                            icon: None,
                            shortcut: None,
                            disabled: false,
                        })
                    })
                    .collect(),
            },
        ]
    }

    struct Harness {
        palette: Entity<CommandPalette>,
    }
    impl Render for Harness {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().relative().child(self.palette.clone())
        }
    }

    fn render(
        cx: &mut TestAppContext,
        width: f32,
        height: f32,
        active: Rc<RefCell<Vec<(usize, String)>>>,
        commits: Rc<RefCell<Vec<(usize, String)>>>,
        dismissals: Rc<RefCell<usize>>,
    ) -> (Entity<Harness>, &mut VisualTestContext) {
        cx.update(|cx: &mut App| {
            crate::fonts::register(cx);
            crate::ui::text_input::init(cx);
            crate::ui::components::init(cx);
            super::init(cx);
        });
        let (view, cx) = cx.add_window_view(move |_, cx| {
            let scroll = cx.new(|_| {
                ScrollbarState::vertical(
                    ScrollbarAppearance::Automatic,
                    ScrollbarPlacement::BesideWhenOverflowing,
                    SharedScrollHandle::new(),
                )
            });
            let container = cx.focus_handle();
            let last = cx.focus_handle();
            let active_log = active.clone();
            let commit_log = commits.clone();
            let dismissal_log = dismissals.clone();
            let palette = cx.new(|cx| {
                CommandPalette::new(
                    "palette",
                    Theme::light(),
                    "",
                    "Search Happy Place…",
                    sections(),
                    0,
                    scroll,
                    CommandPaletteFocus { container, last },
                    CommandPaletteCallbacks {
                        query_changed: Rc::new(|_, _| {}),
                        active_changed: Rc::new(move |index, id, _, _| {
                            active_log.borrow_mut().push((index, id.to_string()));
                        }),
                        committed: Rc::new(move |index, id, _, _| {
                            commit_log.borrow_mut().push((index, id.to_string()));
                        }),
                        dismissed: Rc::new(move |_, _| *dismissal_log.borrow_mut() += 1),
                    },
                    cx,
                )
            });
            Harness { palette }
        });
        cx.simulate_resize(size(px(width), px(height)));
        cx.run_until_parked();
        assert_eq!(cx.update(|window, _| window.scale_factor()), 2.0);
        (view, cx)
    }

    fn bounds(cx: &mut VisualTestContext, selector: &'static str) -> Bounds<Pixels> {
        cx.debug_bounds(selector)
            .unwrap_or_else(|| panic!("missing rendered geometry for {selector}"))
    }

    fn assert_rect(actual: Bounds<Pixels>, x: f32, y: f32, width: f32, height: f32) {
        assert_eq!(actual.origin.x, px(x), "resolved x");
        assert_eq!(actual.origin.y, px(y), "resolved y");
        assert_eq!(actual.size.width, px(width), "resolved width");
        assert_eq!(actual.size.height, px(height), "resolved height");
    }

    #[gpui::test]
    fn resolves_top_palette_geometry_and_input_focus_at_both_window_contracts(
        cx: &mut TestAppContext,
    ) {
        for (width, height, top) in [(1280.0, 800.0, 128.0), (720.0, 480.0, 48.0)] {
            let active = Rc::new(RefCell::new(Vec::new()));
            let commits = Rc::new(RefCell::new(Vec::new()));
            let dismissals = Rc::new(RefCell::new(0));
            let (view, cx) = render(cx, width, height, active, commits, dismissals);
            let expected_height = (height - top - 24.0_f32).min(461.0);
            let card = bounds(cx, "palette.card");
            assert_rect(card, (width - 640.0) / 2.0, top, 640.0, expected_height);
            assert!(
                px(height) - card.bottom() >= px(24.0),
                "card must preserve the 24px safe gutter"
            );
            assert_rect(
                bounds(cx, "palette.header"),
                (width - 640.0) / 2.0 + 1.0,
                top + 1.0,
                638.0,
                60.0,
            );
            assert_rect(
                bounds(cx, "palette.body"),
                (width - 640.0) / 2.0 + 1.0,
                top + 61.0,
                638.0,
                expected_height - 62.0,
            );
            let scroll_root = bounds(cx, "palette-body-scroll.root");
            let scroll_viewport = bounds(cx, "palette-body-scroll.viewport");
            assert_eq!(scroll_root, bounds(cx, "palette.body"));
            assert_eq!(scroll_viewport.origin, scroll_root.origin);
            assert_eq!(scroll_viewport.size.height, scroll_root.size.height);
            assert_eq!(scroll_root.size.width - scroll_viewport.size.width, px(8.0));
            let content = bounds(cx, "palette.body-content");
            assert!(content.size.height > bounds(cx, "palette.body").size.height);
            assert_eq!(content.origin.x - card.origin.x, px(1.0));
            assert_eq!(
                bounds(cx, "palette.caption-recent").origin.x - content.origin.x,
                px(8.0)
            );
            let first = bounds(cx, "palette.row-0");
            assert_eq!(first.origin.x - content.origin.x, px(8.0));
            assert_eq!(first.size, size(px(614.0), px(44.0)));
            assert_eq!(bounds(cx, "palette.caption-recent").size.height, px(28.0));
            assert_eq!(
                bounds(cx, "palette.row-1").origin.y - first.bottom(),
                px(0.0)
            );
            assert_eq!(
                bounds(cx, "palette.caption-actions").origin.y
                    - bounds(cx, "palette.row-1").bottom(),
                px(8.0)
            );
            assert_eq!(bounds(cx, "palette.row-3").size.height, px(64.0));
            assert_eq!(bounds(cx, "palette.control-theme").size.height, px(64.0));
            let shortcut = bounds(cx, "palette.row-2-shortcut.root");
            assert_eq!(shortcut.size, size(px(23.5), px(18.0)));
            assert_eq!(
                bounds(cx, "palette.row-2-shortcut.token-0.slot").size.width,
                px(9.0)
            );
            assert_eq!(
                bounds(cx, "palette.row-2-shortcut.token-1.slot").size.width,
                px(6.5)
            );
            let input = cx.update(|_, app| view.read(app).palette.read(app).input().clone());
            assert!(cx.update(|window, app| input.read(app).focus_handle(app).is_focused(window)));
        }
    }

    #[gpui::test]
    fn close_is_last_focus_stop_and_activates_by_pointer_enter_and_space(cx: &mut TestAppContext) {
        use gpui::Modifiers;

        let active = Rc::new(RefCell::new(Vec::new()));
        let commits = Rc::new(RefCell::new(Vec::new()));
        let dismissals = Rc::new(RefCell::new(0));
        let (view, cx) = render(cx, 720.0, 480.0, active, commits, dismissals.clone());
        let input = cx.update(|_, app| view.read(app).palette.read(app).input().clone());
        let close = cx.update(|_, app| view.read(app).palette.read(app).focus.last.clone());

        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, _| close.is_focused(window)));
        cx.simulate_keystrokes("tab");
        assert!(cx.update(|window, app| input.read(app).focus_handle(app).is_focused(window)));
        cx.simulate_keystrokes("shift-tab");
        assert!(cx.update(|window, _| close.is_focused(window)));

        cx.simulate_keystrokes("enter space");
        let close_bounds = bounds(cx, "palette.close");
        let close_center = gpui::point(close_bounds.left() + px(3.0), close_bounds.center().y);
        cx.simulate_click(close_center, Modifiers::default());
        assert!(
            cx.update(|window, _| close.is_focused(window)),
            "pointer focuses close"
        );
        assert_eq!(*dismissals.borrow(), 3);
    }

    #[gpui::test]
    fn arrows_wrap_skip_disabled_and_enter_escape_and_command_k_report_intent(
        cx: &mut TestAppContext,
    ) {
        let active = Rc::new(RefCell::new(Vec::new()));
        let commits = Rc::new(RefCell::new(Vec::new()));
        let dismissals = Rc::new(RefCell::new(0));
        let (view, cx) = render(
            cx,
            1280.0,
            800.0,
            active.clone(),
            commits.clone(),
            dismissals.clone(),
        );
        cx.simulate_keystrokes("up");
        let palette = cx.update(|_, app| view.read(app).palette.clone());
        cx.update(|_, app| palette.update(app, |palette, cx| palette.active_reconcile(3, cx)));
        cx.run_until_parked();
        cx.simulate_keystrokes("enter");
        cx.update(|_, app| palette.update(app, |palette, cx| palette.active_reconcile(0, cx)));
        cx.run_until_parked();
        cx.simulate_keystrokes("down");
        cx.update(|_, app| palette.update(app, |palette, cx| palette.active_reconcile(2, cx)));
        cx.run_until_parked();
        cx.simulate_keystrokes("down");
        cx.simulate_keystrokes("escape");
        cx.simulate_keystrokes("cmd-k");
        assert_eq!(
            &*active.borrow(),
            &[
                (11, "more-7".into()),
                (2, "three".into()),
                (3, "theme".into())
            ]
        );
        assert_eq!(&*commits.borrow(), &[(3, "theme".into())]);
        assert_eq!(*dismissals.borrow(), 2);
    }
}
