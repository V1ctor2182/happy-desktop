//! Authenticated local Happy Agent transport.

pub mod installer;
pub mod protocol;
pub mod state;
pub mod transport;

pub use protocol::*;
pub use state::*;
pub use transport::{
    HostTransport, TransportOptions, UserError, UserErrorKind, WorkerEvent, start_host_transport,
};
