//! Bounded `@slopus/ghostty-web` 0.1.0 wire client and protocol-v23 terminal models.

use flate2::{Compression, read::DeflateDecoder, write::DeflateEncoder};
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{MapAccess, SeqAccess, Visitor},
};
use std::collections::{BTreeMap, VecDeque};
use std::io::{Read, Write};

pub const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_ENVELOPE_BYTES: usize = MAX_FRAME_BYTES + HEADER_BYTES;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_INPUT_BYTES: usize = 64 * 1024;
pub const MAX_PENDING_INPUTS: usize = 1_024;
pub const MAX_PENDING_RESIZES: usize = 32;
pub const MAX_SCROLLBACK_REQUESTS: usize = 128;
const HEADER_BYTES: usize = 20;
const MAX_GRID_ROWS: usize = 1_000;
const MAX_GRID_CELLS: usize = 1_000_000;
const MAX_ROW_CELLS: usize = 1_000;
const MAX_STYLES: usize = 4_096;
const MAX_STYLE_FIELDS: usize = 32;
const MAX_PALETTE: usize = 4_096;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_RECORD_TEXT_BYTES: usize = 4 * 1024;
const MAX_PROTOCOL_ID_BYTES: usize = 128;
const MAGIC: u16 = 0x5254;
const VERSION: u8 = 1;
const COMPRESSED: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalColorScheme {
    Dark,
    Light,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalRunStatus {
    Running,
    Exited,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecord {
    pub id: String,
    pub workspace_id: String,
    pub status: TerminalRunStatus,
    pub exit_code: Option<i32>,
    pub cols: u16,
    pub rows: u16,
    pub color_scheme: TerminalColorScheme,
    pub epoch: String,
    pub version: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct TerminalResponse {
    pub terminal: TerminalRecord,
}
#[derive(Clone, Debug, Deserialize)]
pub struct TerminalListResponse {
    pub terminals: Vec<TerminalRecord>,
}
#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpenTerminalRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cols: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_scrollback: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<TerminalColorScheme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalRequest {
    pub cols: u16,
    pub rows: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mutation_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalMode {
    Grid,
    Vt,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridCell {
    pub style_id: usize,
    pub text: String,
    pub width: u8,
    pub x: u16,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct GridRow {
    #[serde(deserialize_with = "bounded_cells")]
    pub cells: Vec<GridCell>,
    pub wrapped: bool,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridCursor {
    pub visible: bool,
    pub x: u16,
    pub y: u16,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalGrid {
    pub cols: u16,
    pub covers_output_offset: u64,
    pub cursor: Option<GridCursor>,
    #[serde(deserialize_with = "bounded_palette")]
    pub palette: Vec<String>,
    pub revision: u64,
    #[serde(deserialize_with = "bounded_rows")]
    pub rows: Vec<GridRow>,
    pub start_row: u64,
    #[serde(deserialize_with = "bounded_styles")]
    pub styles: Vec<BTreeMap<String, serde_json::Value>>,
    pub title: String,
    pub total_rows: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GridPatch {
    base_revision: u64,
    cols: u16,
    covers_output_offset: u64,
    cursor: Option<GridCursor>,
    #[serde(deserialize_with = "bounded_palette")]
    palette: Vec<String>,
    revision: u64,
    #[serde(deserialize_with = "bounded_patch_rows")]
    rows: Vec<(usize, GridRow)>,
    start_row: u64,
    #[serde(deserialize_with = "bounded_styles")]
    styles: Vec<BTreeMap<String, serde_json::Value>>,
    title: String,
    total_rows: u64,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScrollbackPage {
    pub base_row: u64,
    pub count: usize,
    pub history_epoch: String,
    pub history_revision: u64,
    #[serde(default, deserialize_with = "bounded_optional_palette")]
    pub palette: Option<Vec<String>>,
    #[serde(deserialize_with = "bounded_rows")]
    pub rows: Vec<GridRow>,
    pub start: u64,
    #[serde(default, deserialize_with = "bounded_optional_styles")]
    pub styles: Option<Vec<BTreeMap<String, serde_json::Value>>>,
    pub total_rows: u64,
}
#[derive(Clone)]
pub struct PendingInput {
    pub sequence: u64,
    pub data: Vec<u8>,
}
#[derive(Clone, Default)]
pub struct ReconnectState {
    pub epoch: Option<String>,
    pub input_lease: Option<String>,
    pub pending_inputs: Vec<PendingInput>,
    pub resume_input_sequence: u64,
    pub resume_output_offset: u64,
}
#[derive(Debug)]
pub enum ClientEvent {
    Ready {
        cols: u16,
        rows: u16,
    },
    Mode(TerminalMode),
    Vt(Vec<u8>),
    Grid(TerminalGrid),
    Resize {
        cols: u16,
        rows: u16,
        request_sequence: u64,
    },
    InputAcknowledged(u64),
    Scrollback {
        request_sequence: u64,
        page: ScrollbackPage,
    },
    Exit(Option<i32>),
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum PacketType {
    ClientHello = 1,
    Welcome = 2,
    Output = 3,
    OutputAck = 4,
    Input = 5,
    InputAck = 6,
    Resize = 7,
    ResizeAck = 8,
    GridKeyframe = 9,
    GridPatch = 10,
    GridAck = 11,
    Mode = 12,
    Resync = 13,
    ScrollbackRequest = 14,
    ScrollbackPage = 15,
    Exit = 16,
    Error = 17,
    ResizeApplied = 18,
}
impl PacketType {
    fn from(v: u8) -> Result<Self, String> {
        Ok(match v {
            1 => Self::ClientHello,
            2 => Self::Welcome,
            3 => Self::Output,
            4 => Self::OutputAck,
            5 => Self::Input,
            6 => Self::InputAck,
            7 => Self::Resize,
            8 => Self::ResizeAck,
            9 => Self::GridKeyframe,
            10 => Self::GridPatch,
            11 => Self::GridAck,
            12 => Self::Mode,
            13 => Self::Resync,
            14 => Self::ScrollbackRequest,
            15 => Self::ScrollbackPage,
            16 => Self::Exit,
            17 => Self::Error,
            18 => Self::ResizeApplied,
            _ => return Err("Unknown remote terminal packet type.".into()),
        })
    }
}
#[derive(Clone, Copy)]
struct PendingScrollback {
    start: u64,
    count: usize,
}

struct Packet {
    kind: PacketType,
    sequence: u64,
    payload: Vec<u8>,
}

pub struct ProtocolClient {
    decoder: Decoder,
    outgoing: VecDeque<Vec<u8>>,
    ready: bool,
    pub mode: Option<TerminalMode>,
    pub grid: Option<TerminalGrid>,
    epoch: Option<String>,
    input_lease: Option<String>,
    output_offset: u64,
    input_sequence: u64,
    last_input_ack: u64,
    pending_inputs: BTreeMap<u64, Vec<u8>>,
    pending_resizes: BTreeMap<u64, ()>,
    resize_sequence: u64,
    scrollback_sequence: u64,
    pending_scrollback: BTreeMap<u64, PendingScrollback>,
}
impl ProtocolClient {
    pub fn new(reconnect: ReconnectState) -> Result<Self, String> {
        safe_integer(reconnect.resume_input_sequence)?;
        safe_integer(reconnect.resume_output_offset)?;
        if let Some(epoch) = &reconnect.epoch {
            protocol_id(epoch, "Invalid retained terminal epoch.")?;
        }
        if let Some(input_lease) = &reconnect.input_lease {
            protocol_id(input_lease, "Invalid retained terminal input lease.")?;
        }
        if reconnect.pending_inputs.len() > MAX_PENDING_INPUTS {
            return Err("Too many retained terminal inputs.".into());
        }
        let mut previous = 0;
        for input in &reconnect.pending_inputs {
            safe_integer(input.sequence)?;
            if input.sequence == 0
                || input.sequence <= previous
                || input.sequence > reconnect.resume_input_sequence
                || input.data.len() > MAX_INPUT_BYTES
            {
                return Err("Invalid retained terminal input.".into());
            }
            previous = input.sequence;
        }
        let mut this = Self {
            decoder: Decoder::default(),
            outgoing: VecDeque::new(),
            ready: false,
            mode: None,
            grid: None,
            epoch: reconnect.epoch,
            input_lease: reconnect.input_lease,
            output_offset: reconnect.resume_output_offset,
            input_sequence: reconnect.resume_input_sequence,
            last_input_ack: 0,
            pending_inputs: reconnect
                .pending_inputs
                .into_iter()
                .map(|p| (p.sequence, p.data))
                .collect(),
            pending_resizes: BTreeMap::new(),
            resize_sequence: 0,
            scrollback_sequence: 0,
            pending_scrollback: BTreeMap::new(),
        };
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Hello<'a> {
            capabilities: Capabilities,
            client_id: &'a str,
            credit_bytes: usize,
            #[serde(skip_serializing_if = "Option::is_none")]
            epoch: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            input_lease: Option<&'a str>,
            resume_output_offset: u64,
            parser_fingerprint: &'a str,
        }
        #[derive(Serialize)]
        struct Capabilities {
            grid: bool,
            vt: bool,
        }
        let h = Hello {
            capabilities: Capabilities {
                grid: true,
                vt: true,
            },
            client_id: "happy-terminal",
            credit_bytes: 256 * 1024,
            epoch: this.epoch.as_deref(),
            input_lease: this.input_lease.as_deref(),
            resume_output_offset: this.output_offset,
            parser_fingerprint: "libghostty-vt/0.2/defaults",
        };
        let hello =
            serde_json::to_vec(&h).map_err(|_| "Could not encode terminal frame.".to_string())?;
        let offset = this.output_offset;
        this.send(PacketType::ClientHello, offset, &hello)?;
        Ok(this)
    }
    pub fn reconnect_state(&self) -> ReconnectState {
        ReconnectState {
            epoch: self.epoch.clone(),
            input_lease: self.input_lease.clone(),
            pending_inputs: self
                .pending_inputs
                .iter()
                .map(|(&sequence, data)| PendingInput {
                    sequence,
                    data: data.clone(),
                })
                .collect(),
            resume_input_sequence: self.input_sequence,
            resume_output_offset: self.output_offset,
        }
    }
    pub fn take_outgoing(&mut self) -> Option<Vec<u8>> {
        self.outgoing.pop_front()
    }
    pub fn write_input(&mut self, data: &[u8]) -> Result<u64, String> {
        if data.len() > MAX_INPUT_BYTES {
            return Err("Terminal input is too large.".into());
        }
        if self.pending_inputs.len() >= MAX_PENDING_INPUTS {
            return Err("Too many unacknowledged terminal inputs.".into());
        }
        self.input_sequence = checked_next(self.input_sequence)?;
        self.pending_inputs
            .insert(self.input_sequence, data.to_vec());
        self.send(PacketType::Input, self.input_sequence, data)?;
        Ok(self.input_sequence)
    }
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<u64, String> {
        dimensions(cols, rows)?;
        if self.pending_resizes.len() >= MAX_PENDING_RESIZES {
            return Err("Too many pending terminal resizes.".into());
        }
        self.resize_sequence = checked_next(self.resize_sequence)?;
        self.pending_resizes.insert(self.resize_sequence, ());
        #[derive(Serialize)]
        struct R {
            cols: u16,
            rows: u16,
        }
        self.send_json(PacketType::Resize, self.resize_sequence, &R { cols, rows })?;
        Ok(self.resize_sequence)
    }
    pub fn request_scrollback(
        &mut self,
        start: u64,
        count: usize,
        basis: Option<(&str, u64)>,
    ) -> Result<u64, String> {
        if count == 0 || count > 1000 || self.pending_scrollback.len() >= MAX_SCROLLBACK_REQUESTS {
            return Err("Invalid scrollback request.".into());
        }
        safe_integer(start)?;
        if let Some((history_epoch, history_revision)) = basis {
            protocol_id(history_epoch, "Invalid terminal scrollback history epoch.")?;
            safe_integer(history_revision)?;
        }
        self.scrollback_sequence = checked_next(self.scrollback_sequence)?;
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Basis<'a> {
            history_epoch: &'a str,
            history_revision: u64,
        }
        #[derive(Serialize)]
        struct Q<'a> {
            start: u64,
            count: usize,
            #[serde(skip_serializing_if = "Option::is_none")]
            basis: Option<Basis<'a>>,
        }
        let basis = basis.map(|(history_epoch, history_revision)| Basis {
            history_epoch,
            history_revision,
        });
        self.send_json(
            PacketType::ScrollbackRequest,
            self.scrollback_sequence,
            &Q {
                start,
                count,
                basis,
            },
        )?;
        self.pending_scrollback
            .insert(self.scrollback_sequence, PendingScrollback { start, count });
        Ok(self.scrollback_sequence)
    }
    pub fn receive(&mut self, data: &[u8]) -> Result<Vec<ClientEvent>, String> {
        let packets = self.decoder.push(data)?;
        let mut events = Vec::new();
        for p in packets {
            self.apply(p, &mut events)?
        }
        Ok(events)
    }
    fn apply(&mut self, p: Packet, events: &mut Vec<ClientEvent>) -> Result<(), String> {
        if p.kind == PacketType::Error {
            return Err("Happy Agent reported a terminal protocol error.".into());
        }
        if p.kind == PacketType::Welcome {
            if self.ready {
                return Err("Duplicate server welcome.".into());
            }
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct W {
                epoch: String,
                input_lease: String,
                input_sequence: u64,
                cols: u16,
                rows: u16,
                resize_revision: u64,
                mode: String,
            }
            let w = json::<W>(&p.payload)?;
            for value in [w.input_sequence, w.resize_revision] {
                safe_integer(value)?;
            }
            protocol_id(&w.epoch, "Invalid terminal welcome epoch.")?;
            protocol_id(&w.input_lease, "Invalid terminal welcome input lease.")?;
            dimensions(w.cols, w.rows)?;
            if w.input_sequence > self.input_sequence {
                return Err("Welcome input sequence exceeds the client sequence.".into());
            }
            if self.epoch.as_ref().is_some_and(|e| e != &w.epoch) {
                self.output_offset = 0
            }
            self.epoch = Some(w.epoch);
            self.input_lease = Some(w.input_lease);
            self.mode = Some(mode(&w.mode)?);
            events.push(ClientEvent::Mode(self.mode.unwrap()));
            events.push(ClientEvent::Resize {
                cols: w.cols,
                rows: w.rows,
                request_sequence: 0,
            });
            self.send(PacketType::ResizeApplied, w.resize_revision, &[])?;
            let replay: Vec<_> = self
                .pending_inputs
                .iter()
                .filter(|(s, _)| **s > w.input_sequence)
                .map(|(&s, d)| (s, d.clone()))
                .collect();
            self.pending_inputs.retain(|&s, _| s > w.input_sequence);
            for (s, d) in replay {
                self.send(PacketType::Input, s, &d)?
            }
            self.last_input_ack = w.input_sequence;
            self.ready = true;
            events.push(ClientEvent::Ready {
                cols: w.cols,
                rows: w.rows,
            });
            return Ok(());
        }
        if !self.ready {
            return Err("Server welcome is required.".into());
        }
        match p.kind {
            PacketType::Output => {
                if self.mode != Some(TerminalMode::Vt) {
                    return Err("VT output received outside VT mode.".into());
                }
                let start = p
                    .sequence
                    .checked_sub(p.payload.len() as u64)
                    .ok_or("Invalid output offset.")?;
                if p.sequence <= self.output_offset {
                    return Ok(());
                }
                if start != self.output_offset {
                    self.send(PacketType::Resync, 0, &[])?;
                    return Ok(());
                }
                self.output_offset = p.sequence;
                events.push(ClientEvent::Vt(p.payload));
                self.send(PacketType::OutputAck, self.output_offset, &[])?
            }
            PacketType::Mode => {
                #[derive(Deserialize)]
                struct M {
                    mode: String,
                }
                let m = mode(&json::<M>(&p.payload)?.mode)?;
                if m != TerminalMode::Grid {
                    return Err("Invalid terminal mode transition.".into());
                }
                self.mode = Some(m);
                events.push(ClientEvent::Mode(m))
            }
            PacketType::GridKeyframe => {
                let g = json::<TerminalGrid>(&p.payload)?;
                validate_grid(&g)?;
                self.grid = Some(g.clone());
                self.mode = Some(TerminalMode::Grid);
                events.push(ClientEvent::Grid(g.clone()));
                self.send(PacketType::GridAck, g.revision, &[])?
            }
            PacketType::GridPatch => {
                let patch = json::<GridPatch>(&p.payload)?;
                let Some(current) = self.grid.as_ref() else {
                    self.send(PacketType::Resync, 0, &[])?;
                    return Ok(());
                };
                for value in [
                    patch.base_revision,
                    patch.covers_output_offset,
                    patch.revision,
                    patch.start_row,
                    patch.total_rows,
                ] {
                    safe_integer(value)?;
                }
                if current.revision != patch.base_revision {
                    self.send(PacketType::Resync, 0, &[])?;
                    return Ok(());
                }
                validate_patch(&patch, current)?;
                let g = self.grid.as_mut().expect("grid checked above");
                for (index, row) in patch.rows {
                    g.rows[index] = row;
                }
                g.cols = patch.cols;
                g.covers_output_offset = patch.covers_output_offset;
                g.cursor = patch.cursor;
                g.palette = patch.palette;
                g.revision = patch.revision;
                g.start_row = patch.start_row;
                g.styles = patch.styles;
                g.title = patch.title;
                g.total_rows = patch.total_rows;
                let copy = g.clone();
                events.push(ClientEvent::Grid(copy.clone()));
                self.send(PacketType::GridAck, copy.revision, &[])?
            }
            PacketType::InputAck => {
                if !p.payload.is_empty()
                    || p.sequence < self.last_input_ack
                    || p.sequence > self.input_sequence
                {
                    return Err("Invalid input acknowledgement.".into());
                }
                self.last_input_ack = p.sequence;
                self.pending_inputs.retain(|&s, _| s > p.sequence);
                events.push(ClientEvent::InputAcknowledged(p.sequence))
            }
            PacketType::ResizeAck => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct R {
                    cols: u16,
                    rows: u16,
                    barrier: u64,
                    resize_revision: u64,
                    request_sequence: u64,
                }
                let r = json::<R>(&p.payload)?;
                for value in [r.barrier, r.resize_revision, r.request_sequence] {
                    safe_integer(value)?;
                }
                dimensions(r.cols, r.rows)?;
                if self.mode == Some(TerminalMode::Vt) && self.output_offset != r.barrier {
                    return Err("Resize output barrier mismatch.".into());
                }
                if r.request_sequence > 0 && !self.pending_resizes.contains_key(&r.request_sequence)
                {
                    return Err("Unknown resize acknowledgement.".into());
                }
                self.send(PacketType::ResizeApplied, r.resize_revision, &[])?;
                if r.request_sequence > 0 {
                    self.pending_resizes.remove(&r.request_sequence);
                }
                events.push(ClientEvent::Resize {
                    cols: r.cols,
                    rows: r.rows,
                    request_sequence: r.request_sequence,
                })
            }
            PacketType::ScrollbackPage => {
                let Some(request) = self.pending_scrollback.get(&p.sequence).copied() else {
                    return Err("Unknown scrollback response.".into());
                };
                let page = json::<ScrollbackPage>(&p.payload)?;
                let (cols, retained_styles) = self
                    .grid
                    .as_ref()
                    .map_or((1000, MAX_STYLES), |grid| (grid.cols, grid.styles.len()));
                validate_scrollback(&page, cols, retained_styles)?;
                if page.start != request.start || page.count != request.count {
                    return Err("Scrollback response does not match its request.".into());
                }
                self.pending_scrollback.remove(&p.sequence);
                events.push(ClientEvent::Scrollback {
                    request_sequence: p.sequence,
                    page,
                })
            }
            PacketType::Exit => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct X {
                    exit_code: Option<i32>,
                    output_offset: u64,
                }
                let x = json::<X>(&p.payload)?;
                safe_integer(x.output_offset)?;
                if self.mode == Some(TerminalMode::Vt) && self.output_offset != x.output_offset {
                    return Err("Exit output barrier mismatch.".into());
                }
                if self.mode == Some(TerminalMode::Grid)
                    && self.grid.as_ref().map_or(0, |g| g.covers_output_offset) < x.output_offset
                {
                    return Err("Exit grid barrier mismatch.".into());
                }
                events.push(ClientEvent::Exit(x.exit_code))
            }
            _ => return Err("Packet is invalid in the current client state.".into()),
        }
        Ok(())
    }
    fn send_json(&mut self, k: PacketType, s: u64, v: &impl Serialize) -> Result<(), String> {
        let p =
            serde_json::to_vec(v).map_err(|_| "Could not encode terminal frame.".to_string())?;
        self.send(k, s, &p)
    }
    fn send(&mut self, k: PacketType, s: u64, p: &[u8]) -> Result<(), String> {
        safe_integer(s)?;
        self.outgoing.push_back(encode(k, s, p)?);
        Ok(())
    }
}

struct BoundedSeq<T, const N: usize>(Vec<T>);
impl<'de, T: Deserialize<'de>, const N: usize> Deserialize<'de> for BoundedSeq<T, N> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct SeqVisitor<T, const N: usize>(std::marker::PhantomData<T>);
        impl<'de, T: Deserialize<'de>, const N: usize> Visitor<'de> for SeqVisitor<T, N> {
            type Value = BoundedSeq<T, N>;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(formatter, "an array containing at most {N} entries")
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut values = Vec::with_capacity(seq.size_hint().unwrap_or(0).min(N));
                while values.len() < N {
                    let Some(value) = seq.next_element()? else {
                        return Ok(BoundedSeq(values));
                    };
                    values.push(value);
                }
                if seq.next_element::<serde::de::IgnoredAny>()?.is_some() {
                    return Err(serde::de::Error::custom(
                        "bounded terminal array is too large",
                    ));
                }
                Ok(BoundedSeq(values))
            }
        }
        deserializer.deserialize_seq(SeqVisitor::<T, N>(std::marker::PhantomData))
    }
}

struct BoundedStyle(BTreeMap<String, serde_json::Value>);
impl<'de> Deserialize<'de> for BoundedStyle {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct StyleVisitor;
        impl<'de> Visitor<'de> for StyleVisitor {
            type Value = BoundedStyle;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a bounded terminal style object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut value = BTreeMap::new();
                let mut entries = 0usize;
                while let Some(key) = map.next_key::<String>()? {
                    if entries == MAX_STYLE_FIELDS || key.len() > 64 {
                        return Err(serde::de::Error::custom("terminal style is too large"));
                    }
                    let field = map.next_value::<serde_json::Value>()?;
                    entries += 1;
                    value.insert(key, field);
                }
                Ok(BoundedStyle(value))
            }
        }
        deserializer.deserialize_map(StyleVisitor)
    }
}

