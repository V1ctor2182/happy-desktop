//! Retained native WebKit surface for remote browser tools.
//!
//! This is intentionally separate from `native_preview`: browser pages allow remote network
//! navigation, while file previews keep their narrow local-file capability unchanged. Page
//! JavaScript is disabled because WebKit cannot prove that every JavaScript networking API uses
//! the configured per-store proxy.

#[cfg(not(all(target_os = "macos", not(test))))]
use super::{Icon, IconName, theme_roles::ThemeRole};
#[cfg(not(all(target_os = "macos", not(test))))]
use crate::fonts;
#[cfg(all(target_os = "macos", not(test)))]
use crate::tools::browser_proxy::BrowserProxy;
use crate::{connectivity::TransportOptions, theme::Theme};
#[cfg(not(all(target_os = "macos", not(test))))]
use gpui::px;
use gpui::{App, IntoElement, RenderOnce, SharedString, Window, div, prelude::*};
use std::{collections::VecDeque, fmt, io, rc::Rc, sync::Arc};

const MAX_BROWSER_ADDRESS_BYTES: usize = 8_192;
const MAX_BROWSER_TITLE_BYTES: usize = 1_024;
const MAX_PENDING_BROWSER_REQUESTS: usize = 32;

fn bounded_title(value: &str) -> Arc<str> {
    if value.len() <= MAX_BROWSER_TITLE_BYTES {
        return Arc::from(value);
    }
    let mut end = MAX_BROWSER_TITLE_BYTES;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    Arc::from(&value[..end])
}

#[derive(Clone, PartialEq, Eq)]
pub struct BrowserAddress(Arc<str>);
impl BrowserAddress {
    pub fn parse(candidate: &str) -> Result<Self, BrowserAddressError> {
        // Bound the exact UTF-8 input before URL parsing. Never truncate an address into a
        // different request.
        if candidate.len() > MAX_BROWSER_ADDRESS_BYTES {
            return Err(BrowserAddressError);
        }
        if candidate == "about:blank" {
            return Ok(Self(Arc::from(candidate)));
        }
        let parsed = url::Url::parse(candidate).map_err(|_| BrowserAddressError)?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(BrowserAddressError);
        }
        Ok(Self(Arc::from(parsed.as_str())))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BrowserAddressError;
impl fmt::Display for BrowserAddressError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(
            "The browser address must be at most 8192 UTF-8 bytes and use HTTP, HTTPS, or about:blank.",
        )
    }
}
impl std::error::Error for BrowserAddressError {}

/// Requests emitted by page behavior. The product owner decides where a popup is placed.
#[derive(Clone, PartialEq, Eq)]
pub enum NativeBrowserRequest {
    PopupRequested { address: BrowserAddress },
}

#[derive(Clone, PartialEq, Eq)]
pub struct NativeBrowserSnapshot {
    pub address: BrowserAddress,
    pub title: Arc<str>,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub connected: bool,
    pub failure: Option<Arc<str>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeBrowserEvent {
    /// One or more snapshot fields or pending requests changed. Read the current snapshot and
    /// drain requests after receiving it. The bounded channel deliberately coalesces bursts.
    Changed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NativeBrowserConnectionError;
impl fmt::Display for NativeBrowserConnectionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("The native browser's secure connection could not be restored.")
    }
}
impl std::error::Error for NativeBrowserConnectionError {}

/// Background-prepared browser networking. Its workspace, transport options, credentials, and
/// listener remain private and cannot be inspected by product snapshots or error values.
pub struct NativeBrowserPreparation {
    #[cfg(all(target_os = "macos", not(test)))]
    workspace_id: String,
    #[cfg(all(target_os = "macos", not(test)))]
    options: TransportOptions,
    #[cfg(all(target_os = "macos", not(test)))]
    proxy: BrowserProxy,
}
impl NativeBrowserPreparation {
    /// Revokes a prepared listener without joining its worker threads on the caller.
    pub(crate) fn retire(self) {
        #[cfg(all(target_os = "macos", not(test)))]
        self.proxy.retire();
    }
}

/// An opaque, `Send` reconnect operation. Move it to a background executor and call `prepare`.
pub struct NativeBrowserReconnectPreparation {
    generation: u64,
    #[cfg(all(target_os = "macos", not(test)))]
    workspace_id: String,
    #[cfg(all(target_os = "macos", not(test)))]
    options: TransportOptions,
}

/// The opaque result of background reconnect preparation.
///
/// It can only be consumed by `NativeBrowserSource::connection_apply`; credentials, listener,
/// socket, and token state are never exposed.
pub struct NativeBrowserPreparedReconnect {
    generation: u64,
    #[cfg(all(target_os = "macos", not(test)))]
    proxy: Option<io::Result<BrowserProxy>>,
}

