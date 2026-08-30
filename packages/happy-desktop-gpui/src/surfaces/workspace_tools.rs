use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    io::Write,
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};

use gpui::{
    App, Context, Entity, FocusHandle, IntoElement, Render, SharedString, Subscription, Window,
    div, prelude::*,
};

use super::{
    FilesInspectorSurface,
    workspace_live_tool::{ToolRuntimeEvent, ToolRuntimeEventHandler, WorkspaceToolLifetimes},
};

use crate::{
    chat::{
        ChatSnapshot, ChatStore, InspectorSelection, LoadState, ToolCreateState, ToolKind,
        ToolPlacement, ToolTabKey, WorkspaceStore, WorkspaceTab,
    },
    connectivity::{
        AgentStatus, ConnectivityController, ConversationKey, TransportOptions,
        chat_protocol::{
            BackgroundProcessStatus, CompactionBlock, CompactionTrigger, ExplorationOperation,
            FileDiffKind as ProtocolDiffFileKind, FileDiffLineKind as ProtocolDiffLineKind,
            Message, MessageBlock, RunStatus, SearchTarget, ToolCallBlock,
            ToolCallStatus as ProtocolToolStatus, ToolPresentation as ProtocolToolPresentation,
        },
    },
    theme::Theme,
    tools::OpenTerminal,
    ui::{
        Button, ButtonVariant, ControlSize, IconName, ScrollbarState,
        activity_panel::{
            ACTIVITY_PANEL_MAX_ROWS, ActivityAgent, ActivityAgentStatus, ActivityPanel,
            ActivityProcess,
        },
        agent_trace_panel::{
            AGENT_TRACE_PANEL_MAX_ENTRIES, AgentTraceEntry, AgentTraceEntryStatus, AgentTraceKind,
            AgentTracePanel, AgentTracePanelStatus,
        },
        tool_call_preview::{
            TOOL_PREVIEW_MAX_DIFF_LINES, TOOL_PREVIEW_MAX_FILES, TOOL_PREVIEW_MAX_OPERATIONS,
            TOOL_PREVIEW_MAX_SEARCH_SOURCES, TOOL_PREVIEW_MAX_TEXT_BYTES, ToolCallPresentation,
            ToolCallPreview, ToolCallPreviewData, ToolCallStatus, ToolDiffFile, ToolDiffFileKind,
            ToolDiffLine, ToolDiffLineKind, ToolExplorationKind, ToolExplorationOperation,
            ToolSearchSource, ToolSearchTarget,
        },
        usage_panel::{
            USAGE_PANEL_MAX_GROUPS, UsageContext, UsageGroup, UsagePanel, UsageSnapshot,
        },
        workspace_inspector_tabs::{
            WorkspaceInspectorTabItem, WorkspaceInspectorTabKind, WorkspaceInspectorTabMove,
            WorkspaceInspectorTabs,
        },
    },
};

/// A product action requested by the retained tools surface.
///
/// The owner performs navigation and mutations after the GPUI callback returns. This keeps the
/// props-only panels independent from stores and avoids updating a parent while it is rendering.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkspaceToolsEvent {
    CloseRequested,
    ProcessStopRequested {
        conversation: ConversationKey,
        process_id: Arc<str>,
    },
}

pub type WorkspaceToolsEventHandler = Rc<dyn Fn(WorkspaceToolsEvent, &mut App)>;

/// Caller-owned focus identities used by the props-only tools panels.
#[derive(Clone, Default)]
pub struct WorkspaceToolsFocusState {
    pub activity_completed: Option<FocusHandle>,
}

/// Caller-owned scroll identities. Keeping these outside the projection preserves position when
/// a chat snapshot is replaced, the inspector is resized, or a panel is moved.
#[derive(Clone)]
pub struct WorkspaceToolsScrollState {
    pub activity: Entity<ScrollbarState>,
    pub usage: Entity<ScrollbarState>,
    pub preview_vertical: Entity<ScrollbarState>,
    pub preview_horizontal: Entity<ScrollbarState>,
    pub preview_terminal: Entity<ScrollbarState>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ToolProjectionKey {
    run_id: Arc<str>,
    message_id: Arc<str>,
    tool_id: Arc<str>,
}

struct ToolProjection<'a> {
    key: ToolProjectionKey,
    run_status: RunStatus,
    tool: &'a ToolCallBlock,
}

#[derive(Clone)]
enum WorkspaceToolsProjection {
    Hidden,
    Files,
    LiveTool(ToolTabKey),
    Activity {
        conversation: ConversationKey,
        agents: Arc<Vec<ActivityAgent>>,
        processes: Arc<Vec<ActivityProcess>>,
    },
    Usage {
        conversation: ConversationKey,
        usage: Option<Arc<UsageSnapshot>>,
        loading: bool,
        error: Option<SharedString>,
    },
    Trace {
        run_id: SharedString,
        status: AgentTracePanelStatus,
        entries: Arc<Vec<AgentTraceEntry>>,
        entry_count: usize,
        entry_count_exact: bool,
        error: Option<SharedString>,
    },
    Preview {
        conversation: ConversationKey,
        tool_id: Option<SharedString>,
        tool: Option<Arc<ToolCallPreviewData>>,
    },
}

const WORKSPACE_INSPECTOR_MAX_TABS: usize = 256;
// Keep this admission bound aligned with the workspace store's private TOOL_LIMIT.
const WORKSPACE_TOOL_LIMIT: usize = 100;
const POPUP_CREATION_LIMIT: usize = 8;
const POPUP_CREATION_WINDOW: Duration = Duration::from_secs(10);
const HISTORY_SCAN_MAX_PAGES: usize = 64;
const HISTORY_SCAN_MAX_RUNS: usize = 512;
const HISTORY_SCAN_MAX_MESSAGES: usize = 2_000;
const HISTORY_SCAN_MAX_BLOCKS: usize = 8_000;

#[derive(Default)]
struct HistoryScanBudget {
    pages: usize,
    runs: usize,
    messages: usize,
    blocks: usize,
}

impl HistoryScanBudget {
    fn page(&mut self) -> bool {
        if self.pages >= HISTORY_SCAN_MAX_PAGES {
            return false;
        }
        self.pages += 1;
        true
    }

    fn run(&mut self) -> bool {
        if self.runs >= HISTORY_SCAN_MAX_RUNS {
            return false;
        }
        self.runs += 1;
        true
    }

    fn message(&mut self) -> bool {
        if self.messages >= HISTORY_SCAN_MAX_MESSAGES {
            return false;
        }
        self.messages += 1;
        true
    }

    fn block(&mut self) -> bool {
        if self.blocks >= HISTORY_SCAN_MAX_BLOCKS {
            return false;
        }
        self.blocks += 1;
        true
    }
}

#[derive(Clone)]
struct InspectorCloseTarget {
    key: ToolTabKey,
    next_focus: FocusHandle,
}

enum WorkspaceToolStorePlan {
    TerminalOpen {
        key: ToolTabKey,
        conversation: ConversationKey,
        attached_terminal: Option<String>,
    },
    BrowserOpen {
        key: ToolTabKey,
        conversation: ConversationKey,
        label: &'static str,
        url: Arc<str>,
        rollback_popup: bool,
    },
    PlaceInInspector(ToolTabKey),
}

#[derive(Clone)]
struct WorkspaceToolsChromeModel {
    workspace_id: SharedString,
    items: Arc<Vec<WorkspaceInspectorTabItem>>,
    selection_targets: Arc<BTreeMap<SharedString, InspectorSelection>>,
    close_targets: Arc<BTreeMap<SharedString, InspectorCloseTarget>>,
    transfer_targets: Arc<BTreeMap<SharedString, ToolTabKey>>,
    tool_conversation: Option<ConversationKey>,
    create_disabled: bool,
}

/// Retained projection for the Activity, Usage, and tool Preview inspector selections.
///
/// This entity never materializes a chat. It only observes a chat which the connectivity owner has
/// already materialized. When hidden it drops that observation and does not traverse history.
pub struct WorkspaceToolsSurface {
    workspace: Entity<WorkspaceStore>,
    files: Entity<FilesInspectorSurface>,
    connectivity: Entity<ConnectivityController>,
    theme: Theme,
    focus: WorkspaceToolsFocusState,
    scroll: WorkspaceToolsScrollState,
    on_event: WorkspaceToolsEventHandler,
    visible: bool,
    inspector_layout_visible: bool,
    completed_open: bool,
    observed_chat: Option<Entity<ChatStore>>,
    chat_subscription: Option<Subscription>,
    projection: WorkspaceToolsProjection,
    chrome: WorkspaceToolsChromeModel,
    live_tools: WorkspaceToolLifetimes,
    inspector_tab_focus: BTreeMap<SharedString, FocusHandle>,
    inspector_tab_close_focus: BTreeMap<ToolTabKey, FocusHandle>,
    inspector_tab_transfer_focus: BTreeMap<ToolTabKey, FocusHandle>,
    popup_creations: VecDeque<Instant>,
    activity_process_focus: BTreeMap<Arc<str>, FocusHandle>,
    preview_terminal_focus: Option<(SharedString, FocusHandle)>,
    attached_terminals: BTreeMap<String, ToolTabKey>,
    new_terminal_focus: FocusHandle,
    new_browser_focus: FocusHandle,
    inspector_close_focus: FocusHandle,
    available: bool,
    inspector_tabs_scrollbar: Entity<ScrollbarState>,
    trace_scrollbar: Entity<ScrollbarState>,
    native_allowed: bool,
    _workspace_subscription: Subscription,
}

