//! Native host boundary for Happy Agent.
//!
//! The GPUI surface never receives a daemon socket, bearer token, or process handle. Those stay
//! behind [`AuthenticatedClient`], an in-process capability checked on every operation.

mod http;
mod paths;
mod runtime;

pub use runtime::{AuthenticatedClient, HostError, HostRuntime};