fn bounded_cells<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<GridCell>, D::Error> {
    Ok(BoundedSeq::<GridCell, MAX_ROW_CELLS>::deserialize(d)?.0)
}
fn bounded_rows<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<GridRow>, D::Error> {
    Ok(BoundedSeq::<GridRow, MAX_GRID_ROWS>::deserialize(d)?.0)
}
fn bounded_patch_rows<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<(usize, GridRow)>, D::Error> {
    Ok(BoundedSeq::<(usize, GridRow), MAX_GRID_ROWS>::deserialize(d)?.0)
}
fn bounded_palette<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    Ok(BoundedSeq::<String, MAX_PALETTE>::deserialize(d)?.0)
}
fn bounded_styles<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Vec<BTreeMap<String, serde_json::Value>>, D::Error> {
    Ok(BoundedSeq::<BoundedStyle, MAX_STYLES>::deserialize(d)?
        .0
        .into_iter()
        .map(|style| style.0)
        .collect())
}
fn bounded_optional_palette<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<String>>, D::Error> {
    Ok(Option::<BoundedSeq<String, MAX_PALETTE>>::deserialize(d)?.map(|value| value.0))
}
fn bounded_optional_styles<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<BTreeMap<String, serde_json::Value>>>, D::Error> {
    Ok(
        Option::<BoundedSeq<BoundedStyle, MAX_STYLES>>::deserialize(d)?
            .map(|value| value.0.into_iter().map(|style| style.0).collect()),
    )
}