impl WorkspaceToolsSurface {
    pub fn new(
        workspace: Entity<WorkspaceStore>,
        files: Entity<FilesInspectorSurface>,
        connectivity: Entity<ConnectivityController>,
        theme: Theme,
        focus: WorkspaceToolsFocusState,
        scroll: WorkspaceToolsScrollState,
        on_event: WorkspaceToolsEventHandler,
        cx: &mut Context<Self>,
    ) -> Self {
        let workspace_subscription = cx.observe(&workspace, |this, _, cx| {
            this.runtime_reconcile(cx);
            this.chrome_reconcile(cx);
            this.chat_observation_reconcile(cx);
            this.projection_reconcile(cx);
            cx.notify();
        });
        let mut this = Self {
            workspace,
            files,
            connectivity,
            theme,
            focus,
            scroll,
            on_event,
            visible: false,
            inspector_layout_visible: true,
            completed_open: false,
            observed_chat: None,
            chat_subscription: None,
            projection: WorkspaceToolsProjection::Hidden,
            chrome: WorkspaceToolsChromeModel {
                workspace_id: "workspace".into(),
                items: Arc::new(Vec::new()),
                selection_targets: Arc::new(BTreeMap::new()),
                close_targets: Arc::new(BTreeMap::new()),
                transfer_targets: Arc::new(BTreeMap::new()),
                tool_conversation: None,
                create_disabled: true,
            },
            live_tools: WorkspaceToolLifetimes::new(),
            inspector_tab_focus: BTreeMap::new(),
            inspector_tab_close_focus: BTreeMap::new(),
            inspector_tab_transfer_focus: BTreeMap::new(),
            popup_creations: VecDeque::new(),
            activity_process_focus: BTreeMap::new(),
            preview_terminal_focus: None,
            attached_terminals: BTreeMap::new(),
            new_terminal_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            new_browser_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            inspector_close_focus: cx.focus_handle().tab_index(0).tab_stop(true),
            available: false,
            inspector_tabs_scrollbar: cx.new(|_| {
                ScrollbarState::horizontal(
                    crate::ui::ScrollbarAppearance::Automatic,
                    crate::ui::ScrollbarPlacement::Overlay,
                    crate::ui::SharedScrollHandle::new(),
                )
            }),
            trace_scrollbar: cx.new(|_| {
                ScrollbarState::vertical(
                    crate::ui::ScrollbarAppearance::Automatic,
                    crate::ui::ScrollbarPlacement::BesideWhenOverflowing,
                    crate::ui::SharedScrollHandle::new(),
                )
            }),
            native_allowed: true,
            _workspace_subscription: workspace_subscription,
        };
        this.chrome_reconcile(cx);
        this.chat_observation_reconcile(cx);
        this.projection_reconcile(cx);
        this
    }

    pub fn theme_update(&mut self, theme: Theme, cx: &mut Context<Self>) {
        if self.theme != theme {
            self.theme = theme;
            self.live_tools.theme_reconcile(theme, cx);
            cx.notify();
        }
    }

    pub fn focus_update(&mut self, focus: WorkspaceToolsFocusState, cx: &mut Context<Self>) {
        self.focus = focus;
        self.projection_reconcile(cx);
        cx.notify();
    }

    pub fn scroll_update(&mut self, scroll: WorkspaceToolsScrollState, cx: &mut Context<Self>) {
        self.scroll = scroll;
        cx.notify();
    }

    pub fn visible_update(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible == visible {
            return;
        }
        self.visible = visible;
        self.runtime_reconcile(cx);
        self.chat_observation_reconcile(cx);
        self.projection_reconcile(cx);
        cx.notify();
    }

    pub fn inspector_layout_visible_update(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.inspector_layout_visible == visible {
            return;
        }
        self.inspector_layout_visible = visible;
        self.runtime_reconcile(cx);
        cx.notify();
    }

    fn tool_capacity_available(&self, cx: &App) -> bool {
        self.workspace.read(cx).snapshot().tools.len() < WORKSPACE_TOOL_LIMIT
    }

    fn popup_creation_admit(&mut self, cx: &App) -> bool {
        if !self.tool_capacity_available(cx) {
            return false;
        }
        let now = Instant::now();
        while self
            .popup_creations
            .front()
            .is_some_and(|created| now.duration_since(*created) >= POPUP_CREATION_WINDOW)
        {
            self.popup_creations.pop_front();
        }
        if self.popup_creations.len() >= POPUP_CREATION_LIMIT {
            return false;
        }
        self.popup_creations.push_back(now);
        true
    }

    fn runtime_handler(&self, cx: &Context<Self>) -> ToolRuntimeEventHandler {
        let weak = cx.entity().downgrade();
        let workspace = self.workspace.clone();
        Rc::new(move |event, cx| {
            let weak = weak.clone();
            let workspace = workspace.clone();
            cx.defer(move |cx| match event {
                ToolRuntimeEvent::Ready(key) => workspace.update(cx, |store, cx| {
                    store.tool_create_state_update(&key, ToolCreateState::Ready);
                    cx.notify();
                }),
                ToolRuntimeEvent::Failed(key, message) => workspace.update(cx, |store, cx| {
                    store.tool_create_state_update(
                        &key,
                        ToolCreateState::Failed {
                            message: Arc::from(message.as_ref()),
                        },
                    );
                    cx.notify();
                }),
                ToolRuntimeEvent::BrowserChanged {
                    key,
                    address,
                    title,
                } => workspace.update(cx, |store, cx| {
                    store.browser_tool_update(&key, address.as_ref(), title.as_ref());
                    cx.notify();
                }),
                ToolRuntimeEvent::BrowserPopup { owner, address } => {
                    let Some(surface) = weak.upgrade() else {
                        return;
                    };
                    let plan = surface.update(cx, |this, cx| {
                        let owner_conversation = this
                            .workspace
                            .read(cx)
                            .snapshot()
                            .tools
                            .get(&owner)
                            .map(|metadata| metadata.owning_conversation.clone());
                        let conversation = owner_conversation?;
                        let options = this.live_tools.browser_options(&owner, cx)?;
                        if !this.popup_creation_admit(cx) {
                            return None;
                        }
                        match this.browser_create_plan(
                            conversation,
                            options,
                            address,
                            "Browser",
                            true,
                            cx,
                        ) {
                            Some(plan) => Some(plan),
                            None => {
                                this.popup_creations.pop_back();
                                None
                            }
                        }
                    });
                    if let Some(plan) = plan {
                        Self::apply_store_plan(plan, workspace, surface.downgrade(), cx);
                    }
                }
            });
        })
    }

    fn fresh_tool_key() -> ToolTabKey {
        ToolTabKey::new(cuid2::create_id()).expect("CUID2 tool identity is nonempty")
    }

    fn terminal_create_plan(
        &mut self,
        conversation: ConversationKey,
        cx: &mut Context<Self>,
    ) -> Option<WorkspaceToolStorePlan> {
        if !self.available || !self.tool_capacity_available(cx) {
            return None;
        }
        let key = Self::fresh_tool_key();
        let request = OpenTerminal {
            mutation_id: Some(cuid2::create_id()),
            ..OpenTerminal::default()
        };
        if !self.terminal_open(key.clone(), TransportOptions::default(), request, cx) {
            return None;
        }
        Some(WorkspaceToolStorePlan::TerminalOpen {
            key,
            conversation,
            attached_terminal: None,
        })
    }

    fn terminal_attach_plan(
        &mut self,
        conversation: ConversationKey,
        terminal_id: SharedString,
        cx: &mut Context<Self>,
    ) -> Option<WorkspaceToolStorePlan> {
        if !self.available {
            return None;
        }
        if let Some(key) = self.attached_terminals.get(terminal_id.as_ref()).cloned() {
            return Some(WorkspaceToolStorePlan::PlaceInInspector(key));
        }
        if !self.tool_capacity_available(cx) {
            return None;
        }
        let key = Self::fresh_tool_key();
        if !self.live_tools.terminal_attach(
            key.clone(),
            self.theme,
            TransportOptions::default(),
            self.workspace.read(cx).snapshot().workspace.id().to_owned(),
            terminal_id.to_string(),
            self.runtime_handler(cx),
            cx,
        ) {
            return None;
        }
        Some(WorkspaceToolStorePlan::TerminalOpen {
            key,
            conversation,
            attached_terminal: Some(terminal_id.to_string()),
        })
    }

    fn browser_create_plan(
        &mut self,
        conversation: ConversationKey,
        options: TransportOptions,
        address: crate::ui::native_browser::BrowserAddress,
        label: &'static str,
        rollback_popup: bool,
        cx: &mut Context<Self>,
    ) -> Option<WorkspaceToolStorePlan> {
        if !self.available || !self.tool_capacity_available(cx) {
            return None;
        }
        let key = Self::fresh_tool_key();
        let url: Arc<str> = Arc::from(address.as_str());
        if !self.browser_open(key.clone(), options, address, cx) {
            return None;
        }
        Some(WorkspaceToolStorePlan::BrowserOpen {
            key,
            conversation,
            label,
            url,
            rollback_popup,
        })
    }

