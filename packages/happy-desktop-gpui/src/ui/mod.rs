pub mod chat_composer;
pub mod chat_header;
pub mod chat_markdown;
pub mod chat_message;
pub mod chat_transcript;
pub mod command_palette;
pub mod components;
pub mod composer_controls;
pub mod gallery;
pub mod icon;
pub mod icon_data;
pub mod key_cap;
pub mod metrics;
pub mod navigation;
pub mod scrollbar;
pub mod settings;
pub mod sidebar;
pub mod startup;
pub mod text_area;
pub mod text_input;
pub mod theme_roles;
pub mod workspace_lifecycle;
pub mod workspace_tabs;

pub use components::*;
pub use icon::{Icon, IconName};
pub use navigation::{Menu, MenuItem, TabItem, TabSelectHandler, Tabs, TabsSize};
pub use scrollbar::{ScrollbarAppearance, ScrollbarPlacement, ScrollbarState, SharedScrollHandle};
#[allow(unused_imports)]
pub use startup::{
    ConnectionNotice, ConnectionNoticeState, InstallProgress, InstallProgressState,
    ProfileOnboardingSurface, ProviderOnboardingSurface, StartupSurface, StartupSurfaceState,
    WELCOME_SLIDES, WelcomeDeck, WelcomeSelectHandler, WelcomeSlide,
};
pub use text_input::TextInput;

pub use command_palette::CommandPalette;
pub use settings::{SettingsCategory, SettingsShell};
pub use sidebar::{
    Sidebar, SidebarActivity, SidebarChangeStats, SidebarFold, SidebarFooter, SidebarFooterAction,
    SidebarItem, SidebarItemAvailability, SidebarItemLifecycle, SidebarRowAction, SidebarSection,
    SidebarSectionAction, SidebarUpdateAction, SidebarUpdateOperation, SidebarUpdateStatus,
    SidebarUpdateSubject,
};
