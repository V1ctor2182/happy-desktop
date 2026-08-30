//! Retained workspace terminal and native-browser lifetimes.
//!
//! `ToolTabKey` is the resource identity. Metadata controls only chrome and placement.

use std::{collections::BTreeMap, rc::Rc, thread};

use gpui::{
    App, Context, Entity, FocusHandle, Focusable, IntoElement, Render, SharedString, Window, div,
    prelude::*, px,
};
use libghostty_vt::key::{Key, Mods};

use crate::{
    chat::ToolTabKey,
    connectivity::{TransportOptions, UserError},
    theme::Theme,
    tools::{OpenTerminal, TerminalSession, TerminalStatus as SessionStatus},
    ui::{
        Button, ButtonVariant, ControlSize, IconName, TextInput,
        native_browser::{
            BrowserAddress, NativeBrowser, NativeBrowserRequest, NativeBrowserSnapshot,
            NativeBrowserSource,
        },
        terminal_panel::{
            TERMINAL_CELL_HEIGHT, TERMINAL_CELL_WIDTH, TERMINAL_INSET_X, TERMINAL_INSET_Y,
            TERMINAL_MAX_HISTORY_ROWS, TERMINAL_MAX_PROJECTED_CELLS, TerminalAvailability,
            TerminalCell, TerminalCellStyle, TerminalColor, TerminalColorScheme, TerminalGrid,
            TerminalInputCapture, TerminalInputIntent, TerminalKey, TerminalKeyIntent,
            TerminalLink, TerminalPanel, TerminalPanelLayout, TerminalRow, TerminalScrollAxis,
            TerminalScrollIntent, TerminalScrollState, TerminalSelection, TerminalSize,
            TerminalStatus,
        },
        theme_roles::ThemeRole,
    },
};

#[derive(Clone)]
pub enum ToolRuntimeEvent {
    Ready(ToolTabKey),
    Failed(ToolTabKey, SharedString),
    BrowserChanged {
        key: ToolTabKey,
        address: SharedString,
        title: SharedString,
    },
    BrowserPopup {
        owner: ToolTabKey,
        address: BrowserAddress,
    },
}
pub type ToolRuntimeEventHandler = Rc<dyn Fn(ToolRuntimeEvent, &mut App)>;