    fn apply_store_plan(
        plan: WorkspaceToolStorePlan,
        workspace: Entity<WorkspaceStore>,
        surface: gpui::WeakEntity<Self>,
        cx: &mut App,
    ) {
        match plan {
            WorkspaceToolStorePlan::PlaceInInspector(key) => {
                workspace.update(cx, |store, cx| {
                    store.tool_placement_update(&key, ToolPlacement::Inspector);
                    store.inspector_selection_update(InspectorSelection::LiveTool(key));
                    cx.notify();
                });
            }
            WorkspaceToolStorePlan::TerminalOpen {
                key,
                conversation,
                attached_terminal,
            } => {
                let inserted = workspace.update(cx, |store, cx| {
                    let inserted = store.terminal_tool_open(key.clone(), conversation, "Terminal");
                    cx.notify();
                    inserted
                });
                if inserted && attached_terminal.is_none() {
                    return;
                }
                let Some(surface) = surface.upgrade() else {
                    return;
                };
                let _ = surface.update(cx, |this, cx| {
                    if inserted {
                        if let Some(terminal_id) = attached_terminal {
                            this.attached_terminals.insert(terminal_id, key);
                        }
                    } else {
                        this.live_tools.close(&key, cx);
                    }
                    this.runtime_reconcile(cx);
                });
            }
            WorkspaceToolStorePlan::BrowserOpen {
                key,
                conversation,
                label,
                url,
                rollback_popup,
            } => {
                let inserted = workspace.update(cx, |store, cx| {
                    let inserted =
                        store.browser_tool_open(key.clone(), conversation, label, Arc::clone(&url));
                    if inserted {
                        store.tool_create_state_update(&key, ToolCreateState::Creating);
                    }
                    cx.notify();
                    inserted
                });
                if inserted {
                    return;
                }
                let Some(surface) = surface.upgrade() else {
                    return;
                };
                let _ = surface.update(cx, |this, cx| {
                    this.live_tools.close(&key, cx);
                    if rollback_popup {
                        this.popup_creations.pop_back();
                    }
                    this.runtime_reconcile(cx);
                });
            }
        }
    }

    fn runtime_reconcile(&mut self, cx: &mut Context<Self>) {
        let snapshot = self.workspace.read(cx).snapshot().clone();
        let mut retained_tab_ids = BTreeSet::from([
            SharedString::from("files"),
            SharedString::from("activity"),
            SharedString::from("usage"),
        ]);
        if matches!(
            snapshot.inspector.selection,
            InspectorSelection::Preview { .. }
        ) {
            retained_tab_ids.insert("preview".into());
        }
        if matches!(
            snapshot.inspector.selection,
            InspectorSelection::Trace { .. }
        ) {
            retained_tab_ids.insert("trace".into());
        }
        let remaining = WORKSPACE_INSPECTOR_MAX_TABS.saturating_sub(retained_tab_ids.len());
        let mut retained_tool_keys = snapshot
            .inspector
            .tool_order
            .iter()
            .take(remaining)
            .cloned()
            .collect::<BTreeSet<_>>();
        if let InspectorSelection::LiveTool(selected) = &snapshot.inspector.selection {
            retained_tool_keys.insert(selected.clone());
        }
        retained_tab_ids.extend(
            retained_tool_keys
                .iter()
                .map(|key| SharedString::from(format!("tool:{}", key.as_str()))),
        );
        for id in &retained_tab_ids {
            if !self.inspector_tab_focus.contains_key(id) {
                self.inspector_tab_focus
                    .insert(id.clone(), cx.focus_handle());
            }
        }
        self.inspector_tab_focus
            .retain(|id, _| retained_tab_ids.contains(id));
        for key in &retained_tool_keys {
            if !self.inspector_tab_close_focus.contains_key(key) {
                self.inspector_tab_close_focus
                    .insert(key.clone(), cx.focus_handle());
            }
            if !self.inspector_tab_transfer_focus.contains_key(key) {
                self.inspector_tab_transfer_focus
                    .insert(key.clone(), cx.focus_handle());
            }
        }
        self.inspector_tab_close_focus
            .retain(|key, _| retained_tool_keys.contains(key));
        self.inspector_tab_transfer_focus
            .retain(|key, _| retained_tool_keys.contains(key));
        let handler = self.runtime_handler(cx);
        let mut failures = Vec::new();
        let wanted_browser = match &snapshot.active_tab {
            Some(WorkspaceTab::Tool(key))
                if snapshot
                    .tools
                    .get(key)
                    .is_some_and(|tool| tool.placement == ToolPlacement::Main) =>
            {
                Some(key)
            }
            _ if snapshot.inspector.open => match &snapshot.inspector.selection {
                InspectorSelection::LiveTool(key) => Some(key),
                _ => None,
            },
            _ => None,
        };
        for (key, metadata) in &snapshot.tools {
            if self.live_tools.contains(key) {
                continue;
            }
            match &metadata.kind {
                ToolKind::Terminal => {
                    if !matches!(metadata.create_state, ToolCreateState::Failed { .. }) {
                        failures.push((
                            key.clone(),
                            Arc::from("Terminal sessions are not restored after restart."),
                        ));
                    }
                }
                ToolKind::Browser { url, .. } => {
                    if !self.available || wanted_browser != Some(key) {
                        continue;
                    }
                    match crate::ui::native_browser::BrowserAddress::parse(url) {
                        Ok(address) => {
                            let _ = self.live_tools.browser_open(
                                key.clone(),
                                self.theme,
                                snapshot.workspace.id().to_owned(),
                                crate::connectivity::TransportOptions::default(),
                                address,
                                handler.clone(),
                                cx,
                            );
                        }
                        Err(_) => failures.push((
                            key.clone(),
                            Arc::from("The saved browser address is invalid."),
                        )),
                    }
                }
            }
        }
        if !failures.is_empty() {
            let workspace = self.workspace.clone();
            cx.defer(move |cx| {
                workspace.update(cx, |store, cx| {
                    for (key, message) in failures {
                        store.tool_create_state_update(&key, ToolCreateState::Failed { message });
                    }
                    cx.notify();
                });
            });
        }
        let visible_key = if self.visible {
            match &snapshot.active_tab {
                Some(WorkspaceTab::Tool(key))
                    if snapshot
                        .tools
                        .get(key)
                        .is_some_and(|tool| tool.placement == ToolPlacement::Main) =>
                {
                    Some(key)
                }
                _ if snapshot.inspector.open && self.inspector_layout_visible => {
                    match &snapshot.inspector.selection {
                        InspectorSelection::LiveTool(key) => Some(key),
                        _ => None,
                    }
                }
                _ => None,
            }
        } else {
            None
        };
        self.live_tools.availability_reconcile(self.available, cx);
        self.live_tools.visibility_reconcile(
            visible_key,
            self.native_allowed && self.available,
            cx,
        );
        self.files.update(cx, |files, cx| {
            files.inspector_visible_reconcile(
                self.visible
                    && self.inspector_layout_visible
                    && snapshot.inspector.open
                    && matches!(snapshot.inspector.selection, InspectorSelection::Files),
                cx,
            )
        });
    }

    pub fn terminal_open(
        &mut self,
        key: ToolTabKey,
        options: crate::connectivity::TransportOptions,
        request: OpenTerminal,
        cx: &mut Context<Self>,
    ) -> bool {
        self.live_tools.terminal_open(
            key,
            self.theme,
            options,
            self.workspace.read(cx).snapshot().workspace.id().to_owned(),
            request,
            self.runtime_handler(cx),
            cx,
        )
    }
    pub fn browser_open(
        &mut self,
        key: ToolTabKey,
        options: crate::connectivity::TransportOptions,
        address: crate::ui::native_browser::BrowserAddress,
        cx: &mut Context<Self>,
    ) -> bool {
        self.live_tools.browser_open(
            key,
            self.theme,
            self.workspace.read(cx).snapshot().workspace.id().to_owned(),
            options,
            address,
            self.runtime_handler(cx),
            cx,
        )
    }
    pub fn live_tool(&self, key: &ToolTabKey) -> Option<gpui::AnyElement> {
        self.live_tools.element(key)
    }
    pub fn live_tool_close(&mut self, key: &ToolTabKey, cx: &mut Context<Self>) {
        self.attached_terminals
            .retain(|_, attached| attached != key);
        self.live_tools.close(key, cx);
        let workspace = self.workspace.clone();
        let key = key.clone();
        cx.defer(move |cx| {
            workspace.update(cx, |store, cx| {
                store.tool_close(&key);
                cx.notify();
            });
        });
    }
    pub fn native_allowed_update(&mut self, allowed: bool, cx: &mut Context<Self>) {
        if self.native_allowed != allowed {
            self.native_allowed = allowed;
            self.runtime_reconcile(cx);
            cx.notify();
        }
    }
    pub fn availability_update(&mut self, available: bool, cx: &mut Context<Self>) {
        if self.available != available {
            self.available = available;
            self.live_tools.availability_reconcile(available, cx);
            self.runtime_reconcile(cx);
            cx.notify();
        }
    }

    pub fn close_request(&self, cx: &mut Context<Self>) {
        let handler = self.on_event.clone();
        cx.defer(move |cx| handler(WorkspaceToolsEvent::CloseRequested, cx));
    }

    fn selected_conversation(&self, cx: &App) -> Option<ConversationKey> {
        if !self.visible {
            return None;
        }
        let snapshot = self.workspace.read(cx).snapshot();
        if !snapshot.inspector.open {
            return None;
        }
        match &snapshot.inspector.selection {
            InspectorSelection::Activity { conversation }
            | InspectorSelection::Usage { conversation }
            | InspectorSelection::Trace { conversation, .. }
            | InspectorSelection::Preview { conversation, .. } => Some(conversation.clone()),
            InspectorSelection::Files | InspectorSelection::LiveTool(_) => None,
        }
    }

