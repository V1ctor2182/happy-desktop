//! Narrow native WebKit bridge for staged local previews.
//!
//! The public API cannot represent a network, data, or arbitrary URL. It accepts only a
//! canonical local file and one explicit supported kind. HTML is pre-sanitized by the caller.
//! Audio/video use an inert wrapper with a restrictive CSP and no script. WebKit uses an
//! ephemeral data store and JavaScript is disabled.

use super::{Icon, IconName, theme_roles::ThemeRole};
use crate::{fonts, theme::Theme};
use gpui::{App, IntoElement, RenderOnce, SharedString, Window, div, prelude::*, px};
#[cfg(all(target_os = "macos", not(test)))]
use std::rc::Rc;
use std::{
    fmt,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NavigationPolicy {
    Allow,
    Cancel,
}
fn navigation_policy(
    scheme: Option<&str>,
    path: Option<&Path>,
    has_fragment: bool,
    allowed_file: &Path,
    allow_initial_about: bool,
    initial_pending: bool,
) -> NavigationPolicy {
    match scheme {
        Some("file")
            if path == Some(allowed_file)
                && (initial_pending || has_fragment || allow_initial_about) =>
        {
            NavigationPolicy::Allow
        }
        Some("file")
            if initial_pending
                && allow_initial_about
                && path.is_some_and(|path| allowed_file.parent() == Some(path)) =>
        {
            NavigationPolicy::Allow
        }
        Some("about")
            if initial_pending
                && allow_initial_about
                && path.is_none_or(|path| {
                    path.as_os_str().is_empty() || path == Path::new("blank")
                }) =>
        {
            NavigationPolicy::Allow
        }
        None if initial_pending && allow_initial_about && path.is_none() => NavigationPolicy::Allow,
        _ => NavigationPolicy::Cancel,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativePreviewKind {
    Image,
    Html,
    Audio,
    Video,
    Pdf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreviewStageRoot(PathBuf);
impl PreviewStageRoot {
    /// Host/staging boundary only. Product UI cannot bless an arbitrary directory.
    pub(crate) fn try_new(path: PathBuf) -> std::io::Result<Self> {
        let link_metadata = std::fs::symlink_metadata(&path)?;
        if link_metadata.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "preview stage root cannot be a symlink",
            ));
        }
        let canonical = std::fs::canonicalize(&path)?;
        if canonical != path || !canonical.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "preview stage root must be an existing canonical directory",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let metadata = std::fs::metadata(&canonical)?;
            if metadata.mode() & 0o777 != 0o700 || metadata.uid() != unsafe { libc::geteuid() } {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "preview stage root must be owned by the effective user and mode 0700",
                ));
            }
        }
        Ok(Self(canonical))
    }
    pub fn as_path(&self) -> &Path {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StagedLocalFile(PathBuf);
impl StagedLocalFile {
    /// Accepts an existing canonical file path. Relative, missing, and non-canonical paths fail.
    pub(crate) fn try_new(root: &PreviewStageRoot, path: PathBuf) -> std::io::Result<Self> {
        if !path.is_absolute() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "staged preview path must be absolute",
            ));
        }
        let link_metadata = std::fs::symlink_metadata(&path)?;
        if link_metadata.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "staged preview file cannot be a symlink",
            ));
        }
        let canonical = std::fs::canonicalize(&path)?;
        if canonical != path {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "staged preview path must already be canonical",
            ));
        }
        if !canonical.starts_with(root.as_path()) || canonical.parent() != Some(root.as_path()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "staged preview file must be directly contained by its authorized stage root",
            ));
        }
        if !canonical.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "staged preview path must name a file",
            ));
        }
        let parent = canonical.parent().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "staged preview must have a private parent directory",
            )
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let directory_metadata = std::fs::metadata(parent)?;
            let file_metadata = std::fs::metadata(&canonical)?;
            let directory_mode = directory_metadata.mode() & 0o777;
            let file_mode = file_metadata.mode() & 0o777;
            let euid = unsafe { libc::geteuid() };
            if directory_mode != 0o700
                || file_mode != 0o600
                || directory_metadata.uid() != euid
                || file_metadata.uid() != euid
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "staged preview requires effective-user ownership, a 0700 directory, and a 0600 file",
                ));
            }
        }
        Ok(Self(canonical))
    }
    pub fn as_path(&self) -> &Path {
        &self.0
    }
    #[cfg(test)]
    pub(crate) fn new_for_test(path: PathBuf) -> Self {
        Self(path)
    }
}

