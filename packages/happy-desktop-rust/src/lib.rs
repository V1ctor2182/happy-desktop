pub mod components;
pub mod design;
pub mod host;
pub mod state;

use components::app_shell::AppShell;
use gpui::{Context, IntoElement, Render, ScrollHandle, Task, Window};
use host::{AuthenticatedClient, HostRuntime};
use state::conversation::ConversationState;
use state::runtime::RuntimeSnapshot;

pub struct HappyApp {
    pub dark: bool,
    pub selected_rail: usize,
    pub selected_sidebar: usize,
    pub runtime: RuntimeSnapshot,
    pub conversation: ConversationState,
    conversation_scroll: ScrollHandle,
    sidebar_scroll: ScrollHandle,
    client: Option<AuthenticatedClient>,
    conversation_generation: u64,
    _conversation_task: Option<Task<()>>,
    _runtime_task: Option<Task<()>>,
}

impl Default for HappyApp {
    fn default() -> Self {
        Self {
            dark: false,
            selected_rail: 0,
            selected_sidebar: 1,
            runtime: RuntimeSnapshot::fixture(),
            conversation: ConversationState::Fixture,
            conversation_scroll: ScrollHandle::new(),
            sidebar_scroll: ScrollHandle::new(),
            client: None,
            conversation_generation: 0,
            _conversation_task: None,
            _runtime_task: None,
        }
    }
}

impl HappyApp {
    /// Creates the production root and resolves the native daemon host away from the UI thread.
    pub fn connected(cx: &mut Context<Self>) -> Self {
        let task = cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async {
                    HostRuntime::connect().and_then(|host| {
                        let client = host.client();
                        host.bootstrap().map(|bootstrap| (client, bootstrap))
                    })
                })
                .await;
            let _ = this.update(cx, |app, cx| {
                app.runtime = match result {
                    Ok((client, snapshot)) => {
                        app.client = Some(client);
                        app.conversation = ConversationState::Empty;
                        RuntimeSnapshot::online(snapshot)
                    }
                    Err(error) => RuntimeSnapshot::error(error.to_string()),
                };
                cx.notify();
            });
        });
        Self {
            runtime: RuntimeSnapshot::connecting(),
            _runtime_task: Some(task),
            ..Self::default()
        }
    }

    pub fn sidebar_select(&mut self, index: usize, item_id: String, cx: &mut Context<Self>) {
        self.selected_sidebar = index;
        let Some(agent_id) = item_id.strip_prefix("agent/") else {
            self.conversation_generation += 1;
            self.conversation = ConversationState::Empty;
            cx.notify();
            return;
        };
        let Some(client) = self.client.clone() else {
            self.conversation = ConversationState::Error("Happy Agent is unavailable.".into());
            cx.notify();
            return;
        };
        self.conversation_generation += 1;
        let generation = self.conversation_generation;
        let agent_id = agent_id.to_owned();
        self.conversation = ConversationState::Loading;
        self._conversation_task = Some(cx.spawn(async move |this, cx| {
            let loaded = cx
                .background_executor()
                .spawn(async move { client.conversation(&agent_id) })
                .await;
            let _ = this.update(cx, |app, cx| {
                if app.conversation_generation != generation {
                    return;
                }
                app.conversation = match loaded {
                    Ok(snapshot) => ConversationState::Ready(snapshot.into()),
                    Err(error) => ConversationState::Error(error.to_string().into()),
                };
                cx.notify();
            });
        }));
        cx.notify();
    }
}

impl Render for HappyApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        AppShell::new(
            self.dark,
            self.selected_rail,
            self.selected_sidebar,
            self.runtime.clone(),
            self.conversation.clone(),
            self.conversation_scroll.clone(),
            self.sidebar_scroll.clone(),
        )
        .render(window, cx)
    }
}