impl NativeBrowserReconnectPreparation {
    /// Reads authentication state and starts the loopback listener. This whole operation must run
    /// on a background executor, never in a GPUI render or input callback.
    pub fn prepare(self) -> NativeBrowserPreparedReconnect {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            NativeBrowserPreparedReconnect {
                generation: self.generation,
                proxy: Some(BrowserProxy::start(&self.workspace_id, self.options)),
            }
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            NativeBrowserPreparedReconnect {
                generation: self.generation,
            }
        }
    }
}

impl Drop for NativeBrowserPreparedReconnect {
    fn drop(&mut self) {
        #[cfg(all(target_os = "macos", not(test)))]
        if let Some(Ok(proxy)) = self.proxy.take() {
            // An owner can disappear before applying a background result. Revoke without joining
            // on whichever executor drops the opaque result.
            proxy.retire();
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeBrowserReconnectApply {
    Applied,
    /// A newer preparation or disconnect superseded this result. It did not change the browser.
    Stale,
}

#[derive(Clone)]
pub struct NativeBrowserSource {
    events: async_channel::Receiver<NativeBrowserEvent>,
    #[cfg(all(target_os = "macos", not(test)))]
    controller: Rc<mac::Controller>,
    #[cfg(not(all(target_os = "macos", not(test))))]
    state: Rc<std::cell::RefCell<FallbackState>>,
}
impl fmt::Debug for NativeBrowserSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("NativeBrowserSource")
            .finish_non_exhaustive()
    }
}
impl NativeBrowserSource {
    /// Performs token-file and listener setup. Call this on a background executor, never from a
    /// GPUI render or input callback.
    pub fn prepare(
        workspace_id: &str,
        options: TransportOptions,
    ) -> io::Result<NativeBrowserPreparation> {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            mac::require_proxy_support()?;
            let proxy = BrowserProxy::start(workspace_id, options.clone())?;
            Ok(NativeBrowserPreparation {
                workspace_id: workspace_id.to_owned(),
                options,
                proxy,
            })
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            let _ = (workspace_id, options);
            Ok(NativeBrowserPreparation {})
        }
    }

    /// Creates one main-thread browser lifetime from background-prepared networking.
    pub fn new(
        preparation: NativeBrowserPreparation,
        initial_address: BrowserAddress,
    ) -> io::Result<Self> {
        let (events_tx, events) = async_channel::bounded(1);
        #[cfg(all(target_os = "macos", not(test)))]
        {
            if let Err(error) = mac::require_main_thread() {
                preparation.retire();
                return Err(error);
            }
            Ok(Self {
                controller: Rc::new(mac::Controller::new(
                    initial_address,
                    preparation.workspace_id,
                    preparation.options,
                    preparation.proxy,
                    events_tx,
                )),
                events,
            })
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            let _ = preparation;
            Ok(Self {
                state: Rc::new(std::cell::RefCell::new(FallbackState::new(
                    initial_address,
                    events_tx,
                ))),
                events,
            })
        }
    }
    /// Returns the single-product-owner, bounded event receiver. Clones compete for the same
    /// coalesced wakeups; consumers must always reread `snapshot` and drain `take_requests`.
    pub fn event_receiver(&self) -> async_channel::Receiver<NativeBrowserEvent> {
        self.events.clone()
    }
    pub fn snapshot(&self) -> NativeBrowserSnapshot {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.snapshot()
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            self.state.borrow().snapshot.clone()
        }
    }
    pub fn navigate(&self, address: BrowserAddress) {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.navigate(address);
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            self.state.borrow_mut().navigate(address);
        }
    }
    pub fn back(&self) {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.back();
        }
    }
    pub fn forward(&self) {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.forward();
        }
    }
    pub fn reload(&self) {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.reload();
        }
    }
    pub fn stop(&self) {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.stop();
        }
    }
    /// Changes availability without replacing the retained WebKit view or its history.
    ///
    /// Going offline is synchronous and fail-closed. Going online only returns an opaque,
    /// `Send` operation; it performs no file or socket I/O. Run `prepare` on a background executor,
    /// then pass its opaque result to `connection_apply` on the GPUI main thread.
    pub fn connection_update(
        &self,
        connected: bool,
    ) -> Result<Option<NativeBrowserReconnectPreparation>, NativeBrowserConnectionError> {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.connection_update(connected)
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            let mut state = self.state.borrow_mut();
            state.generation = state.generation.wrapping_add(1);
            if !connected {
                state.snapshot.connected = false;
                state.snapshot.loading = false;
                state.snapshot.failure = None;
                state.notify();
                return Ok(None);
            }
            if state.snapshot.connected {
                return Ok(None);
            }
            Ok(Some(NativeBrowserReconnectPreparation {
                generation: state.generation,
            }))
        }
    }
    /// Applies prepared networking to the same retained store and view. Stale results are retired
    /// without changing state, so a newer disconnect can never be undone.
    pub fn connection_apply(
        &self,
        prepared: NativeBrowserPreparedReconnect,
    ) -> Result<NativeBrowserReconnectApply, NativeBrowserConnectionError> {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.connection_apply(prepared)
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            let mut state = self.state.borrow_mut();
            if state.snapshot.connected || prepared.generation != state.generation {
                return Ok(NativeBrowserReconnectApply::Stale);
            }
            state.snapshot.connected = true;
            state.snapshot.failure = None;
            state.notify();
            Ok(NativeBrowserReconnectApply::Applied)
        }
    }
    pub fn take_requests(&self) -> Vec<NativeBrowserRequest> {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.take_requests()
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            self.state.borrow_mut().requests.drain(..).collect()
        }
    }
    pub fn deactivate(&self) {
        #[cfg(all(target_os = "macos", not(test)))]
        {
            self.controller.deactivate();
        }
    }
}

