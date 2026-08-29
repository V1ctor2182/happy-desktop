use gpui::{Rgba, rgb};

#[derive(Clone, Copy)]
#[allow(dead_code)] // Keep the complete semantic palette available across phased surfaces.
pub struct Theme {
    pub root: Rgba,
    pub chrome: Rgba,
    pub surface: Rgba,
    pub raised: Rgba,
    pub inset: Rgba,
    pub divider: Rgba,
    pub text: Rgba,
    pub secondary_text: Rgba,
    pub link: Rgba,
    pub success: Rgba,
    pub warning: Rgba,
    pub destructive: Rgba,
    pub selected: Rgba,
}

impl Theme {
    pub fn dark() -> Self {
        Self {
            root: rgb(0x1e1e1e),
            chrome: rgb(0x212121),
            surface: rgb(0x212121),
            raised: rgb(0x171717),
            inset: rgb(0x303030),
            divider: rgb(0x292929),
            text: rgb(0xffffff),
            secondary_text: rgb(0xcac4d0),
            link: rgb(0x2baccc),
            success: rgb(0x32d74b),
            warning: rgb(0xff9f0a),
            destructive: rgb(0xff453a),
            selected: rgb(0x303030),
        }
    }

    pub fn light() -> Self {
        Self {
            root: rgb(0xf5f5f5),
            chrome: rgb(0xffffff),
            surface: rgb(0xffffff),
            raised: rgb(0xf8f8f8),
            inset: rgb(0xf5f5f5),
            divider: rgb(0xeaeaea),
            text: rgb(0x000000),
            secondary_text: rgb(0x49454f),
            link: rgb(0x2baccc),
            success: rgb(0x34c759),
            warning: rgb(0xff9500),
            destructive: rgb(0xff3b30),
            selected: rgb(0xf5f5f5),
        }
    }
}