/// HTML staging asserts the caller sanitized the complete document before it entered WebKit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SanitizedHtmlSource(StagedLocalFile);
impl SanitizedHtmlSource {
    pub(crate) fn new(file: StagedLocalFile) -> Self {
        Self(file)
    }
}

#[derive(Clone)]
pub struct NativePreviewSource {
    file: StagedLocalFile,
    kind: NativePreviewKind,
    gallery_fallback: bool,
    #[cfg(all(target_os = "macos", not(test)))]
    controller: Rc<mac::Controller>,
}
impl fmt::Debug for NativePreviewSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativePreviewSource")
            .field("file", &self.file)
            .field("kind", &self.kind)
            .finish()
    }
}
impl NativePreviewSource {
    /// HTML files passed here must already be sanitized by the caller. The bridge never accepts URLs.
    fn new(file: StagedLocalFile, kind: NativePreviewKind) -> Self {
        Self {
            #[cfg(all(target_os = "macos", not(test)))]
            controller: Rc::new(mac::Controller::new(file.clone(), kind)),
            file,
            kind,
            gallery_fallback: false,
        }
    }
    pub fn image(file: StagedLocalFile) -> Self {
        Self::new(file, NativePreviewKind::Image)
    }
    pub fn sanitized_html(source: SanitizedHtmlSource) -> Self {
        Self::new(source.0, NativePreviewKind::Html)
    }
    pub fn audio(file: StagedLocalFile) -> Self {
        Self::new(file, NativePreviewKind::Audio)
    }
    pub fn video(file: StagedLocalFile) -> Self {
        Self::new(file, NativePreviewKind::Video)
    }
    pub fn pdf(file: StagedLocalFile) -> Self {
        Self::new(file, NativePreviewKind::Pdf)
    }
    pub fn file(&self) -> &StagedLocalFile {
        &self.file
    }
    pub fn kind(&self) -> NativePreviewKind {
        self.kind
    }
    /// Immediately hides and suspends an already-created platform preview.
    ///
    /// This is a narrow main-thread lifecycle API for owners that retain a preview after its
    /// route becomes inactive. It does not create a platform view or mutate product state.
    pub fn deactivate(&self) {
        #[cfg(all(target_os = "macos", not(test)))]
        self.controller.deactivate();
    }
    #[cfg(test)]
    pub(crate) fn new_for_test(file: StagedLocalFile, kind: NativePreviewKind) -> Self {
        Self::new(file, kind)
    }
    /// Deterministic in-package gallery placeholder. Product callers cannot access it.
    pub(crate) fn gallery_fixture(kind: NativePreviewKind) -> Self {
        let mut source = Self::new(
            StagedLocalFile(PathBuf::from("/happy-gallery/staged-preview")),
            kind,
        );
        source.gallery_fallback = true;
        source
    }
}

