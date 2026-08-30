//! Stable terminal lifetime with a bounded single-thread protocol/emulator owner.

use super::{
    protocol::{
        ClientEvent, GridCell, GridCursor, GridRow, MAX_INPUT_BYTES, MAX_SAFE_INTEGER,
        ProtocolClient, ReconnectState, ScrollbackPage, TerminalGrid, TerminalRecord,
        validate_grid,
    },
    transport::{OpenTerminal, TerminalTransport},
};
use crate::connectivity::{TransportOptions, UserError, UserErrorKind};
use async_channel::{Receiver, Sender, TrySendError};
use libghostty_vt::{
    RenderState, Terminal, TerminalOptions,
    key::{Encoder as KeyEncoder, Event as KeyEvent, Key, Mods},
    render::{CellIterator, RowIterator},
    screen::CellWide,
};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    rc::Rc,
    sync::{Arc, RwLock},
    thread,
    time::Duration,
};

const COMMAND_CAPACITY: usize = 1024;
const EVENT_CAPACITY: usize = 64;
const RECONNECT_DELAY: Duration = Duration::from_millis(500);

/// Ensures every daemon terminal created for this local lifetime is released,
/// including emulator initialization failures and worker panics.
struct TerminalLeaseCleanup {
    options: TransportOptions,
    workspace: String,
    terminal_id: String,
}