    fn chrome_reconcile(&mut self, cx: &mut Context<Self>) {
        let snapshot = self.workspace.read(cx).snapshot().clone();
        let conversation = match &snapshot.inspector.selection {
            InspectorSelection::Activity { conversation }
            | InspectorSelection::Usage { conversation }
            | InspectorSelection::Trace { conversation, .. }
            | InspectorSelection::Preview { conversation, .. } => Some(conversation.clone()),
            _ => snapshot
                .activation_history
                .iter()
                .rev()
                .find_map(|tab| match tab {
                    WorkspaceTab::Conversation(key) => Some(key.clone()),
                    _ => None,
                }),
        };
        let mut selections: Vec<(SharedString, InspectorSelection)> =
            vec![("files".into(), InspectorSelection::Files)];
        if let Some(conversation) = conversation {
            selections.push((
                "activity".into(),
                InspectorSelection::Activity {
                    conversation: conversation.clone(),
                },
            ));
            selections.push(("usage".into(), InspectorSelection::Usage { conversation }));
        }
        if let selection @ InspectorSelection::Trace { .. } = &snapshot.inspector.selection {
            selections.push(("trace".into(), selection.clone()));
        }
        if let selection @ InspectorSelection::Preview { .. } = &snapshot.inspector.selection {
            selections.push(("preview".into(), selection.clone()));
        }
        let remaining = WORKSPACE_INSPECTOR_MAX_TABS.saturating_sub(selections.len());
        for key in snapshot.inspector.tool_order.iter().take(remaining) {
            selections.push((
                format!("tool:{}", key.as_str()).into(),
                InspectorSelection::LiveTool(key.clone()),
            ));
        }
        if let InspectorSelection::LiveTool(selected_key) = &snapshot.inspector.selection
            && !selections.iter().any(|(_, selection)| {
                matches!(selection, InspectorSelection::LiveTool(key) if key == selected_key)
            })
        {
            if selections.len() >= WORKSPACE_INSPECTOR_MAX_TABS {
                selections.pop();
            }
            selections.push((
                format!("tool:{}", selected_key.as_str()).into(),
                InspectorSelection::LiveTool(selected_key.clone()),
            ));
        }

        for (id, selection) in &selections {
            if !self.inspector_tab_focus.contains_key(id) {
                self.inspector_tab_focus
                    .insert(id.clone(), cx.focus_handle());
            }
            if let InspectorSelection::LiveTool(key) = selection {
                if !self.inspector_tab_close_focus.contains_key(key) {
                    self.inspector_tab_close_focus
                        .insert(key.clone(), cx.focus_handle());
                }
                if !self.inspector_tab_transfer_focus.contains_key(key) {
                    self.inspector_tab_transfer_focus
                        .insert(key.clone(), cx.focus_handle());
                }
            }
        }

        let selected_id = selections
            .iter()
            .find(|(_, selection)| *selection == snapshot.inspector.selection)
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| "files".into());
        let files_focus = self.inspector_tab_focus.get("files").cloned();
        let selected_focus = self.inspector_tab_focus.get(&selected_id).cloned();
        let mut items = Vec::with_capacity(selections.len());
        let mut selection_targets = BTreeMap::new();
        let mut close_targets = BTreeMap::new();
        let mut transfer_targets = BTreeMap::new();
        for (id, selection) in selections {
            let (label, kind, close_focus, transfer_focus) = match &selection {
                InspectorSelection::Files => (
                    SharedString::from("Files"),
                    WorkspaceInspectorTabKind::Files,
                    None,
                    None,
                ),
                InspectorSelection::Activity { .. } => (
                    "Activity".into(),
                    WorkspaceInspectorTabKind::Activity,
                    None,
                    None,
                ),
                InspectorSelection::Usage { .. } => {
                    ("Usage".into(), WorkspaceInspectorTabKind::Usage, None, None)
                }
                InspectorSelection::Trace { .. } => (
                    "Trace".into(),
                    WorkspaceInspectorTabKind::Activity,
                    None,
                    None,
                ),
                InspectorSelection::Preview { .. } => (
                    "Preview".into(),
                    WorkspaceInspectorTabKind::Preview,
                    None,
                    None,
                ),
                InspectorSelection::LiveTool(key) => {
                    let Some(metadata) = snapshot.tools.get(key) else {
                        continue;
                    };
                    let kind = match &metadata.kind {
                        ToolKind::Terminal => WorkspaceInspectorTabKind::Terminal,
                        ToolKind::Browser { .. } => WorkspaceInspectorTabKind::Browser,
                    };
                    let close_focus = self.inspector_tab_close_focus.get(key).cloned();
                    let transfer_focus = self.inspector_tab_transfer_focus.get(key).cloned();
                    let next_focus = if id == selected_id {
                        files_focus.clone()
                    } else {
                        selected_focus.clone().or_else(|| files_focus.clone())
                    };
                    if let Some(next_focus) = next_focus {
                        close_targets.insert(
                            id.clone(),
                            InspectorCloseTarget {
                                key: key.clone(),
                                next_focus,
                            },
                        );
                    }
                    transfer_targets.insert(id.clone(), key.clone());
                    (
                        metadata.label.to_string().into(),
                        kind,
                        close_focus,
                        transfer_focus,
                    )
                }
            };
            let Some(focus) = self.inspector_tab_focus.get(&id).cloned() else {
                continue;
            };
            selection_targets.insert(id.clone(), selection.clone());
            items.push(WorkspaceInspectorTabItem {
                id,
                label,
                kind,
                selected: snapshot.inspector.selection == selection,
                focus,
                close_focus,
                transfer_focus,
            });
        }
        let tool_conversation = match &snapshot.active_tab {
            Some(WorkspaceTab::Conversation(conversation)) => Some(conversation.clone()),
            _ => snapshot
                .activation_history
                .iter()
                .rev()
                .find_map(|tab| match tab {
                    WorkspaceTab::Conversation(conversation) => Some(conversation.clone()),
                    _ => None,
                }),
        };
        self.chrome = WorkspaceToolsChromeModel {
            workspace_id: snapshot.workspace.id().to_owned().into(),
            items: Arc::new(items),
            selection_targets: Arc::new(selection_targets),
            close_targets: Arc::new(close_targets),
            transfer_targets: Arc::new(transfer_targets),
            create_disabled: !self.available
                || tool_conversation.is_none()
                || snapshot.tools.len() >= WORKSPACE_TOOL_LIMIT,
            tool_conversation,
        };
    }

    fn chat_observation_reconcile(&mut self, cx: &mut Context<Self>) {
        let chat = self
            .selected_conversation(cx)
            .and_then(|conversation| self.connectivity.read(cx).chat(&conversation, cx));
        if self.observed_chat.as_ref() == chat.as_ref() {
            return;
        }
        self.chat_subscription = chat.as_ref().map(|chat| {
            cx.observe(chat, |this, _, cx| {
                this.projection_reconcile(cx);
                cx.notify();
            })
        });
        self.observed_chat = chat;
    }

    fn projection_reconcile(&mut self, cx: &mut Context<Self>) {
        let selection = if self.visible {
            let snapshot = self.workspace.read(cx).snapshot();
            snapshot
                .inspector
                .open
                .then(|| snapshot.inspector.selection.clone())
        } else {
            None
        };
        let Some(selection) = selection else {
            self.activity_process_focus.clear();
            self.preview_terminal_focus = None;
            self.projection = WorkspaceToolsProjection::Hidden;
            return;
        };
        if !matches!(selection, InspectorSelection::Activity { .. }) {
            self.activity_process_focus.clear();
        }
        if !matches!(selection, InspectorSelection::Preview { .. }) {
            self.preview_terminal_focus = None;
        }
        if matches!(selection, InspectorSelection::Files) {
            self.projection = WorkspaceToolsProjection::Files;
            return;
        }
        if let InspectorSelection::LiveTool(key) = selection {
            self.projection = WorkspaceToolsProjection::LiveTool(key);
            return;
        }
        let Some(chat) = self.observed_chat.as_ref() else {
            self.activity_process_focus.clear();
            self.preview_terminal_focus = None;
            self.projection = match selection {
                InspectorSelection::Trace { run_id, .. } => trace_unavailable(&run_id),
                _ => WorkspaceToolsProjection::Hidden,
            };
            return;
        };
        let snapshot = chat.read(cx).snapshot();
        self.projection = match selection {
            InspectorSelection::Activity { conversation } => {
                let attached = attached_terminal_ids(snapshot);
                let agents = snapshot
                    .subagents
                    .iter()
                    .take(ACTIVITY_PANEL_MAX_ROWS)
                    .map(|agent| ActivityAgent {
                        session_id: agent.id.clone().into(),
                        description: agent
                            .title
                            .clone()
                            .unwrap_or_else(|| agent.id.clone())
                            .into(),
                        task_name: None,
                        model_id: None,
                        status: if agent.archived_at.is_some() {
                            ActivityAgentStatus::Archived
                        } else {
                            match agent.status {
                                AgentStatus::Idle => ActivityAgentStatus::Idle,
                                AgentStatus::Thinking
                                | AgentStatus::Working
                                | AgentStatus::GeneratingTools
                                | AgentStatus::RunningTools => ActivityAgentStatus::Running,
                            }
                        },
                        elapsed: None,
                        total_tokens: None,
                        // There is no typed route to an agent yet, so agent rows stay inert.
                        focus_handle: None,
                    })
                    .collect::<Vec<_>>();
                let remaining_rows = ACTIVITY_PANEL_MAX_ROWS.saturating_sub(agents.len());
                let process_values = snapshot
                    .processes
                    .iter()
                    .filter(|process| {
                        process.status == BackgroundProcessStatus::Running
                            && !attached.contains(process.id.as_str())
                    })
                    .take(remaining_rows)
                    .collect::<Vec<_>>();
                let process_ids = process_values
                    .iter()
                    .map(|process| Arc::<str>::from(process.id.as_str()))
                    .collect::<Vec<_>>();
                self.activity_process_focus
                    .retain(|id, _| process_ids.iter().any(|candidate| candidate == id));
                for id in &process_ids {
                    if !self.activity_process_focus.contains_key(id) {
                        self.activity_process_focus.insert(
                            Arc::clone(id),
                            cx.focus_handle().tab_index(0).tab_stop(true),
                        );
                    }
                }
                let processes = process_values
                    .into_iter()
                    .zip(process_ids)
                    .map(|(process, id)| ActivityProcess {
                        id: process.id.clone().into(),
                        command: process.command.clone().into(),
                        cwd: None,
                        stop_focus_handle: self.activity_process_focus.get(&id).cloned(),
                    })
                    .collect();
                WorkspaceToolsProjection::Activity {
                    conversation,
                    agents: Arc::new(agents),
                    processes: Arc::new(processes),
                }
            }
            InspectorSelection::Usage { conversation } => {
                let (usage, loading, error) = project_usage(snapshot);
                WorkspaceToolsProjection::Usage {
                    conversation,
                    usage: usage.map(Arc::new),
                    loading,
                    error,
                }
            }
            InspectorSelection::Trace { run_id, .. } => project_trace(snapshot, &run_id),
            InspectorSelection::Preview {
                conversation,
                entry_id,
            } => {
                let projection = find_tool_projection(snapshot, entry_id.as_ref());
                let tool = projection.as_ref().map(tool_preview_data).map(Arc::new);
                let terminal_id = tool.as_deref().and_then(exact_terminal_id);
                if self
                    .preview_terminal_focus
                    .as_ref()
                    .map(|(retained_id, _)| retained_id)
                    != terminal_id.as_ref()
                {
                    self.preview_terminal_focus =
                        terminal_id.map(|id| (id, cx.focus_handle().tab_index(0).tab_stop(true)));
                }
                WorkspaceToolsProjection::Preview {
                    conversation,
                    tool_id: projection
                        .as_ref()
                        .map(|value| value.key.tool_id.to_string().into()),
                    tool,
                }
            }
            InspectorSelection::Files | InspectorSelection::LiveTool(_) => {
                WorkspaceToolsProjection::Hidden
            }
        };
    }
}

