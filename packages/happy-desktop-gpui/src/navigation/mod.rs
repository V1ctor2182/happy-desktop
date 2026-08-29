//! Typed, app-owned native navigation.

mod history;
mod palette_projection;
mod persistence;
mod route;
mod sidebar_memory;

pub use history::NavigationHistory;
pub use palette_projection::{PaletteCommand, PaletteMatch, PaletteSection, palette_matches};
pub use persistence::HistoryPersistence;
pub use route::{FileKind, FilePath, GroupId, Route, SessionId, SettingsSection};
pub use sidebar_memory::{PinnedDestination, SidebarMemory};
