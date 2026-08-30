//! Framework-neutral state for chat and stable workspace-owned tool metadata.
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
    AsyncActionState, ClientConversationId, DEFAULT_INSPECTOR_WIDTH_PX, FileTabKey,
    FileTabPresentation, InspectorSelection, InspectorSnapshot, MAX_INSPECTOR_WIDTH_PX,
    MIN_INSPECTOR_WIDTH_PX, MutationId, ScrollAnchor, SessionArchiveOperation, SessionArchiveState,
    ToolCreateState, ToolKind, ToolMetadata, ToolPlacement, ToolTabKey, TranscriptMemory,
    TranscriptRowId, WorkspaceBehavior, WorkspaceOutput, WorkspaceSnapshot, WorkspaceStore,
    WorkspaceTab,
};
