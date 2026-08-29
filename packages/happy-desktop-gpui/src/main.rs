mod chat;
mod connectivity;
mod fonts;
mod navigation;
mod shell;
mod surfaces;
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
        ui::text_area::init(cx);
        ui::components::init(cx);
        ui::command_palette::init(cx);

        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.bind_keys([
            KeyBinding::new("cmd-q", Quit, None),
            KeyBinding::new("cmd-k", ui::command_palette::CommandPaletteToggle, None),
        ]);
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
            |window, cx| cx.new(|cx| HappyApp::new(window, cx)),
        )
        .expect("open Happy window");
        cx.activate(true);
    });
}