/// One retained native source. Preparation is wholly background work; WebKit creation and all
/// source methods run later on the GPUI thread.
pub struct WorkspaceBrowserLifetime {
    key: ToolTabKey,
    theme: Theme,
    workspace_id: String,
    options: TransportOptions,
    initial_address: BrowserAddress,
    preparation_generation: u64,
    source: Option<NativeBrowserSource>,
    snapshot: Option<NativeBrowserSnapshot>,
    failure: Option<SharedString>,
    visible: bool,
    connected: bool,
    back_focus: FocusHandle,
    forward_focus: FocusHandle,
    reload_focus: FocusHandle,
    address_input: Entity<TextInput>,
    address_error: Option<SharedString>,
    on_event: ToolRuntimeEventHandler,
}
impl WorkspaceBrowserLifetime {
    fn start(
        key: ToolTabKey,
        theme: Theme,
        workspace_id: String,
        options: TransportOptions,
        address: BrowserAddress,
        on_event: ToolRuntimeEventHandler,
        cx: &mut App,
    ) -> Entity<Self> {
        let address_input = cx.new({
            let key = key.clone();
            let value = address.as_str().to_owned();
            move |cx| {
                TextInput::new(
                    format!("browser-address:{}", key.as_str()),
                    value,
                    "https://example.com",
                    theme,
                    cx,
                )
            }
        });
        let entity = cx.new(move |cx| Self {
            key: key.clone(),
            theme,
            workspace_id,
            options,
            initial_address: address,
            preparation_generation: 0,
            source: None,
            snapshot: None,
            failure: None,
            visible: false,
            connected: true,
            back_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            forward_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            reload_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            address_input: address_input.clone(),
            address_error: None,
            on_event: on_event.clone(),
        });
        entity.update(cx, |this, cx| this.initial_prepare(cx));
        entity
    }
    fn initial_prepare(&mut self, cx: &mut Context<Self>) {
        let generation = self.preparation_generation;
        let workspace_id = self.workspace_id.clone();
        let options = self.options.clone();
        self.failure = None;
        cx.notify();
        let (sender, receiver) = async_channel::bounded(1);
        if thread::Builder::new()
            .name("browser-prepare".into())
            .spawn(move || {
                let result = NativeBrowserSource::prepare(&workspace_id, options);
                if let Err(error) = sender.try_send(result)
                    && let Ok(preparation) = error.into_inner()
                {
                    preparation.retire();
                }
            })
            .is_err()
        {
            self.fail("The browser preparation worker could not start.", cx);
            return;
        }
        let weak = cx.entity().downgrade();
        cx.spawn(async move |_, cx| {
            let Ok(result) = receiver.recv().await else {
                return;
            };
            let Some(entity) = weak.upgrade() else {
                if let Ok(preparation) = result {
                    preparation.retire();
                }
                return;
            };
            let event_receiver = entity
                .update(cx, |this, cx| {
                    if !this.connected
                        || generation != this.preparation_generation
                        || this.source.is_some()
                    {
                        if let Ok(preparation) = result {
                            preparation.retire();
                        }
                        return None;
                    }
                    match result {
                        Ok(preparation) => match NativeBrowserSource::new(
                            preparation,
                            this.initial_address.clone(),
                        ) {
                            Ok(source) => {
                                let receiver = source.event_receiver();
                                this.snapshot = Some(source.snapshot());
                                this.source = Some(source);
                                (this.on_event)(ToolRuntimeEvent::Ready(this.key.clone()), cx);
                                cx.notify();
                                Some(receiver)
                            }
                            Err(_) => {
                                this.fail("The native browser could not be created.", cx);
                                None
                            }
                        },
                        Err(_) => {
                            this.fail("The secure browser connection could not be prepared.", cx);
                            None
                        }
                    }
                })
                .ok()
                .flatten();
            let Some(receiver) = event_receiver else {
                return;
            };
            while receiver.recv().await.is_ok() {
                let Some(entity) = weak.upgrade() else {
                    break;
                };
                if entity
                    .update(cx, |this, cx| this.source_changed(cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }
    fn fail(&mut self, message: &'static str, cx: &mut Context<Self>) {
        let message: SharedString = message.into();
        self.failure = Some(message.clone());
        (self.on_event)(ToolRuntimeEvent::Failed(self.key.clone(), message), cx);
        cx.notify();
    }
    fn source_changed(&mut self, cx: &mut Context<Self>) {
        let Some(source) = self.source.as_ref() else {
            return;
        };
        let snapshot = source.snapshot();
        let previous_address = self
            .snapshot
            .as_ref()
            .map(|value| value.address.as_str().to_owned());
        let address_tracks_page = previous_address
            .as_deref()
            .is_none_or(|previous| self.address_input.read(cx).value().as_ref() == previous);
        if address_tracks_page {
            let address = snapshot.address.as_str().to_owned();
            self.address_input
                .update(cx, move |input, cx| input.set_value(address, cx));
        }
        self.snapshot = Some(snapshot.clone());
        self.address_error = None;
        (self.on_event)(
            ToolRuntimeEvent::BrowserChanged {
                key: self.key.clone(),
                address: snapshot.address.as_str().to_owned().into(),
                title: snapshot.title.to_string().into(),
            },
            cx,
        );
        for request in source.take_requests() {
            let NativeBrowserRequest::PopupRequested { address } = request;
            (self.on_event)(
                ToolRuntimeEvent::BrowserPopup {
                    owner: self.key.clone(),
                    address,
                },
                cx,
            );
        }
        cx.notify();
    }
    pub fn theme_reconcile(&mut self, theme: Theme, cx: &mut Context<Self>) {
        if self.theme != theme {
            self.theme = theme;
            self.address_input
                .update(cx, |input, _| input.theme_reconcile(theme));
            cx.notify();
        }
    }
    pub fn visible_reconcile(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible == visible {
            return;
        }
        self.visible = visible;
        if !visible && let Some(source) = self.source.as_ref() {
            source.deactivate();
        }
        cx.notify();
    }
    pub fn availability_reconcile(&mut self, connected: bool, cx: &mut Context<Self>) {
        if self.connected == connected {
            return;
        }
        self.connected = connected;
        self.preparation_generation = self.preparation_generation.wrapping_add(1);
        let Some(source) = self.source.clone() else {
            self.failure = None;
            if connected {
                self.initial_prepare(cx);
            } else {
                cx.notify();
            }
            return;
        };
        let Ok(preparation) = source.connection_update(connected) else {
            self.fail("The native browser connection could not be updated.", cx);
            return;
        };
        let Some(preparation) = preparation else {
            self.source_changed(cx);
            return;
        };
        let (sender, receiver) = async_channel::bounded(1);
        if thread::Builder::new()
            .name("browser-reconnect".into())
            .spawn(move || {
                let _ = sender.try_send(preparation.prepare());
            })
            .is_err()
        {
            self.fail("The browser reconnect worker could not start.", cx);
            return;
        }
        let weak = cx.entity().downgrade();
        cx.spawn(async move |_, cx| {
            let Ok(prepared) = receiver.recv().await else {
                return;
            };
            let Some(entity) = weak.upgrade() else {
                return;
            };
            let _ = entity.update(cx, |this, cx| {
                if let Some(source) = this.source.as_ref() {
                    if source.connection_apply(prepared).is_err() {
                        this.fail("The native browser connection could not be restored.", cx);
                    } else {
                        this.source_changed(cx);
                    }
                }
            });
        })
        .detach();
    }
}
impl Render for WorkspaceBrowserLifetime {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (Some(source), Some(snapshot)) = (self.source.clone(), self.snapshot.clone()) else {
            let status = if !self.connected {
                "Browser offline".into()
            } else {
                self.failure
                    .clone()
                    .unwrap_or_else(|| "Opening browser…".into())
            };
            return div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .child(status)
                .into_any_element();
        };
        let weak = cx.entity().downgrade();
        let action = |operation: &'static str| {
            let weak = weak.clone();
            Rc::new(move |_: &mut Window, cx: &mut App| {
                let weak = weak.clone();
                cx.defer(move |cx| {
                    if let Some(entity) = weak.upgrade() {
                        let _ = entity.update(cx, |this, _| {
                            if let Some(source) = this.source.as_ref() {
                                match operation {
                                    "back" => source.back(),
                                    "forward" => source.forward(),
                                    "reload" => source.reload(),
                                    "stop" => source.stop(),
                                    _ => {}
                                }
                            }
                        });
                    }
                });
            }) as Rc<dyn Fn(&mut Window, &mut App)>
        };
        let button = |id: &'static str,
                      label: &'static str,
                      icon,
                      disabled,
                      focus_handle: FocusHandle,
                      handler| Button {
            id: format!("browser-{}-{id}", self.key.as_str()).into(),
            theme: self.theme,
            label: label.into(),
            size: ControlSize::Small,
            variant: ButtonVariant::Ghost,
            icon: Some(icon),
            icon_only: true,
            disabled,
            force_focused: false,
            focus_handle: Some(focus_handle),
            on_activate: Some(handler),
        };
        let address_input = self.address_input.clone();
        let address_weak = cx.entity().downgrade();
        div()
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(36.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(4.0))
                    .px(px(6.0))
                    .border_b_1()
                    .border_color(self.theme.role(ThemeRole::Divider))
                    .child(button(
                        "back",
                        "Back",
                        IconName::ChevronLeft,
                        !snapshot.can_go_back || !snapshot.connected,
                        self.back_focus.clone(),
                        action("back"),
                    ))
                    .child(button(
                        "forward",
                        "Forward",
                        IconName::ArrowRight,
                        !snapshot.can_go_forward || !snapshot.connected,
                        self.forward_focus.clone(),
                        action("forward"),
                    ))
                    .child(button(
                        if snapshot.loading { "stop" } else { "reload" },
                        if snapshot.loading { "Stop" } else { "Reload" },
                        if snapshot.loading {
                            IconName::Stop
                        } else {
                            IconName::History
                        },
                        !snapshot.connected,
                        self.reload_focus.clone(),
                        action(if snapshot.loading { "stop" } else { "reload" }),
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h(px(28.0))
                            .px(px(8.0))
                            .rounded(px(5.0))
                            .bg(self.theme.role(ThemeRole::InputBackground))
                            .text_size(px(12.0))
                            .text_color(self.theme.role(ThemeRole::InputText))
                            .on_key_down(move |event, _window, cx| {
                                if event.is_held || event.keystroke.key.as_str() != "enter" {
                                    return;
                                }
                                cx.stop_propagation();
                                let value = address_input.read(cx).value().to_string();
                                let weak = address_weak.clone();
                                cx.defer(move |cx| {
                                    if let Some(entity) = weak.upgrade() {
                                        let _ = entity.update(cx, |this, cx| {
                                            let Some(source) = this.source.as_ref() else {
                                                return;
                                            };
                                            if !source.snapshot().connected {
                                                this.address_error =
                                                    Some("The browser is offline.".into());
                                            } else {
                                                match BrowserAddress::parse(&value) {
                                                    Ok(address) => {
                                                        this.address_error = None;
                                                        source.navigate(address);
                                                    }
                                                    Err(_) => {
                                                        this.address_error = Some(
                                                            "Enter an HTTP, HTTPS, or about:blank address."
                                                                .into(),
                                                        );
                                                    }
                                                }
                                            }
                                            cx.notify();
                                        });
                                    }
                                });
                            })
                            .child(self.address_input.clone()),
                    ),
            )
            .when_some(self.address_error.clone(), |root, error| {
                root.child(
                    div()
                        .flex_none()
                        .px(px(8.0))
                        .py(px(4.0))
                        .text_size(px(11.0))
                        .text_color(self.theme.role(ThemeRole::TextDestructive))
                        .child(error),
                )
            })
            .child(div().flex_1().min_h_0().min_w_0().child(NativeBrowser {
                id: format!("workspace-browser:{}", self.key.as_str()).into(),
                theme: self.theme,
                source,
                visible: self.visible,
            }))
            .into_any_element()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DragAxis {
    Horizontal,
    Vertical,
}

#[derive(Clone, Copy, Debug)]
struct DragState {
    axis: DragAxis,
    pointer: f32,
    origin: TerminalScrollState,
}

#[derive(Clone, Copy, Debug)]
struct ScrollbarGeometry {
    thumb_start: f32,
    thumb_extent: f32,
    scroll_range: f32,
    thumb_travel: f32,
}

#[derive(Clone, Copy, Debug)]
enum RetainedScrollAnchor {
    Newest,
    Parked { absolute_row: u64, subrow: f32 },
}

/// One terminal resource and all caller-owned interaction identity for its whole lifetime.
pub struct WorkspaceTerminalLifetime {
    key: ToolTabKey,
    theme: Theme,
    session: Option<Rc<TerminalSession>>,
    opening: bool,
    open_error: Option<SharedString>,
    available: bool,
    color_scheme: TerminalColorScheme,
    focus: FocusHandle,
    input_capture: Entity<TerminalInputCapture>,
    grid: Option<Rc<TerminalGrid>>,
    status: TerminalStatus,
    session_notice: Option<SharedString>,
    exit_code: Option<i32>,
    scroll: TerminalScrollState,
    selection: Option<TerminalSelection>,
    hovered_link: Option<TerminalLink>,
    accepted_size: Option<TerminalSize>,
    drag: Option<DragState>,
    last_scrollback_start: Option<u64>,
    on_event: ToolRuntimeEventHandler,
}

enum TerminalStart {
    Open(OpenTerminal),
    Attach(String),
}

impl WorkspaceTerminalLifetime {
    fn pending(
        key: ToolTabKey,
        theme: Theme,
        on_event: ToolRuntimeEventHandler,
        cx: &mut Context<Self>,
    ) -> Self {
        let weak = cx.entity().downgrade();
        let on_input = Rc::new(move |intent, _window: &mut Window, cx: &mut App| {
            let weak = weak.clone();
            cx.defer(move |cx| {
                if let Some(entity) = weak.upgrade() {
                    entity.update(cx, |this, cx| this.input(intent, cx));
                }
            });
        });
        let focus = cx.focus_handle().tab_index(0).tab_stop(true);
        let input_capture = cx.new(|_| TerminalInputCapture::new(focus.clone(), on_input));
        Self {
            key,
            theme,
            session: None,
            opening: true,
            open_error: None,
            available: true,
            color_scheme: if theme == Theme::dark() {
                TerminalColorScheme::Dark
            } else {
                TerminalColorScheme::Light
            },
            focus,
            input_capture,
            grid: None,
            status: TerminalStatus::Connecting,
            session_notice: None,
            exit_code: None,
            scroll: TerminalScrollState::default(),
            selection: None,
            hovered_link: None,
            accepted_size: None,
            drag: None,
            last_scrollback_start: None,
            on_event,
        }
    }

    fn start_open(
        entity: Entity<Self>,
        options: TransportOptions,
        workspace_id: String,
        request: OpenTerminal,
        cx: &mut App,
    ) {
        Self::start(
            entity,
            options,
            workspace_id,
            TerminalStart::Open(request),
            cx,
        );
    }

    fn start_attach(
        entity: Entity<Self>,
        options: TransportOptions,
        workspace_id: String,
        terminal_id: String,
        cx: &mut App,
    ) {
        Self::start(
            entity,
            options,
            workspace_id,
            TerminalStart::Attach(terminal_id),
            cx,
        );
    }

    fn start(
        entity: Entity<Self>,
        options: TransportOptions,
        workspace_id: String,
        start: TerminalStart,
        cx: &mut App,
    ) {
        let (sender, receiver) = async_channel::bounded(1);
        let spawned = thread::Builder::new()
            .name(format!("terminal-open-{}", entity.read(cx).key.as_str()))
            .spawn(move || {
                let result = match start {
                    TerminalStart::Open(request) => {
                        TerminalSession::open(options, workspace_id, request)
                    }
                    TerminalStart::Attach(terminal_id) => {
                        TerminalSession::attach_existing(options, workspace_id, terminal_id)
                    }
                };
                let _ = sender.try_send(result);
            });
        if spawned.is_err() {
            entity.update(cx, |this, cx| {
                this.opening = false;
                let message: SharedString = "The terminal open worker could not start.".into();
                this.open_error = Some(message.clone());
                (this.on_event)(ToolRuntimeEvent::Failed(this.key.clone(), message), cx);
                cx.notify();
            });
            return;
        }
        let weak = entity.downgrade();
        cx.spawn(async move |cx| {
            let Ok(result) = receiver.recv().await else {
                return;
            };
            let Some(entity) = weak.upgrade() else { return };
            let receiver = match entity.update(cx, |this, cx| {
                this.opening = false;
                match result {
                    Ok(session) => {
                        this.color_scheme = match session.snapshot().terminal.color_scheme {
                            crate::tools::TerminalColorScheme::Dark => TerminalColorScheme::Dark,
                            crate::tools::TerminalColorScheme::Light => TerminalColorScheme::Light,
                        };
                        let receiver = session.receiver();
                        this.session = Some(Rc::new(session));
                        this.snapshot_reconcile(cx);
                        (this.on_event)(ToolRuntimeEvent::Ready(this.key.clone()), cx);
                        Some(receiver)
                    }
                    Err(error) => {
                        let message: SharedString = error.message.into();
                        this.open_error = Some(message.clone());
                        (this.on_event)(ToolRuntimeEvent::Failed(this.key.clone(), message), cx);
                        cx.notify();
                        None
                    }
                }
            }) {
                Ok(receiver) => receiver,
                Err(_) => return,
            };
            let Some(receiver) = receiver else { return };
            while receiver.recv().await.is_ok() {
                let Some(entity) = weak.upgrade() else { break };
                if entity
                    .update(cx, |this, cx| this.snapshot_reconcile(cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }

    fn snapshot_reconcile(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.as_ref() else {
            return;
        };
        let snapshot = session.snapshot();
        self.status = match snapshot.status {
            SessionStatus::Connecting => TerminalStatus::Connecting,
            SessionStatus::Connected => TerminalStatus::Connected,
            SessionStatus::Disconnected => TerminalStatus::Disconnected,
            SessionStatus::Exited => TerminalStatus::Exited,
            SessionStatus::Error => TerminalStatus::Error,
        };
        self.session_notice = snapshot.error.map(|value| value.to_string().into());
        self.exit_code = snapshot.exit_code;
        let anchor = self.retained_scroll_anchor();
        self.grid = snapshot
            .grid
            .as_ref()
            .map(|grid| project_grid(grid, snapshot.scrollback.as_deref()));
        self.input_capture.update(cx, |capture, _| {
            capture.set_writable(self.available && snapshot.writable)
        });
        self.grid_scroll_reconcile(anchor);
        cx.notify();
    }

    pub fn theme_reconcile(&mut self, theme: Theme, cx: &mut Context<Self>) {
        // The panel chrome follows appearance. The terminal palette stays fixed to creation.
        if self.theme != theme {
            self.theme = theme;
            cx.notify();
        }
    }

    pub fn availability_reconcile(&mut self, available: bool, cx: &mut Context<Self>) {
        if self.available != available {
            self.available = available;
            let writable =
                available && self.session.as_ref().is_some_and(|s| s.snapshot().writable);
            self.input_capture
                .update(cx, |capture, _| capture.set_writable(writable));
            cx.notify();
        }
    }

    fn input(&mut self, intent: TerminalInputIntent, cx: &mut Context<Self>) {
        if !self.available {
            return;
        }
        let Some(session) = self.session.as_ref() else {
            return;
        };
        let result = match intent {
            TerminalInputIntent::Key(intent) => {
                key_parts(intent).map_or(Ok(()), |(key, mods, text)| session.key(key, mods, text))
            }
            TerminalInputIntent::Text(text) => session.write(text.as_bytes()),
            TerminalInputIntent::Paste { text, bracketed } => {
                if bracketed {
                    let mut bytes = Vec::with_capacity(text.len() + 12);
                    bytes.extend_from_slice(b"\x1b[200~");
                    bytes.extend_from_slice(text.as_bytes());
                    bytes.extend_from_slice(b"\x1b[201~");
                    session.write(&bytes)
                } else {
                    session.write(text.as_bytes())
                }
            }
        };
        if let Err(error) = result {
            self.action_error(error, cx);
        }
    }

    fn resize(&mut self, size: TerminalSize, cx: &mut Context<Self>) {
        if self.accepted_size == Some(size) {
            return;
        }
        self.accepted_size = Some(size);
        if self.available
            && let Some(session) = self.session.as_ref()
            && let Err(error) = session.resize(size.columns, size.rows)
        {
            self.action_error(error, cx);
            return;
        }
        cx.notify();
    }

    fn scroll(&mut self, intent: TerminalScrollIntent, cx: &mut Context<Self>) {
        match intent {
            TerminalScrollIntent::By { x, y } => {
                self.scroll.x += x;
                self.scroll.y += y;
            }
            TerminalScrollIntent::To(value) => self.scroll = value,
            TerminalScrollIntent::ViewportBounds {
                x,
                y,
                width,
                height,
            } => {
                let width = width.max(0.0);
                let height = height.max(0.0);
                if self.scroll.viewport_x == x
                    && self.scroll.viewport_y == y
                    && self.scroll.viewport_width == width
                    && self.scroll.viewport_height == height
                {
                    return;
                }
                let size_changed =
                    self.scroll.viewport_width != width || self.scroll.viewport_height != height;
                let follow_newest = size_changed && self.is_following_newest();
                self.scroll.viewport_x = x;
                self.scroll.viewport_y = y;
                self.scroll.viewport_width = width;
                self.scroll.viewport_height = height;
                if follow_newest {
                    self.scroll.y = self.max_scroll_y();
                }
            }
            TerminalScrollIntent::PageAt { axis, pointer } => {
                let geometry = self.scrollbar_geometry(axis);
                let (local_pointer, page) = match axis {
                    TerminalScrollAxis::Horizontal => {
                        (pointer - self.scroll.viewport_x, self.scroll.viewport_width)
                    }
                    TerminalScrollAxis::Vertical => (
                        pointer - self.scroll.viewport_y,
                        self.scroll.viewport_height,
                    ),
                };
                let delta = if local_pointer < geometry.thumb_start + geometry.thumb_extent / 2.0 {
                    -page
                } else {
                    page
                };
                match axis {
                    TerminalScrollAxis::Horizontal => self.scroll.x += delta,
                    TerminalScrollAxis::Vertical => self.scroll.y += delta,
                }
            }
            TerminalScrollIntent::DragStart { axis, pointer, .. } => {
                self.drag = Some(DragState {
                    axis: match axis {
                        TerminalScrollAxis::Horizontal => DragAxis::Horizontal,
                        TerminalScrollAxis::Vertical => DragAxis::Vertical,
                    },
                    pointer,
                    origin: self.scroll,
                })
            }
            TerminalScrollIntent::DragMove { axis, pointer } => {
                let wanted = match axis {
                    TerminalScrollAxis::Horizontal => DragAxis::Horizontal,
                    TerminalScrollAxis::Vertical => DragAxis::Vertical,
                };
                if let Some(drag) = self.drag.filter(|drag| drag.axis == wanted) {
                    let geometry = self.scrollbar_geometry(axis);
                    let value = if geometry.scroll_range > 0.0 && geometry.thumb_travel > 0.0 {
                        let delta = pointer - drag.pointer;
                        let origin = match wanted {
                            DragAxis::Horizontal => drag.origin.x,
                            DragAxis::Vertical => drag.origin.y,
                        };
                        origin + delta * geometry.scroll_range / geometry.thumb_travel
                    } else {
                        0.0
                    };
                    match wanted {
                        DragAxis::Horizontal => self.scroll.x = value,
                        DragAxis::Vertical => self.scroll.y = value,
                    }
                }
            }
            TerminalScrollIntent::DragEnd { axis } => {
                let wanted = match axis {
                    TerminalScrollAxis::Horizontal => DragAxis::Horizontal,
                    TerminalScrollAxis::Vertical => DragAxis::Vertical,
                };
                if self.drag.is_some_and(|drag| drag.axis == wanted) {
                    self.drag = None;
                }
            }
        }
        self.clamp_scroll();
        self.request_scrollback_if_needed(cx);
        cx.notify();
    }

    fn scrollbar_geometry(&self, axis: TerminalScrollAxis) -> ScrollbarGeometry {
        let (track_extent, content_extent, offset) = match axis {
            TerminalScrollAxis::Horizontal => (
                self.scroll.viewport_width,
                self.grid.as_ref().map_or(0.0, |grid| {
                    grid.columns.min(1000) as f32 * TERMINAL_CELL_WIDTH + 2.0 * TERMINAL_INSET_X
                }),
                self.scroll.x,
            ),
            TerminalScrollAxis::Vertical => {
                let rows = self
                    .grid
                    .as_ref()
                    .map_or(0, |grid| grid.rows.len().min(TERMINAL_MAX_HISTORY_ROWS));
                (
                    self.scroll.viewport_height,
                    rows as f32 * TERMINAL_CELL_HEIGHT + 2.0 * TERMINAL_INSET_Y,
                    self.scroll.y,
                )
            }
        };
        let track_extent = track_extent.max(1.0);
        let thumb_extent = (track_extent * (track_extent / content_extent.max(track_extent)))
            .clamp(18.0_f32.min(track_extent), track_extent);
        let scroll_range = (content_extent - track_extent).max(0.0);
        let thumb_travel = (track_extent - thumb_extent).max(0.0);
        let thumb_start = if scroll_range > 0.0 {
            thumb_travel * (offset.clamp(0.0, scroll_range) / scroll_range)
        } else {
            0.0
        };
        ScrollbarGeometry {
            thumb_start,
            thumb_extent,
            scroll_range,
            thumb_travel,
        }
    }

    fn max_scroll_y(&self) -> f32 {
        let rows = self.grid.as_ref().map_or(0, |grid| grid.rows.len());
        (rows as f32 * TERMINAL_CELL_HEIGHT + 2.0 * TERMINAL_INSET_Y - self.scroll.viewport_height)
            .max(0.0)
    }

    fn is_following_newest(&self) -> bool {
        self.grid.is_none() || self.scroll.y >= self.max_scroll_y() - 0.5
    }

    fn retained_scroll_anchor(&self) -> Option<RetainedScrollAnchor> {
        let grid = self.grid.as_ref()?;
        if grid.rows.is_empty() || self.is_following_newest() {
            return Some(RetainedScrollAnchor::Newest);
        }
        let visual_row = ((self.scroll.y.max(0.0) / TERMINAL_CELL_HEIGHT).floor() as usize)
            .min(grid.rows.len() - 1);
        Some(RetainedScrollAnchor::Parked {
            absolute_row: grid.rows[visual_row].row,
            subrow: self.scroll.y - visual_row as f32 * TERMINAL_CELL_HEIGHT,
        })
    }

    fn grid_scroll_reconcile(&mut self, anchor: Option<RetainedScrollAnchor>) {
        let Some(grid) = self.grid.as_ref() else {
            self.scroll.y = 0.0;
            self.clamp_scroll();
            return;
        };
        if grid.rows.is_empty() {
            self.scroll.y = 0.0;
            self.clamp_scroll();
            return;
        }
        match anchor.unwrap_or(RetainedScrollAnchor::Newest) {
            RetainedScrollAnchor::Newest => self.scroll.y = self.max_scroll_y(),
            RetainedScrollAnchor::Parked {
                absolute_row,
                subrow,
            } => {
                if let Some(visual_row) = grid.rows.iter().position(|row| row.row == absolute_row) {
                    // The absolute anchor survived. Preserve its exact retained-vector position.
                    self.scroll.y = visual_row as f32 * TERMINAL_CELL_HEIGHT + subrow;
                } else {
                    // Only a missing anchor is clamped to the nearest retained boundary.
                    let first = grid.rows.first().map_or(absolute_row, |row| row.row);
                    let last = grid.rows.last().map_or(absolute_row, |row| row.row);
                    self.scroll.y = if absolute_row < first {
                        0.0
                    } else if absolute_row > last {
                        self.max_scroll_y()
                    } else {
                        let visual_row = grid.rows.partition_point(|row| row.row < absolute_row);
                        (visual_row as f32 * TERMINAL_CELL_HEIGHT + subrow)
                            .clamp(0.0, self.max_scroll_y())
                    };
                }
            }
        }
        let columns = grid.columns as usize;
        let max_x = (columns as f32 * TERMINAL_CELL_WIDTH + 2.0 * TERMINAL_INSET_X
            - self.scroll.viewport_width)
            .max(0.0);
        self.scroll.x = self.scroll.x.clamp(0.0, max_x);
    }

    fn clamp_scroll(&mut self) {
        let (columns, rows) = self
            .grid
            .as_ref()
            .map_or((0, 0), |grid| (grid.columns as usize, grid.rows.len()));
        let max_x = (columns as f32 * TERMINAL_CELL_WIDTH + 2.0 * TERMINAL_INSET_X
            - self.scroll.viewport_width)
            .max(0.0);
        let max_y = (rows as f32 * TERMINAL_CELL_HEIGHT + 2.0 * TERMINAL_INSET_Y
            - self.scroll.viewport_height)
            .max(0.0);
        self.scroll.x = self.scroll.x.clamp(0.0, max_x);
        self.scroll.y = self.scroll.y.clamp(0.0, max_y);
    }

    fn request_scrollback_if_needed(&mut self, cx: &mut Context<Self>) {
        if self.scroll.y > TERMINAL_CELL_HEIGHT * 2.0 {
            return;
        }
        let Some(first) = self
            .grid
            .as_ref()
            .and_then(|grid| grid.rows.first())
            .map(|row| row.row)
        else {
            return;
        };
        if first == 0 || self.last_scrollback_start == Some(first.saturating_sub(512)) {
            return;
        }
        let start = first.saturating_sub(512);
        self.last_scrollback_start = Some(start);
        if let Some(session) = self.session.as_ref()
            && let Err(error) = session.request_scrollback(start, 512)
        {
            self.action_error(error, cx);
        }
    }

    fn action_error(&mut self, error: UserError, cx: &mut Context<Self>) {
        self.open_error = Some(error.message.into());
        cx.notify();
    }
}

impl Render for WorkspaceTerminalLifetime {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.session.is_none() {
            return div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .child(self.open_error.clone().unwrap_or_else(|| {
                    if self.opening {
                        "Opening terminal…".into()
                    } else {
                        "Terminal unavailable".into()
                    }
                }))
                .into_any_element();
        }
        let weak = cx.entity().downgrade();
        let input = deferred_input(weak.clone());
        let resize = Rc::new({
            let weak = weak.clone();
            move |size, _window: &mut Window, cx: &mut App| {
                let weak = weak.clone();
                cx.defer(move |cx| {
                    if let Some(entity) = weak.upgrade() {
                        entity.update(cx, |this, cx| this.resize(size, cx));
                    }
                });
            }
        });
        let scroll = Rc::new({
            let weak = weak.clone();
            move |intent, _window: &mut Window, cx: &mut App| {
                let weak = weak.clone();
                cx.defer(move |cx| {
                    if let Some(entity) = weak.upgrade() {
                        entity.update(cx, |this, cx| this.scroll(intent, cx));
                    }
                });
            }
        });
        let selection = Rc::new({
            let weak = weak.clone();
            move |value, _window: &mut Window, cx: &mut App| {
                let weak = weak.clone();
                cx.defer(move |cx| {
                    if let Some(entity) = weak.upgrade() {
                        entity.update(cx, |this, cx| {
                            this.selection = value;
                            cx.notify();
                        });
                    }
                });
            }
        });
        let hover = Rc::new({
            let weak = weak.clone();
            move |value, _window: &mut Window, cx: &mut App| {
                let weak = weak.clone();
                cx.defer(move |cx| {
                    if let Some(entity) = weak.upgrade() {
                        entity.update(cx, |this, cx| {
                            this.hovered_link = value;
                            cx.notify();
                        });
                    }
                });
            }
        });
        let reconnect = Rc::new({
            let weak = weak.clone();
            move |_window: &mut Window, cx: &mut App| {
                let weak = weak.clone();
                cx.defer(move |cx| {
                    if let Some(entity) = weak.upgrade() {
                        entity.update(cx, |this, cx| {
                            if let Some(session) = this.session.as_ref() {
                                if let Err(error) = session.reconnect() {
                                    this.action_error(error, cx);
                                }
                            }
                        });
                    }
                });
            }
        });
        let copy = Rc::new(
            move |text: SharedString, _window: &mut Window, cx: &mut App| {
                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.to_string()))
            },
        );
        let open = Rc::new(
            move |link: TerminalLink, _window: &mut Window, cx: &mut App| {
                cx.open_url(link.url.as_ref())
            },
        );
        let focused = window.is_window_active() && self.focus.is_focused(window);
        TerminalPanel {
            id: format!("workspace-terminal:{}", self.key.as_str()).into(),
            theme: self.theme,
            color_scheme: self.color_scheme,
            layout: TerminalPanelLayout::Fill,
            status: self.status,
            availability: if self.available {
                TerminalAvailability::Available
            } else {
                TerminalAvailability::Unavailable
            },
            notice: self
                .open_error
                .clone()
                .or_else(|| self.session_notice.clone()),
            exit_code: self.exit_code,
            grid: self.grid.clone(),
            scroll: self.scroll,
            selection: self.selection,
            hovered_link: self.hovered_link.clone(),
            focused,
            focus: self.focus.clone(),
            input_capture: self.input_capture.clone(),
            reported_size: self.accepted_size,
            on_input: input,
            on_resize: resize,
            on_scroll: scroll,
            on_selection: selection,
            on_copy: copy,
            on_open_link: Some(open),
            on_hover_link: Some(hover),
            on_reconnect: reconnect,
        }
        .into_any_element()
    }
}

fn deferred_input(
    weak: gpui::WeakEntity<WorkspaceTerminalLifetime>,
) -> Rc<dyn Fn(TerminalInputIntent, &mut Window, &mut App)> {
    Rc::new(move |intent, _window, cx| {
        let weak = weak.clone();
        cx.defer(move |cx| {
            if let Some(entity) = weak.upgrade() {
                entity.update(cx, |this, cx| this.input(intent, cx));
            }
        });
    })
}

/// Workspace-owned resource map. An existing key is never replaced.
pub struct WorkspaceToolLifetimes {
    terminals: BTreeMap<ToolTabKey, Entity<WorkspaceTerminalLifetime>>,
    browsers: BTreeMap<ToolTabKey, Entity<WorkspaceBrowserLifetime>>,
}
impl WorkspaceToolLifetimes {
    pub fn new() -> Self {
        Self {
            terminals: BTreeMap::new(),
            browsers: BTreeMap::new(),
        }
    }
    pub fn terminal_open(
        &mut self,
        key: ToolTabKey,
        theme: Theme,
        options: TransportOptions,
        workspace_id: String,
        request: OpenTerminal,
        on_event: ToolRuntimeEventHandler,
        cx: &mut App,
    ) -> bool {
        if self.terminals.contains_key(&key) || self.browsers.contains_key(&key) {
            return false;
        }
        let entity =
            cx.new(|cx| WorkspaceTerminalLifetime::pending(key.clone(), theme, on_event, cx));
        self.terminals.insert(key, entity.clone());
        WorkspaceTerminalLifetime::start_open(entity, options, workspace_id, request, cx);
        true
    }
    pub fn terminal_attach(
        &mut self,
        key: ToolTabKey,
        theme: Theme,
        options: TransportOptions,
        workspace_id: String,
        terminal_id: String,
        on_event: ToolRuntimeEventHandler,
        cx: &mut App,
    ) -> bool {
        if self.terminals.contains_key(&key) || self.browsers.contains_key(&key) {
            return false;
        }
        let entity =
            cx.new(|cx| WorkspaceTerminalLifetime::pending(key.clone(), theme, on_event, cx));
        self.terminals.insert(key, entity.clone());
        WorkspaceTerminalLifetime::start_attach(entity, options, workspace_id, terminal_id, cx);
        true
    }

    pub fn browser_open(
        &mut self,
        key: ToolTabKey,
        theme: Theme,
        workspace_id: String,
        options: TransportOptions,
        address: BrowserAddress,
        on_event: ToolRuntimeEventHandler,
        cx: &mut App,
    ) -> bool {
        if self.terminals.contains_key(&key) || self.browsers.contains_key(&key) {
            return false;
        }
        let entity = WorkspaceBrowserLifetime::start(
            key.clone(),
            theme,
            workspace_id,
            options,
            address,
            on_event,
            cx,
        );
        self.browsers.insert(key, entity);
        true
    }
    pub fn terminal(&self, key: &ToolTabKey) -> Option<Entity<WorkspaceTerminalLifetime>> {
        self.terminals.get(key).cloned()
    }
    pub fn browser(&self, key: &ToolTabKey) -> Option<Entity<WorkspaceBrowserLifetime>> {
        self.browsers.get(key).cloned()
    }
    pub(crate) fn browser_options(&self, key: &ToolTabKey, cx: &App) -> Option<TransportOptions> {
        self.browsers
            .get(key)
            .map(|browser| browser.read(cx).options.clone())
    }
    pub fn element(&self, key: &ToolTabKey) -> Option<gpui::AnyElement> {
        self.terminal(key)
            .map(IntoElement::into_any_element)
            .or_else(|| self.browser(key).map(IntoElement::into_any_element))
    }
    pub fn contains(&self, key: &ToolTabKey) -> bool {
        self.terminals.contains_key(key) || self.browsers.contains_key(key)
    }
    pub fn focus(&self, key: &ToolTabKey, window: &mut Window, cx: &App) -> bool {
        if let Some(terminal) = self.terminals.get(key) {
            terminal.read(cx).focus.focus(window);
            return true;
        }
        if let Some(browser) = self.browsers.get(key) {
            let address_input = browser.read(cx).address_input.clone();
            address_input.read(cx).focus_handle(cx).focus(window);
            return true;
        }
        false
    }
    pub fn close(&mut self, key: &ToolTabKey, cx: &App) {
        if let Some(browser) = self.browsers.remove(key) {
            if let Some(source) = browser.read(cx).source.as_ref() {
                source.deactivate();
            }
        }
        self.terminals.remove(key);
    }
    pub fn theme_reconcile(&self, theme: Theme, cx: &mut App) {
        for terminal in self.terminals.values() {
            terminal.update(cx, |terminal, cx| terminal.theme_reconcile(theme, cx));
        }
        for browser in self.browsers.values() {
            browser.update(cx, |browser, cx| browser.theme_reconcile(theme, cx));
        }
    }
    pub fn availability_reconcile(&self, available: bool, cx: &mut App) {
        for terminal in self.terminals.values() {
            terminal.update(cx, |terminal, cx| {
                terminal.availability_reconcile(available, cx)
            });
        }
        for browser in self.browsers.values() {
            browser.update(cx, |browser, cx| {
                browser.availability_reconcile(available, cx)
            });
        }
    }
    pub fn visibility_reconcile(
        &self,
        visible_key: Option<&ToolTabKey>,
        native_allowed: bool,
        cx: &mut App,
    ) {
        for (key, browser) in &self.browsers {
            browser.update(cx, |browser, cx| {
                browser.visible_reconcile(native_allowed && visible_key == Some(key), cx)
            });
        }
    }
}

fn project_grid(
    grid: &crate::tools::TerminalGrid,
    scrollback: Option<&crate::tools::protocol::ScrollbackPage>,
) -> Rc<TerminalGrid> {
    // Build newest-to-oldest so the live screen and its latest/cursor rows consume
    // the hard budgets before any history. The final reverse restores visual order.
    let mut retained_reversed = Vec::new();
    let mut cell_budget = TERMINAL_MAX_PROJECTED_CELLS;

    for (index, row) in grid.rows.iter().enumerate().rev() {
        if retained_reversed.len() == TERMINAL_MAX_HISTORY_ROWS {
            break;
        }
        let absolute = grid.start_row.saturating_add(index as u64);
        let Some(row) = project_row(absolute, row, &grid.styles, &grid.palette, &mut cell_budget)
        else {
            break;
        };
        retained_reversed.push(row);
    }

    let retained_all_current = retained_reversed.len() == grid.rows.len();
    if retained_all_current
        && retained_reversed.len() < TERMINAL_MAX_HISTORY_ROWS
        && let Some(page) = scrollback
    {
        let styles = page.styles.as_deref().unwrap_or(&grid.styles);
        let palette = page.palette.as_deref().unwrap_or(&grid.palette);
        let mut expected = grid.start_row;
        for (index, row) in page.rows.iter().enumerate().rev() {
            if retained_reversed.len() == TERMINAL_MAX_HISTORY_ROWS {
                break;
            }
            let absolute = page.start.saturating_add(index as u64);
            if absolute >= expected {
                continue;
            }
            if absolute.checked_add(1) != Some(expected) {
                break;
            }
            let Some(row) = project_row(absolute, row, styles, palette, &mut cell_budget) else {
                break;
            };
            retained_reversed.push(row);
            expected = absolute;
        }
    }

    retained_reversed.reverse();
    let omitted_before = retained_reversed
        .first()
        .map(|row| row.row)
        .filter(|first| *first > 0)
        .map(|first| 0..first);
    let cursor_absolute = grid
        .cursor
        .as_ref()
        .map(|cursor| grid.start_row.saturating_add(cursor.y as u64));
    let cursor = grid.cursor.as_ref().and_then(|cursor| {
        let absolute = cursor_absolute?;
        retained_reversed
            .iter()
            .position(|row| row.row == absolute)
            .map(|visual_row| crate::ui::terminal_panel::TerminalCursor {
                column: cursor.x,
                visual_row,
                visible: cursor.visible,
            })
    });

    Rc::new(TerminalGrid {
        columns: grid.cols,
        rows: Rc::new(retained_reversed),
        cursor,
        omitted_before,
        input_modes: Default::default(),
    })
}

fn project_row(
    row_number: u64,
    row: &crate::tools::protocol::GridRow,
    styles: &[BTreeMap<String, serde_json::Value>],
    palette: &[String],
    cell_budget: &mut usize,
) -> Option<TerminalRow> {
    // Enforce the budget before insertion. An empty source row remains a real
    // empty row; an oversized source row is omitted rather than encoded as a
    // partial or empty truncation marker.
    if row.cells.len() > *cell_budget {
        return None;
    }
    let projected_cells = row.cells.len();
    *cell_budget -= projected_cells;
    Some(TerminalRow {
        row: row_number,
        wrapped: row.wrapped,
        cells: Rc::new(
            row.cells
                .iter()
                .take(projected_cells)
                .map(|cell| {
                    let style = styles.get(cell.style_id);
                    TerminalCell {
                        column: cell.x,
                        width: cell.width.clamp(1, 2),
                        text: cell.text.clone().into(),
                        foreground: style.and_then(|s| style_color(s, "foreground", palette)),
                        background: style.and_then(|s| style_color(s, "background", palette)),
                        style: TerminalCellStyle {
                            bold: flag(style, "bold"),
                            dim: flag(style, "dim"),
                            italic: flag(style, "italic"),
                            underline: style.and_then(|s| s.get("underline")).is_some(),
                            overline: flag(style, "overline"),
                            strikethrough: flag(style, "strikethrough"),
                            inverse: flag(style, "inverse"),
                            invisible: flag(style, "invisible"),
                        },
                        hyperlink: style
                            .and_then(|s| s.get("hyperlink"))
                            .and_then(|v| v.as_str())
                            .map(|value| SharedString::from(value.to_owned())),
                    }
                })
                .collect(),
        ),
    })
}

fn flag(style: Option<&BTreeMap<String, serde_json::Value>>, name: &str) -> bool {
    style
        .and_then(|s| s.get(name))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}
fn style_color(
    style: &BTreeMap<String, serde_json::Value>,
    name: &str,
    palette: &[String],
) -> Option<TerminalColor> {
    let value = style.get(name)?;
    let raw = if let Some(index) = value.as_u64() {
        palette.get(index as usize)?.as_str()
    } else {
        value.as_str()?
    };
    let hex = raw.strip_prefix('#')?;
    let rgb = u32::from_str_radix(hex, 16).ok()?;
    let rgba = if hex.len() == 6 {
        (rgb << 8) | 0xff
    } else if hex.len() == 8 {
        rgb
    } else {
        return None;
    };
    Some(TerminalColor(gpui::rgba(rgba).into()))
}

fn key_parts(intent: TerminalKeyIntent) -> Option<(Key, Mods, Option<String>)> {
    let mut mods = Mods::empty();
    if intent.modifiers.control {
        mods |= Mods::CTRL;
    }
    if intent.modifiers.alt {
        mods |= Mods::ALT;
    }
    if intent.modifiers.shift {
        mods |= Mods::SHIFT;
    }
    if intent.modifiers.command {
        mods |= Mods::SUPER;
    }
    let (key, text) = match intent.key {
        TerminalKey::Character(value) => (character_key(value.as_ref()), Some(value.to_string())),
        TerminalKey::Enter => (Key::Enter, None),
        TerminalKey::Backspace => (Key::Backspace, None),
        TerminalKey::Tab => (Key::Tab, None),
        TerminalKey::Escape => (Key::Escape, None),
        TerminalKey::Insert => (Key::Insert, None),
        TerminalKey::Delete => (Key::Delete, None),
        TerminalKey::Home => (Key::Home, None),
        TerminalKey::End => (Key::End, None),
        TerminalKey::PageUp => (Key::PageUp, None),
        TerminalKey::PageDown => (Key::PageDown, None),
        TerminalKey::ArrowUp => (Key::ArrowUp, None),
        TerminalKey::ArrowDown => (Key::ArrowDown, None),
        TerminalKey::ArrowLeft => (Key::ArrowLeft, None),
        TerminalKey::ArrowRight => (Key::ArrowRight, None),
        TerminalKey::Function(n) => (
            [
                Key::F1,
                Key::F2,
                Key::F3,
                Key::F4,
                Key::F5,
                Key::F6,
                Key::F7,
                Key::F8,
                Key::F9,
                Key::F10,
                Key::F11,
                Key::F12,
            ]
            .get(n.saturating_sub(1) as usize)
            .copied()?,
            None,
        ),
    };
    Some((key, mods, text))
}

fn character_key(value: &str) -> Key {
    match value.chars().next().map(|c| c.to_ascii_lowercase()) {
        Some('a') => Key::A,
        Some('b') => Key::B,
        Some('c') => Key::C,
        Some('d') => Key::D,
        Some('e') => Key::E,
        Some('f') => Key::F,
        Some('g') => Key::G,
        Some('h') => Key::H,
        Some('i') => Key::I,
        Some('j') => Key::J,
        Some('k') => Key::K,
        Some('l') => Key::L,
        Some('m') => Key::M,
        Some('n') => Key::N,
        Some('o') => Key::O,
        Some('p') => Key::P,
        Some('q') => Key::Q,
        Some('r') => Key::R,
        Some('s') => Key::S,
        Some('t') => Key::T,
        Some('u') => Key::U,
        Some('v') => Key::V,
        Some('w') => Key::W,
        Some('x') => Key::X,
        Some('y') => Key::Y,
        Some('z') => Key::Z,
        Some('0') => Key::Digit0,
        Some('1') => Key::Digit1,
        Some('2') => Key::Digit2,
        Some('3') => Key::Digit3,
        Some('4') => Key::Digit4,
        Some('5') => Key::Digit5,
        Some('6') => Key::Digit6,
        Some('7') => Key::Digit7,
        Some('8') => Key::Digit8,
        Some('9') => Key::Digit9,
        Some(' ') => Key::Space,
        Some('-') => Key::Minus,
        Some('=') => Key::Equal,
        Some(',') => Key::Comma,
        Some('.') => Key::Period,
        Some('/') => Key::Slash,
        Some(';') => Key::Semicolon,
        Some('\'') => Key::Quote,
        Some('[') => Key::BracketLeft,
        Some(']') => Key::BracketRight,
        Some('\\') => Key::Backslash,
        Some('`') => Key::Backquote,
        _ => Key::Unidentified,
    }
}
