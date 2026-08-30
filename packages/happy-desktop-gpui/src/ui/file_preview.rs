//! Reusable, props-only file and document previews.
//!
//! Product state, file loading, staging, sanitizing, and routing stay with the caller.

use std::{rc::Rc, sync::Arc};

use gpui::{
    AnyElement, App, FocusHandle, FontWeight, Image, IntoElement, ObjectFit, RenderOnce,
    SharedString, StatefulInteractiveElement, Window, div, img, prelude::*, px,
};

use super::{
    Button, ButtonVariant, ControlSize, IconName, ModalFocus, ModalOverlay, OverlayPlacement,
    chat_markdown::{ChatMarkdown, MarkdownDocument, MarkdownLinkActivate},
    native_preview::{NativePreview, NativePreviewSource},
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub const FILE_PREVIEW_HEADER_HEIGHT: f32 = 32.0;
pub type PreviewActivate = Rc<dyn Fn(&mut Window, &mut App)>;
pub type PreviewModeSelect = Rc<dyn Fn(PreviewMode, &mut Window, &mut App)>;

/// Computes visibility for an embedded native child that may also be shown in a lightbox.
///
/// A cloned `NativePreviewSource` owns one platform child. The caller must pass this result to
/// `FilePreview::native_visible` so the embedded frame is inactive while the same source's
/// lightbox is visible. This keeps exactly one frame authoritative at a time.
pub fn embedded_native_visible(route_visible: bool, same_source_lightbox_visible: bool) -> bool {
    route_visible && !same_source_lightbox_visible
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewMode {
    Rendered,
    Source,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BinaryFact {
    pub label: SharedString,
    pub value: SharedString,
}

#[derive(Clone)]
pub enum FilePreviewKind {
    Image {
        image: Arc<Image>,
        dimensions: Option<(u32, u32)>,
        alt: SharedString,
        focus_handle: Option<FocusHandle>,
        on_open_lightbox: Option<PreviewActivate>,
    },
    NativeImage {
        source: NativePreviewSource,
        focus_handle: Option<FocusHandle>,
        on_open_lightbox: Option<PreviewActivate>,
    },
    Markdown(MarkdownDocument),
    Html(NativePreviewSource),
    Audio(NativePreviewSource),
    Video {
        source: NativePreviewSource,
        focus_handle: Option<FocusHandle>,
        on_open_lightbox: Option<PreviewActivate>,
    },
    Pdf(NativePreviewSource),
    Binary(Vec<BinaryFact>),
    Text(SharedString),
}

#[derive(IntoElement)]
pub struct FilePreview {
    pub id: SharedString,
    pub theme: Theme,
    pub size: SharedString,
    pub updating: bool,
    pub mode: Option<PreviewMode>,
    pub mode_focus: Option<[FocusHandle; 2]>,
    pub on_markdown_link_open: Option<MarkdownLinkActivate>,
    pub on_mode_select: Option<PreviewModeSelect>,
    /// Whether this embedded platform preview owns the active child frame.
    ///
    /// For video with a same-source lightbox, pass `embedded_native_visible(route_visible,
    /// lightbox_visible)` rather than the route visibility alone.
    pub native_visible: bool,
    pub kind: FilePreviewKind,
}

impl RenderOnce for FilePreview {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let dimensions = match &self.kind {
            FilePreviewKind::Image {
                dimensions: Some((w, h)),
                ..
            } => Some(format!("{w} × {h}")),
            _ => None,
        };
        let mode_controls = self.mode.map(|selected| {
            mode_control(
                id.clone(),
                theme,
                selected,
                self.mode_focus.clone(),
                self.on_mode_select.clone(),
            )
        });
        let body = render_body(
            id.clone(),
            theme,
            self.kind,
            self.on_markdown_link_open.clone(),
            self.native_visible,
        );
        div()
            .debug_selector({
                let id = id.clone();
                move || format!("{id}.root")
            })
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(theme.role(ThemeRole::Surface))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(ThemeRole::Text))
            .when(
                !self.size.is_empty()
                    || self.updating
                    || dimensions.is_some()
                    || mode_controls.is_some(),
                |view| {
                    view.child(
                        div()
                            .debug_selector({
                                let id = id.clone();
                                move || format!("{id}.header")
                            })
                            .w_full()
                            .h(px(FILE_PREVIEW_HEADER_HEIGHT))
                            .flex_none()
                            .min_w_0()
                            .flex()
                            .items_center()
                            .justify_end()
                            .gap(px(8.0))
                            .px(px(8.0))
                            .child(
                                div()
                                    .debug_selector({
                                        let id = id.clone();
                                        move || format!("{id}.facts")
                                    })
                                    .flex_1()
                                    .min_w_0()
                                    .flex()
                                    .items_center()
                                    .justify_end()
                                    .gap(px(6.0))
                                    .font_family(fonts::MONO_FAMILY)
                                    .text_size(px(10.0))
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .when(!self.size.is_empty(), |v| v.child(self.size))
                                    .children(dimensions)
                                    .children(self.updating.then(|| {
                                        div()
                                            .text_color(theme.role(ThemeRole::Warning))
                                            .child("Updating")
                                    })),
                            )
                            .children(mode_controls),
                    )
                },
            )
            .child(
                div()
                    .debug_selector({
                        let id = id.clone();
                        move || format!("{id}.body")
                    })
                    .w_full()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .child(body),
            )
    }
}

fn mode_control(
    id: SharedString,
    theme: Theme,
    selected: PreviewMode,
    focus: Option<[FocusHandle; 2]>,
    on_select: Option<PreviewModeSelect>,
) -> AnyElement {
    div()
        .debug_selector({
            let id = id.clone();
            move || format!("{id}.mode-control")
        })
        .h(px(24.0))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(2.0))
        .children(
            [PreviewMode::Rendered, PreviewMode::Source]
                .into_iter()
                .enumerate()
                .map(|(index, mode)| {
                    let focus_handle = focus.as_ref().map(|handles| handles[index].clone());
                    let label = match mode {
                        PreviewMode::Rendered => "Rendered",
                        PreviewMode::Source => "Source",
                    };
                    let handler = on_select.clone();
                    div()
                        .id(SharedString::from(format!("{id}-{}", label.to_lowercase())))
                        .debug_selector({
                            let id = id.clone();
                            move || format!("{id}.mode-{}", label.to_lowercase())
                        })
                        .h(px(24.0))
                        .px(px(8.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(6.0))
                        .when(mode == selected, |v| {
                            v.bg(theme.role(ThemeRole::SurfaceSelected))
                        })
                        .text_size(px(11.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(if mode == selected {
                            theme.role(ThemeRole::Text)
                        } else {
                            theme.role(ThemeRole::TextSecondary)
                        })
                        .when_some(focus_handle, |v, focus| {
                            v.track_focus(&focus.tab_index(0).tab_stop(handler.is_some()))
                        })
                        .when(handler.is_some(), |v| v.cursor_pointer())
                        .when_some(handler, |v, handler| {
                            let keyboard = handler.clone();
                            v.on_click(move |_, window, cx| handler(mode, window, cx))
                                .on_key_down(move |event, window, cx| {
                                    if !event.is_held
                                        && matches!(
                                            event.keystroke.key.as_str(),
                                            "enter" | "space" | " "
                                        )
                                    {
                                        cx.stop_propagation();
                                        keyboard(mode, window, cx);
                                    }
                                })
                        })
                }),
        )
        .into_any_element()
}

fn render_body(
    id: SharedString,
    theme: Theme,
    kind: FilePreviewKind,
    on_markdown_link_open: Option<MarkdownLinkActivate>,
    native_visible: bool,
) -> AnyElement {
    match kind {
        FilePreviewKind::Image {
            image,
            alt,
            focus_handle,
            on_open_lightbox,
            ..
        } => {
            let interactive = on_open_lightbox.is_some();
            div()
                .id(SharedString::from(format!("{id}-image")))
                .debug_selector({
                    let id = id.clone();
                    move || format!("{id}.image-frame")
                })
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .bg(theme.role(ThemeRole::SurfaceHigh))
                .when_some(focus_handle, |v, focus| {
                    v.track_focus(&focus.tab_index(0).tab_stop(interactive))
                })
                .when(interactive, |v| v.cursor_pointer())
                .when_some(on_open_lightbox, |v, open| {
                    let keyboard = open.clone();
                    v.on_click(move |_, w, cx| open(w, cx))
                        .on_key_down(move |e, w, cx| {
                            if !e.is_held
                                && matches!(e.keystroke.key.as_str(), "enter" | "space" | " ")
                            {
                                cx.stop_propagation();
                                keyboard(w, cx);
                            }
                        })
                })
                .child(
                    img(image)
                        .debug_selector(move || format!("{id}.image"))
                        .size_full()
                        .object_fit(ObjectFit::Contain),
                )
                .child(div().absolute().size(px(0.0)).overflow_hidden().child(alt))
                .into_any_element()
        }

        FilePreviewKind::Markdown(document) => scroll_body(
            id.clone(),
            div()
                .w_full()
                .max_w(px(760.0))
                .child(ChatMarkdown {
                    id: format!("{id}-markdown").into(),
                    theme,
                    document,
                    on_link_open: on_markdown_link_open,
                })
                .into_any_element(),
            theme,
        ),
        FilePreviewKind::Html(source)
        | FilePreviewKind::Audio(source)
        | FilePreviewKind::Pdf(source) => NativePreview {
            id: format!("{id}-native").into(),
            theme,
            source,
            visible: native_visible,
        }
        .into_any_element(),
        FilePreviewKind::NativeImage {
            source,
            focus_handle,
            on_open_lightbox,
        } => render_native_lightbox(
            id,
            theme,
            source,
            focus_handle,
            on_open_lightbox,
            native_visible,
            "Open image full screen",
        ),
        FilePreviewKind::Video {
            source,
            focus_handle,
            on_open_lightbox,
        } => render_native_lightbox(
            id,
            theme,
            source,
            focus_handle,
            on_open_lightbox,
            native_visible,
            "Open video full screen",
        ),
        FilePreviewKind::Binary(facts) => div()
            .debug_selector(move || format!("{id}.binary"))
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(theme.role(ThemeRole::SurfaceHigh))
            .child(
                div()
                    .w(px(320.0))
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .p(px(16.0))
                    .children(facts.into_iter().map(|fact| {
                        div()
                            .w_full()
                            .flex()
                            .gap(px(12.0))
                            .text_size(px(12.0))
                            .child(
                                div()
                                    .w(px(96.0))
                                    .flex_none()
                                    .text_color(theme.role(ThemeRole::TextSecondary))
                                    .child(fact.label),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .font_family(fonts::MONO_FAMILY)
                                    .child(fact.value),
                            )
                    })),
            )
            .into_any_element(),
        FilePreviewKind::Text(text) => scroll_body(
            id,
            div()
                .font_family(fonts::MONO_FAMILY)
                .text_size(px(12.0))
                .line_height(px(18.0))
                .child(text)
                .into_any_element(),
            theme,
        ),
    }
}

fn render_native_lightbox(
    id: SharedString,
    theme: Theme,
    source: NativePreviewSource,
    focus_handle: Option<FocusHandle>,
    on_open_lightbox: Option<PreviewActivate>,
    native_visible: bool,
    label: &'static str,
) -> AnyElement {
    let native = NativePreview {
        id: format!("{id}-native").into(),
        theme,
        source,
        visible: native_visible,
    };
    div()
        .size_full()
        .flex()
        .flex_col()
        .children(on_open_lightbox.map(|open| {
            div()
                .w_full()
                .h(px(28.0))
                .flex_none()
                .flex()
                .justify_end()
                .child(Button {
                    id: format!("{id}-lightbox").into(),
                    theme,
                    label: label.into(),
                    size: ControlSize::Small,
                    variant: ButtonVariant::Ghost,
                    icon: Some(IconName::PanelExpand),
                    icon_only: true,
                    disabled: !native_visible,
                    force_focused: false,
                    focus_handle,
                    on_activate: Some(open),
                })
        }))
        .child(
            div()
                .w_full()
                .flex_1()
                .min_h_0()
                .overflow_hidden()
                .child(native),
        )
        .into_any_element()
}

fn scroll_body(id: SharedString, child: AnyElement, theme: Theme) -> AnyElement {
    div()
        .id(SharedString::from(format!("{id}-scrollport")))
        .debug_selector(move || format!("{id}.scrollport"))
        .size_full()
        .overflow_y_scroll()
        .bg(theme.role(ThemeRole::Surface))
        .child(
            div()
                .w_full()
                .flex()
                .flex_col()
                .items_center()
                .p(px(16.0))
                .child(child),
        )
        .into_any_element()
}

#[derive(Clone)]
pub enum PreviewLightboxMedia {
    Image {
        image: Arc<Image>,
        alt: SharedString,
    },
    NativeImage(NativePreviewSource),
    Video(NativePreviewSource),
}

#[derive(IntoElement)]
pub struct FilePreviewLightbox {
    pub id: SharedString,
    pub theme: Theme,
    pub media: PreviewLightboxMedia,
    /// Whether retained native media belongs to the currently visible lightbox route.
    pub native_visible: bool,
    pub overlay_focus: FocusHandle,
    pub close_focus: FocusHandle,
    pub on_close: PreviewActivate,
}
impl RenderOnce for FilePreviewLightbox {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let native_visible = self.native_visible;
        let close = self.on_close;
        let close_button = close.clone();
        let focus = ModalFocus {
            container: self.overlay_focus,
            initial: self.close_focus.clone(),
            first: self.close_focus.clone(),
            last: self.close_focus.clone(),
        };
        let media = match self.media {
            PreviewLightboxMedia::Image { image, alt } => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .child(img(image).size_full().object_fit(ObjectFit::Contain))
                .child(div().absolute().size(px(0.0)).overflow_hidden().child(alt))
                .into_any_element(),
            PreviewLightboxMedia::NativeImage(source) | PreviewLightboxMedia::Video(source) => {
                NativePreview {
                    id: format!("{id}-native").into(),
                    theme: self.theme,
                    source,
                    visible: native_visible,
                }
                .into_any_element()
            }
        };
        ModalOverlay {
            id: id.clone(),
            theme: self.theme,
            placement: OverlayPlacement::Fill,
            focus,
            on_dismiss: Some(close),
            content: div()
                .debug_selector({
                    let id = id.clone();
                    move || format!("{id}.root")
                })
                .size_full()
                .p(px(24.0))
                .flex()
                .flex_col()
                .gap(px(12.0))
                .bg(self.theme.role(ThemeRole::Surface))
                .child(
                    div()
                        .h(px(28.0))
                        .flex_none()
                        .flex()
                        .justify_end()
                        .child(Button {
                            id: format!("{id}-close").into(),
                            theme: self.theme,
                            label: "Close preview".into(),
                            size: ControlSize::Small,
                            variant: ButtonVariant::Ghost,
                            icon: Some(IconName::Close),
                            icon_only: true,
                            disabled: false,
                            force_focused: false,
                            focus_handle: Some(self.close_focus),
                            on_activate: Some(close_button),
                        }),
                )
                .child(
                    div()
                        .debug_selector(move || format!("{id}.media"))
                        .w_full()
                        .flex_1()
                        .min_h_0()
                        .overflow_hidden()
                        .rounded(px(8.0))
                        .child(media),
                )
                .into_any_element(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::native_preview::{NativePreviewKind, StagedLocalFile};
    use super::*;
    use gpui::{Bounds, Context, Render, TestAppContext, size};
    use std::path::PathBuf;

    #[derive(Clone, Copy)]
    enum Kind {
        Image,
        NativeImage,
        Markdown,
        Html,
        Audio,
        Video,
        Pdf,
        Binary,
        Text,
    }
    struct Fixture {
        width: f32,
        height: f32,
        kind: Kind,
        show_header: bool,
        native_visible: bool,
        same_source_lightbox_visible: bool,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let staged = StagedLocalFile::new_for_test(PathBuf::from("/staged/preview"));
            let native = |kind| NativePreviewSource::new_for_test(staged.clone(), kind);
            let kind = match self.kind {
                Kind::Image => FilePreviewKind::Image {
                    image: Arc::new(Image::empty()),
                    dimensions: Some((1920, 1080)),
                    alt: "Image".into(),
                    focus_handle: None,
                    on_open_lightbox: None,
                },
                Kind::NativeImage => FilePreviewKind::NativeImage {
                    source: native(NativePreviewKind::Image),
                    focus_handle: None,
                    on_open_lightbox: None,
                },
                Kind::Markdown => FilePreviewKind::Markdown(MarkdownDocument::parse(
                    "# Preview\n\nRendered locally.",
                )),
                Kind::Html => FilePreviewKind::Html(native(NativePreviewKind::Html)),
                Kind::Audio => FilePreviewKind::Audio(native(NativePreviewKind::Audio)),
                Kind::Video => FilePreviewKind::Video {
                    source: native(NativePreviewKind::Video),
                    focus_handle: None,
                    on_open_lightbox: None,
                },
                Kind::Pdf => FilePreviewKind::Pdf(native(NativePreviewKind::Pdf)),
                Kind::Binary => FilePreviewKind::Binary(vec![BinaryFact {
                    label: "Type".into(),
                    value: "application/octet-stream".into(),
                }]),
                Kind::Text => FilePreviewKind::Text("plain text".into()),
            };
            div()
                .w(px(self.width))
                .h(px(self.height))
                .child(FilePreview {
                    id: "preview".into(),
                    theme: Theme::light(),
                    size: if self.show_header {
                        "24 KB".into()
                    } else {
                        "".into()
                    },
                    updating: self.show_header,
                    mode: self.show_header.then_some(PreviewMode::Rendered),
                    mode_focus: None,
                    on_markdown_link_open: None,
                    on_mode_select: None,
                    native_visible: embedded_native_visible(
                        self.native_visible,
                        self.same_source_lightbox_visible,
                    ),
                    kind,
                })
        }
    }
    #[test]
    fn embedded_native_child_is_inactive_while_same_source_lightbox_is_visible() {
        assert!(embedded_native_visible(true, false));
        assert!(!embedded_native_visible(true, true));
        assert!(!embedded_native_visible(false, false));
        assert!(!embedded_native_visible(false, true));
    }

    #[gpui::test]
    fn every_preview_type_has_real_narrow_wide_and_reference_geometry(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, _| Fixture {
            width: 220.0,
            height: 320.0,
            kind: Kind::Image,
            show_header: true,
            native_visible: true,
            same_source_lightbox_visible: false,
        });
        for width in [220.0, 560.0, 1280.0] {
            for kind in [
                Kind::Image,
                Kind::NativeImage,
                Kind::Markdown,
                Kind::Html,
                Kind::Audio,
                Kind::Video,
                Kind::Pdf,
                Kind::Binary,
                Kind::Text,
            ] {
                view.update(cx, |fixture, cx| {
                    fixture.width = width;
                    fixture.height = 480.0;
                    fixture.kind = kind;
                    cx.notify();
                });
                cx.simulate_resize(size(px(width), px(480.0)));
                cx.run_until_parked();
                assert_eq!(
                    cx.debug_bounds("preview.root"),
                    Some(Bounds::new(
                        gpui::point(px(0.0), px(0.0)),
                        size(px(width), px(480.0))
                    ))
                );
                assert_eq!(
                    cx.debug_bounds("preview.header").unwrap().size,
                    size(px(width), px(32.0))
                );
                assert_eq!(
                    cx.debug_bounds("preview.body").unwrap().size,
                    size(px(width), px(448.0))
                );
                assert_eq!(
                    cx.debug_bounds("preview.mode-control").unwrap().size.height,
                    px(24.0)
                );
                if matches!(
                    kind,
                    Kind::NativeImage | Kind::Html | Kind::Audio | Kind::Video | Kind::Pdf
                ) {
                    assert_eq!(
                        cx.debug_bounds("preview-native.fallback.visible")
                            .unwrap()
                            .size,
                        size(px(width), px(448.0))
                    );
                }
            }
        }
        view.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            fixture.height = 480.0;
            fixture.kind = Kind::Pdf;
            fixture.native_visible = false;
            cx.notify();
        });
        cx.simulate_resize(size(px(560.0), px(480.0)));
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("preview-native.fallback.hidden")
                .unwrap()
                .size,
            size(px(560.0), px(448.0))
        );

        view.update(cx, |fixture, cx| {
            fixture.kind = Kind::Video;
            fixture.native_visible = true;
            fixture.same_source_lightbox_visible = true;
            cx.notify();
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("preview-native.fallback.hidden")
                .unwrap()
                .size,
            size(px(560.0), px(448.0))
        );

        view.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            fixture.height = 480.0;
            fixture.kind = Kind::Text;
            fixture.native_visible = false;
            fixture.show_header = false;
            cx.notify();
        });
        cx.simulate_resize(size(px(560.0), px(480.0)));
        cx.run_until_parked();
        let body = cx.debug_bounds("preview.body").unwrap();
        assert_eq!(body.origin, gpui::point(px(0.0), px(0.0)));
        assert_eq!(body.size, size(px(560.0), px(480.0)));
    }
}
