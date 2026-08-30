//! Authenticated local Happy Agent transport.

pub mod catalog;
pub mod chat_protocol;
mod chat_state;
pub mod chat_transport;
pub mod installer;
pub mod protocol;
pub mod state;
pub mod transport;

pub use crate::files::*;
pub use catalog::*;
pub use chat_state::{ChatProtocolLimitations, CreatedChatNavigation};
pub use chat_transport::*;
pub use protocol::*;
pub use state::*;

pub use transport::{
    HostTransport, TransportOptions, UserError, UserErrorKind, WorkerEvent, start_host_transport,
};