#[cfg(not(all(target_os = "macos", not(test))))]
struct FallbackState {
    snapshot: NativeBrowserSnapshot,
    generation: u64,
    requests: VecDeque<NativeBrowserRequest>,
    events: async_channel::Sender<NativeBrowserEvent>,
}
#[cfg(not(all(target_os = "macos", not(test))))]
impl FallbackState {
    fn new(address: BrowserAddress, events: async_channel::Sender<NativeBrowserEvent>) -> Self {
        Self {
            snapshot: NativeBrowserSnapshot {
                address,
                title: Arc::from("Browser"),
                loading: false,
                can_go_back: false,
                can_go_forward: false,
                connected: true,
                failure: None,
            },
            generation: 0,
            requests: VecDeque::new(),
            events,
        }
    }
    fn navigate(&mut self, address: BrowserAddress) {
        if !self.snapshot.connected {
            return;
        }
        self.snapshot.address = address;
        self.notify();
    }
    fn notify(&self) {
        let _ = self.events.try_send(NativeBrowserEvent::Changed);
    }
}

#[derive(IntoElement)]
pub struct NativeBrowser {
    pub id: SharedString,
    pub theme: Theme,
    pub source: NativeBrowserSource,
    pub visible: bool,
}
impl RenderOnce for NativeBrowser {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
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
            let owner = id;
            let visible = self.visible;
            root.child(
                gpui::canvas(
                    |bounds, _, _| bounds,
                    move |bounds, _, window, _| {
                        controller.paint(&owner, bounds, visible, window);
                    },
                )
                .size_full(),
            )
            .into_any_element()
        }
        #[cfg(not(all(target_os = "macos", not(test))))]
        {
            root.child(
                div()
                    .debug_selector(move || format!("{id}.fallback"))
                    .size_full()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(8.0))
                    .bg(self.theme.role(ThemeRole::SurfaceHigh))
                    .font_family(fonts::UI_FAMILY)
                    .text_size(px(12.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .opacity(if self.visible { 1.0 } else { 0.0 })
                    .child(Icon::decorative(
                        IconName::Globe,
                        24.0,
                        self.theme.role(ThemeRole::TextLink).into(),
                        "native-browser-fallback-icon",
                    ))
                    .child("Native browser"),
            )
            .into_any_element()
        }
    }
}

#[derive(Debug, Default)]
struct ActiveOwner(Option<SharedString>);
impl ActiveOwner {
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
    fn clear(&mut self) {
        self.0 = None;
    }
}

#[cfg(all(target_os = "macos", not(test)))]
mod mac {
    use super::*;
    use gpui::{Bounds, Pixels};
    use objc2::{
        DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
        rc::Retained,
        runtime::{NSObjectProtocol, ProtocolObject, Sel},
    };
    use objc2_app_kit::NSView;
    use objc2_foundation::{
        NSArray, NSObject, NSPoint, NSRect, NSSize, NSString, NSURL, NSURLRequest,
    };
    use objc2_web_kit::{
        WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKNavigationType,
        WKPreferences, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore,
    };
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::{
        cell::RefCell,
        ffi::{CStr, CString, c_char, c_void},
        mem::ManuallyDrop,
        ptr::NonNull,
    };

