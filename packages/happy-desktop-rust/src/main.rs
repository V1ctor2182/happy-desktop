use gpui::{App, AppContext, Application, Bounds, WindowBounds, WindowOptions, point, px, size};
use happy_desktop_rust::HappyApp;
use happy_desktop_rust::design::theme::register_fonts;

fn main() {
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
            |_, cx| cx.new(|_| HappyApp::default()),
        )
        .expect("open Happy Rust window");
        cx.activate(true);
    });
}
