//! Product-facing stable GPUI surfaces.

mod chat_workspace;
mod file_presentation_services;
mod files_inspector;
mod workspace_live_tool;
mod workspace_tools;

pub use chat_workspace::*;
pub(crate) use file_presentation_services::*;
pub use files_inspector::*;
pub use workspace_tools::*;