impl Render for WorkspaceToolsSurface {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let body = match self.projection.clone() {
            WorkspaceToolsProjection::Hidden => div().size_full().into_any_element(),
            WorkspaceToolsProjection::Files => self.files.clone().into_any_element(),
            WorkspaceToolsProjection::LiveTool(key) => {
                self.live_tools.element(&key).unwrap_or_else(|| {
                    div()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child("Tool unavailable")
                        .into_any_element()
                })
            }
            WorkspaceToolsProjection::Activity {
                conversation,
                agents,
                processes,
            } => {
                let stop_handler = self.on_event.clone();
                let completed_surface = cx.entity().downgrade();
                ActivityPanel {
                    id: format!("workspace-tools-activity:{}", conversation.id()).into(),
                    theme: self.theme,
                    goal: None,
                    tasks: Arc::new(Vec::new()),
                    agents,
                    processes,
                    completed_open: self.completed_open,
                    scrollbar: self.scroll.activity.clone(),
                    completed_focus_handle: self.focus.activity_completed.clone(),
                    on_completed_toggle: Some(Rc::new(move |open, _, cx| {
                        let surface = completed_surface.clone();
                        cx.defer(move |cx| {
                            if let Some(surface) = surface.upgrade() {
                                let _ = surface.update(cx, |this, cx| {
                                    this.completed_open = open;
                                    cx.notify();
                                });
                            }
                        });
                    })),
                    on_agent_select: None,
                    on_process_stop: Some(Rc::new(move |process_id, _, cx| {
                        let handler = stop_handler.clone();
                        let event = WorkspaceToolsEvent::ProcessStopRequested {
                            conversation: conversation.clone(),
                            process_id: Arc::from(process_id.as_ref()),
                        };
                        cx.defer(move |cx| handler(event, cx));
                    })),
                }
                .into_any_element()
            }
            WorkspaceToolsProjection::Usage {
                conversation,
                usage,
                loading,
                error,
            } => UsagePanel {
                id: format!("workspace-tools-usage:{}", conversation.id()).into(),
                theme: self.theme,
                usage,
                loading,
                error,
                compact: true,
                scrollbar: self.scroll.usage.clone(),
            }
            .into_any_element(),
            WorkspaceToolsProjection::Trace {
                run_id,
                status,
                entries,
                entry_count,
                entry_count_exact,
                error,
            } => AgentTracePanel {
                id: format!("workspace-tools-trace:{run_id}").into(),
                theme: self.theme,
                title: format!("Run {run_id}").into(),
                status,
                entries,
                entry_count,
                entry_count_exact,
                loading: false,
                error,
                scrollbar: self.trace_scrollbar.clone(),
                close_focus_handle: None,
                on_close: None,
            }
            .into_any_element(),
            WorkspaceToolsProjection::Preview {
                conversation,
                tool_id,
                tool,
            } => match (tool_id, tool) {
                (Some(tool_id), Some(tool)) => {
                    let terminal_id = exact_terminal_id(&tool);
                    let open_terminal_focus = terminal_id.as_ref().and_then(|id| {
                        self.preview_terminal_focus
                            .as_ref()
                            .and_then(|(retained_id, focus)| {
                                (retained_id == id).then(|| focus.clone())
                            })
                    });
                    let weak = cx.entity().downgrade();
                    let terminal_workspace = self.workspace.clone();
                    let on_open_terminal = terminal_id.map(|_| {
                        let conversation = conversation.clone();
                        Rc::new(
                            move |terminal_id: SharedString, _window: &mut Window, cx: &mut App| {
                                let weak = weak.clone();
                                let workspace = terminal_workspace.clone();
                                let conversation = conversation.clone();
                                cx.defer(move |cx| {
                                    let Some(surface) = weak.upgrade() else {
                                        return;
                                    };
                                    let plan = surface.update(cx, |this, cx| {
                                        this.terminal_attach_plan(conversation, terminal_id, cx)
                                    });
                                    if let Some(plan) = plan {
                                        WorkspaceToolsSurface::apply_store_plan(
                                            plan, workspace, weak, cx,
                                        );
                                    }
                                });
                            },
                        )
                            as crate::ui::tool_call_preview::ToolCallTerminalHandler
                    });
                    ToolCallPreview {
                        id: tool_id,
                        theme: self.theme,
                        tool,
                        vertical_scrollbar: self.scroll.preview_vertical.clone(),
                        horizontal_scrollbar: self.scroll.preview_horizontal.clone(),
                        terminal_scrollbar: self.scroll.preview_terminal.clone(),
                        open_terminal_focus,
                        open_terminal_disabled: !self.available,
                        on_open_terminal,
                    }
                    .into_any_element()
                }
                _ => div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child("Preview unavailable")
                    .into_any_element(),
            },
        };
        let chrome = self.chrome.clone();
        let selection_targets = Arc::clone(&chrome.selection_targets);
        let selection_workspace = self.workspace.clone();
        let on_select = Rc::new(
            move |id: SharedString, _window: &mut Window, cx: &mut App| {
                let Some(selection) = selection_targets.get(&id).cloned() else {
                    return;
                };
                let workspace = selection_workspace.clone();
                cx.defer(move |cx| {
                    workspace.update(cx, |store, cx| {
                        store.inspector_selection_update(selection);
                        cx.notify();
                    });
                });
            },
        );
        let close_targets = Arc::clone(&chrome.close_targets);
        let close_weak = cx.entity().downgrade();
        let on_close = Rc::new(move |id: SharedString, window: &mut Window, cx: &mut App| {
            let Some(target) = close_targets.get(&id) else {
                return;
            };
            target.next_focus.focus(window);
            let key = target.key.clone();
            let weak = close_weak.clone();
            cx.defer(move |cx| {
                if let Some(surface) = weak.upgrade() {
                    let _ = surface.update(cx, |this, cx| this.live_tool_close(&key, cx));
                }
            });
        });
        let transfer_targets = Arc::clone(&chrome.transfer_targets);
        let transfer_fallbacks = Arc::clone(&chrome.close_targets);
        let move_targets = Arc::clone(&chrome.transfer_targets);
        let transfer_workspace = self.workspace.clone();
        let transfer_weak = cx.entity().downgrade();
        let on_transfer = Rc::new(move |id: SharedString, window: &mut Window, cx: &mut App| {
            let Some(key) = transfer_targets.get(&id).cloned() else {
                return;
            };
            let focused = transfer_weak.upgrade().is_some_and(|surface| {
                surface.update(cx, |this, cx| this.live_tools.focus(&key, window, cx))
            });
            if !focused && let Some(target) = transfer_fallbacks.get(&id) {
                target.next_focus.focus(window);
            }
            let workspace = transfer_workspace.clone();
            cx.defer(move |cx| {
                workspace.update(cx, |store, cx| {
                    store.tool_placement_update(&key, ToolPlacement::Main);
                    cx.notify();
                })
            });
        });
        let move_workspace = self.workspace.clone();
        let on_move = Rc::new(
            move |id: SharedString,
                  direction: WorkspaceInspectorTabMove,
                  _window: &mut Window,
                  cx: &mut App| {
                let Some(key) = move_targets.get(&id).cloned() else {
                    return;
                };
                let workspace = move_workspace.clone();
                cx.defer(move |cx| {
                    workspace.update(cx, |store, cx| {
                        let target_index = {
                            let order = &store.snapshot().inspector.tool_order;
                            let Some(index) = order.iter().position(|item| item == &key) else {
                                return;
                            };
                            match direction {
                                WorkspaceInspectorTabMove::Previous => index.saturating_sub(1),
                                WorkspaceInspectorTabMove::Next => {
                                    (index + 1).min(order.len().saturating_sub(1))
                                }
                            }
                        };
                        store.inspector_tool_move(&key, target_index);
                        cx.notify();
                    });
                });
            },
        );
        let create_disabled = chrome.create_disabled;
        let terminal_weak = cx.entity().downgrade();
        let terminal_workspace = self.workspace.clone();
        let terminal_conversation = chrome.tool_conversation.clone();
        let new_terminal = Button {
            id: "inspector-new-terminal".into(),
            theme: self.theme,
            label: "New Terminal".into(),
            size: ControlSize::Small,
            variant: ButtonVariant::Ghost,
            icon: Some(IconName::Terminal),
            icon_only: true,
            disabled: create_disabled,
            force_focused: false,
            focus_handle: Some(self.new_terminal_focus.clone()),
            on_activate: Some(Rc::new(move |_, cx| {
                let weak = terminal_weak.clone();
                let workspace = terminal_workspace.clone();
                let conversation = terminal_conversation.clone();
                cx.defer(move |cx| {
                    let (Some(surface), Some(conversation)) = (weak.upgrade(), conversation) else {
                        return;
                    };
                    let plan =
                        surface.update(cx, |this, cx| this.terminal_create_plan(conversation, cx));
                    if let Some(plan) = plan {
                        WorkspaceToolsSurface::apply_store_plan(plan, workspace, weak, cx);
                    }
                });
            })),
        };
        let browser_weak = cx.entity().downgrade();
        let browser_workspace = self.workspace.clone();
        let browser_conversation = chrome.tool_conversation.clone();
        let new_browser = Button {
            id: "inspector-new-browser".into(),
            theme: self.theme,
            label: "New Browser".into(),
            size: ControlSize::Small,
            variant: ButtonVariant::Ghost,
            icon: Some(IconName::Globe),
            icon_only: true,
            disabled: create_disabled,
            force_focused: false,
            focus_handle: Some(self.new_browser_focus.clone()),
            on_activate: Some(Rc::new(move |_, cx| {
                let weak = browser_weak.clone();
                let workspace = browser_workspace.clone();
                let conversation = browser_conversation.clone();
                cx.defer(move |cx| {
                    let (Some(surface), Some(conversation)) = (weak.upgrade(), conversation) else {
                        return;
                    };
                    let Ok(address) =
                        crate::ui::native_browser::BrowserAddress::parse("about:blank")
                    else {
                        return;
                    };
                    let plan = surface.update(cx, |this, cx| {
                        this.browser_create_plan(
                            conversation,
                            TransportOptions::default(),
                            address,
                            "Browser",
                            false,
                            cx,
                        )
                    });
                    if let Some(plan) = plan {
                        WorkspaceToolsSurface::apply_store_plan(plan, workspace, weak, cx);
                    }
                });
            })),
        };
        let close_handler = self.on_event.clone();
        let close_button = Button {
            id: "inspector-close".into(),
            theme: self.theme,
            label: "Close inspector".into(),
            size: ControlSize::Small,
            variant: ButtonVariant::Ghost,
            icon: Some(IconName::Close),
            icon_only: true,
            disabled: false,
            force_focused: false,
            focus_handle: Some(self.inspector_close_focus.clone()),
            on_activate: Some(Rc::new(move |_, cx| {
                let handler = close_handler.clone();
                cx.defer(move |cx| handler(WorkspaceToolsEvent::CloseRequested, cx));
            })),
        };
        div()
            .size_full()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .child(div().flex_1().min_w_0().child(WorkspaceInspectorTabs {
                        id: format!("inspector-tabs:{}", chrome.workspace_id).into(),
                        theme: self.theme,
                        items: Arc::clone(&chrome.items),
                        scrollbar: self.inspector_tabs_scrollbar.clone(),
                        on_select,
                        on_close,
                        on_transfer,
                        on_move,
                    }))
                    .child(new_terminal)
                    .child(new_browser)
                    .child(close_button),
            )
            .child(div().flex_1().min_h_0().min_w_0().child(body))
    }
}

