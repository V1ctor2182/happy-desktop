//! Props-only native transcript visuals. These types are the closed UI boundary;
//! they contain no wire values, transport handles, URLs, or product stores.

use gpui::{
    AnyElement, App, Entity, FocusHandle, FontWeight, Image, IntoElement, ObjectFit, RenderOnce,
    SharedString, Window, div, img, prelude::*, px,
};
use std::{fmt, rc::Rc, sync::Arc};

use super::{
    Button, ButtonVariant, ControlSize, IconName, ModalFocus, ModalOverlay, OverlayPlacement,
    chat_markdown::{ChatMarkdown, MarkdownDocument, MarkdownLinkActivate, markdown_height},
    text_area::TextArea,
    theme_roles::ThemeRole,
};
use crate::{fonts, theme::Theme};

pub type ChatActivate = Rc<dyn Fn(&mut Window, &mut App)>;
/// Activates one inline image by its caller-supplied stable block ID.
pub type ChatImageActivate = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;
pub type QuestionSelect = Rc<dyn Fn(SharedString, SharedString, bool, &mut Window, &mut App)>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageRole {
    User,
    Agent,
    System,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageDelivery {
    Sending,
    Sent,
    PendingSteering,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageGeneration {
    Complete,
    Streaming,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SemanticTone {
    Neutral,
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Clone)]
pub struct ChatImageBlock {
    pub id: SharedString,
    pub alt: SharedString,
    /// Caller-owned decoded bytes. The transcript never receives or loads a URL.
    pub image: Option<Arc<Image>>,
    /// Intrinsic pixel dimensions supplied with the local image.
    pub width: Option<u32>,
    pub height: Option<u32>,
}
impl fmt::Debug for ChatImageBlock {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ChatImageBlock")
            .field("id", &self.id)
            .field("alt", &self.alt)
            .field("image_id", &self.image.as_ref().map(|image| image.id()))
            .field("width", &self.width)
            .field("height", &self.height)
            .finish()
    }
}
impl PartialEq for ChatImageBlock {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
            && self.alt == other.alt
            && self.image.as_ref().map(|image| image.id())
                == other.image.as_ref().map(|image| image.id())
            && self.width == other.width
            && self.height == other.height
    }
}
impl Eq for ChatImageBlock {}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReasoningBlock {
    pub summary: SharedString,
    pub detail: MarkdownDocument,
    pub expanded: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolPresentation {
    Command {
        command: SharedString,
        output: Option<SharedString>,
    },
    File {
        operation: SharedString,
        path: SharedString,
    },
    Search {
        query: SharedString,
        result_count: Option<u32>,
    },
    Generic {
        summary: SharedString,
        detail: Option<SharedString>,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolReviewStatus {
    Required,
    Allowed,
    Denied,
    Expired,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolReview {
    pub status: ToolReviewStatus,
    pub prompt: SharedString,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolBlock {
    pub title: SharedString,
    pub status: ToolStatus,
    pub presentation: ToolPresentation,
    pub review: Option<ToolReview>,
    pub expanded: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactionBlock {
    pub title: SharedString,
    pub summary: MarkdownDocument,
    pub token_count: Option<u64>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatMessageBlock {
    Text(MarkdownDocument),
    Image(ChatImageBlock),
    Reasoning(ReasoningBlock),
    Tool(ToolBlock),
    Compaction(CompactionBlock),
}

#[derive(Clone)]
pub struct ChatMessageModel {
    pub id: SharedString,
    pub role: MessageRole,
    pub author: SharedString,
    pub initials: SharedString,
    pub time: Option<SharedString>,
    pub context_note: Option<SharedString>,
    pub delivery: MessageDelivery,
    pub generation: MessageGeneration,
    pub grouped: bool,
    pub blocks: Vec<ChatMessageBlock>,
    pub on_link_open: Option<MarkdownLinkActivate>,
    pub on_image_open: Option<ChatImageActivate>,
    pub on_tool_open: Option<ChatActivate>,
    pub on_review_allow: Option<ChatActivate>,
    pub on_review_deny: Option<ChatActivate>,
}

#[derive(IntoElement)]
pub struct ChatMessage {
    pub theme: Theme,
    pub model: ChatMessageModel,
}
impl RenderOnce for ChatMessage {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let model = self.model;
        let own = model.role == MessageRole::User;
        let id = model.id.clone();
        let body = div()
            .debug_selector({
                let id = id.clone();
                move || format!("chat-message-{id}.body")
            })
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .children(
                model
                    .blocks
                    .into_iter()
                    .enumerate()
                    .map(move |(index, block)| {
                        render_message_block(
                            format!("chat-message-{id}.block-{index}").into(),
                            block,
                            theme,
                            model.on_link_open.clone(),
                            model.on_image_open.clone(),
                            model.on_tool_open.clone(),
                            model.on_review_allow.clone(),
                            model.on_review_deny.clone(),
                        )
                    }),
            );
        div()
            .debug_selector({
                let id = model.id.clone();
                move || format!("chat-message-{id}.root")
            })
            .w_full()
            .flex()
            .gap(px(12.0))
            .px(px(24.0))
            .py(px(if model.grouped { 4.0 } else { 8.0 }))
            .font_family(fonts::UI_FAMILY)
            .text_color(theme.role(if own {
                ThemeRole::UserMessageText
            } else {
                ThemeRole::AgentMessageText
            }))
            .opacity(match model.delivery {
                MessageDelivery::Sending | MessageDelivery::PendingSteering => 0.62,
                _ => 1.0,
            })
            .when(!model.grouped, |view| {
                view.child(
                    div()
                        .debug_selector({
                            let id = model.id.clone();
                            move || format!("chat-message-{id}.avatar")
                        })
                        .size(px(32.0))
                        .flex_none()
                        .rounded_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .bg(theme.role(if own {
                            ThemeRole::UserMessageBackground
                        } else {
                            ThemeRole::SurfaceHigh
                        }))
                        .font_weight(FontWeight::BOLD)
                        .text_size(px(11.0))
                        .child(model.initials.clone()),
                )
            })
            .when(model.grouped, |view| {
                view.child(div().w(px(32.0)).flex_none())
            })
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(4.0))
                    .when(!model.grouped, |view| {
                        view.child(
                            div()
                                .debug_selector({
                                    let id = model.id.clone();
                                    move || format!("chat-message-{id}.meta")
                                })
                                .h(px(20.0))
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .child(
                                    div()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .child(model.author.clone()),
                                )
                                .children(model.time.clone().map(|time| {
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child(time)
                                }))
                                .children(model.context_note.clone().map(|note| {
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.role(ThemeRole::TextSecondary))
                                        .child(note)
                                })),
                        )
                    })
                    .child(body)
                    .when(model.generation == MessageGeneration::Streaming, |view| {
                        view.child(
                            div()
                                .w(px(6.0))
                                .h(px(14.0))
                                .bg(theme.role(ThemeRole::TextLink)),
                        )
                    })
                    .when(
                        model.delivery == MessageDelivery::Failed
                            || model.generation == MessageGeneration::Failed,
                        |view| {
                            view.child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.role(ThemeRole::TextDestructive))
                                    .child("Failed"),
                            )
                        },
                    ),
            )
    }
}

/// A caller-owned lightbox for a decoded inline chat image.
///
/// The caller owns visibility, the decoded image, both focus handles, and the
/// close action. This component performs no loading or transport work.
#[derive(IntoElement)]
pub struct InlineImageLightbox {
    pub id: SharedString,
    pub theme: Theme,
    pub image: Arc<Image>,
    pub alt: SharedString,
    pub overlay_focus: FocusHandle,
    pub close_focus: FocusHandle,
    pub on_close: ChatActivate,
}
impl RenderOnce for InlineImageLightbox {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id.clone();
        let theme = self.theme;
        let close = self.on_close;
        let close_button = close.clone();
        let close_focus = self.close_focus;
        let focus = ModalFocus {
            container: self.overlay_focus,
            initial: close_focus.clone(),
            first: close_focus.clone(),
            last: close_focus.clone(),
        };
        ModalOverlay {
            id: id.clone(),
            theme,
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
                .bg(theme.role(ThemeRole::Surface))
                .font_family(fonts::UI_FAMILY)
                .text_color(theme.role(ThemeRole::Text))
                .child(
                    div()
                        .id(SharedString::from(format!("{id}-toolbar")))
                        .debug_selector({
                            let id = id.clone();
                            move || format!("{id}.toolbar")
                        })
                        .h(px(28.0))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_end()
                        .on_click(|_, _, cx| cx.stop_propagation())
                        .child(Button {
                            id: format!("{id}-close").into(),
                            theme,
                            label: "Close image".into(),
                            size: ControlSize::Small,
                            variant: ButtonVariant::Ghost,
                            icon: Some(IconName::Close),
                            icon_only: true,
                            disabled: false,
                            force_focused: false,
                            focus_handle: Some(close_focus),
                            on_activate: Some(close_button),
                        }),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("{id}-image-frame")))
                        .debug_selector({
                            let id = id.clone();
                            move || format!("{id}.image-frame")
                        })
                        .w_full()
                        .flex_1()
                        .min_h_0()
                        .rounded(px(8.0))
                        .overflow_hidden()
                        .flex()
                        .items_center()
                        .justify_center()
                        .bg(theme.role(ThemeRole::SurfaceHigh))
                        .on_click(|_, _, cx| cx.stop_propagation())
                        .child(
                            img(self.image)
                                .debug_selector({
                                    let id = id.clone();
                                    move || format!("{id}.image")
                                })
                                .size_full()
                                .object_fit(ObjectFit::Contain),
                        ),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("{id}-caption")))
                        .debug_selector(move || format!("{id}.caption"))
                        .h(px(20.0))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(12.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .on_click(|_, _, cx| cx.stop_propagation())
                        .child(self.alt),
                )
                .into_any_element(),
        }
    }
}

