//! Terminal protocol, daemon transport, and stable session state.

pub mod browser_proxy;
pub mod protocol;
pub mod session;
pub mod transport;

#[allow(unused_imports)]
pub use protocol::{TerminalColorScheme, TerminalGrid, TerminalRecord};
#[allow(unused_imports)]
pub use session::{TerminalSession, TerminalSnapshot, TerminalStatus};
#[allow(unused_imports)]
pub use transport::{OpenTerminal, TerminalTransport};