fn trace_unavailable(run_id: &str) -> WorkspaceToolsProjection {
    WorkspaceToolsProjection::Trace {
        run_id: run_id.to_owned().into(),
        status: AgentTracePanelStatus::Unavailable,
        entries: Arc::new(Vec::new()),
        entry_count: 0,
        entry_count_exact: true,
        error: Some("This run is unavailable in retained history.".into()),
    }
}

fn project_trace(snapshot: &ChatSnapshot, run_id: &str) -> WorkspaceToolsProjection {
    let mut scan = HistoryScanBudget::default();
    let mut exact_run = None;
    let mut lookup_exhausted = false;
    'pages: for page in &snapshot.history_pages {
        if !scan.page() {
            lookup_exhausted = true;
            break;
        }
        for run in &page.runs {
            if !scan.run() {
                lookup_exhausted = true;
                break 'pages;
            }
            if run.value.id == run_id {
                exact_run = Some(run);
                break 'pages;
            }
        }
    }
    let Some(run) = exact_run else {
        let mut projection = trace_unavailable(run_id);
        if lookup_exhausted && let WorkspaceToolsProjection::Trace { error, .. } = &mut projection {
            *error =
                Some("This exact run was not found within the retained-history scan bound.".into());
        }
        return projection;
    };

    let mut entries = Vec::with_capacity(AGENT_TRACE_PANEL_MAX_ENTRIES);
    let mut entry_count = 0usize;
    let mut detail_budget = TOOL_PREVIEW_MAX_TEXT_BYTES;
    let mut detail_truncated = false;
    let content_limit =
        AGENT_TRACE_PANEL_MAX_ENTRIES.saturating_sub(usize::from(run.value.ended_at.is_some()));

    entry_count += 1;
    entries.push(AgentTraceEntry {
        id: format!("run:{}:started", run.value.id).into(),
        kind: AgentTraceKind::Status,
        title: "Run started".into(),
        detail: None,
        status: AgentTraceEntryStatus::Complete,
        occurred_at: run.value.started_at,
        completed_at: None,
    });

    let mut scan_exhausted = false;
    'messages: for message in &run.messages {
        if !scan.message() {
            scan_exhausted = true;
            break;
        }
        let Message::Agent(message) = message.as_ref() else {
            continue;
        };
        for (block_index, block) in message.content.iter().enumerate() {
            if !scan.block() {
                scan_exhausted = true;
                break 'messages;
            }
            let eligible = matches!(
                block,
                MessageBlock::Reasoning { .. }
                    | MessageBlock::Text { .. }
                    | MessageBlock::ToolCallRequest { .. }
                    | MessageBlock::ToolCall(_)
                    | MessageBlock::Compaction(_)
            );
            if !eligible {
                continue;
            }
            entry_count = entry_count.saturating_add(1);
            if entries.len() >= content_limit {
                continue;
            }

            let ordinary_id = || format!("block:{}:{block_index}", message.id).into();
            let entry = match block {
                MessageBlock::Reasoning { text } => AgentTraceEntry {
                    id: ordinary_id(),
                    kind: AgentTraceKind::Reasoning,
                    title: "Reasoning".into(),
                    detail: trace_detail(text, &mut detail_budget, &mut detail_truncated),
                    status: AgentTraceEntryStatus::Complete,
                    occurred_at: message.created_at,
                    completed_at: None,
                },
                MessageBlock::Text { text } => AgentTraceEntry {
                    id: ordinary_id(),
                    kind: AgentTraceKind::Response,
                    title: "Response".into(),
                    detail: trace_detail(text, &mut detail_budget, &mut detail_truncated),
                    status: AgentTraceEntryStatus::Complete,
                    occurred_at: message.created_at,
                    completed_at: None,
                },
                MessageBlock::ToolCallRequest { name, arguments } => AgentTraceEntry {
                    id: ordinary_id(),
                    kind: AgentTraceKind::Tool,
                    title: trace_text(
                        &format!("Request {name}"),
                        &mut detail_budget,
                        &mut detail_truncated,
                    ),
                    detail: trace_detail(
                        &json_object(Some(arguments)),
                        &mut detail_budget,
                        &mut detail_truncated,
                    ),
                    status: AgentTraceEntryStatus::Complete,
                    occurred_at: message.created_at,
                    completed_at: None,
                },
                MessageBlock::ToolCall(tool) => AgentTraceEntry {
                    id: format!("tool:{}", tool.id).into(),
                    kind: AgentTraceKind::Tool,
                    title: trace_text(&tool.name, &mut detail_budget, &mut detail_truncated),
                    detail: tool.result.as_ref().and_then(|result| {
                        trace_detail(
                            &json_object(Some(result)),
                            &mut detail_budget,
                            &mut detail_truncated,
                        )
                    }),
                    status: match (tool.status, run.value.status) {
                        (ProtocolToolStatus::Running, RunStatus::Aborted) => {
                            AgentTraceEntryStatus::Stopped
                        }
                        (ProtocolToolStatus::Running, _) => AgentTraceEntryStatus::Running,
                        (ProtocolToolStatus::Completed, _) => AgentTraceEntryStatus::Complete,
                        (ProtocolToolStatus::Failed, _) => AgentTraceEntryStatus::Failed,
                    },
                    occurred_at: message.created_at,
                    completed_at: None,
                },
                MessageBlock::Compaction(compaction) => {
                    let (status, occurred_at, completed_at, detail) =
                        compaction_trace(compaction, run.value.status);
                    AgentTraceEntry {
                        id: ordinary_id(),
                        kind: AgentTraceKind::Status,
                        title: "Compaction".into(),
                        detail: trace_detail(&detail, &mut detail_budget, &mut detail_truncated),
                        status,
                        occurred_at,
                        completed_at,
                    }
                }
                MessageBlock::Image { .. } => unreachable!("images are not eligible trace blocks"),
            };
            entries.push(entry);
        }
    }

    if let Some(ended_at) = run.value.ended_at {
        entry_count = entry_count.saturating_add(1);
        if entries.len() < AGENT_TRACE_PANEL_MAX_ENTRIES {
            entries.push(AgentTraceEntry {
                id: format!("run:{}:ended", run.value.id).into(),
                kind: AgentTraceKind::Status,
                title: "Run ended".into(),
                detail: None,
                status: match run.value.status {
                    RunStatus::Running => AgentTraceEntryStatus::Running,
                    RunStatus::Completed => AgentTraceEntryStatus::Complete,
                    RunStatus::Aborted => AgentTraceEntryStatus::Stopped,
                    RunStatus::Failed => AgentTraceEntryStatus::Failed,
                },
                occurred_at: ended_at,
                completed_at: Some(ended_at),
            });
        }
    }

    let mut notices = Vec::new();
    if scan_exhausted {
        notices.push(format!(
            "Showing {} of at least {entry_count} trace entries; history scanning is bounded.",
            entries.len()
        ));
    } else if entry_count > entries.len() {
        notices.push(format!(
            "Trace has {entry_count} entries; showing the first {}.",
            entries.len()
        ));
    }
    if detail_truncated {
        notices.push(format!(
            "Trace detail is bounded at {TOOL_PREVIEW_MAX_TEXT_BYTES} bytes."
        ));
    }

    if !notices.is_empty()
        && let Some(started) = entries.first_mut()
    {
        started.detail = Some(notices.join(" ").into());
    }

    WorkspaceToolsProjection::Trace {
        run_id: run.value.id.clone().into(),
        status: match run.value.status {
            RunStatus::Running => AgentTracePanelStatus::Running,
            RunStatus::Completed => AgentTracePanelStatus::Complete,
            RunStatus::Aborted => AgentTracePanelStatus::Aborted,
            RunStatus::Failed => AgentTracePanelStatus::Failed,
        },
        entries: Arc::new(entries),
        entry_count,
        entry_count_exact: !scan_exhausted,
        error: None,
    }
}

