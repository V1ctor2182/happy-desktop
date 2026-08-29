pub mod components;
pub mod design;

use components::app_shell::AppShell;
use gpui::{Context, IntoElement, Render, Window};

pub struct HappyApp {
    pub dark: bool,
    pub selected_rail: usize,
    pub selected_sidebar: usize,
}

impl Default for HappyApp {
    fn default() -> Self {
        Self {
            dark: false,
            selected_rail: 0,
            selected_sidebar: 1,
        }
    }
}

impl Render for HappyApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        AppShell::new(self.dark, self.selected_rail, self.selected_sidebar).render(window, cx)
    }
}
