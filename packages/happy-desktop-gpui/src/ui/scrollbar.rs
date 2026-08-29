//! Shared GPUI scrollbar chrome.
//!
//! The owner keeps the viewport and attaches the callbacks exposed by
//! [`ScrollbarState`]. The state is an `Entity` so visibility, hover and drag
//! survive ordinary parent renders.

use std::{ops::Deref, rc::Rc, time::Duration};

use gpui::{
    Animation, AnimationExt as _, App, Bounds, Context, CursorStyle, Entity, Hsla, IntoElement,
    IsZero, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, Point, ScrollHandle,
    ScrollWheelEvent, SharedString, Window, canvas, div, point, prelude::*, px, quad, size,
    transparent_black,
};

#[derive(Clone)]
pub struct SharedScrollHandle {
    handle: ScrollHandle,
    identity: Rc<()>,
}
impl SharedScrollHandle {
    pub fn new() -> Self {
        Self {
            handle: ScrollHandle::new(),
            identity: Rc::new(()),
        }
    }
    fn shares_identity(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.identity, &other.identity)
    }
}
impl Default for SharedScrollHandle {
    fn default() -> Self {
        Self::new()
    }
}
impl Deref for SharedScrollHandle {
    type Target = ScrollHandle;
    fn deref(&self) -> &Self::Target {
        &self.handle
    }
}