fn trace_text(value: &str, remaining: &mut usize, truncated: &mut bool) -> SharedString {
    if value.is_empty() {
        return "".into();
    }
    if *remaining == 0 {
        *truncated = true;
        return "".into();
    }
    let mut end = value.len().min(*remaining);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    *remaining -= end;
    if end < value.len() {
        *truncated = true;
    }
    value[..end].to_owned().into()
}

fn trace_detail(value: &str, remaining: &mut usize, truncated: &mut bool) -> Option<SharedString> {
    if value.is_empty() {
        return None;
    }
    let text = trace_text(value, remaining, truncated);
    (!text.is_empty()).then_some(text)
}

fn compaction_trace(
    compaction: &CompactionBlock,
    run_status: RunStatus,
) -> (AgentTraceEntryStatus, i64, Option<i64>, String) {
    match compaction {
        CompactionBlock::Running {
            trigger,
            started_at,
            tokens_before,
            ..
        } => (
            if run_status == RunStatus::Aborted {
                AgentTraceEntryStatus::Stopped
            } else {
                AgentTraceEntryStatus::Running
            },
            *started_at,
            None,
            compaction_detail(*trigger, *tokens_before, None, None),
        ),
        CompactionBlock::Completed {
            trigger,
            started_at,
            completed_at,
            tokens_before,
            tokens_after,
            ..
        } => (
            AgentTraceEntryStatus::Complete,
            *started_at,
            Some(*completed_at),
            compaction_detail(*trigger, *tokens_before, *tokens_after, None),
        ),
        CompactionBlock::Failed {
            trigger,
            started_at,
            completed_at,
            tokens_before,
            failure_reason,
            ..
        } => (
            AgentTraceEntryStatus::Failed,
            *started_at,
            Some(*completed_at),
            compaction_detail(
                *trigger,
                *tokens_before,
                None,
                Some(failure_reason.as_str()),
            ),
        ),
    }
}

fn compaction_detail(
    trigger: CompactionTrigger,
    tokens_before: Option<u64>,
    tokens_after: Option<u64>,
    failure_reason: Option<&str>,
) -> String {
    let trigger = match trigger {
        CompactionTrigger::Manual => "manual",
        CompactionTrigger::Automatic => "automatic",
    };
    if let Some(reason) = failure_reason {
        return format!("{trigger} · {reason}");
    }
    match (tokens_before, tokens_after) {
        (Some(before), Some(after)) => format!("{trigger} · {before} → {after} tokens"),
        (Some(before), None) => format!("{trigger} · {before} tokens before"),
        _ => trigger.to_owned(),
    }
}

fn project_usage(snapshot: &ChatSnapshot) -> (Option<UsageSnapshot>, bool, Option<SharedString>) {
    let loading = matches!(snapshot.load, LoadState::Initial | LoadState::Loading);
    let mut error = match &snapshot.load {
        LoadState::Error { message } => Some(SharedString::from(message.to_string())),
        LoadState::Initial | LoadState::Loading | LoadState::Ready => None,
    };
    let usage = matches!(snapshot.load, LoadState::Ready).then(|| {
        let mut total_tokens = 0u64;
        let mut groups = Vec::new();
        let mut truncated = false;
        'providers: for (provider_id, models) in snapshot.usage.iter() {
            for (model_id, usage) in models {
                if groups.len() >= USAGE_PANEL_MAX_GROUPS {
                    truncated = true;
                    break 'providers;
                }
                let total = usage
                    .input
                    .saturating_add(usage.output)
                    .saturating_add(usage.cache_read)
                    .saturating_add(usage.cache_write);
                total_tokens = total_tokens.saturating_add(total);
                groups.push(UsageGroup {
                    provider_id: provider_id.clone().into(),
                    model_id: model_id.clone().into(),
                    input_tokens: usage.input,
                    output_tokens: usage.output,
                    cache_read_tokens: usage.cache_read,
                    cache_write_tokens: usage.cache_write,
                    total_tokens: total,
                    cost_usd: None,
                });
            }
        }
        if truncated {
            error =
                Some("Usage groups are truncated; totals cover only the displayed groups.".into());
        }
        UsageSnapshot {
            groups,
            total_tokens,
            total_cost_usd: None,
            context: snapshot.context.as_ref().map(|context| UsageContext {
                total_tokens: context.context_tokens,
                approximate: context.approximate,
                model_id: context.model_id.clone().map(Into::into),
            }),
            quotas: Vec::new(),
        }
    });
    (usage, loading, error)
}

