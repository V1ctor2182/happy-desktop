mod connectivity;
mod fonts;
mod shell;
mod theme;
mod ui;

use gpui::{
    App, AppContext, Application, Bounds, KeyBinding, Menu, MenuItem, TitlebarOptions,
    WindowBounds, WindowOptions, actions, point, px, size,
};
use shell::HappyApp;

actions!(happy, [Quit]);

fn main() {
    Application::new().run(|cx: &mut App| {
        fonts::register(cx);
        ui::text_input::init(cx);
        ui::components::init(cx);

        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
        cx.set_menus(vec![Menu {
            name: "Happy GPUI".into(),
            items: vec![MenuItem::action("Quit Happy GPUI", Quit)],
        }]);

        let bounds = Bounds::centered(None, size(px(1280.0), px(800.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_min_size: Some(size(px(720.0), px(480.0))),
                titlebar: Some(TitlebarOptions {
                    title: Some("Happy GPUI".into()),
                    appears_transparent: true,
                    traffic_light_position: Some(point(px(14.0), px(13.0))),
                }),
                ..Default::default()
            },
            |_, cx| cx.new(HappyApp::new),
        )
        .expect("open Happy window");
        cx.activate(true);
    });
}
