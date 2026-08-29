use gpui::{App, AppContext, Application, Bounds, WindowBounds, WindowOptions, point, px, size};
use happy_desktop_rust::HappyApp;
use happy_desktop_rust::design::theme::register_fonts;
use happy_desktop_rust::host::HostRuntime;

fn main() {
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--verify-host")) {
        match HostRuntime::connect().and_then(|host| {
            let client = host.client();
            host.bootstrap().and_then(|bootstrap| {
                let agent_id = bootstrap
                    .projects
                    .iter()
                    .flat_map(|project| &project.agents)
                    .chain(
                        bootstrap
                            .workspaces
                            .iter()
                            .flat_map(|workspace| &workspace.agents),
                    )
                    .find(|agent| agent.archived_at.is_none())
                    .map(|agent| agent.id.clone());
                let conversation_rows = agent_id
                    .map(|agent_id| client.conversation(&agent_id))
                    .transpose()?
                    .map(|conversation| conversation.rows.len());
                Ok((bootstrap.projects.len(), conversation_rows))
            })
        }) {
            Ok((projects, conversation_rows)) => {
                println!(
                    "Happy Agent bootstrap verified: {projects} projects; conversation rows: {}",
                    conversation_rows.map_or_else(|| "none".to_owned(), |rows| rows.to_string())
                );
                return;
            }
            Err(error) => {
                eprintln!("Happy Agent bootstrap failed: {error}");
                std::process::exit(1);
            }
        }
    }
    Application::new().run(|cx: &mut App| {
        register_fonts(cx.text_system());
        let bounds = Bounds::new(point(px(160.0), px(100.0)), size(px(1280.0), px(800.0)));
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_min_size: Some(size(px(720.0), px(480.0))),
                titlebar: Some(gpui::TitlebarOptions {
                    title: Some("Happy Rust".into()),
                    appears_transparent: true,
                    traffic_light_position: Some(point(px(14.0), px(12.0))),
                }),
                ..Default::default()
            },
            |_, cx| cx.new(HappyApp::connected),
        )
        .expect("open Happy Rust window");
        cx.activate(true);
    });
}