impl Drop for TerminalLeaseCleanup {
    fn drop(&mut self) {
        if let Ok(transport) = TerminalTransport::connect(self.options.clone()) {
            let _ = transport.stop(&self.workspace, &self.terminal_id);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalStatus {
    Connecting,
    Connected,
    Disconnected,
    Exited,
    Error,
}
#[derive(Clone)]
pub struct TerminalSnapshot {
    pub terminal: TerminalRecord,
    pub status: TerminalStatus,
    pub grid: Option<Arc<TerminalGrid>>,
    pub scrollback: Option<Arc<ScrollbackPage>>,
    pub exit_code: Option<i32>,
    pub error: Option<Arc<str>>,
    /// False while unavailable or exited. The retained grid remains readable.
    pub writable: bool,
}
#[derive(Clone, Debug)]
pub enum TerminalEvent {
    Changed,
    Scrollback { request_sequence: u64 },
    InputAcknowledged(u64),
    ResizeAcknowledged(u64),
}
enum Command {
    Input(Vec<u8>),
    Key {
        key: Key,
        mods: Mods,
        text: Option<String>,
    },
    Resize(u16, u16),
    Scrollback(u64, usize),
    Reconnect,
    Close,
}

pub struct TerminalSession {
    snapshot: Arc<RwLock<TerminalSnapshot>>,
    commands: Sender<Command>,
    events: Receiver<TerminalEvent>,
}
impl TerminalSession {
    /// Creates a daemon terminal and starts its local replica.
    ///
    /// This performs blocking daemon I/O; callers must run it on background work.
    pub fn open(
        options: TransportOptions,
        workspace: String,
        request: OpenTerminal,
    ) -> Result<Self, UserError> {
        let transport = TerminalTransport::connect(options.clone())?;
        let terminal = transport.create(&workspace, request)?;
        Self::start_owned(options, workspace, terminal, transport)
    }

    /// Attaches the exact daemon terminal already created for this Happy tool
    /// presentation. This never creates a terminal. The exact authoritative
    /// record must be present in `workspace`, and this session assumes its lease:
    /// dropping the session stops the daemon terminal on every worker exit path.
    ///
    /// This performs blocking daemon I/O; callers must run it on background work.
    pub fn attach_existing(
        options: TransportOptions,
        workspace: String,
        terminal_id: String,
    ) -> Result<Self, UserError> {
        let transport = TerminalTransport::connect(options.clone())?;
        let terminal = transport.existing(&workspace, &terminal_id)?;
        Self::start_owned(options, workspace, terminal, transport)
    }

    fn start_owned(
        options: TransportOptions,
        workspace: String,
        terminal: TerminalRecord,
        transport: TerminalTransport,
    ) -> Result<Self, UserError> {
        let authoritative_exited = terminal.status == super::protocol::TerminalRunStatus::Exited;
        let snapshot = Arc::new(RwLock::new(TerminalSnapshot {
            exit_code: terminal.exit_code,
            terminal: terminal.clone(),
            status: if authoritative_exited {
                TerminalStatus::Exited
            } else {
                TerminalStatus::Connecting
            },
            grid: None,
            scrollback: None,
            error: None,
            writable: false,
        }));
        let (command_tx, command_rx) = async_channel::bounded(COMMAND_CAPACITY);
        let (event_tx, event_rx) = async_channel::bounded(EVENT_CAPACITY);
        let worker_snapshot = Arc::clone(&snapshot);
        let cleanup_workspace = workspace.clone();
        let cleanup_terminal = terminal.id.clone();
        if thread::Builder::new()
            .name(format!("terminal-{}", terminal.id))
            .spawn(move || {
                worker(
                    options,
                    workspace,
                    terminal,
                    worker_snapshot,
                    command_rx,
                    event_tx,
                )
            })
            .is_err()
        {
            // The lease could not transfer to the worker. Release it before
            // reporting the local spawn failure, regardless of where it was created.
            let _ = transport.stop(&cleanup_workspace, &cleanup_terminal);
            return Err(error(
                UserErrorKind::Unavailable,
                "The terminal worker could not start.",
            ));
        }
        Ok(Self {
            snapshot,
            commands: command_tx,
            events: event_rx,
        })
    }
    pub fn snapshot(&self) -> TerminalSnapshot {
        self.snapshot
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
    pub fn receiver(&self) -> Receiver<TerminalEvent> {
        self.events.clone()
    }
    /// Offline terminals are read-only: input is refused rather than queued.
    pub fn write(&self, data: &[u8]) -> Result<(), UserError> {
        if !self.snapshot().writable {
            return Err(error(
                UserErrorKind::Unavailable,
                "The terminal is offline and read-only.",
            ));
        }
        for chunk in data.chunks(MAX_INPUT_BYTES) {
            self.submit(Command::Input(chunk.to_vec()))?
        }
        Ok(())
    }
    /// Encodes a physical key against Ghostty's current cursor/keypad/Kitty modes.
    pub fn key(&self, key: Key, mods: Mods, text: Option<String>) -> Result<(), UserError> {
        if !self.snapshot().writable {
            return Err(error(
                UserErrorKind::Unavailable,
                "The terminal is offline and read-only.",
            ));
        }
        self.submit(Command::Key { key, mods, text })
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), UserError> {
        if !self.snapshot().writable {
            return Err(error(
                UserErrorKind::Unavailable,
                "The terminal is offline and read-only.",
            ));
        }
        if cols == 0 || cols > 1000 || rows == 0 || rows > 1000 {
            return Err(error(
                UserErrorKind::Protocol,
                "The terminal dimensions are invalid.",
            ));
        }
        self.submit(Command::Resize(cols, rows))
    }
    pub fn request_scrollback(&self, start: u64, count: usize) -> Result<(), UserError> {
        if start > MAX_SAFE_INTEGER || count == 0 || count > 1000 {
            return Err(error(
                UserErrorKind::Protocol,
                "The scrollback request is invalid.",
            ));
        }
        self.submit(Command::Scrollback(start, count))
    }
    pub fn reconnect(&self) -> Result<(), UserError> {
        self.submit(Command::Reconnect)
    }
    fn submit(&self, c: Command) -> Result<(), UserError> {
        self.commands.try_send(c).map_err(|e| match e {
            TrySendError::Full(_) => error(
                UserErrorKind::Unavailable,
                "Too many terminal actions are pending.",
            ),
            TrySendError::Closed(_) => error(
                UserErrorKind::Unavailable,
                "The terminal session is closed.",
            ),
        })
    }
}
impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = self.commands.try_send(Command::Close);
        // Closing is authoritative even if the bounded queue was full.
        // The worker checks the channel state before every attach/read cycle.
        self.commands.close();
    }
}

fn worker(
    options: TransportOptions,
    workspace: String,
    record: TerminalRecord,
    snapshot: Arc<RwLock<TerminalSnapshot>>,
    commands: Receiver<Command>,
    events: Sender<TerminalEvent>,
) {
    let _lease_cleanup = TerminalLeaseCleanup {
        options: options.clone(),
        workspace: workspace.clone(),
        terminal_id: record.id.clone(),
    };
    if record.status == super::protocol::TerminalRunStatus::Exited {
        // The REST record is authoritative. Its final snapshot was published by
        // start_owned; do not attach or initialize a live emulator for it.
        return;
    }
    let mut terminal = match Terminal::new(TerminalOptions {
        cols: record.cols,
        rows: record.rows,
        max_scrollback: 10_000,
    }) {
        Ok(v) => v,
        Err(_) => {
            set(&snapshot, &events, |s| {
                s.status = TerminalStatus::Error;
                s.error = Some("The terminal emulator failed to load.".into())
            });
            return;
        }
    };
    let pty_replies = Rc::new(RefCell::new(Vec::<Vec<u8>>::new()));
    if terminal
        .on_pty_write({
            let pty_replies = Rc::clone(&pty_replies);
            move |_terminal, data| pty_replies.borrow_mut().push(data.to_vec())
        })
        .is_err()
    {
        set(&snapshot, &events, |s| {
            s.status = TerminalStatus::Error;
            s.error = Some("The terminal response channel failed to load.".into())
        });
        return;
    }
    let mut key_encoder = match KeyEncoder::new() {
        Ok(value) => value,
        Err(_) => {
            set(&snapshot, &events, |s| {
                s.status = TerminalStatus::Error;
                s.error = Some("The terminal key encoder failed to load.".into())
            });
            return;
        }
    };
    let mut render = match RenderState::new() {
        Ok(v) => v,
        Err(_) => {
            set(&snapshot, &events, |s| {
                s.status = TerminalStatus::Error;
                s.error = Some("The terminal renderer failed to load.".into())
            });
            return;
        }
    };
    let mut rows = RowIterator::new().ok();
    let mut cells = CellIterator::new().ok();
    let mut reconnect = ReconnectState::default();
    let mut closed = false;
    let mut exited = false;
    let mut desired = (record.cols, record.rows);
    let mut revision = 0u64;
    while !closed && !exited {
        if commands.is_closed() {
            break;
        }
        set(&snapshot, &events, |s| {
            s.status = TerminalStatus::Connecting;
            s.writable = false;
            s.error = None
        });
        let transport = match TerminalTransport::connect(options.clone()) {
            Ok(v) => v,
            Err(e) => {
                disconnect(&snapshot, &events, &e);
                if wait_reconnect(&commands, &mut closed, &mut desired) {
                    continue;
                } else {
                    break;
                }
            }
        };
        let mut socket = match transport.attach(&workspace, &record.id) {
            Ok(v) => v,
            Err(e) => {
                disconnect(&snapshot, &events, &e);
                if wait_reconnect(&commands, &mut closed, &mut desired) {
                    continue;
                } else {
                    break;
                }
            }
        };
        let mut protocol = match ProtocolClient::new(reconnect.clone()) {
            Ok(v) => v,
            Err(message) => {
                set(&snapshot, &events, |s| {
                    s.status = TerminalStatus::Error;
                    s.error = Some(message.into())
                });
                break;
            }
        };
        let mut lost = false;
        let mut latest_resize: Option<(u16, u16)> = None;
        while !closed && !exited && !lost {
            if commands.is_closed() {
                closed = true;
                break;
            }
            while let Some(frame) = protocol.take_outgoing() {
                if let Err(e) = socket.send(frame) {
                    disconnect(&snapshot, &events, &e);
                    lost = true;
                    break;
                }
            }
            while let Ok(command) = commands.try_recv() {
                match command {
                    Command::Input(data) => {
                        if let Err(m) = protocol.write_input(&data) {
                            set(&snapshot, &events, |s| s.error = Some(m.into()))
                        }
                    }
                    Command::Key { key, mods, text } => {
                        key_encoder.set_options_from_terminal(&terminal);
                        if let Ok(mut event) = KeyEvent::new() {
                            event.set_key(key).set_mods(mods).set_utf8(text);
                            let mut encoded = Vec::new();
                            if key_encoder.encode_to_vec(&event, &mut encoded).is_ok()
                                && !encoded.is_empty()
                            {
                                if let Err(message) = protocol.write_input(&encoded) {
                                    set(&snapshot, &events, |s| s.error = Some(message.into()));
                                }
                            }
                        }
                    }
                    Command::Resize(c, r) => {
                        desired = (c, r);
                        latest_resize = Some((c, r))
                    }
                    Command::Scrollback(start, count) => {
                        let retained = snapshot
                            .read()
                            .unwrap_or_else(|p| p.into_inner())
                            .scrollback
                            .clone();
                        let basis = retained
                            .as_ref()
                            .map(|page| (page.history_epoch.as_str(), page.history_revision));
                        if let Err(m) = protocol.request_scrollback(start, count, basis) {
                            set(&snapshot, &events, |s| s.error = Some(m.into()))
                        }
                    }
                    Command::Reconnect => {}
                    Command::Close => {
                        closed = true;
                        break;
                    }
                }
            }
            if let Some((c, r)) = latest_resize.take() {
                if let Err(m) = protocol.resize(c, r) {
                    set(&snapshot, &events, |s| s.error = Some(m.into()))
                }
            }
            if closed || lost {
                break;
            }
            match socket.receive() {
                Ok(Some(data)) => match protocol.receive(&data) {
                    Ok(protocol_events) => {
                        for event in protocol_events {
                            match event {
                                ClientEvent::Ready { cols, rows } => {
                                    set(&snapshot, &events, |s| {
                                        s.status = TerminalStatus::Connected;
                                        s.writable = true;
                                        s.error = None
                                    });
                                    if desired != (cols, rows) {
                                        latest_resize = Some(desired);
                                    }
                                }
                                ClientEvent::Mode(_) => {}
                                ClientEvent::Vt(data) => {
                                    terminal.vt_write(&data);
                                    for reply in pty_replies.borrow_mut().drain(..) {
                                        if let Err(message) = protocol.write_input(&reply) {
                                            set(&snapshot, &events, |s| {
                                                s.error = Some(message.into())
                                            });
                                            break;
                                        }
                                    }
                                    let Some(next_revision) = revision.checked_add(1) else {
                                        set(&snapshot, &events, |s| {
                                            s.status = TerminalStatus::Error;
                                            s.writable = false;
                                            s.error =
                                                Some("The terminal revision is exhausted.".into())
                                        });
                                        lost = true;
                                        break;
                                    };
                                    if next_revision > MAX_SAFE_INTEGER {
                                        set(&snapshot, &events, |s| {
                                            s.status = TerminalStatus::Error;
                                            s.writable = false;
                                            s.error =
                                                Some("The terminal revision is exhausted.".into())
                                        });
                                        lost = true;
                                        break;
                                    }
                                    revision = next_revision;
                                    if let Ok(grid) = emulator_grid(
                                        &terminal,
                                        &mut render,
                                        rows.as_mut(),
                                        cells.as_mut(),
                                        revision,
                                    ) && validate_grid(&grid).is_ok()
                                    {
                                        set(&snapshot, &events, |s| s.grid = Some(Arc::new(grid)))
                                    }
                                }
                                ClientEvent::Grid(grid) => {
                                    set(&snapshot, &events, |s| s.grid = Some(Arc::new(grid)))
                                }
                                ClientEvent::Resize {
                                    cols,
                                    rows,
                                    request_sequence,
                                } => {
                                    let _ = terminal.resize(cols, rows, 1, 1);
                                    if request_sequence > 0 {
                                        desired = (cols, rows);
                                        let _ = events.try_send(TerminalEvent::ResizeAcknowledged(
                                            request_sequence,
                                        ));
                                    }
                                }
                                ClientEvent::InputAcknowledged(sequence) => {
                                    let _ =
                                        events.try_send(TerminalEvent::InputAcknowledged(sequence));
                                }
                                ClientEvent::Scrollback {
                                    request_sequence,
                                    page,
                                } => {
                                    apply_scrollback(&snapshot, page);
                                    let _ = events
                                        .try_send(TerminalEvent::Scrollback { request_sequence });
                                }
                                ClientEvent::Exit(code) => {
                                    exited = true;
                                    set(&snapshot, &events, |s| {
                                        s.status = TerminalStatus::Exited;
                                        s.writable = false;
                                        s.exit_code = code;
                                        s.terminal.exit_code = code;
                                        s.terminal.status =
                                            super::protocol::TerminalRunStatus::Exited
                                    })
                                }
                            }
                        }
                    }
                    Err(message) => {
                        let e = error(UserErrorKind::Protocol, &message);
                        disconnect(&snapshot, &events, &e);
                        lost = true
                    }
                },
                Ok(None) => {}
                Err(e) => {
                    disconnect(&snapshot, &events, &e);
                    lost = true
                }
            }
        }
        reconnect = protocol.reconnect_state();
        socket.close();
        if lost && !closed && !exited && !wait_reconnect(&commands, &mut closed, &mut desired) {
            break;
        }
    }
    // `_lease_cleanup` DELETEs the daemon-owned lease on every exit path.
}
fn wait_reconnect(
    commands: &Receiver<Command>,
    closed: &mut bool,
    desired: &mut (u16, u16),
) -> bool {
    thread::park_timeout(RECONNECT_DELAY);
    while let Ok(command) = commands.try_recv() {
        match command {
            Command::Close => {
                *closed = true;
                return false;
            }
            Command::Resize(cols, rows) => *desired = (cols, rows),
            Command::Reconnect => return true,
            Command::Input(_) | Command::Key { .. } | Command::Scrollback(_, _) => {}
        }
    }
    !*closed
}
fn disconnect(
    snapshot: &Arc<RwLock<TerminalSnapshot>>,
    events: &Sender<TerminalEvent>,
    e: &UserError,
) {
    set(snapshot, events, |s| {
        s.status = TerminalStatus::Disconnected;
        s.writable = false;
        s.error = Some(e.message.clone().into())
    })
}
fn set(
    snapshot: &Arc<RwLock<TerminalSnapshot>>,
    events: &Sender<TerminalEvent>,
    f: impl FnOnce(&mut TerminalSnapshot),
) {
    let mut s = snapshot.write().unwrap_or_else(|p| p.into_inner());
    f(&mut s);
    drop(s);
    let _ = events.try_send(TerminalEvent::Changed);
}
fn apply_scrollback(snapshot: &Arc<RwLock<TerminalSnapshot>>, page: ScrollbackPage) {
    let mut s = snapshot.write().unwrap_or_else(|p| p.into_inner());
    s.scrollback = Some(Arc::new(page));
}
fn error(kind: UserErrorKind, message: &str) -> UserError {
    UserError {
        kind,
        message: message.into(),
        api: None,
    }
}

fn emulator_grid<'alloc, 'cb>(
    terminal: &Terminal<'alloc, 'cb>,
    render: &mut RenderState<'alloc>,
    rows: Option<&mut RowIterator<'alloc>>,
    cells: Option<&mut CellIterator<'alloc>>,
    revision: u64,
) -> Result<TerminalGrid, libghostty_vt::Error> {
    let title = terminal.title()?.to_owned();
    let total_rows = terminal.total_rows()? as u64;
    let terminal_palette = terminal.color_palette()?;
    let palette = (0..=255u8)
        .map(|index| {
            let color = terminal_palette.get(libghostty_vt::style::PaletteIndex(index));
            format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b)
        })
        .collect();
    let snapshot = render.update(terminal)?;
    let cols = snapshot.cols()?;
    let cursor = if snapshot.cursor_visible()? {
        snapshot.cursor_viewport()?.map(|c| GridCursor {
            visible: true,
            x: c.x,
            y: c.y,
        })
    } else {
        None
    };
    let mut output = Vec::new();
    let mut styles = vec![BTreeMap::new()];
    let mut style_ids = HashMap::new();
    if let (Some(rows), Some(cells)) = (rows, cells) {
        let mut row_iter = rows.update(&snapshot)?;
        while let Some(row) = row_iter.next() {
            let wrapped = row.raw_row()?.is_wrapped()?;
            let mut row_cells = Vec::new();
            let mut x = 0u16;
            let mut cell_iter = cells.update(&row)?;
            while let Some(cell) = cell_iter.next() {
                let wide = cell.raw_cell()?.wide()?;
                if wide == CellWide::SpacerTail {
                    x = x.checked_add(1).unwrap_or(u16::MAX);
                    continue;
                }
                let width = if wide == CellWide::Wide { 2 } else { 1 };
                let mut text = String::new();
                cell.graphemes_utf8(&mut text)?;
                if text.is_empty() {
                    text.push(' ')
                }
                let style = vt_style(&cell, &terminal_palette)?;
                let key = serde_json::to_string(&style).unwrap_or_default();
                let style_id = if style.is_empty() {
                    0
                } else if let Some(id) = style_ids.get(&key) {
                    *id
                } else if styles.len() < 4_096 {
                    let id = styles.len();
                    styles.push(style);
                    style_ids.insert(key, id);
                    id
                } else {
                    0
                };
                row_cells.push(GridCell {
                    style_id,
                    text,
                    width,
                    x,
                });
                x = x.checked_add(width as u16).unwrap_or(u16::MAX)
            }
            output.push(GridRow {
                cells: row_cells,
                wrapped,
            })
        }
    }
    Ok(TerminalGrid {
        cols,
        covers_output_offset: 0,
        cursor,
        palette,
        revision: revision.max(1),
        rows: output,
        start_row: total_rows.saturating_sub(snapshot.rows()? as u64),
        styles,
        title,
        total_rows,
    })
}

fn vt_style(
    cell: &libghostty_vt::render::CellIteration<'_, '_>,
    palette: &libghostty_vt::style::Palette,
) -> Result<BTreeMap<String, serde_json::Value>, libghostty_vt::Error> {
    use libghostty_vt::style::Underline;
    let raw = cell.style()?;
    let mut value = BTreeMap::new();
    for (name, enabled) in [
        ("bold", raw.bold),
        ("dim", raw.faint),
        ("italic", raw.italic),
        ("blink", raw.blink),
        ("inverse", raw.inverse),
        ("invisible", raw.invisible),
        ("strikethrough", raw.strikethrough),
        ("overline", raw.overline),
    ] {
        if enabled {
            value.insert(name.into(), serde_json::Value::Bool(true));
        }
    }
    let underline = match raw.underline {
        Underline::None => None,
        Underline::Single => Some("single"),
        Underline::Double => Some("double"),
        Underline::Curly => Some("curly"),
        Underline::Dotted => Some("dotted"),
        Underline::Dashed => Some("dashed"),
        _ => Some("single"),
    };
    if let Some(underline) = underline {
        value.insert(
            "underline".into(),
            serde_json::Value::String(underline.into()),
        );
    }
    let underline_color = match raw.underline_color {
        libghostty_vt::style::StyleColor::None => None,
        libghostty_vt::style::StyleColor::Rgb(color) => Some(color),
        libghostty_vt::style::StyleColor::Palette(index) => Some(palette.get(index)),
    };
    if let Some(color) = underline_color {
        value.insert(
            "underlineColor".into(),
            serde_json::Value::String(format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b)),
        );
    }
    if let Some(color) = cell.fg_color()? {
        value.insert(
            "foreground".into(),
            serde_json::Value::String(format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b)),
        );
    }
    if let Some(color) = cell.bg_color()? {
        value.insert(
            "background".into(),
            serde_json::Value::String(format!("#{:02x}{:02x}{:02x}", color.r, color.g, color.b)),
        );
    }
    // libghostty-vt 0.2.1 exposes hyperlink URIs only through terminal GridRef,
    // not through RenderState cell iteration. Semantic server grids retain the
    // hyperlink field exactly; VT fallback cells cannot project it safely here.
    Ok(value)
}