fn mode(s: &str) -> Result<TerminalMode, String> {
    match s {
        "grid" => Ok(TerminalMode::Grid),
        "vt" => Ok(TerminalMode::Vt),
        _ => Err("Invalid terminal mode.".into()),
    }
}
fn checked_next(value: u64) -> Result<u64, String> {
    let next = value
        .checked_add(1)
        .ok_or("Terminal sequence is exhausted.")?;
    safe_integer(next)?;
    Ok(next)
}
fn safe_integer(value: u64) -> Result<(), String> {
    if value > MAX_SAFE_INTEGER {
        Err("Terminal integer exceeds the protocol safe-integer range.".into())
    } else {
        Ok(())
    }
}
fn protocol_id(value: &str, error: &'static str) -> Result<(), String> {
    if value.is_empty() || value.len() > MAX_PROTOCOL_ID_BYTES {
        Err(error.into())
    } else {
        Ok(())
    }
}
fn dimensions(c: u16, r: u16) -> Result<(), String> {
    if c == 0 || c > 1000 || r == 0 || r > 1000 {
        Err("Invalid terminal dimensions.".into())
    } else {
        Ok(())
    }
}
pub fn validate_terminal_record(record: &TerminalRecord) -> Result<(), String> {
    for value in [&record.id, &record.workspace_id] {
        if value.is_empty() || value.len() > 256 || value.contains(['\0', '/']) {
            return Err("Invalid terminal identity in terminal record.".into());
        }
    }
    if record.epoch.is_empty()
        || record.epoch.len() > MAX_RECORD_TEXT_BYTES
        || record.version.is_empty()
        || record.version.len() > MAX_RECORD_TEXT_BYTES
    {
        return Err("Invalid terminal metadata in terminal record.".into());
    }
    dimensions(record.cols, record.rows)?;
    if record.status == TerminalRunStatus::Running && record.exit_code.is_some() {
        return Err("Running terminal record has an exit code.".into());
    }
    Ok(())
}
fn validate_style(style: &BTreeMap<String, serde_json::Value>) -> Result<(), String> {
    if style.len() > MAX_STYLE_FIELDS {
        return Err("Invalid terminal style.".into());
    }
    for (key, value) in style {
        if key.len() > 64 {
            return Err("Invalid terminal style.".into());
        }
        match value {
            serde_json::Value::Bool(_) => {}
            serde_json::Value::String(value) if value.len() <= MAX_TEXT_BYTES => {}
            _ => return Err("Invalid terminal style value.".into()),
        }
    }
    Ok(())
}
fn validate_rows(rows: &[GridRow], cols: u16, style_count: usize) -> Result<usize, String> {
    if rows.len() > MAX_GRID_ROWS {
        return Err("Invalid terminal grid rows.".into());
    }
    let mut total = 0usize;
    for row in rows {
        if row.cells.len() > MAX_ROW_CELLS {
            return Err("Invalid terminal grid row.".into());
        }
        total = total
            .checked_add(row.cells.len())
            .ok_or("Invalid terminal grid cell total.")?;
        if total > MAX_GRID_CELLS {
            return Err("Invalid terminal grid cell total.".into());
        }
        let mut end = 0u16;
        for cell in &row.cells {
            if cell.text.len() > MAX_TEXT_BYTES
                || (cell.width != 1 && cell.width != 2)
                || cell.style_id >= style_count
                || cell.x < end
            {
                return Err("Invalid terminal grid cell.".into());
            }
            end = cell
                .x
                .checked_add(cell.width as u16)
                .ok_or("Invalid terminal grid cell coordinate.")?;
            if end > cols {
                return Err("Invalid terminal grid cell coordinate.".into());
            }
        }
    }
    Ok(total)
}
pub(crate) fn validate_grid(g: &TerminalGrid) -> Result<(), String> {
    if g.rows.is_empty() {
        return Err("Invalid terminal grid.".into());
    }
    dimensions(
        g.cols,
        u16::try_from(g.rows.len()).map_err(|_| "Invalid terminal grid.")?,
    )?;
    safe_integer(g.covers_output_offset)?;
    safe_integer(g.revision)?;
    safe_integer(g.start_row)?;
    safe_integer(g.total_rows)?;
    if g.revision == 0
        || g.styles.is_empty()
        || g.styles.len() > MAX_STYLES
        || g.palette.len() > MAX_PALETTE
        || g.title.len() > MAX_TEXT_BYTES
        || g.palette.iter().any(|value| value.len() > MAX_TEXT_BYTES)
        || g.start_row > g.total_rows
        || g.start_row
            .checked_add(g.rows.len() as u64)
            .is_none_or(|end| end > g.total_rows)
    {
        return Err("Invalid terminal grid.".into());
    }
    if let Some(cursor) = &g.cursor
        && (cursor.x >= g.cols || usize::from(cursor.y) >= g.rows.len())
    {
        return Err("Invalid terminal grid cursor.".into());
    }
    for style in &g.styles {
        validate_style(style)?;
    }
    validate_rows(&g.rows, g.cols, g.styles.len())?;
    Ok(())
}
fn validate_patch(patch: &GridPatch, grid: &TerminalGrid) -> Result<(), String> {
    dimensions(
        patch.cols,
        u16::try_from(grid.rows.len()).map_err(|_| "Invalid terminal grid patch.")?,
    )?;
    for value in [
        patch.base_revision,
        patch.covers_output_offset,
        patch.revision,
        patch.start_row,
        patch.total_rows,
    ] {
        safe_integer(value)?;
    }
    if patch.base_revision != grid.revision
        || patch.revision <= patch.base_revision
        || patch.styles.is_empty()
        || patch.styles.len() > MAX_STYLES
        || patch.palette.len() > MAX_PALETTE
        || patch.title.len() > MAX_TEXT_BYTES
        || patch
            .palette
            .iter()
            .any(|value| value.len() > MAX_TEXT_BYTES)
        || patch.start_row > patch.total_rows
        || patch
            .start_row
            .checked_add(grid.rows.len() as u64)
            .is_none_or(|end| end > patch.total_rows)
    {
        return Err("Invalid terminal grid patch.".into());
    }
    if let Some(cursor) = &patch.cursor
        && (cursor.x >= patch.cols || usize::from(cursor.y) >= grid.rows.len())
    {
        return Err("Invalid terminal grid cursor.".into());
    }
    for style in &patch.styles {
        validate_style(style)?;
    }
    let mut replacements = BTreeMap::new();
    for (index, row) in &patch.rows {
        safe_integer(u64::try_from(*index).map_err(|_| "Invalid terminal grid patch row.")?)?;
        if *index >= grid.rows.len() || replacements.insert(*index, row).is_some() {
            return Err("Invalid terminal grid patch row.".into());
        }
    }
    let mut total = 0usize;
    for (index, existing) in grid.rows.iter().enumerate() {
        let row = replacements.get(&index).copied().unwrap_or(existing);
        total = total
            .checked_add(validate_rows(
                std::slice::from_ref(row),
                patch.cols,
                patch.styles.len(),
            )?)
            .ok_or("Invalid terminal grid cell total.")?;
        if total > MAX_GRID_CELLS {
            return Err("Invalid terminal grid cell total.".into());
        }
    }
    Ok(())
}
fn validate_scrollback(
    page: &ScrollbackPage,
    cols: u16,
    retained_style_count: usize,
) -> Result<(), String> {
    for value in [
        page.base_row,
        page.history_revision,
        page.start,
        page.total_rows,
    ] {
        safe_integer(value)?;
    }
    protocol_id(
        &page.history_epoch,
        "Invalid terminal scrollback history epoch.",
    )?;
    if page.count == 0
        || page.count > 1000
        || page.rows.len() > page.count
        || page.base_row > page.total_rows
        || page.start > page.total_rows
        || page
            .start
            .checked_add(page.rows.len() as u64)
            .is_none_or(|end| end > page.total_rows)
    {
        return Err("Invalid terminal scrollback page.".into());
    }
    let styles = page.styles.as_deref().unwrap_or(&[]);
    if let Some(palette) = &page.palette
        && palette.iter().any(|value| value.len() > MAX_TEXT_BYTES)
    {
        return Err("Invalid terminal scrollback palette.".into());
    }
    for style in styles {
        validate_style(style)?;
    }
    // A page without a style table may contain only style zero; it uses the retained grid table.
    let style_count = page.styles.as_ref().map_or(retained_style_count, Vec::len);
    if style_count == 0 {
        return Err("Invalid terminal scrollback styles.".into());
    }
    validate_rows(&page.rows, cols, style_count)?;
    Ok(())
}
fn json<T: for<'a> Deserialize<'a>>(p: &[u8]) -> Result<T, String> {
    serde_json::from_slice(p).map_err(|_| "Invalid terminal JSON payload.".into())
}
fn encode(k: PacketType, s: u64, p: &[u8]) -> Result<Vec<u8>, String> {
    safe_integer(s)?;
    let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
    enc.write_all(p)
        .map_err(|_| "Could not compress terminal frame.")?;
    let compressed = enc
        .finish()
        .map_err(|_| "Could not compress terminal frame.")?;
    let use_compressed = p.len() >= 512 && compressed.len() + 16 < p.len();
    let body = if use_compressed {
        compressed
    } else {
        p.to_vec()
    };
    if body.len() > MAX_FRAME_BYTES {
        return Err("Remote terminal frame is too large.".into());
    }
    let mut out = Vec::with_capacity(HEADER_BYTES + body.len());
    out.extend(MAGIC.to_be_bytes());
    out.push(VERSION);
    out.push(k as u8);
    out.push(if use_compressed { COMPRESSED } else { 0 });
    out.extend([0; 3]);
    out.extend(s.to_be_bytes());
    out.extend((body.len() as u32).to_be_bytes());
    out.extend(body);
    Ok(out)
}
#[derive(Default)]
struct Decoder {
    buffer: Vec<u8>,
}
impl Decoder {
    fn push(&mut self, data: &[u8]) -> Result<Vec<Packet>, String> {
        if self
            .buffer
            .len()
            .checked_add(data.len())
            .is_none_or(|size| size > MAX_ENVELOPE_BYTES)
        {
            return Err("Remote terminal receive buffer is too large.".into());
        }
        self.buffer.extend(data);
        let mut out = Vec::new();
        while self.buffer.len() >= HEADER_BYTES {
            if out.len() >= 4096 {
                return Err("Too many remote terminal packets in one read.".into());
            }
            if u16::from_be_bytes([self.buffer[0], self.buffer[1]]) != MAGIC {
                return Err("Invalid wire magic.".into());
            }
            if self.buffer[2] != VERSION {
                return Err("Unsupported remote terminal wire version.".into());
            }
            let kind = PacketType::from(self.buffer[3])?;
            let flags = self.buffer[4];
            if flags & !COMPRESSED != 0 || self.buffer[5..8] != [0, 0, 0] {
                return Err("Invalid remote terminal wire header.".into());
            }
            let seq = u64::from_be_bytes(self.buffer[8..16].try_into().unwrap());
            safe_integer(seq)?;
            let len = u32::from_be_bytes(self.buffer[16..20].try_into().unwrap()) as usize;
            if len > MAX_FRAME_BYTES {
                return Err("Remote terminal frame is too large.".into());
            }
            if self.buffer.len() < HEADER_BYTES + len {
                break;
            }
            let encoded = self.buffer[HEADER_BYTES..HEADER_BYTES + len].to_vec();
            self.buffer.drain(..HEADER_BYTES + len);
            let payload = if flags & COMPRESSED != 0 {
                let d = DeflateDecoder::new(&encoded[..]);
                let mut v = Vec::new();
                d.take((MAX_FRAME_BYTES + 1) as u64)
                    .read_to_end(&mut v)
                    .map_err(|_| "Invalid compressed remote terminal frame.")?;
                if v.len() > MAX_FRAME_BYTES {
                    return Err("Inflated remote terminal frame is too large.".into());
                }
                v
            } else {
                encoded
            };
            out.push(Packet {
                kind,
                sequence: seq,
                payload,
            })
        }
        Ok(out)
    }
}
