pub mod components;
pub mod design;
pub mod host;
pub mod state;

use components::app_shell::AppShell;
use gpui::{Context, IntoElement, Render, Task, Window};
use host::HostRuntime;
use state::runtime::RuntimeSnapshot;

pub struct HappyApp {
    pub dark: bool,
    pub selected_rail: usize,
    pub selected_sidebar: usize,
    pub runtime: RuntimeSnapshot,
    _runtime_task: Option<Task<()>>,
}

impl Default for HappyApp {
    fn default() -> Self {
        Self {
            dark: false,
            selected_rail: 0,
            selected_sidebar: 1,
            runtime: RuntimeSnapshot::fixture(),
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
                .spawn(async { HostRuntime::connect().map(|host| host.bootstrap()) })
                .await;
            let _ = this.update(cx, |app, cx| {
                app.runtime = match result {
                    Ok(Ok(snapshot)) => RuntimeSnapshot::online(snapshot),
                    Ok(Err(error)) | Err(error) => RuntimeSnapshot::error(error.to_string()),
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
}

impl Render for HappyApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        AppShell::new(
            self.dark,
            self.selected_rail,
            self.selected_sidebar,
            self.runtime.clone(),
        )
        .render(window, cx)
    }
}