fn attached_terminal_ids(snapshot: &ChatSnapshot) -> std::collections::BTreeSet<String> {
    let mut ids = std::collections::BTreeSet::new();
    let mut scan = HistoryScanBudget::default();
    'pages: for page in snapshot.history_pages.iter().rev() {
        if !scan.page() {
            break;
        }
        for run in page.runs.iter().rev() {
            if !scan.run() {
                break 'pages;
            }
            for message in run.messages.iter().rev() {
                if !scan.message() {
                    break 'pages;
                }
                let content = match message.as_ref() {
                    Message::User(value) => &value.content,
                    Message::Agent(value) | Message::System(value) | Message::Service(value) => {
                        &value.content
                    }
                };
                for block in content {
                    if !scan.block() {
                        break 'pages;
                    }
                    let MessageBlock::ToolCall(tool) = block else {
                        continue;
                    };
                    match tool.presentation.as_ref() {
                        Some(ProtocolToolPresentation::ExecCommand {
                            terminal_id: Some(terminal_id),
                            ..
                        })
                        | Some(ProtocolToolPresentation::BackgroundTerminalInteraction {
                            terminal_id,
                            ..
                        }) => {
                            ids.insert(terminal_id.clone());
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    ids
}

fn find_tool_projection<'a>(
    snapshot: &'a ChatSnapshot,
    entry_id: &str,
) -> Option<ToolProjection<'a>> {
    let mut scan = HistoryScanBudget::default();
    'pages: for page in snapshot.history_pages.iter().rev() {
        if !scan.page() {
            break;
        }
        for run in page.runs.iter().rev() {
            if !scan.run() {
                break 'pages;
            }
            for message in run.messages.iter().rev() {
                if !scan.message() {
                    break 'pages;
                }
                let (message_id, content) = match message.as_ref() {
                    Message::User(value) => (&value.id, &value.content),
                    Message::Agent(value) | Message::System(value) | Message::Service(value) => {
                        (&value.id, &value.content)
                    }
                };
                for block in content.iter().rev() {
                    if !scan.block() {
                        break 'pages;
                    }
                    let MessageBlock::ToolCall(tool) = block else {
                        continue;
                    };
                    if tool.id == entry_id {
                        return Some(ToolProjection {
                            key: ToolProjectionKey {
                                run_id: Arc::from(run.value.id.as_str()),
                                message_id: Arc::from(message_id.as_str()),
                                tool_id: Arc::from(tool.id.as_str()),
                            },
                            run_status: run.value.status,
                            tool,
                        });
                    }
                }
            }
        }
    }
    None
}

fn exact_terminal_id(tool: &ToolCallPreviewData) -> Option<SharedString> {
    match &tool.presentation {
        ToolCallPresentation::ExecCommand {
            terminal_id: Some(terminal_id),
            ..
        }
        | ToolCallPresentation::BackgroundTerminalInteraction { terminal_id, .. } => {
            Some(terminal_id.clone())
        }
        _ => None,
    }
}

fn tool_preview_data(projection: &ToolProjection<'_>) -> ToolCallPreviewData {
    let tool = projection.tool;
    let status = match (tool.status, projection.run_status) {
        (ProtocolToolStatus::Running, RunStatus::Aborted) => ToolCallStatus::Stopped,
        (ProtocolToolStatus::Running, _) => ToolCallStatus::Running,
        (ProtocolToolStatus::Completed, _) => ToolCallStatus::Completed,
        (ProtocolToolStatus::Failed, _) => ToolCallStatus::Failed,
    };
    let presentation = tool
        .presentation
        .as_ref()
        .map(project_presentation)
        .unwrap_or_else(|| ToolCallPresentation::Generic {
            arguments_json: json_object(tool.arguments.as_ref()).into(),
        });
    let result = tool
        .result
        .as_ref()
        .map(|value| SharedString::from(json_object(Some(value))));
    let (result, failure) = if status == ToolCallStatus::Failed {
        (None, result)
    } else {
        (result, None)
    };
    ToolCallPreviewData {
        tool_name: tool.name.clone().into(),
        tool_label: tool.name.clone().into(),
        status,
        presentation,
        result,
        failure,
    }
}

fn combined_omitted_count(authoritative: Option<u64>, local: usize) -> Option<u64> {
    if authoritative.is_none() && local == 0 {
        return None;
    }
    Some(
        authoritative
            .unwrap_or_default()
            .saturating_add(u64::try_from(local).unwrap_or(u64::MAX)),
    )
}

fn project_presentation(value: &ProtocolToolPresentation) -> ToolCallPresentation {
    let mut text_budget = TOOL_PREVIEW_MAX_TEXT_BYTES;
    match value {
        ProtocolToolPresentation::Exploration { operations } => ToolCallPresentation::Exploration {
            operations: operations
                .iter()
                .take(TOOL_PREVIEW_MAX_OPERATIONS)
                .map(|operation| match operation {
                    ExplorationOperation::List { target } => ToolExplorationOperation {
                        kind: ToolExplorationKind::List,
                        target: bounded_text(target, &mut text_budget),
                    },
                    ExplorationOperation::Read { name } => ToolExplorationOperation {
                        kind: ToolExplorationKind::Read,
                        target: bounded_text(name, &mut text_budget),
                    },
                    ExplorationOperation::Search {
                        command,
                        path,
                        query,
                    } => ToolExplorationOperation {
                        kind: ToolExplorationKind::Search,
                        target: bounded_text(
                            &[Some(command.as_str()), path.as_deref(), query.as_deref()]
                                .into_iter()
                                .flatten()
                                .collect::<Vec<_>>()
                                .join(" · "),
                            &mut text_budget,
                        ),
                    },
                })
                .collect(),
            omitted_operations: combined_omitted_count(
                None,
                operations.len().saturating_sub(TOOL_PREVIEW_MAX_OPERATIONS),
            ),
        },
        ProtocolToolPresentation::ExecCommand {
            command,
            output,
            terminal_id,
        } => ToolCallPresentation::ExecCommand {
            command: bounded_text(command, &mut text_budget),
            output: bounded_text(output.as_deref().unwrap_or_default(), &mut text_budget),
            terminal_id: terminal_id.clone().map(Into::into),
        },
        ProtocolToolPresentation::BackgroundTerminalInteraction {
            command,
            input,
            terminal_id,
        } => ToolCallPresentation::BackgroundTerminalInteraction {
            command: bounded_text(command, &mut text_budget),
            input: bounded_text(input, &mut text_budget),
            terminal_id: terminal_id.clone().into(),
        },
        ProtocolToolPresentation::FileDiff {
            files,
            omitted_files,
        } => ToolCallPresentation::FileDiff {
            files: files
                .iter()
                .take(TOOL_PREVIEW_MAX_FILES)
                .map(|file| {
                    let path = bounded_text(&file.path, &mut text_budget);
                    let language = file
                        .language
                        .as_deref()
                        .map(|language| bounded_text(language, &mut text_budget));
                    let source_line_count = file
                        .hunks
                        .iter()
                        .fold(0usize, |count, hunk| count.saturating_add(hunk.lines.len()));
                    let mut lines = Vec::new();
                    for hunk in &file.hunks {
                        if lines.len() >= TOOL_PREVIEW_MAX_DIFF_LINES {
                            break;
                        }
                        let mut old = hunk.old_start;
                        let mut new = hunk.new_start;
                        for line in &hunk.lines {
                            if lines.len() >= TOOL_PREVIEW_MAX_DIFF_LINES {
                                break;
                            }
                            let (kind, old_number, new_number) = match line.kind {
                                ProtocolDiffLineKind::Add => {
                                    let line_new = new;
                                    new = new.saturating_add(1);
                                    (ToolDiffLineKind::Add, None, Some(line_new))
                                }
                                ProtocolDiffLineKind::Delete => {
                                    let line_old = old;
                                    old = old.saturating_add(1);
                                    (ToolDiffLineKind::Delete, Some(line_old), None)
                                }
                                ProtocolDiffLineKind::Context => {
                                    let line_old = old;
                                    let line_new = new;
                                    old = old.saturating_add(1);
                                    new = new.saturating_add(1);
                                    (ToolDiffLineKind::Context, Some(line_old), Some(line_new))
                                }
                            };
                            lines.push(ToolDiffLine {
                                kind,
                                old_number: old_number
                                    .map(|number| u32::try_from(number.max(0)).unwrap_or(u32::MAX)),
                                new_number: new_number
                                    .map(|number| u32::try_from(number.max(0)).unwrap_or(u32::MAX)),
                                text: bounded_text(&line.text, &mut text_budget),
                            });
                        }
                    }
                    ToolDiffFile {
                        path,
                        kind: match file.kind {
                            ProtocolDiffFileKind::Add => ToolDiffFileKind::Add,
                            ProtocolDiffFileKind::Delete => ToolDiffFileKind::Delete,
                            ProtocolDiffFileKind::Update => ToolDiffFileKind::Update,
                        },
                        language,
                        added: u32::try_from(file.added).unwrap_or(u32::MAX),
                        deleted: u32::try_from(file.deleted).unwrap_or(u32::MAX),
                        omitted_lines: combined_omitted_count(
                            file.omitted_lines,
                            source_line_count.saturating_sub(lines.len()),
                        ),
                        lines,
                    }
                })
                .collect(),
            omitted_files: combined_omitted_count(
                *omitted_files,
                files.len().saturating_sub(TOOL_PREVIEW_MAX_FILES),
            ),
        },
        ProtocolToolPresentation::Search {
            query,
            sources,
            target,
        } => ToolCallPresentation::Search {
            query: bounded_text(query, &mut text_budget),
            target: match target {
                SearchTarget::Web => ToolSearchTarget::Web,
                SearchTarget::X => ToolSearchTarget::X,
            },
            sources: sources
                .as_deref()
                .unwrap_or_default()
                .iter()
                .take(TOOL_PREVIEW_MAX_SEARCH_SOURCES)
                .map(|source| ToolSearchSource {
                    title: bounded_text(&source.title, &mut text_budget),
                    url: bounded_text(&source.url, &mut text_budget),
                })
                .collect(),
            omitted_sources: combined_omitted_count(
                None,
                sources
                    .as_deref()
                    .unwrap_or_default()
                    .len()
                    .saturating_sub(TOOL_PREVIEW_MAX_SEARCH_SOURCES),
            ),
        },
    }
}

fn bounded_text(value: &str, remaining: &mut usize) -> SharedString {
    if *remaining == 0 {
        return "".into();
    }
    let mut end = value.len().min(*remaining);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    *remaining = (*remaining).saturating_sub(end);
    if end == value.len() {
        value.to_owned().into()
    } else {
        *remaining = 0;
        format!(
            "{}
… tool preview text limit reached",
            &value[..end]
        )
        .into()
    }
}

fn json_object(value: Option<&std::collections::BTreeMap<String, serde_json::Value>>) -> String {
    struct BoundedJsonWriter {
        bytes: Vec<u8>,
        limit: usize,
    }
    impl Write for BoundedJsonWriter {
        fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
            let remaining = self.limit.saturating_sub(self.bytes.len());
            if input.len() > remaining {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "tool preview JSON exceeds its bound",
                ));
            }
            self.bytes.extend_from_slice(input);
            Ok(input.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let empty = BTreeMap::new();
    let mut writer = BoundedJsonWriter {
        bytes: Vec::with_capacity(TOOL_PREVIEW_MAX_TEXT_BYTES.min(16 * 1024)),
        limit: TOOL_PREVIEW_MAX_TEXT_BYTES,
    };
    if serde_json::to_writer_pretty(&mut writer, value.unwrap_or(&empty)).is_err() {
        return format!(
            "Tool data exceeds the {}-byte preview limit.",
            TOOL_PREVIEW_MAX_TEXT_BYTES
        );
    }
    String::from_utf8(writer.bytes).unwrap_or_else(|_| "{}".to_owned())
}
