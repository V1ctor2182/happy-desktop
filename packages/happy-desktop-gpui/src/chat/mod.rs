//! Framework-neutral state for the Phase 5 chat work loop.
//!
//! Stores in this module own immutable snapshots and local intent only. They do
//! not open transports, timers, subscriptions, authentication, or UI entities.

mod persistence;
mod projection;
mod store;
mod workspace;

pub use persistence::WorkspacePersistence;
pub(crate) use persistence::WorkspacePersistenceEvent;
pub use projection::*;
pub use store::*;
pub use workspace::{
    AsyncActionState, ClientConversationId, FileTabKey, FileTabPresentation, MutationId,
    ScrollAnchor, SessionArchiveOperation, SessionArchiveState, ToolTabKey, TranscriptMemory,
    TranscriptRowId, WorkspaceBehavior, WorkspaceOutput, WorkspaceSnapshot, WorkspaceStore,
    WorkspaceTab,
};