const MAX_INLINE_IMAGE_WIDTH: f32 = 360.0;

#[derive(Clone, Copy, Debug, PartialEq)]
struct InlineImageGeometry {
    maximum_width: f32,
    aspect_ratio: f32,
}

impl InlineImageGeometry {
    fn size_at(self, available_width: f32) -> (f32, f32) {
        let width = available_width.max(0.0).min(self.maximum_width);
        (width, width / self.aspect_ratio)
    }
}

fn inline_image_geometry(image: &ChatImageBlock) -> InlineImageGeometry {
    let intrinsic_width = image.width.unwrap_or(360).max(1) as f32;
    let intrinsic_height = image.height.unwrap_or(180).max(1) as f32;
    InlineImageGeometry {
        maximum_width: intrinsic_width.min(MAX_INLINE_IMAGE_WIDTH),
        aspect_ratio: intrinsic_width / intrinsic_height,
    }
}

fn render_message_block(
    id: SharedString,
    block: ChatMessageBlock,
    theme: Theme,
    on_link: Option<MarkdownLinkActivate>,
    on_image: Option<ChatImageActivate>,
    on_tool: Option<ChatActivate>,
    allow: Option<ChatActivate>,
    deny: Option<ChatActivate>,
) -> AnyElement {
    match block {
        ChatMessageBlock::Text(document) => ChatMarkdown {
            id,
            theme,
            document,
            on_link_open: on_link,
        }
        .into_any_element(),
        ChatMessageBlock::Image(image) => {
            let geometry = inline_image_geometry(&image);
            let local = image.image.clone();
            let action = on_image.filter(|_| local.is_some());
            let image_id = image.id.clone();
            let mut frame = div()
                .id(id.clone())
                .debug_selector(move || format!("{id}.image-block"))
                .w_full()
                .max_w(px(geometry.maximum_width))
                .rounded(px(8.0))
                .overflow_hidden()
                .border_1()
                .border_color(theme.role(ThemeRole::Divider))
                .bg(theme.role(ThemeRole::SurfaceHigh))
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme.role(ThemeRole::TextSecondary))
                .when(action.is_some(), |v| {
                    v.tab_index(0)
                        .focus(|style| style.border_color(theme.role(ThemeRole::TextLink)))
                })
                .when_some(action, |v, activate| {
                    let pointer_id = image_id.clone();
                    let keyboard = activate.clone();
                    let keyboard_id = image_id.clone();
                    v.on_click(move |_, w, c| activate(pointer_id.clone(), w, c))
                        .on_key_down(move |event, w, c| {
                            if !event.is_held
                                && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                            {
                                c.stop_propagation();
                                keyboard(keyboard_id.clone(), w, c);
                            }
                        })
                })
                .when_some(local, |v, image| {
                    v.child(img(image).size_full().object_fit(ObjectFit::Contain))
                })
                .when(image.image.is_none(), |v| {
                    v.child(format!("{} (not downloaded)", image.alt))
                });
            frame.style().aspect_ratio = Some(geometry.aspect_ratio);
            frame.into_any_element()
        }
        ChatMessageBlock::Reasoning(reasoning) => div()
            .id(id.clone())
            .flex()
            .flex_col()
            .gap(px(6.0))
            .pl(px(12.0))
            .border_l_2()
            .border_color(theme.role(ThemeRole::ActivityElevatedLine))
            .child(
                div()
                    .text_size(px(12.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(theme.role(ThemeRole::TextSecondary))
                    .child(reasoning.summary),
            )
            .when(reasoning.expanded, |v| {
                v.child(ChatMarkdown {
                    id: format!("{id}.detail").into(),
                    theme,
                    document: reasoning.detail,
                    on_link_open: on_link.clone(),
                })
            })
            .into_any_element(),
        ChatMessageBlock::Tool(tool) => render_tool(id, tool, theme, on_tool, allow, deny),
        ChatMessageBlock::Compaction(compaction) => div()
            .id(id.clone())
            .flex()
            .flex_col()
            .gap(px(6.0))
            .p(px(12.0))
            .rounded(px(8.0))
            .bg(theme.role(ThemeRole::SurfaceHigh))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(
                        div()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(compaction.title),
                    )
                    .children(compaction.token_count.map(|count| {
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.role(ThemeRole::TextSecondary))
                            .child(format!("{count} tokens"))
                    })),
            )
            .child(ChatMarkdown {
                id: format!("{id}.summary").into(),
                theme,
                document: compaction.summary,
                on_link_open: on_link,
            })
            .into_any_element(),
    }
}
fn render_tool(
    id: SharedString,
    tool: ToolBlock,
    theme: Theme,
    on_open: Option<ChatActivate>,
    allow: Option<ChatActivate>,
    deny: Option<ChatActivate>,
) -> AnyElement {
    let action_id = id.clone();
    let status = format!("{:?}", tool.status);
    let detail = match tool.presentation {
        ToolPresentation::Command { command, output } => format!(
            "$ {command}{}",
            output.map(|v| format!("\n{v}")).unwrap_or_default()
        ),
        ToolPresentation::File { operation, path } => format!("{operation} {path}"),
        ToolPresentation::Search {
            query,
            result_count,
        } => format!(
            "Search {query}{}",
            result_count
                .map(|v| format!(" · {v} results"))
                .unwrap_or_default()
        ),
        ToolPresentation::Generic { summary, detail } => format!(
            "{summary}{}",
            detail.map(|v| format!("\n{v}")).unwrap_or_default()
        ),
    };
    div()
        .id(id)
        .w_full()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(12.0))
        .rounded(px(8.0))
        .border_1()
        .border_color(theme.role(if tool.status == ToolStatus::Failed {
            ThemeRole::ActivityFailedLine
        } else {
            ThemeRole::Divider
        }))
        .bg(theme.role(ThemeRole::SurfaceHigh))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .child(div().font_weight(FontWeight::SEMIBOLD).child(tool.title))
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.role(ThemeRole::TextSecondary))
                        .child(status),
                ),
        )
        .when(tool.expanded, |v| {
            v.child(
                div()
                    .font_family(fonts::MONO_FAMILY)
                    .text_size(px(12.0))
                    .line_height(px(18.0))
                    .child(detail),
            )
        })
        .when_some(on_open, |v, action| {
            v.child(action_button(
                format!("{action_id}.open").into(),
                "Open",
                theme,
                action,
            ))
        })
        .when_some(tool.review, |v, review| {
            v.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .child(review.prompt)
                    .when(review.status == ToolReviewStatus::Required, |v| {
                        v.child(
                            div()
                                .flex()
                                .gap(px(8.0))
                                .children(allow.map(|a| {
                                    action_button(
                                        format!("{action_id}.allow").into(),
                                        "Allow",
                                        theme,
                                        a,
                                    )
                                }))
                                .children(deny.map(|a| {
                                    action_button(
                                        format!("{action_id}.deny").into(),
                                        "Deny",
                                        theme,
                                        a,
                                    )
                                })),
                        )
                    }),
            )
        })
        .into_any_element()
}
fn action_button(
    id: SharedString,
    label: &'static str,
    theme: Theme,
    action: ChatActivate,
) -> AnyElement {
    controlled_action_button(id, label.into(), theme, Some(action), false)
}