    pub(super) fn require_main_thread() -> io::Result<MainThreadMarker> {
        MainThreadMarker::new().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::Other,
                "The native browser must be created on the main thread.",
            )
        })
    }

    pub(super) fn require_proxy_support() -> io::Result<()> {
        let Some(class) = objc2::runtime::AnyClass::get(c"WKWebsiteDataStore") else {
            return Err(unsupported());
        };
        let selector = Sel::register(c"setProxyConfigurations:");
        let supported: bool = unsafe { msg_send![class, instancesRespondToSelector: selector] };
        if supported {
            Ok(())
        } else {
            Err(unsupported())
        }
    }
    fn unsupported() -> io::Error {
        io::Error::new(
            io::ErrorKind::Unsupported,
            "Native browser networking requires macOS 14 or later.",
        )
    }

    struct NavigationIvars {
        state: Rc<RefCell<ControllerState>>,
    }
    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = NavigationIvars]
        struct NavigationDelegate;
        unsafe impl NSObjectProtocol for NavigationDelegate {}
        unsafe impl WKNavigationDelegate for NavigationDelegate {
            #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
            unsafe fn decide(
                &self,
                _view: &WKWebView,
                action: &WKNavigationAction,
                decision: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>,
            ) {
                let request = unsafe { action.request() };
                let allowed = self.ivars().state.borrow().snapshot.connected
                    && request
                        .URL()
                        .as_ref()
                        .and_then(|url| address_from_url(url))
                        .is_some();
                decision.call((if allowed {
                    WKNavigationActionPolicy::Allow
                } else {
                    WKNavigationActionPolicy::Cancel
                },));
            }
            #[unsafe(method(webView:didStartProvisionalNavigation:))]
            unsafe fn started(&self, view: &WKWebView, _navigation: *mut NSObject) {
                update_view_state(view, &self.ivars().state, true, None);
            }
            #[unsafe(method(webView:didFinishNavigation:))]
            unsafe fn finished(&self, view: &WKWebView, _navigation: *mut NSObject) {
                update_view_state(view, &self.ivars().state, false, None);
            }
            #[unsafe(method(webView:didFailNavigation:withError:))]
            unsafe fn failed(
                &self,
                view: &WKWebView,
                _navigation: *mut NSObject,
                _error: &NSObject,
            ) {
                update_view_state(
                    view,
                    &self.ivars().state,
                    false,
                    Some("The page could not be loaded."),
                );
            }
            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            unsafe fn provisional_failed(
                &self,
                view: &WKWebView,
                _navigation: *mut NSObject,
                _error: &NSObject,
            ) {
                update_view_state(
                    view,
                    &self.ivars().state,
                    false,
                    Some("The page could not be loaded."),
                );
            }
            #[unsafe(method(webViewWebContentProcessDidTerminate:))]
            unsafe fn content_process_terminated(&self, view: &WKWebView) {
                update_view_state(
                    view,
                    &self.ivars().state,
                    false,
                    Some("The page process stopped unexpectedly."),
                );
            }
        }
    );
    impl NavigationDelegate {
        fn new(mtm: MainThreadMarker, state: Rc<RefCell<ControllerState>>) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(NavigationIvars { state });
            unsafe { msg_send![super(this), init] }
        }
    }

    struct UiIvars {
        state: Rc<RefCell<ControllerState>>,
    }
    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        #[ivars = UiIvars]
        struct UiDelegate;
        unsafe impl NSObjectProtocol for UiDelegate {}
        impl UiDelegate {
            #[unsafe(method(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
            unsafe fn popup(&self, _view: &WKWebView, _configuration: &WKWebViewConfiguration, action: &WKNavigationAction, _features: &NSObject) -> *mut NSObject {
                // `navigationType` is the public action property that distinguishes a direct link
                // activation from script and other page-driven popup attempts. Deny every type
                // whose user initiation cannot be established from that public value.
                if unsafe { action.navigationType() } != WKNavigationType::LinkActivated {
                    return std::ptr::null_mut();
                }
                let request = unsafe { action.request() };
                if self.ivars().state.borrow().snapshot.connected {
                    if let Some(address) = request.URL().as_ref().and_then(|url| address_from_url(url)) {
                        self.ivars().state.borrow_mut().push_request(
                            NativeBrowserRequest::PopupRequested { address },
                        );
                    }
                }
                std::ptr::null_mut()
            }
            #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
            unsafe fn media_permission(&self, _view: &WKWebView, _origin: &NSObject, _frame: &NSObject, _capture_type: isize, decision: &block2::DynBlock<dyn Fn(isize)>) {
                // WKPermissionDecisionDeny. No page-controlled prompt reaches product UI.
                decision.call((2,));
            }
            #[unsafe(method(webView:requestDeviceOrientationAndMotionPermissionForOrigin:initiatedByFrame:decisionHandler:))]
            unsafe fn motion_permission(&self, _view: &WKWebView, _origin: &NSObject, _frame: &NSObject, decision: &block2::DynBlock<dyn Fn(isize)>) {
                // WKPermissionDecisionDeny.
                decision.call((2,));
            }
            #[unsafe(method(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:))]
            unsafe fn open_panel(&self, _view: &WKWebView, _parameters: &NSObject, _frame: &NSObject, completion: &block2::DynBlock<dyn Fn(*mut NSArray<NSURL>)>) {
                // File-system capabilities are never delegated to remote browser content.
                completion.call((std::ptr::null_mut(),));
            }
        }
    );
    impl UiDelegate {
        fn new(mtm: MainThreadMarker, state: Rc<RefCell<ControllerState>>) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(UiIvars { state });
            unsafe { msg_send![super(this), init] }
        }
    }

    struct ControllerState {
        snapshot: NativeBrowserSnapshot,
        requests: VecDeque<NativeBrowserRequest>,
        events: async_channel::Sender<NativeBrowserEvent>,
    }
    impl ControllerState {
        fn notify(&self) {
            let _ = self.events.try_send(NativeBrowserEvent::Changed);
        }
        fn push_request(&mut self, request: NativeBrowserRequest) {
            if self.requests.len() == MAX_PENDING_BROWSER_REQUESTS {
                self.requests.pop_front();
            }
            self.requests.push_back(request);
            self.notify();
        }
    }
    pub(super) struct Controller {
        workspace_id: String,
        options: TransportOptions,
        generation: std::cell::Cell<u64>,
        proxy: RefCell<Option<BrowserProxy>>,
        state: Rc<RefCell<ControllerState>>,
        native: RefCell<Option<NativeState>>,
    }
    struct NativeState {
        view: Retained<WKWebView>,
        store: Retained<WKWebsiteDataStore>,
        _navigation_delegate: Retained<NavigationDelegate>,
        _ui_delegate: Retained<UiDelegate>,
        _proxy_configuration: NetworkProxyConfiguration,
        parent: *const NSView,
        active_owner: ActiveOwner,
        hidden: bool,
    }
    impl NativeState {
        fn set_active(&mut self, active: bool) {
            if !active {
                self.return_first_responder();
            }
            if self.hidden != !active {
                self.hidden = !active;
                self.view.setHidden(self.hidden);
                unsafe {
                    self.view
                        .setAllMediaPlaybackSuspended_completionHandler(!active, None);
                }
            }
        }
        fn return_first_responder(&self) {
            let Some(window) = self.view.window() else {
                return;
            };
            let Some(responder) = window.firstResponder() else {
                return;
            };
            let Ok(responder) = responder.downcast::<NSView>() else {
                return;
            };
            if std::ptr::eq(&*responder, &**self.view) || responder.isDescendantOf(&self.view) {
                let parent = unsafe { &*self.parent };
                window.makeFirstResponder(Some(parent));
            }
        }
    }
    impl Controller {
        pub(super) fn new(
            address: BrowserAddress,
            workspace_id: String,
            options: TransportOptions,
            proxy: BrowserProxy,
            events: async_channel::Sender<NativeBrowserEvent>,
        ) -> Self {
            Self {
                workspace_id,
                options,
                generation: std::cell::Cell::new(0),
                proxy: RefCell::new(Some(proxy)),
                state: Rc::new(RefCell::new(ControllerState {
                    snapshot: NativeBrowserSnapshot {
                        address,
                        title: Arc::from("Browser"),
                        loading: false,
                        can_go_back: false,
                        can_go_forward: false,
                        connected: true,
                        failure: None,
                    },
                    requests: VecDeque::new(),
                    events,
                })),
                native: RefCell::new(None),
            }
        }
        pub(super) fn snapshot(&self) -> NativeBrowserSnapshot {
            self.state.borrow().snapshot.clone()
        }
        pub(super) fn take_requests(&self) -> Vec<NativeBrowserRequest> {
            self.state.borrow_mut().requests.drain(..).collect()
        }
        pub(super) fn navigate(&self, address: BrowserAddress) {
            if !self.state.borrow().snapshot.connected {
                return;
            }
            {
                let mut state = self.state.borrow_mut();
                state.snapshot.address = address.clone();
                state.snapshot.failure = None;
                state.notify();
            }
            if let Some(mtm) = MainThreadMarker::new()
                && let Some(native) = self.native.borrow().as_ref()
            {
                load(&native.view, &address, mtm);
            }
        }
        pub(super) fn back(&self) {
            if !self.state.borrow().snapshot.connected {
                return;
            }
            if MainThreadMarker::new().is_some()
                && let Some(native) = self.native.borrow().as_ref()
            {
                unsafe {
                    native.view.goBack();
                }
            }
        }
        pub(super) fn forward(&self) {
            if !self.state.borrow().snapshot.connected {
                return;
            }
            if MainThreadMarker::new().is_some()
                && let Some(native) = self.native.borrow().as_ref()
            {
                unsafe {
                    native.view.goForward();
                }
            }
        }
        pub(super) fn reload(&self) {
            if !self.state.borrow().snapshot.connected {
                return;
            }
            if MainThreadMarker::new().is_some()
                && let Some(native) = self.native.borrow().as_ref()
            {
                unsafe {
                    native.view.reload();
                }
            }
        }
        pub(super) fn stop(&self) {
            if MainThreadMarker::new().is_some()
                && let Some(native) = self.native.borrow().as_ref()
            {
                unsafe {
                    native.view.stopLoading();
                }
            }
        }
        pub(super) fn connection_update(
            &self,
            connected: bool,
        ) -> Result<Option<NativeBrowserReconnectPreparation>, NativeBrowserConnectionError>
        {
            let generation = self.generation.get().wrapping_add(1);
            self.generation.set(generation);
            if !connected {
                // Revoke the capability first. Dropping the proxy shuts down its listener, every
                // accepted client, and every corresponding Happy Agent Unix-socket tunnel.
                let old_proxy = self.proxy.borrow_mut().take();
                drop(old_proxy);
                self.stop();
                self.deactivate();
                let mut state = self.state.borrow_mut();
                state.snapshot.connected = false;
                state.snapshot.loading = false;
                state.snapshot.failure = None;
                state.notify();
                return Ok(None);
            }
            if self.state.borrow().snapshot.connected {
                return Ok(None);
            }
            Ok(Some(NativeBrowserReconnectPreparation {
                generation,
                workspace_id: self.workspace_id.clone(),
                options: self.options.clone(),
            }))
        }
        pub(super) fn connection_apply(
            &self,
            mut prepared: NativeBrowserPreparedReconnect,
        ) -> Result<NativeBrowserReconnectApply, NativeBrowserConnectionError> {
            if prepared.generation != self.generation.get()
                || self.state.borrow().snapshot.connected
            {
                if let Some(Ok(proxy)) = prepared.proxy.take() {
                    retire_proxy(proxy);
                }
                return Ok(NativeBrowserReconnectApply::Stale);
            }
            if self.native.borrow().is_some() && MainThreadMarker::new().is_none() {
                if let Some(Ok(proxy)) = prepared.proxy.take() {
                    retire_proxy(proxy);
                }
                self.record_connection_failure();
                return Err(NativeBrowserConnectionError);
            }
            let new_proxy = match prepared.proxy.take() {
                Some(Ok(proxy)) => proxy,
                Some(Err(_)) => {
                    self.record_connection_failure();
                    return Err(NativeBrowserConnectionError);
                }
                None => return Err(NativeBrowserConnectionError),
            };
            if let Some(native) = self.native.borrow_mut().as_mut() {
                let configuration =
                    match NetworkProxyConfiguration::new(&new_proxy).and_then(|configuration| {
                        configuration.apply(&native.store)?;
                        Ok(configuration)
                    }) {
                        Ok(configuration) => configuration,
                        Err(_) => {
                            retire_proxy(new_proxy);
                            self.record_connection_failure();
                            return Err(NativeBrowserConnectionError);
                        }
                    };
                native._proxy_configuration = configuration;
            }
            *self.proxy.borrow_mut() = Some(new_proxy);
            let mut state = self.state.borrow_mut();
            state.snapshot.connected = true;
            state.snapshot.failure = None;
            state.notify();
            Ok(NativeBrowserReconnectApply::Applied)
        }
        fn record_connection_failure(&self) {
            self.proxy.borrow_mut().take();
            let mut state = self.state.borrow_mut();
            state.snapshot.connected = false;
            state.snapshot.loading = false;
            state.snapshot.failure = Some(Arc::from(NativeBrowserConnectionError.to_string()));
            state.notify();
        }
        pub(super) fn deactivate(&self) {
            if MainThreadMarker::new().is_none() {
                return;
            }
            if let Some(native) = self.native.borrow_mut().as_mut() {
                native.active_owner.clear();
                native.set_active(false);
            }
        }
        pub(super) fn paint(
            &self,
            owner: &SharedString,
            bounds: Bounds<Pixels>,
            visible: bool,
            window: &mut Window,
        ) {
            let connected = self.state.borrow().snapshot.connected;
            let active = connected
                && visible
                && bounds.size.width > Pixels::ZERO
                && bounds.size.height > Pixels::ZERO;
            if !active {
                if MainThreadMarker::new().is_some()
                    && let Some(native) = self.native.borrow_mut().as_mut()
                    && native.active_owner.update(owner, false)
                {
                    native.set_active(false);
                }
                return;
            }
            let Ok(handle) = HasWindowHandle::window_handle(window) else {
                return;
            };
            let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
                return;
            };
            let parent = handle.ns_view.as_ptr().cast::<NSView>();
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let mut native = self.native.borrow_mut();
            if native.is_none() {
                match self.create(parent, mtm) {
                    Ok(created) => *native = Some(created),
                    Err(_) => {
                        drop(native);
                        self.record_connection_failure();
                        return;
                    }
                }
            }
            let Some(native) = native.as_mut() else {
                return;
            };
            native.active_owner.update(owner, true);
            if native.parent != parent {
                native.set_active(false);
                native.view.removeFromSuperview();
                unsafe {
                    (&*parent).addSubview(&native.view);
                }
                native.parent = parent;
            }
            let parent_bounds = unsafe { (&*parent).bounds() };
            native.view.setFrame(NSRect::new(
                NSPoint::new(
                    parent_bounds.origin.x + bounds.origin.x.to_f64(),
                    parent_bounds.origin.y + parent_bounds.size.height
                        - bounds.origin.y.to_f64()
                        - bounds.size.height.to_f64(),
                ),
                NSSize::new(bounds.size.width.to_f64(), bounds.size.height.to_f64()),
            ));
            native.view.setClipsToBounds(true);
            native.set_active(true);
        }
        fn create(&self, parent: *const NSView, mtm: MainThreadMarker) -> io::Result<NativeState> {
            let store = unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) };
            let proxy = self.proxy.borrow();
            let proxy = proxy.as_ref().ok_or_else(connection_unavailable)?;
            let proxy_configuration = NetworkProxyConfiguration::new(proxy)?;
            proxy_configuration.apply(&store)?;
            let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
            unsafe {
                configuration.setWebsiteDataStore(&store);
            }
            let preferences = unsafe { WKPreferences::new(mtm) };
            #[allow(deprecated)]
            unsafe {
                // Phase 7 fails closed here. WKWebView has no public per-store guarantee that
                // WebRTC, ICE, STUN, TURN, or data-channel traffic uses the configured proxy, so
                // JavaScript must remain fully disabled rather than relying on injection or
                // private selectors to block individual APIs.
                preferences.setJavaScriptEnabled(false);
                preferences.setJavaScriptCanOpenWindowsAutomatically(false);
                configuration.setPreferences(&preferences);
            }
            // The proxy selector and complete fail-closed Network configuration exist before this point.
            let view = unsafe {
                WKWebView::initWithFrame_configuration(
                    mtm.alloc(),
                    NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0)),
                    &configuration,
                )
            };
            let navigation_delegate = NavigationDelegate::new(mtm, Rc::clone(&self.state));
            let ui_delegate = UiDelegate::new(mtm, Rc::clone(&self.state));
            unsafe {
                view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation_delegate)));
                let _: () = msg_send![&view, setUIDelegate: &*ui_delegate];
            }
            // Remove WKWebView's NSDraggingDestination registrations so remote content cannot
            // receive file URLs or file contents through drag/drop. This does not disable normal
            // mouse interaction or text selection.
            view.unregisterDraggedTypes();
            view.setHidden(true);
            view.setClipsToBounds(true);
            unsafe {
                (&*parent).addSubview(&view);
            }
            load(&view, &self.state.borrow().snapshot.address, mtm);
            Ok(NativeState {
                view,
                store,
                _navigation_delegate: navigation_delegate,
                _ui_delegate: ui_delegate,
                _proxy_configuration: proxy_configuration,
                parent,
                active_owner: ActiveOwner::default(),
                hidden: true,
            })
        }
    }
    impl Drop for Controller {
        fn drop(&mut self) {
            if let Some(mut native) = self.native.get_mut().take() {
                native.active_owner.clear();
                native.set_active(false);
                unsafe {
                    native.view.stopLoading();
                    native.view.setNavigationDelegate(None);
                    let _: () =
                        msg_send![&native.view, setUIDelegate: std::ptr::null::<NSObject>()];
                }
                native.view.removeFromSuperview();
            }
        }
    }

    fn retire_proxy(proxy: BrowserProxy) {
        // Stale prepared listeners are revoked immediately, while thread joins are detached from
        // GPUI. Synchronous offline transitions continue to use BrowserProxy::drop directly.
        proxy.retire();
    }

    fn connection_unavailable() -> io::Error {
        io::Error::new(
            io::ErrorKind::NotConnected,
            "Native browser networking is offline.",
        )
    }

    fn load(view: &WKWebView, address: &BrowserAddress, _mtm: MainThreadMarker) {
        let string = NSString::from_str(address.as_str());
        let Some(url) = NSURL::URLWithString(&string) else {
            return;
        };
        let request = NSURLRequest::requestWithURL(&url);
        unsafe {
            view.loadRequest(&request);
        }
    }
    fn address_from_url(url: &NSURL) -> Option<BrowserAddress> {
        BrowserAddress::parse(&url.absoluteString()?.to_string()).ok()
    }
    fn update_view_state(
        view: &WKWebView,
        state: &RefCell<ControllerState>,
        loading: bool,
        failure: Option<&str>,
    ) {
        let mut state = state.borrow_mut();
        let connected = state.snapshot.connected;
        state.snapshot.loading = loading && connected;
        state.snapshot.failure = if connected {
            failure.map(Arc::from)
        } else {
            None
        };
        unsafe {
            if let Some(url) = view.URL().as_ref().and_then(|url| address_from_url(url)) {
                state.snapshot.address = url;
            }
            let title = view
                .title()
                .map(|value| value.to_string())
                .unwrap_or_default();
            if !title.is_empty() {
                state.snapshot.title = bounded_title(&title);
            }
            state.snapshot.can_go_back = view.canGoBack();
            state.snapshot.can_go_forward = view.canGoForward();
        }
        state.notify();
    }

    type EndpointCreate = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut NSObject;
    type ProxyCreate = unsafe extern "C" fn(*mut NSObject, *mut NSObject) -> *mut NSObject;
    type CredentialsSet = unsafe extern "C" fn(*mut NSObject, *const c_char, *const c_char);
    type FailoverSet = unsafe extern "C" fn(*mut NSObject, bool);
    struct NetworkProxyConfiguration {
        configurations: ManuallyDrop<Retained<NSArray<NSObject>>>,
        library: NonNull<c_void>,
    }
    impl NetworkProxyConfiguration {
        fn new(proxy: &BrowserProxy) -> io::Result<Self> {
            let path =
                CString::new("/System/Library/Frameworks/Network.framework/Network").unwrap();
            let library = NonNull::new(unsafe {
                libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL)
            })
            .ok_or_else(unsupported)?;
            let result = (|| unsafe {
                let endpoint_create: EndpointCreate = symbol(library, c"nw_endpoint_create_host")?;
                let proxy_create: ProxyCreate =
                    symbol(library, c"nw_proxy_config_create_http_connect")?;
                let credentials_set: CredentialsSet =
                    symbol(library, c"nw_proxy_config_set_username_and_password")?;
                let failover_set: FailoverSet =
                    symbol(library, c"nw_proxy_config_set_failover_allowed")?;
                let host = CString::new("127.0.0.1").unwrap();
                let port = CString::new(proxy.port().to_string()).unwrap();
                let endpoint = Retained::from_raw(endpoint_create(host.as_ptr(), port.as_ptr()))
                    .ok_or_else(unsupported)?;
                let configuration = Retained::from_raw(proxy_create(
                    Retained::as_ptr(&endpoint).cast_mut(),
                    std::ptr::null_mut(),
                ))
                .ok_or_else(unsupported)?;
                let username = CString::new(proxy.username()).map_err(|_| unsupported())?;
                let password = CString::new(proxy.password()).map_err(|_| unsupported())?;
                credentials_set(
                    Retained::as_ptr(&configuration).cast_mut(),
                    username.as_ptr(),
                    password.as_ptr(),
                );
                let mut username = username.into_bytes_with_nul();
                let mut password = password.into_bytes_with_nul();
                username.fill(0);
                password.fill(0);
                failover_set(Retained::as_ptr(&configuration).cast_mut(), false);
                let configurations = NSArray::arrayWithObject(&*configuration);
                Ok(Self {
                    configurations: ManuallyDrop::new(configurations),
                    library,
                })
            })();
            if result.is_err() {
                unsafe {
                    libc::dlclose(library.as_ptr());
                }
            }
            result
        }
        fn apply(&self, store: &WKWebsiteDataStore) -> io::Result<()> {
            let selector = Sel::register(c"setProxyConfigurations:");
            let responds: bool = unsafe { msg_send![store, respondsToSelector: selector] };
            if !responds {
                return Err(unsupported());
            }
            unsafe {
                let _: () = msg_send![store, setProxyConfigurations: &**self.configurations];
            }
            Ok(())
        }
    }
    impl Drop for NetworkProxyConfiguration {
        fn drop(&mut self) {
            // Release Network objects before unloading the framework implementation they own.
            unsafe {
                ManuallyDrop::drop(&mut self.configurations);
                libc::dlclose(self.library.as_ptr());
            }
        }
    }
    unsafe fn symbol<T: Copy>(library: NonNull<c_void>, name: &CStr) -> io::Result<T> {
        let pointer = unsafe { libc::dlsym(library.as_ptr(), name.as_ptr()) };
        if pointer.is_null() {
            Err(unsupported())
        } else {
            Ok(unsafe { std::mem::transmute_copy(&pointer) })
        }
    }
}