#[derive(IntoElement)]
pub struct NativePreview {
    pub id: SharedString,
    pub theme: Theme,
    pub source: NativePreviewSource,
    /// Retained inactive tabs must set this false so their AppKit child cannot cover active GPUI.
    pub visible: bool,
}
impl RenderOnce for NativePreview {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        if self.source.gallery_fallback {
            return fallback(self.id, self.theme, self.source.kind, self.visible);
        }
        let id = self.id;
        let selector = id.clone();
        let root = div()
            .debug_selector(move || format!("{selector}.root"))
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden();
        #[cfg(all(target_os = "macos", not(test)))]
        {
            let controller = self.source.controller.clone();
            let owner = id.clone();
            let visible = self.visible;
            root.child(
                gpui::canvas(
                    |bounds, _, _| bounds,
                    move |bounds, _, window, _| {
                        // Narrow imperative paint exception: synchronize only the retained AppKit child's
                        // attachment, clipping, frame, and visibility with resolved GPUI geometry. This
                        // never mutates product/entity state and never invokes caller callbacks.
                        controller.paint(&owner, bounds, visible, window);
                    },
                )
                .size_full(),
            )
            .into_any_element()
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            fallback_child(root, id, self.theme, self.source.kind, self.visible)
        }
    }
}

fn fallback(
    id: SharedString,
    theme: Theme,
    kind: NativePreviewKind,
    visible: bool,
) -> gpui::AnyElement {
    let selector = id.clone();
    fallback_child(
        div()
            .debug_selector(move || format!("{selector}.root"))
            .size_full()
            .min_w_0()
            .min_h_0()
            .overflow_hidden(),
        id,
        theme,
        kind,
        visible,
    )
}
fn fallback_child(
    root: gpui::Div,
    id: SharedString,
    theme: Theme,
    kind: NativePreviewKind,
    visible: bool,
) -> gpui::AnyElement {
    let label = match kind {
        NativePreviewKind::Image => "Native image preview",
        NativePreviewKind::Html => "HTML preview",
        NativePreviewKind::Audio => "Audio preview",
        NativePreviewKind::Video => "Video preview",
        NativePreviewKind::Pdf => "PDF preview",
    };
    let icon = match kind {
        NativePreviewKind::Image => IconName::Image,
        NativePreviewKind::Audio => IconName::Mic,
        NativePreviewKind::Video => IconName::Play,
        NativePreviewKind::Html => IconName::Code,
        NativePreviewKind::Pdf => IconName::Doc,
    };
    root.child(
        div()
            .debug_selector(move || {
                format!(
                    "{id}.fallback.{}",
                    if visible { "visible" } else { "hidden" }
                )
            })
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.0))
            .bg(theme.role(ThemeRole::SurfaceHigh))
            .font_family(fonts::UI_FAMILY)
            .text_size(px(12.0))
            .text_color(theme.role(ThemeRole::TextSecondary))
            .opacity(if visible { 1.0 } else { 0.0 })
            .child(Icon::decorative(
                icon,
                24.0,
                theme.role(ThemeRole::FileData).into(),
                "native-preview-fallback-icon",
            ))
            .child(label),
    )
    .into_any_element()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct VisibilityLifecycle {
    hidden: bool,
    suspended: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct VisibilityChanges {
    hidden: Option<bool>,
    suspended: Option<bool>,
}
impl VisibilityLifecycle {
    fn initially_hidden() -> Self {
        Self {
            hidden: true,
            suspended: false,
        }
    }
    fn transition(&mut self, active: bool) -> VisibilityChanges {
        let hidden = !active;
        let suspended = !active;
        let changes = VisibilityChanges {
            hidden: (self.hidden != hidden).then_some(hidden),
            suspended: (self.suspended != suspended).then_some(suspended),
        };
        self.hidden = hidden;
        self.suspended = suspended;
        changes
    }
}

/// Resolves paints from cloned elements that share one native controller.
///
/// A visible paint takes ownership. Only that owner may later deactivate the child. Route-level
/// `NativePreviewSource::deactivate` intentionally bypasses this arbitration.
#[derive(Debug, Default, PartialEq, Eq)]
struct ActivePreviewOwner(Option<SharedString>);
impl ActivePreviewOwner {
    fn update(&mut self, owner: &SharedString, active: bool) -> bool {
        if active {
            self.0 = Some(owner.clone());
            true
        } else if self.0.as_ref() == Some(owner) {
            self.0 = None;
            true
        } else {
            false
        }
    }
    fn deactivate(&mut self) {
        self.0 = None;
    }
}

#[cfg(all(target_os = "macos", not(test)))]
mod mac {
    use super::{
        ActivePreviewOwner, NativePreviewKind, NavigationPolicy, StagedLocalFile,
        VisibilityLifecycle, navigation_policy,
    };
    use gpui::{Bounds, Pixels, SharedString, Window};
    use objc2::{
        DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, rc::Retained,
        runtime::ProtocolObject,
    };
    use objc2_app_kit::NSView;
    use objc2_foundation::{NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString, NSURL};
    use objc2_web_kit::{
        WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKPreferences,
        WKWebView, WKWebViewConfiguration, WKWebsiteDataStore,
    };
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::{
        cell::{Cell, RefCell},
        path::PathBuf,
    };

    struct NavigationDelegateIvars {
        allowed_file: PathBuf,
        allow_about: bool,
        initial_pending: Cell<bool>,
    }
    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = NavigationDelegateIvars]
        struct NavigationDelegate;
        unsafe impl NSObjectProtocol for NavigationDelegate {}
        unsafe impl WKNavigationDelegate for NavigationDelegate {
            #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
            unsafe fn decide_navigation(
                &self,
                _web_view: &WKWebView,
                action: &WKNavigationAction,
                decision: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>,
            ) {
                let request = unsafe { action.request() };
                let url = request.URL();
                let scheme = url
                    .as_ref()
                    .and_then(|url| url.scheme())
                    .map(|s| s.to_string());
                let path = url
                    .as_ref()
                    .and_then(|url| url.path())
                    .map(|s| PathBuf::from(s.to_string()));
                let has_fragment = url.as_ref().and_then(|url| url.fragment()).is_some();
                let initial = self.ivars().initial_pending.get();
                let policy = navigation_policy(
                    scheme.as_deref(),
                    path.as_deref(),
                    has_fragment,
                    &self.ivars().allowed_file,
                    self.ivars().allow_about,
                    initial,
                );
                if policy == NavigationPolicy::Allow {
                    self.ivars().initial_pending.set(false);
                }
                decision.call((if policy == NavigationPolicy::Allow {
                    WKNavigationActionPolicy::Allow
                } else {
                    WKNavigationActionPolicy::Cancel
                },));
            }
        }
    );
    impl NavigationDelegate {
        fn new(mtm: MainThreadMarker, allowed_file: PathBuf, allow_about: bool) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(NavigationDelegateIvars {
                allowed_file,
                allow_about,
                initial_pending: Cell::new(true),
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    pub(super) struct Controller {
        file: StagedLocalFile,
        kind: NativePreviewKind,
        state: RefCell<Option<NativeState>>,
    }
    struct NativeState {
        view: Retained<WKWebView>,
        _navigation_delegate: Retained<NavigationDelegate>,
        parent: *const NSView,
        lifecycle: VisibilityLifecycle,
        active_owner: ActivePreviewOwner,
    }
    impl NativeState {
        fn return_first_responder_to_parent(&self) {
            let Some(window) = self.view.window() else {
                return;
            };
            let Some(first_responder) = window.firstResponder() else {
                return;
            };
            let Ok(first_responder_view) = first_responder.downcast::<NSView>() else {
                return;
            };
            if std::ptr::eq(&*first_responder_view, &**self.view)
                || first_responder_view.isDescendantOf(&self.view)
            {
                // The raw window handle owns this host view for at least the attached child's
                // lifetime. Controller/NativeState are !Send and every entry point is guarded by
                // MainThreadMarker before AppKit is accessed.
                let parent = unsafe { &*self.parent };
                window.makeFirstResponder(Some(parent));
            }
        }
        fn set_active(&mut self, active: bool) {
            if !active {
                self.return_first_responder_to_parent();
            }
            let changes = self.lifecycle.transition(active);
            if active {
                if let Some(suspended) = changes.suspended {
                    unsafe {
                        self.view
                            .setAllMediaPlaybackSuspended_completionHandler(suspended, None);
                    }
                }
                if let Some(hidden) = changes.hidden {
                    self.view.setHidden(hidden);
                }
            } else {
                if let Some(hidden) = changes.hidden {
                    self.view.setHidden(hidden);
                }
                if let Some(suspended) = changes.suspended {
                    unsafe {
                        self.view
                            .setAllMediaPlaybackSuspended_completionHandler(suspended, None);
                    }
                }
            }
        }
    }
    // GPUI/AppKit access is main-thread-only. Rc keeps the controller on GPUI's main thread.

    impl Controller {
        pub(super) fn new(file: StagedLocalFile, kind: NativePreviewKind) -> Self {
            Self {
                file,
                kind,
                state: RefCell::new(None),
            }
        }
        pub(super) fn deactivate(&self) {
            let Some(_mtm) = MainThreadMarker::new() else {
                return;
            };
            if let Some(state) = self.state.borrow_mut().as_mut() {
                state.active_owner.deactivate();
                state.set_active(false);
            }
        }
        pub(super) fn paint(
            &self,
            owner: &SharedString,
            bounds: Bounds<Pixels>,
            visible: bool,
            window: &mut Window,
        ) {
            let active =
                visible && bounds.size.width > Pixels::ZERO && bounds.size.height > Pixels::ZERO;
            if !active {
                let Some(_mtm) = MainThreadMarker::new() else {
                    return;
                };
                if let Some(state) = self.state.borrow_mut().as_mut()
                    && state.active_owner.update(owner, false)
                {
                    state.set_active(false);
                }
                return;
            }
            let Ok(handle) = HasWindowHandle::window_handle(window) else {
                return;
            };
            let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
                return;
            };
            let parent_ptr = handle.ns_view.as_ptr().cast::<NSView>();
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let mut state = self.state.borrow_mut();
            if state.is_none() {
                *state = self.create(parent_ptr, mtm);
            }
            let Some(state) = state.as_mut() else {
                return;
            };
            state.active_owner.update(owner, true);
            if state.parent != parent_ptr {
                state.set_active(false);
                state.view.removeFromSuperview();
                unsafe {
                    (&*parent_ptr).addSubview(&state.view);
                }
                state.parent = parent_ptr;
            }
            let parent = unsafe { &*parent_ptr };
            let parent_bounds = parent.bounds();
            state.view.setFrame(NSRect::new(
                NSPoint::new(
                    parent_bounds.origin.x + bounds.origin.x.to_f64(),
                    parent_bounds.origin.y + parent_bounds.size.height
                        - bounds.origin.y.to_f64()
                        - bounds.size.height.to_f64(),
                ),
                NSSize::new(bounds.size.width.to_f64(), bounds.size.height.to_f64()),
            ));
            state.view.setClipsToBounds(true);
            state.set_active(true);
        }
        fn create(&self, parent: *const NSView, mtm: MainThreadMarker) -> Option<NativeState> {
            let config = unsafe { WKWebViewConfiguration::new(mtm) };
            let store = unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) };
            unsafe {
                config.setWebsiteDataStore(&store);
            }
            let preferences = unsafe { WKPreferences::new(mtm) };
            #[allow(deprecated)]
            unsafe {
                preferences.setJavaScriptEnabled(false);
            }
            unsafe {
                preferences.setJavaScriptCanOpenWindowsAutomatically(false);
                config.setPreferences(&preferences);
            }
            let view = unsafe {
                WKWebView::initWithFrame_configuration(
                    mtm.alloc(),
                    NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0)),
                    &config,
                )
            };
            let navigation_delegate = NavigationDelegate::new(
                mtm,
                self.file.as_path().to_path_buf(),
                matches!(
                    self.kind,
                    NativePreviewKind::Audio | NativePreviewKind::Video
                ),
            );
            unsafe {
                view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation_delegate)));
            }
            view.setClipsToBounds(true);
            view.setHidden(true);
            unsafe {
                (&*parent).addSubview(&view);
            }
            let file_string = NSString::from_str(&self.file.as_path().to_string_lossy());
            let file_url = NSURL::fileURLWithPath(&file_string);
            let directory = self.file.as_path().parent()?;
            let directory_string = NSString::from_str(&directory.to_string_lossy());
            let directory_url = NSURL::fileURLWithPath_isDirectory(&directory_string, true);
            match self.kind {
                NativePreviewKind::Image | NativePreviewKind::Pdf => unsafe {
                    view.loadFileURL_allowingReadAccessToURL(&file_url, &file_url);
                },
                NativePreviewKind::Html => unsafe {
                    view.loadFileURL_allowingReadAccessToURL(&file_url, &directory_url);
                },
                NativePreviewKind::Audio | NativePreviewKind::Video => {
                    let tag = if self.kind == NativePreviewKind::Audio {
                        "audio"
                    } else {
                        "video"
                    };
                    let src = html_escape(&self.file.as_path().file_name()?.to_string_lossy());
                    let wrapper = format!(
                        r#"<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'"><style>html,body{{width:100%;height:100%;margin:0;background:#000;display:flex;align-items:center;justify-content:center}}{tag}{{max-width:100%;max-height:100%}}</style><{tag} controls src="{src}"></{tag}>"#
                    );
                    let html = NSString::from_str(&wrapper);
                    unsafe {
                        view.loadHTMLString_baseURL(&html, Some(&directory_url));
                    }
                }
            }
            Some(NativeState {
                view,
                _navigation_delegate: navigation_delegate,
                parent,
                lifecycle: VisibilityLifecycle::initially_hidden(),
                active_owner: ActivePreviewOwner::default(),
            })
        }
    }
    impl Drop for Controller {
        fn drop(&mut self) {
            if let Some(mut state) = self.state.get_mut().take() {
                state.active_owner.deactivate();
                state.set_active(false);
                unsafe {
                    state.view.stopLoading();
                    state.view.setNavigationDelegate(None);
                }
                state.view.removeFromSuperview();
            }
        }
    }
    fn html_escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('"', "&quot;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{Context, Render, TestAppContext, size};
    struct Fixture {
        visible: bool,
    }
    impl Render for Fixture {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().w(px(560.0)).h(px(220.0)).child(NativePreview {
                id: "native".into(),
                theme: Theme::dark(),
                source: NativePreviewSource::new_for_test(
                    StagedLocalFile::new_for_test("/staged/file.pdf".into()),
                    NativePreviewKind::Pdf,
                ),
                visible: self.visible,
            })
        }
    }
    #[gpui::test]
    fn test_platform_uses_deterministic_fallback_geometry(cx: &mut TestAppContext) {
        let (view, cx) = cx.add_window_view(|_, _| Fixture { visible: true });
        cx.simulate_resize(size(px(560.0), px(220.0)));
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("native.fallback.visible").unwrap().size,
            size(px(560.0), px(220.0))
        );
        view.update(cx, |fixture, cx| {
            fixture.visible = false;
            cx.notify();
        });
        cx.run_until_parked();
        assert_eq!(
            cx.debug_bounds("native.fallback.hidden").unwrap().size,
            size(px(560.0), px(220.0))
        );
    }

    #[test]
    fn cloned_preview_non_owner_cannot_deactivate_active_child() {
        let embedded: SharedString = "embedded".into();
        let lightbox: SharedString = "lightbox".into();
        let mut owner = ActivePreviewOwner::default();

        assert!(owner.update(&embedded, true));
        assert!(owner.update(&lightbox, true));
        assert!(!owner.update(&embedded, false));
        assert_eq!(owner.0.as_ref(), Some(&lightbox));
        assert!(owner.update(&lightbox, false));
        assert_eq!(owner, ActivePreviewOwner::default());

        assert!(owner.update(&embedded, true));
        owner.deactivate();
        assert_eq!(owner, ActivePreviewOwner::default());
    }

    #[test]
    fn visibility_lifecycle_transitions_are_paired_and_idempotent() {
        let mut lifecycle = VisibilityLifecycle::initially_hidden();
        assert_eq!(
            lifecycle.transition(false),
            VisibilityChanges {
                hidden: None,
                suspended: Some(true),
            }
        );
        assert_eq!(lifecycle.transition(false), VisibilityChanges::default());
        assert_eq!(
            lifecycle.transition(true),
            VisibilityChanges {
                hidden: Some(false),
                suspended: Some(false),
            }
        );
        assert_eq!(lifecycle.transition(true), VisibilityChanges::default());
        assert_eq!(
            lifecycle.transition(false),
            VisibilityChanges {
                hidden: Some(true),
                suspended: Some(true),
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn stage_capability_rejects_files_outside_the_private_root() {
        use std::{
            fs,
            os::unix::fs::PermissionsExt,
            time::{SystemTime, UNIX_EPOCH},
        };
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!("happy-preview-{nonce}"));
        let stage = base.join("stage");
        let outside = base.join("outside");
        fs::create_dir_all(&stage).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::set_permissions(&stage, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&outside, fs::Permissions::from_mode(0o700)).unwrap();
        let staged_path = stage.join("preview.pdf");
        let outside_path = outside.join("private-key");
        fs::write(&staged_path, b"pdf").unwrap();
        fs::write(&outside_path, b"secret").unwrap();
        fs::set_permissions(&staged_path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::set_permissions(&outside_path, fs::Permissions::from_mode(0o600)).unwrap();
        let root = PreviewStageRoot::try_new(fs::canonicalize(&stage).unwrap()).unwrap();
        assert!(StagedLocalFile::try_new(&root, fs::canonicalize(&staged_path).unwrap()).is_ok());
        assert_eq!(
            StagedLocalFile::try_new(&root, fs::canonicalize(&outside_path).unwrap())
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::PermissionDenied
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn navigation_policy_allows_initial_local_document_fragments_and_exact_media_resource() {
        let allowed = Path::new("/stage/preview.html");
        assert_eq!(
            navigation_policy(Some("file"), Some(allowed), false, allowed, false, true),
            NavigationPolicy::Allow
        );
        assert_eq!(
            navigation_policy(Some("file"), Some(allowed), true, allowed, false, false),
            NavigationPolicy::Allow
        );
        for scheme in ["http", "https", "data", "javascript", "custom"] {
            assert_eq!(
                navigation_policy(Some(scheme), None, false, allowed, false, true),
                NavigationPolicy::Cancel
            );
        }
        assert_eq!(
            navigation_policy(
                Some("file"),
                Some(Path::new("/stage/sibling.html")),
                false,
                allowed,
                false,
                true
            ),
            NavigationPolicy::Cancel
        );
        assert_eq!(
            navigation_policy(Some("file"), Some(allowed), false, allowed, false, false),
            NavigationPolicy::Cancel
        );
        assert_eq!(
            navigation_policy(Some("file"), Some(allowed), false, allowed, true, false),
            NavigationPolicy::Allow
        );
        assert_eq!(
            navigation_policy(
                Some("file"),
                Some(Path::new("/stage")),
                false,
                allowed,
                true,
                true
            ),
            NavigationPolicy::Allow
        );
        assert_eq!(
            navigation_policy(None, None, false, allowed, true, true),
            NavigationPolicy::Allow
        );
        assert_eq!(
            navigation_policy(Some("about"), None, false, allowed, true, true),
            NavigationPolicy::Allow
        );
        assert_eq!(
            navigation_policy(Some("about"), None, false, allowed, true, false),
            NavigationPolicy::Cancel
        );
    }
}