fn controlled_action_button(
    id: SharedString,
    label: SharedString,
    theme: Theme,
    action: Option<ChatActivate>,
    disabled: bool,
) -> AnyElement {
    let active = !disabled && action.is_some();
    let pointer = action.clone();
    let keyboard = action;
    let selector_id = id.clone();
    div()
        .id(id)
        .debug_selector(move || format!("{selector_id}.root"))
        .h(px(28.0))
        .px(px(10.0))
        .rounded(px(6.0))
        .border_1()
        .border_color(theme.role(ThemeRole::Divider))
        .flex()
        .items_center()
        .opacity(if disabled { 0.48 } else { 1.0 })
        .when(active, |button| {
            button
                .tab_index(0)
                .focus(|style| style.border_color(theme.role(ThemeRole::TextLink)))
                .on_click(move |_, window, cx| pointer.clone().unwrap()(window, cx))
                .on_key_down(move |event, window, cx| {
                    if !event.is_held
                        && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                    {
                        cx.stop_propagation();
                        keyboard.clone().unwrap()(window, cx);
                    }
                })
        })
        .child(label)
        .into_any_element()
}

#[derive(Clone)]
pub struct QuestionOption {
    pub id: SharedString,
    pub label: SharedString,
    pub selected: bool,
    pub disabled: bool,
}
#[derive(Clone)]
pub struct GenericQuestion {
    pub id: SharedString,
    pub prompt: SharedString,
    pub multiple: bool,
    pub options: Vec<QuestionOption>,
    /// A real caller-owned input entity for free-text questions. Its value,
    /// focus, selection, and lifetime remain outside this reusable row.
    pub text_input: Option<Entity<TextArea>>,
}
#[derive(Clone)]
pub struct QuestionRowModel {
    pub id: SharedString,
    pub title: SharedString,
    pub questions: Vec<GenericQuestion>,
    /// True while this question is awaiting the user's answer.
    pub pending: bool,
    /// A caller-owned availability state. Disabled submit remains visible.
    pub submit_disabled: bool,
    /// A caller-owned in-flight state. Busy submit remains visible and reads "Submitting…".
    pub submit_busy: bool,
    pub on_select: Option<QuestionSelect>,
    pub on_submit: Option<ChatActivate>,
}
#[derive(IntoElement)]
pub struct QuestionRow {
    pub theme: Theme,
    pub model: QuestionRowModel,
}
impl RenderOnce for QuestionRow {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let theme = self.theme;
        let model = self.model;
        let handler = model.on_select.clone();
        let submit_id: SharedString = format!("question-{}.submit", model.id).into();
        let submit_visible = model.pending;
        let submit_disabled = model.submit_disabled || model.submit_busy;
        let submit_label = if model.submit_busy {
            SharedString::from("Submitting…")
        } else {
            SharedString::from("Submit")
        };
        div()
            .debug_selector({
                let id = model.id.clone();
                move || format!("question-{id}.root")
            })
            .mx(px(24.0))
            .p(px(16.0))
            .flex()
            .flex_col()
            .gap(px(12.0))
            .rounded(px(10.0))
            .border_1()
            .border_color(theme.role(ThemeRole::Divider))
            .bg(theme.role(ThemeRole::Surface))
            .font_family(fonts::UI_FAMILY)
            .child(div().font_weight(FontWeight::BOLD).child(model.title))
            .children(model.questions.into_iter().map(move |question| {
                let question_id = question.id.clone();
                let multiple = question.multiple;
                div()
                    .debug_selector({
                        let question_id = question_id.clone();
                        move || format!("question-{question_id}.group")
                    })
                    .flex()
                    .flex_col()
                    .gap(px(6.0))
                    .child(div().child(question.prompt))
                    .children(question.options.into_iter().map({
                        let handler = handler.clone();
                        move |option| {
                            let callback = handler.clone();
                            let q = question_id.clone();
                            let o = option.id.clone();
                            let selected = option.selected;
                            let marker = div()
                                .size(px(14.0))
                                .flex_none()
                                .border_1()
                                .border_color(theme.role(if selected {
                                    ThemeRole::TextLink
                                } else {
                                    ThemeRole::Divider
                                }))
                                .when(multiple, |v| v.rounded(px(3.0)))
                                .when(!multiple, |v| v.rounded_full())
                                .when(selected, |v| v.bg(theme.role(ThemeRole::TextLink)));
                            div()
                                .id(SharedString::from(format!("question-{q}-{o}")))
                                .debug_selector({
                                    let q = q.clone();
                                    let o = o.clone();
                                    move || format!("question-{q}-{o}.option")
                                })
                                .h(px(28.0))
                                .px(px(8.0))
                                .flex()
                                .items_center()
                                .gap(px(8.0))
                                .rounded(px(6.0))
                                .border_1()
                                .border_color(theme.role(ThemeRole::Divider))
                                .bg(if selected {
                                    theme.role(ThemeRole::SurfaceSelected)
                                } else {
                                    theme.role(ThemeRole::SurfaceHigh)
                                })
                                .opacity(if option.disabled { 0.48 } else { 1.0 })
                                .when(callback.is_some() && !option.disabled, |v| {
                                    v.tab_index(0).focus(|style| {
                                        style.border_color(theme.role(ThemeRole::TextLink))
                                    })
                                })
                                .when_some(
                                    callback.filter(|_| !option.disabled),
                                    move |v, callback| {
                                        let keyboard = callback.clone();
                                        let key_q = q.clone();
                                        let key_o = o.clone();
                                        v.on_click(move |_, w, c| {
                                            callback(q.clone(), o.clone(), !selected, w, c)
                                        })
                                        .on_key_down(
                                            move |event, w, c| {
                                                if !event.is_held
                                                    && matches!(
                                                        event.keystroke.key.as_str(),
                                                        "enter" | "space" | " "
                                                    )
                                                {
                                                    c.stop_propagation();
                                                    keyboard(
                                                        key_q.clone(),
                                                        key_o.clone(),
                                                        !selected,
                                                        w,
                                                        c,
                                                    );
                                                }
                                            },
                                        )
                                    },
                                )
                                .child(marker)
                                .child(option.label)
                        }
                    }))
                    .children(question.text_input)
            }))
            .when(submit_visible, |view| {
                view.child(controlled_action_button(
                    submit_id,
                    submit_label,
                    theme,
                    model.on_submit,
                    submit_disabled,
                ))
            })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DelegationRowModel {
    pub id: SharedString,
    pub agent: SharedString,
    pub task: SharedString,
    pub status: SharedString,
    pub elapsed: Option<SharedString>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessRowModel {
    pub id: SharedString,
    pub label: SharedString,
    pub detail: SharedString,
    pub running: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatusRowModel {
    pub id: SharedString,
    pub label: SharedString,
    pub detail: Option<SharedString>,
    pub tone: SemanticTone,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NoticeRowModel {
    pub id: SharedString,
    pub title: Option<SharedString>,
    pub text: SharedString,
    pub tone: SemanticTone,
}

fn tone_role(tone: SemanticTone) -> ThemeRole {
    match tone {
        SemanticTone::Neutral => ThemeRole::TextSecondary,
        SemanticTone::Info => ThemeRole::TextLink,
        SemanticTone::Success => ThemeRole::Success,
        SemanticTone::Warning => ThemeRole::Warning,
        SemanticTone::Error => ThemeRole::TextDestructive,
    }
}
#[derive(IntoElement)]
pub struct DelegationRow {
    pub theme: Theme,
    pub model: DelegationRowModel,
    pub on_open: Option<ChatActivate>,
}
impl RenderOnce for DelegationRow {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let m = self.model;
        let theme = self.theme;
        row_shell(
            format!("delegation-{}", m.id).into(),
            theme,
            SemanticTone::Info,
        )
        .id(m.id.clone())
        .when(self.on_open.is_some(), |view| {
            view.tab_index(0)
                .focus(|style| style.bg(theme.role(ThemeRole::SurfaceSelected)))
        })
        .when_some(self.on_open, |view, open| {
            let keyboard = open.clone();
            view.on_click(move |_, window, cx| open(window, cx))
                .on_key_down(move |event, window, cx| {
                    if !event.is_held
                        && matches!(event.keystroke.key.as_str(), "enter" | "space" | " ")
                    {
                        cx.stop_propagation();
                        keyboard(window, cx);
                    }
                })
        })
        .child(div().font_weight(FontWeight::SEMIBOLD).child(m.agent))
        .child(div().flex_1().min_w_0().child(m.task))
        .child(m.status)
        .children(m.elapsed)
    }
}
#[derive(IntoElement)]
pub struct ProcessRow {
    pub theme: Theme,
    pub model: ProcessRowModel,
    pub on_stop: Option<ChatActivate>,
}
impl RenderOnce for ProcessRow {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let m = self.model;
        let running = m.running;
        let stop_id: SharedString = format!("process-{}.stop", m.id).into();
        row_shell(
            format!("process-{}", m.id).into(),
            self.theme,
            if running {
                SemanticTone::Info
            } else {
                SemanticTone::Neutral
            },
        )
        .child(m.label)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .font_family(fonts::MONO_FAMILY)
                .child(m.detail),
        )
        .when(running, |row| {
            row.children(
                self.on_stop
                    .map(|stop| action_button(stop_id, "Stop", self.theme, stop)),
            )
        })
    }
}
#[derive(IntoElement)]
pub struct StatusRow {
    pub theme: Theme,
    pub model: StatusRowModel,
}
impl RenderOnce for StatusRow {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let m = self.model;
        row_shell(format!("status-{}", m.id).into(), self.theme, m.tone)
            .child(m.label)
            .children(m.detail)
    }
}
#[derive(IntoElement)]
pub struct NoticeRow {
    pub theme: Theme,
    pub model: NoticeRowModel,
}
impl RenderOnce for NoticeRow {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let m = self.model;
        row_shell(format!("notice-{}", m.id).into(), self.theme, m.tone)
            .children(
                m.title
                    .map(|v| div().font_weight(FontWeight::SEMIBOLD).child(v)),
            )
            .child(m.text)
    }
}
fn row_shell(id: SharedString, theme: Theme, tone: SemanticTone) -> gpui::Div {
    div()
        .debug_selector(move || format!("{id}.root"))
        .w_full()
        .min_h(px(36.0))
        .px(px(24.0))
        .py(px(8.0))
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(8.0))
        .font_family(fonts::UI_FAMILY)
        .text_size(px(12.0))
        .text_color(theme.role(tone_role(tone)))
}

