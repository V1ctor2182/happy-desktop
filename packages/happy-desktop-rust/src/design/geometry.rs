use gpui::{Bounds, Pixels, Point, Size, point, px, size};

pub const REFERENCE_WIDTH: f32 = 1280.0;
pub const REFERENCE_HEIGHT: f32 = 800.0;
pub const MINIMUM_WIDTH: f32 = 720.0;
pub const MINIMUM_HEIGHT: f32 = 480.0;
pub const TITLE_BAR_HEIGHT: f32 = 56.0;
pub const SURFACE_HEADER_HEIGHT: f32 = 56.0;
pub const RAIL_WIDTH: f32 = 64.0;
pub const SIDEBAR_MIN_WIDTH: f32 = 250.0;
pub const SIDEBAR_MAX_WIDTH: f32 = 360.0;
pub const SIDEBAR_SHARE: f32 = 0.30;
pub const SIDEBAR_ROW_HEIGHT: f32 = 32.0;
pub const SIDEBAR_ROW_GAP: f32 = 2.0;

pub fn sidebar_width(window_width: f32) -> f32 {
    (window_width * SIDEBAR_SHARE).clamp(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
}

pub fn rect(x: f32, y: f32, width: f32, height: f32) -> Bounds<Pixels> {
    Bounds::new(point(px(x), px(y)), size(px(width), px(height)))
}

pub fn point_px(x: f32, y: f32) -> Point<Pixels> {
    point(px(x), px(y))
}

pub fn size_px(width: f32, height: f32) -> Size<Pixels> {
    size(px(width), px(height))
}