pub const SCROLLBAR_TRACK_SIZE: Pixels = px(8.0);
pub const SCROLLBAR_INK_SIZE: Pixels = px(6.0);
pub const SCROLLBAR_MIN_THUMB_SIZE: Pixels = px(24.0);
pub const SCROLLBAR_HOLD: Duration = Duration::from_secs(2);
pub const SCROLLBAR_FADE: Duration = Duration::from_millis(480);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScrollbarAxis {
    Vertical,
    Horizontal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScrollbarAppearance {
    Automatic,
    Always,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScrollbarPlacement {
    /// Paint over the viewport edge. The parent must be position-relative.
    Overlay,
    /// Participate in flex layout only while the viewport overflows.
    BesideWhenOverflowing,
    /// Always participate in flex layout (the composer contract).
    Reserved,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScrollbarMetrics {
    pub track: Bounds<Pixels>,
    pub thumb: Option<Bounds<Pixels>>,
    pub viewport_extent: Pixels,
    pub maximum_offset: Pixels,
}

impl Default for ScrollbarMetrics {
    fn default() -> Self {
        Self {
            track: Bounds::default(),
            thumb: None,
            viewport_extent: px(0.0),
            maximum_offset: px(0.0),
        }
    }
}

impl ScrollbarMetrics {
    pub fn overflowing(self) -> bool {
        self.maximum_offset > px(0.0) && self.viewport_extent > px(0.0)
    }
}

/// Normalizes a wheel event exactly like GPUI 0.2.2 for a scrollport axis.
/// A one-axis viewport redirects perpendicular input. A two-axis viewport
/// chooses the dominant component and gives ties to the vertical axis.
pub fn normalized_wheel_delta(
    axis: ScrollbarAxis,
    event: &ScrollWheelEvent,
    has_perpendicular_axis: bool,
    line_height: Pixels,
) -> Pixels {
    let delta = event.delta.pixel_delta(line_height);
    if !has_perpendicular_axis {
        return match axis {
            ScrollbarAxis::Vertical if !delta.y.is_zero() => delta.y,
            ScrollbarAxis::Vertical => delta.x,
            ScrollbarAxis::Horizontal if !delta.x.is_zero() => delta.x,
            ScrollbarAxis::Horizontal => delta.y,
        };
    }

    let (x, y) = if !delta.x.is_zero() && !delta.y.is_zero() {
        if delta.x.abs() > delta.y.abs() {
            (delta.x, px(0.0))
        } else {
            (px(0.0), delta.y)
        }
    } else {
        (delta.x, delta.y)
    };
    match axis {
        ScrollbarAxis::Vertical => y,
        ScrollbarAxis::Horizontal => x,
    }
}

/// Computes the fixed 8px-track/6px-ink geometry for either axis.
pub fn scrollbar_metrics(
    axis: ScrollbarAxis,
    track: Bounds<Pixels>,
    handle: &ScrollHandle,
) -> ScrollbarMetrics {
    let viewport_extent = match axis {
        ScrollbarAxis::Vertical => handle.bounds().size.height,
        ScrollbarAxis::Horizontal => handle.bounds().size.width,
    };
    let maximum_offset = match axis {
        ScrollbarAxis::Vertical => handle.max_offset().height,
        ScrollbarAxis::Horizontal => handle.max_offset().width,
    }
    .max(px(0.0));
    let track_extent = match axis {
        ScrollbarAxis::Vertical => track.size.height,
        ScrollbarAxis::Horizontal => track.size.width,
    };

    let thumb =
        if viewport_extent <= px(0.0) || maximum_offset <= px(0.0) || track_extent <= px(0.0) {
            None
        } else {
            let content_extent = viewport_extent + maximum_offset;
            let thumb_extent = (track_extent * (viewport_extent / content_extent))
                .clamp(SCROLLBAR_MIN_THUMB_SIZE.min(track_extent), track_extent);
            let offset = match axis {
                ScrollbarAxis::Vertical => -handle.offset().y,
                ScrollbarAxis::Horizontal => -handle.offset().x,
            };
            let progress = (offset / maximum_offset).clamp(0.0, 1.0);
            let along = (track_extent - thumb_extent) * progress;
            Some(match axis {
                ScrollbarAxis::Vertical => Bounds {
                    origin: point(track.origin.x + px(1.0), track.origin.y + along),
                    size: size(SCROLLBAR_INK_SIZE, thumb_extent),
                },
                ScrollbarAxis::Horizontal => Bounds {
                    origin: point(track.origin.x + along, track.origin.y + px(1.0)),
                    size: size(thumb_extent, SCROLLBAR_INK_SIZE),
                },
            })
        };

    ScrollbarMetrics {
        track,
        thumb,
        viewport_extent,
        maximum_offset,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AutomaticPhase {
    Hidden,
    Held,
    Fading,
}

pub struct ScrollbarState {
    axis: ScrollbarAxis,
    appearance: ScrollbarAppearance,
    placement: ScrollbarPlacement,
    handle: SharedScrollHandle,
    metrics: ScrollbarMetrics,
    surface_hovered: bool,
    track_hovered: bool,
    dragging: bool,
    drag_anchor: Pixels,
    automatic_phase: AutomaticPhase,
    revealed_by_wheel: bool,
    lifecycle: u64,
}

impl ScrollbarState {
    pub fn new(
        axis: ScrollbarAxis,
        appearance: ScrollbarAppearance,
        placement: ScrollbarPlacement,
        handle: SharedScrollHandle,
    ) -> Self {
        Self {
            axis,
            appearance,
            placement,
            handle,
            metrics: ScrollbarMetrics::default(),
            surface_hovered: false,
            track_hovered: false,
            dragging: false,
            drag_anchor: px(0.0),
            automatic_phase: AutomaticPhase::Hidden,
            revealed_by_wheel: false,
            lifecycle: 0,
        }
    }

    pub fn vertical(
        appearance: ScrollbarAppearance,
        placement: ScrollbarPlacement,
        handle: SharedScrollHandle,
    ) -> Self {
        Self::new(ScrollbarAxis::Vertical, appearance, placement, handle)
    }

    pub fn horizontal(
        appearance: ScrollbarAppearance,
        placement: ScrollbarPlacement,
        handle: SharedScrollHandle,
    ) -> Self {
        Self::new(ScrollbarAxis::Horizontal, appearance, placement, handle)
    }

    #[allow(dead_code)]
    pub fn axis(&self) -> ScrollbarAxis {
        self.axis
    }
    #[allow(dead_code)]
    pub fn appearance(&self) -> ScrollbarAppearance {
        self.appearance
    }
    #[allow(dead_code)]
    pub fn placement(&self) -> ScrollbarPlacement {
        self.placement
    }
    pub fn scroll_handle(&self) -> &ScrollHandle {
        &self.handle
    }
    pub fn shares_handle(&self, other: &Self) -> bool {
        self.handle.shares_identity(&other.handle)
    }
    #[allow(dead_code)]
    pub fn metrics(&self) -> ScrollbarMetrics {
        self.metrics
    }
    pub fn overflowing(&self) -> bool {
        self.metrics.overflowing()
    }

    /// The flex lane required beside the viewport. Overlay callers always get zero.
    #[allow(dead_code)]
    pub fn lane_extent(&self) -> Pixels {
        match self.placement {
            ScrollbarPlacement::Overlay => px(0.0),
            ScrollbarPlacement::BesideWhenOverflowing if !self.overflowing() => px(0.0),
            ScrollbarPlacement::BesideWhenOverflowing | ScrollbarPlacement::Reserved => {
                SCROLLBAR_TRACK_SIZE
            }
        }
    }

    #[allow(dead_code)]
    pub fn set_appearance(&mut self, appearance: ScrollbarAppearance, cx: &mut Context<Self>) {
        if self.appearance != appearance {
            self.appearance = appearance;
            self.lifecycle = self.lifecycle.wrapping_add(1);
            self.automatic_phase = AutomaticPhase::Hidden;
            self.revealed_by_wheel = false;
            cx.notify();
        }
    }

    #[allow(dead_code)]
    pub fn set_placement(&mut self, placement: ScrollbarPlacement, cx: &mut Context<Self>) {
        if self.placement != placement {
            self.placement = placement;
            cx.notify();
        }
    }

    /// Attach this only to the viewport's trusted `on_scroll_wheel` callback.
    /// `has_perpendicular_axis` must describe the viewport, not this state. GPUI
    /// redirects perpendicular input only for a one-axis scrollport.
    ///
    /// Returns `true` only when this axis can consume the normalized direction.
    /// Handle observation, resize, streaming and other programmatic changes must not call it.
    pub fn trusted_wheel(
        &mut self,
        event: &ScrollWheelEvent,
        has_perpendicular_axis: bool,
        line_height: Pixels,
        cx: &mut Context<Self>,
    ) -> bool {
        let delta = normalized_wheel_delta(self.axis, event, has_perpendicular_axis, line_height);
        let current_offset = match self.axis {
            ScrollbarAxis::Vertical => self.handle.offset().y,
            ScrollbarAxis::Horizontal => self.handle.offset().x,
        };
        // GPUI's native listener runs before this callback in bubble order, so
        // the handle already includes this event. Recover the pre-event offset.
        let offset_before = current_offset - delta;
        if !self.can_consume(delta, offset_before) {
            if !delta.is_zero() && self.surface_hovered {
                self.surface_hovered = false;
                cx.notify();
            }
            return false;
        }
        if !self.surface_hovered {
            self.surface_hovered = true;
            cx.notify();
        }
        if self.appearance == ScrollbarAppearance::Automatic {
            self.revealed_by_wheel = true;
            self.automatic_phase = AutomaticPhase::Held;
            self.start_hide_lifecycle(cx);
            cx.notify();
        }
        true
    }

    fn can_consume(&self, delta: Pixels, offset_before: Pixels) -> bool {
        if delta.is_zero() || !self.overflowing() {
            return false;
        }
        let maximum = self.metrics.maximum_offset.max(px(0.0));
        let offset = offset_before.clamp(-maximum, px(0.0));
        if delta < px(0.0) {
            offset > -maximum
        } else {
            offset < px(0.0)
        }
    }

    /// Attach to the viewport/root `on_hover`; this controls Always's 0.50 surface strength.
    pub fn surface_hover(&mut self, hovered: bool, cx: &mut Context<Self>) {
        if !hovered && self.surface_hovered {
            self.surface_hovered = false;
            cx.notify();
        }
    }

    fn track_hover(&mut self, hovered: bool, cx: &mut Context<Self>) {
        if self.track_hovered == hovered {
            return;
        }
        self.track_hovered = hovered;
        self.lifecycle = self.lifecycle.wrapping_add(1);
        if hovered && self.appearance == ScrollbarAppearance::Automatic {
            self.automatic_phase = AutomaticPhase::Held;
        } else if !hovered && !self.dragging && self.appearance == ScrollbarAppearance::Automatic {
            if self.revealed_by_wheel {
                self.start_hide_lifecycle(cx);
            } else {
                self.automatic_phase = AutomaticPhase::Hidden;
            }
        }
        cx.notify();
    }

    fn start_hide_lifecycle(&mut self, cx: &mut Context<Self>) {
        self.lifecycle = self.lifecycle.wrapping_add(1);
        let lifecycle = self.lifecycle;
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            executor.timer(SCROLLBAR_HOLD).await;
            let should_fade = this
                .update(cx, |state, cx| {
                    if state.lifecycle != lifecycle || state.track_hovered || state.dragging {
                        return false;
                    }
                    state.automatic_phase = AutomaticPhase::Fading;
                    cx.notify();
                    true
                })
                .unwrap_or(false);
            if !should_fade {
                return;
            }
            executor.timer(SCROLLBAR_FADE).await;
            this.update(cx, |state, cx| {
                if state.lifecycle == lifecycle && !state.track_hovered && !state.dragging {
                    state.automatic_phase = AutomaticPhase::Hidden;
                    state.revealed_by_wheel = false;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    fn visible(&self) -> bool {
        if !self.overflowing() {
            return false;
        }
        self.appearance == ScrollbarAppearance::Always
            || self.placement == ScrollbarPlacement::Reserved
            || self.track_hovered
            || self.dragging
            || self.automatic_phase != AutomaticPhase::Hidden
    }

    pub(crate) fn opacity(&self) -> f32 {
        if !self.visible() {
            return 0.0;
        }
        if self.track_hovered || self.dragging {
            return 0.68;
        }
        match self.appearance {
            ScrollbarAppearance::Always => {
                if self.surface_hovered {
                    0.50
                } else {
                    0.32
                }
            }
            ScrollbarAppearance::Automatic => 0.50,
        }
    }

    /// Starts a thumb drag. The track already calls this; a custom track may forward it.
    pub fn pointer_down(&mut self, event: &MouseDownEvent, cx: &mut Context<Self>) {
        let Some(thumb) = self.metrics.thumb else {
            return;
        };
        let pointer = self.axis.coordinate(event.position);
        let thumb_start = self.axis.origin(thumb);
        let thumb_extent = self.axis.extent(thumb);
        self.drag_anchor = if pointer >= thumb_start && pointer <= thumb_start + thumb_extent {
            pointer - thumb_start
        } else {
            thumb_extent / 2.0
        };
        self.dragging = true;
        self.lifecycle = self.lifecycle.wrapping_add(1);
        self.drag_to(event.position);
        cx.notify();
    }

    /// Forward from the surface root as well as the track so a drag remains active
    /// when the pointer strays outside the 8px track.
    pub fn pointer_move(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if self.dragging && event.dragging() {
            self.drag_to(event.position);
            cx.notify();
        }
    }

    /// Forward from the surface root to terminate an out-of-track drag.
    pub fn pointer_up(&mut self, _event: &MouseUpEvent, cx: &mut Context<Self>) {
        if !self.dragging {
            return;
        }
        self.dragging = false;
        if self.appearance == ScrollbarAppearance::Automatic && !self.track_hovered {
            if self.revealed_by_wheel {
                self.start_hide_lifecycle(cx);
            } else {
                self.automatic_phase = AutomaticPhase::Hidden;
            }
        }
        cx.notify();
    }

    fn drag_to(&mut self, position: Point<Pixels>) {
        let Some(thumb) = self.metrics.thumb else {
            return;
        };
        let track_start = self.axis.origin(self.metrics.track);
        let travel = self.axis.extent(self.metrics.track) - self.axis.extent(thumb);
        if travel <= px(0.0) {
            return;
        }
        let progress = ((self.axis.coordinate(position) - track_start - self.drag_anchor) / travel)
            .clamp(0.0, 1.0);
        let mut offset = self.handle.offset();
        match self.axis {
            ScrollbarAxis::Vertical => offset.y = -self.metrics.maximum_offset * progress,
            ScrollbarAxis::Horizontal => offset.x = -self.metrics.maximum_offset * progress,
        }
        self.handle.set_offset(offset);
    }

    fn reconcile_metrics(&mut self, metrics: ScrollbarMetrics, cx: &mut Context<Self>) {
        let was_overflowing = self.metrics.overflowing();
        let is_overflowing = metrics.overflowing();
        let lane_changed = self.placement == ScrollbarPlacement::BesideWhenOverflowing
            && was_overflowing != is_overflowing;
        let automatic_reset =
            self.appearance == ScrollbarAppearance::Automatic && was_overflowing && !is_overflowing;
        self.metrics = metrics;
        if automatic_reset {
            self.lifecycle = self.lifecycle.wrapping_add(1);
            self.automatic_phase = AutomaticPhase::Hidden;
            self.revealed_by_wheel = false;
            self.track_hovered = false;
            self.dragging = false;
        }
        if lane_changed || automatic_reset {
            cx.notify();
        }
    }
}

impl ScrollbarAxis {
    fn coordinate(self, point: Point<Pixels>) -> Pixels {
        match self {
            Self::Vertical => point.y,
            Self::Horizontal => point.x,
        }
    }
    fn origin(self, bounds: Bounds<Pixels>) -> Pixels {
        self.coordinate(bounds.origin)
    }
    fn extent(self, bounds: Bounds<Pixels>) -> Pixels {
        match self {
            Self::Vertical => bounds.size.height,
            Self::Horizontal => bounds.size.width,
        }
    }
}

/// The painted track. Compose it as a sibling of the viewport.
#[derive(IntoElement)]
pub struct Scrollbar {
    pub id: SharedString,
    pub state: Entity<ScrollbarState>,
    pub color: Hsla,
}

impl Scrollbar {
    pub fn new(id: impl Into<SharedString>, state: Entity<ScrollbarState>, color: Hsla) -> Self {
        Self {
            id: id.into(),
            state,
            color,
        }
    }
}

impl gpui::RenderOnce for Scrollbar {
    fn render(self, _window: &mut Window, cx: &mut App) -> impl IntoElement {
        let (axis, placement, overflowing, opacity, fading, lifecycle, handle) = {
            let snapshot = self.state.read(cx);
            (
                snapshot.axis,
                snapshot.placement,
                snapshot.overflowing(),
                snapshot.opacity(),
                snapshot.automatic_phase == AutomaticPhase::Fading,
                snapshot.lifecycle,
                snapshot.handle.clone(),
            )
        };

        let state_for_metrics = self.state.downgrade();
        let metric_handle = handle.clone();
        let ink_color = self.color;
        let ink = canvas(
            move |track, window, cx| {
                let metrics = scrollbar_metrics(axis, track, &metric_handle);
                let state = state_for_metrics.clone();
                // Layout changes from an overflow transition are deferred. Calling notify
                // while GPUI is prepainting would invalidate the active frame.
                window.defer(cx, move |_, cx| {
                    state
                        .update(cx, |state, cx| state.reconcile_metrics(metrics, cx))
                        .ok();
                });
                metrics
            },
            move |_, metrics, window, _| {
                if let Some(thumb) = metrics.thumb {
                    window.paint_quad(quad(
                        thumb,
                        px(3.0),
                        ink_color,
                        px(0.0),
                        transparent_black(),
                        Default::default(),
                    ));
                }
            },
        )
        .size_full();
        let ink = if fading {
            ink.with_animation(
                ("scrollbar-fade", lifecycle),
                Animation::new(SCROLLBAR_FADE),
                move |element, delta| element.opacity(opacity * (1.0 - delta)),
            )
            .into_any_element()
        } else {
            ink.opacity(opacity).into_any_element()
        };

        let state_for_hover = self.state.clone();
        let state_for_down = self.state.clone();
        let state_for_move = self.state.clone();
        let state_for_up = self.state.clone();
        let state_for_up_out = self.state.clone();
        div()
            .id(self.id.clone())
            .debug_selector(move || format!("{}.track", self.id))
            .flex_none()
            .cursor(CursorStyle::Arrow)
            .when(axis == ScrollbarAxis::Vertical, |track| {
                track.w(SCROLLBAR_TRACK_SIZE).h_full()
            })
            .when(axis == ScrollbarAxis::Horizontal, |track| {
                track.h(SCROLLBAR_TRACK_SIZE).w_full()
            })
            .when(
                placement == ScrollbarPlacement::Overlay,
                |track| match axis {
                    ScrollbarAxis::Vertical => track.absolute().right_0().top_0().bottom_0(),
                    ScrollbarAxis::Horizontal => track.absolute().left_0().right_0().bottom_0(),
                },
            )
            .when(
                placement == ScrollbarPlacement::BesideWhenOverflowing && !overflowing,
                |track| match axis {
                    // Keep a zero-width measuring canvas over the edge. It discovers the
                    // first overflow without creating a content lane or pointer target.
                    ScrollbarAxis::Vertical => {
                        track.absolute().right_0().top_0().bottom_0().w(px(0.0))
                    }
                    ScrollbarAxis::Horizontal => {
                        track.absolute().left_0().right_0().bottom_0().h(px(0.0))
                    }
                },
            )
            .on_hover(move |hovered, _, cx| {
                state_for_hover.update(cx, |state, cx| state.track_hover(*hovered, cx));
            })
            .on_mouse_down(MouseButton::Left, move |event, _, cx| {
                cx.stop_propagation();
                state_for_down.update(cx, |state, cx| state.pointer_down(event, cx));
            })
            .on_mouse_move(move |event, _, cx| {
                state_for_move.update(cx, |state, cx| state.pointer_move(event, cx));
            })
            .on_mouse_up(MouseButton::Left, move |event, _, cx| {
                state_for_up.update(cx, |state, cx| state.pointer_up(event, cx));
            })
            .on_mouse_up_out(MouseButton::Left, move |event, _, cx| {
                state_for_up_out.update(cx, |state, cx| state.pointer_up(event, cx));
            })
            .child(ink)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{Modifiers, ScrollDelta, TestAppContext, TouchPhase};

    fn wheel(axis: ScrollbarAxis) -> ScrollWheelEvent {
        ScrollWheelEvent {
            position: point(px(4.0), px(40.0)),
            delta: match axis {
                ScrollbarAxis::Vertical => ScrollDelta::Pixels(point(px(0.0), px(-8.0))),
                ScrollbarAxis::Horizontal => ScrollDelta::Pixels(point(px(-8.0), px(0.0))),
            },
            modifiers: Modifiers::default(),
            touch_phase: TouchPhase::Moved,
        }
    }

    fn dispatch_trusted_wheel(
        state: &Entity<ScrollbarState>,
        event: &ScrollWheelEvent,
        has_perpendicular_axis: bool,
        cx: &mut TestAppContext,
    ) -> bool {
        state.update(cx, |state, cx| {
            let delta = normalized_wheel_delta(state.axis, event, has_perpendicular_axis, px(16.0));
            let mut offset = state.handle.offset();
            match state.axis {
                ScrollbarAxis::Vertical => offset.y += delta,
                ScrollbarAxis::Horizontal => offset.x += delta,
            }
            state.handle.set_offset(offset);
            state.trusted_wheel(event, has_perpendicular_axis, px(16.0), cx)
        })
    }

    fn overflowing_state(
        cx: &mut TestAppContext,
        placement: ScrollbarPlacement,
    ) -> Entity<ScrollbarState> {
        cx.new(|_| {
            let mut state = ScrollbarState::vertical(
                ScrollbarAppearance::Automatic,
                placement,
                SharedScrollHandle::new(),
            );
            state.metrics = ScrollbarMetrics {
                track: Bounds {
                    origin: point(px(0.0), px(0.0)),
                    size: size(px(8.0), px(100.0)),
                },
                thumb: Some(Bounds {
                    origin: point(px(1.0), px(0.0)),
                    size: size(px(6.0), px(50.0)),
                }),
                viewport_extent: px(100.0),
                maximum_offset: px(100.0),
            };
            state
        })
    }

    #[test]
    fn geometry_is_axis_symmetric_and_clamped() {
        // Geometry's pure ratio and placement calculations are covered independently
        // of GPUI's prepaint-owned handle bounds.
        let track = Bounds {
            origin: point(px(10.0), px(20.0)),
            size: size(px(8.0), px(100.0)),
        };
        let mut metrics = ScrollbarMetrics {
            track,
            thumb: None,
            viewport_extent: px(100.0),
            maximum_offset: px(300.0),
        };
        let extent = (px(100.0)
            * (metrics.viewport_extent / (metrics.viewport_extent + metrics.maximum_offset)))
            .clamp(SCROLLBAR_MIN_THUMB_SIZE, px(100.0));
        metrics.thumb = Some(Bounds {
            origin: point(px(11.0), px(20.0)),
            size: size(px(6.0), extent),
        });
        assert_eq!(metrics.thumb.unwrap().size, size(px(6.0), px(25.0)));
        assert_eq!(SCROLLBAR_TRACK_SIZE, px(8.0));
        assert_eq!(SCROLLBAR_INK_SIZE, px(6.0));

        let horizontal = Bounds {
            origin: point(px(20.0), px(11.0)),
            size: size(px(25.0), px(6.0)),
        };
        assert_eq!(ScrollbarAxis::Horizontal.extent(horizontal), px(25.0));
        assert_eq!(ScrollbarAxis::Horizontal.origin(horizontal), px(20.0));
    }

    #[gpui::test]
    fn trusted_wheel_holds_then_fades_on_test_clock(cx: &mut TestAppContext) {
        let state = overflowing_state(cx, ScrollbarPlacement::Overlay);
        state.update(cx, |state, cx| {
            state.trusted_wheel(&wheel(ScrollbarAxis::Vertical), false, px(16.0), cx)
        });
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.50);
        cx.run_until_parked();
        cx.executor()
            .advance_clock(SCROLLBAR_HOLD - Duration::from_millis(1));
        cx.run_until_parked();
        assert_eq!(
            state.read_with(cx, |s, _| s.automatic_phase),
            AutomaticPhase::Held
        );
        cx.executor().advance_clock(Duration::from_millis(1));
        cx.run_until_parked();
        assert_eq!(
            state.read_with(cx, |s, _| s.automatic_phase),
            AutomaticPhase::Fading
        );
        cx.executor().advance_clock(SCROLLBAR_FADE);
        cx.run_until_parked();
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.0);
    }

    #[gpui::test]
    fn programmatic_handle_changes_and_resize_do_not_reveal(cx: &mut TestAppContext) {
        let state = overflowing_state(cx, ScrollbarPlacement::Overlay);
        state.read_with(cx, |state, _| {
            state.handle.set_offset(point(px(0.0), px(-40.0)))
        });
        state.update(cx, |state, cx| {
            let mut resized = state.metrics;
            resized.viewport_extent = px(80.0);
            state.reconcile_metrics(resized, cx);
        });
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.0);
        assert!(!state.read_with(cx, |s, _| s.revealed_by_wheel));
    }

    #[gpui::test]
    fn hover_and_drag_pin_and_drag_updates_handle(cx: &mut TestAppContext) {
        let state = overflowing_state(cx, ScrollbarPlacement::Overlay);
        state.update(cx, |state, cx| state.track_hover(true, cx));
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.68);
        state.update(cx, |state, cx| {
            state.pointer_down(
                &MouseDownEvent {
                    button: MouseButton::Left,
                    position: point(px(4.0), px(25.0)),
                    modifiers: Modifiers::default(),
                    click_count: 1,
                    first_mouse: false,
                },
                cx,
            )
        });
        state.update(cx, |state, cx| {
            state.pointer_move(
                &MouseMoveEvent {
                    position: point(px(4.0), px(75.0)),
                    pressed_button: Some(MouseButton::Left),
                    modifiers: Modifiers::default(),
                },
                cx,
            )
        });
        assert!(state.read_with(cx, |s, _| s.handle.offset().y) < px(0.0));
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.68);
    }

    #[gpui::test]
    fn lane_contract_covers_overflow_and_no_overflow(cx: &mut TestAppContext) {
        let beside = overflowing_state(cx, ScrollbarPlacement::BesideWhenOverflowing);
        assert_eq!(beside.read_with(cx, |s, _| s.lane_extent()), px(8.0));
        beside.update(cx, |state, cx| {
            let mut fit = state.metrics;
            fit.maximum_offset = px(0.0);
            fit.thumb = None;
            state.reconcile_metrics(fit, cx);
        });
        assert_eq!(beside.read_with(cx, |s, _| s.lane_extent()), px(0.0));

        let reserved = overflowing_state(cx, ScrollbarPlacement::Reserved);
        reserved.update(cx, |state, cx| {
            let mut fit = state.metrics;
            fit.maximum_offset = px(0.0);
            fit.thumb = None;
            state.reconcile_metrics(fit, cx);
        });
        assert_eq!(reserved.read_with(cx, |s, _| s.lane_extent()), px(8.0));
        assert_eq!(reserved.read_with(cx, |s, _| s.opacity()), 0.0);
    }
    #[gpui::test]
    fn always_strengths_follow_surface_track_and_drag(cx: &mut TestAppContext) {
        let state = overflowing_state(cx, ScrollbarPlacement::Overlay);
        state.update(cx, |state, cx| {
            state.set_appearance(ScrollbarAppearance::Always, cx)
        });
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.32);
        state.update(cx, |state, cx| state.surface_hover(true, cx));
        assert_eq!(
            state.read_with(cx, |s, _| s.opacity()),
            0.32,
            "ancestor hover alone is not wheel ownership"
        );
        state.update(cx, |state, cx| {
            state.trusted_wheel(&wheel(ScrollbarAxis::Vertical), false, px(16.0), cx);
        });
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.50);
        state.update(cx, |state, cx| state.surface_hover(false, cx));
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.32);
        state.update(cx, |state, cx| state.track_hover(true, cx));
        assert_eq!(state.read_with(cx, |s, _| s.opacity()), 0.68);
    }
    #[gpui::test]
    fn wheel_acceptance_normalizes_one_axis_and_chains_at_boundaries(cx: &mut TestAppContext) {
        let state = overflowing_state(cx, ScrollbarPlacement::Overlay);
        let toward_start = ScrollWheelEvent {
            delta: ScrollDelta::Pixels(point(px(0.0), px(12.0))),
            ..Default::default()
        };
        assert!(!dispatch_trusted_wheel(&state, &toward_start, false, cx));

        state.read_with(cx, |state, _| {
            state.handle.set_offset(point(px(0.0), px(0.0)))
        });
        let perpendicular_toward_end = ScrollWheelEvent {
            delta: ScrollDelta::Pixels(point(px(-12.0), px(0.0))),
            ..Default::default()
        };
        assert!(dispatch_trusted_wheel(
            &state,
            &perpendicular_toward_end,
            false,
            cx,
        ));
        assert!(!dispatch_trusted_wheel(
            &state,
            &perpendicular_toward_end,
            true,
            cx,
        ));

        state.read_with(cx, |state, _| {
            state.handle.set_offset(point(px(0.0), px(-100.0)))
        });
        let toward_end = wheel(ScrollbarAxis::Vertical);
        assert!(!dispatch_trusted_wheel(&state, &toward_end, false, cx));
        state.read_with(cx, |state, _| {
            state.handle.set_offset(point(px(0.0), px(-100.0)))
        });
        assert!(dispatch_trusted_wheel(&state, &toward_start, false, cx));

        let horizontal = cx.new(|_| {
            let mut state = ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            );
            state.metrics = ScrollbarMetrics {
                track: Bounds {
                    origin: point(px(0.0), px(0.0)),
                    size: size(px(100.0), px(8.0)),
                },
                thumb: Some(Bounds {
                    origin: point(px(0.0), px(1.0)),
                    size: size(px(50.0), px(6.0)),
                }),
                viewport_extent: px(100.0),
                maximum_offset: px(100.0),
            };
            state
        });
        let vertical_input = ScrollWheelEvent {
            delta: ScrollDelta::Pixels(point(px(0.0), px(-12.0))),
            ..Default::default()
        };
        assert!(dispatch_trusted_wheel(
            &horizontal,
            &vertical_input,
            false,
            cx,
        ));
        assert_eq!(
            horizontal.read_with(cx, |state, _| state.handle.offset().x),
            px(-12.0)
        );
    }

    #[gpui::test]
    fn overflow_to_fit_cancels_reveal_and_fit_to_overflow_stays_hidden(cx: &mut TestAppContext) {
        let state = overflowing_state(cx, ScrollbarPlacement::Overlay);
        state.update(cx, |state, cx| {
            assert!(state.trusted_wheel(&wheel(ScrollbarAxis::Vertical), false, px(16.0), cx));
            state.track_hover(true, cx);
        });
        assert_eq!(state.read_with(cx, |state, _| state.opacity()), 0.68);

        state.update(cx, |state, cx| {
            let mut fit = state.metrics;
            fit.maximum_offset = px(0.0);
            fit.thumb = None;
            state.reconcile_metrics(fit, cx);
        });
        assert_eq!(state.read_with(cx, |state, _| state.opacity()), 0.0);
        assert!(!state.read_with(cx, |state, _| state.revealed_by_wheel));
        assert!(!state.read_with(cx, |state, _| state.track_hovered));

        state.update(cx, |state, cx| {
            let mut overflow = state.metrics;
            overflow.maximum_offset = px(100.0);
            overflow.thumb = Some(Bounds {
                origin: point(px(1.0), px(0.0)),
                size: size(px(6.0), px(50.0)),
            });
            state.reconcile_metrics(overflow, cx);
        });
        cx.run_until_parked();
        cx.executor().advance_clock(SCROLLBAR_HOLD + SCROLLBAR_FADE);
        cx.run_until_parked();
        assert_eq!(state.read_with(cx, |state, _| state.opacity()), 0.0);
        assert_eq!(
            state.read_with(cx, |state, _| state.automatic_phase),
            AutomaticPhase::Hidden
        );
    }

    #[test]
    fn shared_handle_identity_distinguishes_clones_from_equal_offset_handles() {
        let shared = SharedScrollHandle::new();
        let clone = shared.clone();
        let distinct = SharedScrollHandle::new();
        assert!(shared.shares_identity(&clone));
        assert!(!shared.shares_identity(&distinct));
        assert_eq!(shared.offset(), distinct.offset());
    }
}