fn message_content_width(width: f32) -> f32 {
    // 24px row padding on both sides, plus the 32px avatar and 12px row gap.
    (width - 92.0).max(80.0)
}

pub fn message_height(model: &ChatMessageModel, width: f32) -> f32 {
    let content = message_content_width(width);
    let mut height = if model.grouped { 8.0 } else { 36.0 };
    for block in &model.blocks {
        height += match block {
            ChatMessageBlock::Text(doc) => markdown_height(doc, content),
            ChatMessageBlock::Image(image) => inline_image_geometry(image).size_at(content).1,
            ChatMessageBlock::Reasoning(v) => {
                20.0 + if v.expanded {
                    markdown_height(&v.detail, content - 12.0)
                } else {
                    0.0
                }
            }
            ChatMessageBlock::Tool(v) => {
                48.0 + if v.expanded { 40.0 } else { 0.0 }
                    + if v.review.is_some() { 52.0 } else { 0.0 }
            }
            ChatMessageBlock::Compaction(v) => 48.0 + markdown_height(&v.summary, content - 24.0),
        } + 8.0;
    }
    height
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_blocks_have_width_sensitive_modeled_height() {
        let model = ChatMessageModel {
            id: "m".into(),
            role: MessageRole::Agent,
            author: "Happy".into(),
            initials: "H".into(),
            time: None,
            context_note: None,
            delivery: MessageDelivery::Sent,
            generation: MessageGeneration::Complete,
            grouped: false,
            blocks: vec![ChatMessageBlock::Text(MarkdownDocument::parse(
                &"hello ".repeat(80),
            ))],
            on_link_open: None,
            on_image_open: None,
            on_tool_open: None,
            on_review_allow: None,
            on_review_deny: None,
        };
        assert!(message_height(&model, 220.0) > message_height(&model, 560.0));
    }
    use gpui::{Context, Modifiers, Render, size};
    use std::{cell::RefCell, rc::Rc};

    fn full_message() -> ChatMessageModel {
        ChatMessageModel {
            id: "tested".into(),
            role: MessageRole::Agent,
            author: "Happy".into(),
            initials: "H".into(),
            time: Some("10:42".into()),
            context_note: None,
            delivery: MessageDelivery::Sent,
            generation: MessageGeneration::Complete,
            grouped: false,
            blocks: vec![
                ChatMessageBlock::Text(MarkdownDocument::parse("A real rendered response.")),
                ChatMessageBlock::Image(ChatImageBlock {
                    id: "image".into(),
                    alt: "local".into(),
                    image: Some(Arc::new(Image::empty())),
                    width: Some(320),
                    height: Some(160),
                }),
                ChatMessageBlock::Reasoning(ReasoningBlock {
                    summary: "Reasoning".into(),
                    detail: MarkdownDocument::parse("Expanded detail"),
                    expanded: true,
                }),
                ChatMessageBlock::Tool(ToolBlock {
                    title: "Run command".into(),
                    status: ToolStatus::Succeeded,
                    presentation: ToolPresentation::Command {
                        command: "cargo check".into(),
                        output: Some("Finished".into()),
                    },
                    review: Some(ToolReview {
                        status: ToolReviewStatus::Required,
                        prompt: "Allow?".into(),
                    }),
                    expanded: true,
                }),
                ChatMessageBlock::Compaction(CompactionBlock {
                    title: "Compacted".into(),
                    summary: MarkdownDocument::parse("Older context summary"),
                    token_count: Some(1200),
                }),
            ],
            on_link_open: None,
            on_image_open: Some(Rc::new(|_, _, _| {})),
            on_tool_open: Some(Rc::new(|_, _| {})),
            on_review_allow: Some(Rc::new(|_, _| {})),
            on_review_deny: Some(Rc::new(|_, _| {})),
        }
    }

    #[gpui::test]
    fn chat_message_all_block_families_have_real_narrow_wide_geometry(
        cx: &mut gpui::TestAppContext,
    ) {
        struct Fixture {
            width: f32,
            dark: bool,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().w(px(self.width)).child(ChatMessage {
                    theme: if self.dark {
                        Theme::dark()
                    } else {
                        Theme::light()
                    },
                    model: full_message(),
                })
            }
        }
        let (view, cx) = cx.add_window_view(|_, _| Fixture {
            width: 220.0,
            dark: false,
        });
        cx.simulate_resize(size(px(560.0), px(900.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|w, _| w.scale_factor()), 2.0);
        let narrow = cx.debug_bounds("chat-message-tested.root").unwrap();
        assert_eq!(narrow.size.width, px(220.0));
        assert!(narrow.size.height > px(400.0));
        assert_eq!(
            cx.debug_bounds("chat-message-tested.avatar").unwrap().size,
            size(px(32.0), px(32.0))
        );
        let narrow_image = cx
            .debug_bounds("chat-message-tested.block-1.image-block")
            .unwrap();
        let image_geometry = inline_image_geometry(match &full_message().blocks[1] {
            ChatMessageBlock::Image(image) => image,
            _ => unreachable!(),
        });
        let modeled_image_size = image_geometry.size_at(message_content_width(220.0));
        assert_eq!(
            narrow_image.size,
            size(px(modeled_image_size.0), px(modeled_image_size.1)),
            "rendered inline image uses the same available-width aspect calculation as message_height"
        );
        view.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            fixture.dark = true;
            cx.notify();
        });
        cx.run_until_parked();
        let wide = cx.debug_bounds("chat-message-tested.root").unwrap();
        assert_eq!(wide.size.width, px(560.0));
        assert!(wide.size.height > px(400.0));
    }

    #[gpui::test]
    fn inline_image_activation_passes_the_stable_block_id(cx: &mut gpui::TestAppContext) {
        struct Fixture {
            opened: Rc<RefCell<Vec<SharedString>>>,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let opened = self.opened.clone();
                div().w(px(560.0)).child(ChatMessage {
                    theme: Theme::light(),
                    model: ChatMessageModel {
                        id: "activation".into(),
                        role: MessageRole::Agent,
                        author: "Happy".into(),
                        initials: "H".into(),
                        time: None,
                        context_note: None,
                        delivery: MessageDelivery::Sent,
                        generation: MessageGeneration::Complete,
                        grouped: false,
                        blocks: vec![ChatMessageBlock::Image(ChatImageBlock {
                            id: "stable-image-id".into(),
                            alt: "Local image".into(),
                            image: Some(Arc::new(Image::empty())),
                            width: Some(320),
                            height: Some(160),
                        })],
                        on_link_open: None,
                        on_image_open: Some(Rc::new(move |id, _, _| opened.borrow_mut().push(id))),
                        on_tool_open: None,
                        on_review_allow: None,
                        on_review_deny: None,
                    },
                })
            }
        }
        let opened = Rc::new(RefCell::new(Vec::new()));
        let fixture_opened = opened.clone();
        let (_, cx) = cx.add_window_view(move |_, _| Fixture {
            opened: fixture_opened,
        });
        cx.simulate_resize(size(px(560.0), px(320.0)));
        cx.run_until_parked();
        let image = cx
            .debug_bounds("chat-message-activation.block-0.image-block")
            .unwrap();
        cx.simulate_click(image.center(), Modifiers::default());
        cx.simulate_keystrokes("enter space");
        assert_eq!(
            opened.borrow().as_slice(),
            ["stable-image-id", "stable-image-id", "stable-image-id"]
        );
    }

    #[gpui::test]
    fn inline_image_lightbox_has_real_narrow_wide_geometry_and_close_interactions(
        cx: &mut gpui::TestAppContext,
    ) {
        struct Fixture {
            dark: bool,
            overlay_focus: FocusHandle,
            close_focus: FocusHandle,
            closed: Rc<RefCell<usize>>,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let closed = self.closed.clone();
                InlineImageLightbox {
                    id: "lightbox".into(),
                    theme: if self.dark {
                        Theme::dark()
                    } else {
                        Theme::light()
                    },
                    image: Arc::new(Image::empty()),
                    alt: "Caller-owned local image".into(),
                    overlay_focus: self.overlay_focus.clone(),
                    close_focus: self.close_focus.clone(),
                    on_close: Rc::new(move |_, _| *closed.borrow_mut() += 1),
                }
            }
        }
        cx.update(super::super::components::init);
        let closed = Rc::new(RefCell::new(0));
        let fixture_closed = closed.clone();
        let (view, cx) = cx.add_window_view(move |_, cx| Fixture {
            dark: false,
            overlay_focus: cx.focus_handle(),
            close_focus: cx.focus_handle(),
            closed: fixture_closed,
        });
        cx.simulate_resize(size(px(220.0), px(320.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|w, _| w.scale_factor()), 2.0);
        assert!(cx.update(|window, app| view.read(app).close_focus.is_focused(window)));
        assert_eq!(
            cx.debug_bounds("lightbox.overlay").unwrap().size,
            size(px(220.0), px(320.0))
        );
        assert_eq!(
            cx.debug_bounds("lightbox.root").unwrap().size,
            size(px(220.0), px(320.0))
        );
        let narrow_frame = cx.debug_bounds("lightbox.image-frame").unwrap();
        assert_eq!(narrow_frame.size, size(px(172.0), px(200.0)));
        assert_eq!(
            cx.debug_bounds("lightbox-close.root").unwrap().size,
            size(px(28.0), px(28.0))
        );
        cx.simulate_click(narrow_frame.center(), Modifiers::default());
        assert_eq!(*closed.borrow(), 0, "image click stays inside the lightbox");
        cx.simulate_click(gpui::point(px(4.0), px(4.0)), Modifiers::default());
        assert_eq!(*closed.borrow(), 1, "empty background dismisses");
        cx.simulate_keystrokes("escape");
        assert_eq!(*closed.borrow(), 2, "Escape dismisses");
        let close = cx.debug_bounds("lightbox-close.root").unwrap();
        cx.simulate_click(close.center(), Modifiers::default());
        assert_eq!(*closed.borrow(), 3, "close button dismisses exactly once");

        view.update(cx, |fixture, cx| {
            fixture.dark = true;
            cx.notify();
        });
        cx.simulate_resize(size(px(560.0), px(420.0)));
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("lightbox.overlay").unwrap().size,
            size(px(560.0), px(420.0))
        );
        assert_eq!(
            cx.debug_bounds("lightbox.image-frame").unwrap().size,
            size(px(512.0), px(300.0))
        );
        assert!(cx.update(|window, app| view.read(app).close_focus.is_focused(window)));
    }

    #[gpui::test]
    fn question_row_renders_single_multi_and_caller_owned_text_input(
        cx: &mut gpui::TestAppContext,
    ) {
        cx.update(super::super::text_area::init);
        struct Fixture {
            input: Entity<TextArea>,
            width: f32,
            submit_busy: bool,
            submitted: Rc<RefCell<usize>>,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().w(px(self.width)).child(QuestionRow {
                    theme: Theme::dark(),
                    model: QuestionRowModel {
                        id: "tested".into(),
                        title: "Questions".into(),
                        pending: true,
                        submit_disabled: false,
                        submit_busy: self.submit_busy,
                        questions: vec![
                            GenericQuestion {
                                id: "single".into(),
                                prompt: "Choose one".into(),
                                multiple: false,
                                options: vec![QuestionOption {
                                    id: "a".into(),
                                    label: "Alpha".into(),
                                    selected: true,
                                    disabled: false,
                                }],
                                text_input: None,
                            },
                            GenericQuestion {
                                id: "multi".into(),
                                prompt: "Choose many".into(),
                                multiple: true,
                                options: vec![QuestionOption {
                                    id: "b".into(),
                                    label: "Beta".into(),
                                    selected: false,
                                    disabled: false,
                                }],
                                text_input: Some(self.input.clone()),
                            },
                        ],
                        on_select: Some(Rc::new(|_, _, _, _, _| {})),
                        on_submit: Some({
                            let submitted = self.submitted.clone();
                            Rc::new(move |_, _| *submitted.borrow_mut() += 1)
                        }),
                    },
                })
            }
        }
        let submitted = Rc::new(RefCell::new(0));
        let submitted_for_fixture = submitted.clone();
        let (view, cx) = cx.add_window_view(move |_, cx| Fixture {
            input: cx.new(|cx| TextArea::new("answer", "", "Type answer", Theme::dark(), cx)),
            width: 220.0,
            submit_busy: false,
            submitted: submitted_for_fixture,
        });
        cx.simulate_resize(size(px(560.0), px(500.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|w, _| w.scale_factor()), 2.0);
        assert_eq!(
            cx.debug_bounds("question-tested.root").unwrap().size.width,
            px(172.0)
        );
        assert_eq!(
            cx.debug_bounds("question-single-a.option")
                .unwrap()
                .size
                .height,
            px(28.0)
        );
        assert_eq!(
            cx.debug_bounds("question-multi-b.option")
                .unwrap()
                .size
                .height,
            px(28.0)
        );
        let submit_center = cx
            .debug_bounds("question-tested.submit.root")
            .unwrap()
            .center();
        cx.simulate_click(submit_center, Modifiers::default());
        assert_eq!(*submitted.borrow(), 1);
        cx.simulate_keystrokes("enter space");
        assert_eq!(*submitted.borrow(), 3);
        view.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            fixture.submit_busy = true;
            cx.notify();
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("question-tested.root").unwrap().size.width,
            px(512.0)
        );
        assert_eq!(
            cx.debug_bounds("question-tested.submit.root")
                .unwrap()
                .size
                .height,
            px(28.0)
        );
        let busy_submit_center = cx
            .debug_bounds("question-tested.submit.root")
            .unwrap()
            .center();
        cx.simulate_click(busy_submit_center, Modifiers::default());
        assert_eq!(*submitted.borrow(), 3);
    }

    #[derive(Clone, Copy)]
    enum TestedRow {
        Delegation,
        Process,
        Status,
        Notice,
    }
    fn tested_row(kind: TestedRow) -> AnyElement {
        match kind {
            TestedRow::Delegation => DelegationRow {
                theme: Theme::light(),
                model: DelegationRowModel {
                    id: "d".into(),
                    agent: "Agent".into(),
                    task: "A narrow task".into(),
                    status: "Running".into(),
                    elapsed: Some("2m".into()),
                },
                on_open: Some(Rc::new(|_, _| {})),
            }
            .into_any_element(),
            TestedRow::Process => ProcessRow {
                theme: Theme::dark(),
                model: ProcessRowModel {
                    id: "p".into(),
                    label: "Process".into(),
                    detail: "cargo check".into(),
                    running: true,
                },
                on_stop: Some(Rc::new(|_, _| {})),
            }
            .into_any_element(),
            TestedRow::Status => StatusRow {
                theme: Theme::light(),
                model: StatusRowModel {
                    id: "s".into(),
                    label: "Connected".into(),
                    detail: Some("Ready".into()),
                    tone: SemanticTone::Success,
                },
            }
            .into_any_element(),
            TestedRow::Notice => NoticeRow {
                theme: Theme::dark(),
                model: NoticeRowModel {
                    id: "n".into(),
                    title: Some("Notice".into()),
                    text: "A long narrow notice remains inside its row".into(),
                    tone: SemanticTone::Warning,
                },
            }
            .into_any_element(),
        }
    }
    fn render_row_geometry(cx: &mut gpui::TestAppContext, kind: TestedRow, selector: &'static str) {
        struct Fixture(TestedRow);
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                div().w(px(220.0)).child(tested_row(self.0))
            }
        }
        let (_, cx) = cx.add_window_view(move |_, _| Fixture(kind));
        cx.simulate_resize(size(px(220.0), px(200.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|w, _| w.scale_factor()), 2.0);
        let bounds = cx.debug_bounds(selector).unwrap();
        assert_eq!(bounds.size.width, px(220.0));
        assert!(bounds.size.height >= px(36.0));
    }

    #[gpui::test]
    fn delegation_row_has_isolated_real_geometry(cx: &mut gpui::TestAppContext) {
        render_row_geometry(cx, TestedRow::Delegation, "delegation-d.root");
    }
    #[gpui::test]
    fn process_row_stop_has_pointer_keyboard_and_narrow_wide_geometry(
        cx: &mut gpui::TestAppContext,
    ) {
        struct Fixture {
            width: f32,
            stopped: Rc<RefCell<usize>>,
        }
        impl Render for Fixture {
            fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let stopped = self.stopped.clone();
                div().w(px(self.width)).child(ProcessRow {
                    theme: Theme::dark(),
                    model: ProcessRowModel {
                        id: "p".into(),
                        label: "Process".into(),
                        detail: "cargo check".into(),
                        running: true,
                    },
                    on_stop: Some(Rc::new(move |_, _| *stopped.borrow_mut() += 1)),
                })
            }
        }
        let stopped = Rc::new(RefCell::new(0));
        let fixture_stopped = stopped.clone();
        let (view, cx) = cx.add_window_view(move |_, _| Fixture {
            width: 220.0,
            stopped: fixture_stopped,
        });
        cx.simulate_resize(size(px(560.0), px(200.0)));
        cx.run_until_parked();
        assert_eq!(cx.update(|w, _| w.scale_factor()), 2.0);
        assert_eq!(
            cx.debug_bounds("process-p.root").unwrap().size.width,
            px(220.0)
        );
        let stop = cx.debug_bounds("process-p.stop.root").unwrap();
        assert_eq!(stop.size.height, px(28.0));
        cx.simulate_click(stop.center(), Modifiers::default());
        assert_eq!(*stopped.borrow(), 1);
        cx.simulate_keystrokes("enter space");
        assert_eq!(*stopped.borrow(), 3);
        view.update(cx, |fixture, cx| {
            fixture.width = 560.0;
            cx.notify();
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("process-p.root").unwrap().size.width,
            px(560.0)
        );
    }
    #[gpui::test]
    fn status_row_has_isolated_real_geometry(cx: &mut gpui::TestAppContext) {
        render_row_geometry(cx, TestedRow::Status, "status-s.root");
    }
    #[gpui::test]
    fn notice_row_has_isolated_real_geometry(cx: &mut gpui::TestAppContext) {
        render_row_geometry(cx, TestedRow::Notice, "notice-n.root");
    }
}
