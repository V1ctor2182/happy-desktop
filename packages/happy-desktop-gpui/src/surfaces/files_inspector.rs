use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet, VecDeque},
    rc::Rc,
    sync::Arc,
};
use unicode_width::UnicodeWidthChar;

use gpui::{
    AnyElement, App, Context, Entity, FocusHandle, ImageFormat, IntoElement, Render, SharedString,
    Subscription, Window, div, prelude::*, px,
};

use crate::{
    connectivity::{
        ConnectivityController, FileTreeEntryType, GitComparison, GitFileChange, GitFileStatus,
        GitState, WorkspaceKey,
    },
    files::{
        DiffLimit, DocumentPayload, FileAvailability, FileBrowserStore, FileDocumentStore,
        FileFamily, FilePresentation, FilePresentationKind, ImageProbe, LoadState, MarkdownLink,
        PresentationCacheKey, PreviewStageKey, ProjectionLimit, RelativeDirectoryPath,
        RelativeFilePath, SanitizedHtmlPreview, StagedRawPreview, file_family, project_line_diff,
        resolve_markdown_link,
    },
    fonts,
    navigation::FileKind,
    theme::Theme,
    ui::{
        Button, ButtonVariant, ControlSize, IconName, ScrollbarAppearance, ScrollbarPlacement,
        ScrollbarState, SharedScrollHandle, TabItem, TabSelectHandler, Tabs, TabsSize,
        chat_markdown::{MarkdownDocument, MarkdownLinkActivate, MarkdownLinkTarget},
        file_browser::{
            FileBrowser, FileBrowserChangeStats, FileBrowserEntry, FileBrowserEntryKind,
            FileBrowserFocusHandles, FileBrowserIconFamily, FileBrowserLayout,
            FileBrowserListState, FileBrowserScope, FileBrowserStatus,
        },
        file_diff::{
            FileDiff, FileDiffContentWidths, FileDiffFocus, FileDiffLine, FileDiffLineKind,
            FileDiffListState, FileDiffMode, FileDiffPreviewLine, FileDiffStats, FileDiffText,
        },
        file_editor::{FileEditor, FileEditorFocus, FileEditorMode, FileEditorState},
        file_preview::{
            BinaryFact, FilePreview, FilePreviewKind, FilePreviewLightbox, PreviewLightboxMedia,
            embedded_native_visible,
        },
        native_preview::NativePreviewSource,
        text_area::{TextArea, TextAreaEvent, TextAreaLayout},
        theme_roles::ThemeRole,
    },
};

use super::{BackgroundPreparation, BackgroundStaged, DecodedImageKey, FilePresentationServices};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FilesInspectorNavigation {
    ClosePreview,
    Preview {
        source: RelativeFilePath,
        path: RelativeFilePath,
        kind: FileKind,
    },
    Main {
        path: RelativeFilePath,
        kind: FileKind,
        ephemeral: bool,
    },
}
pub type FilesInspectorNavigationHandler = Rc<dyn Fn(FilesInspectorNavigation, &mut App)>;

enum StagedLease {
    Raw(StagedRawPreview),
    Html(SanitizedHtmlPreview),
}
impl StagedLease {
    fn key(&self) -> PreviewStageKey {
        match self {
            Self::Raw(value) => value.key(),
            Self::Html(value) => value.key(),
        }
    }
}
enum PreparedDocument {
    Editor,
    Markdown(MarkdownDocument),
    MarkdownUnavailable(Arc<str>),
    Image {
        image: Arc<gpui::Image>,
        dimensions: (u32, u32),
        key: super::DecodedImageKey,
    },
    NativeImage {
        source: NativePreviewSource,
        _lease: StagedLease,
    },
    Html {
        source: NativePreviewSource,
        _lease: StagedLease,
    },
    HtmlUnavailable(Arc<str>),
    Audio {
        source: NativePreviewSource,
        _lease: StagedLease,
    },
    Video {
        source: NativePreviewSource,
        _lease: StagedLease,
    },
    Pdf {
        source: NativePreviewSource,
        _lease: StagedLease,
    },
    DormantNative {
        kind: FilePresentationKind,
        key: PreviewStageKey,
    },
    DormantHtml {
        key: PreviewStageKey,
    },
    Binary {
        facts: Vec<BinaryFact>,
    },
    Unavailable(Arc<str>),
}

#[derive(Clone)]
struct GitDiffSpec {
    change: GitFileChange,
    base: Option<Arc<str>>,
    old_path: RelativeFilePath,
    old_store: Option<Entity<FileDocumentStore>>,
}
struct DiffUi {
    spec: GitDiffSpec,
    mode: FileDiffMode,
    wrap: bool,
    generation: u64,
    pending: bool,
    in_flight: bool,
    text: Option<FileDiffText>,
    requested: Option<FileDiffText>,
    lines: Rc<Vec<FileDiffLine>>,
    preview_lines: Rc<Vec<FileDiffPreviewLine>>,
    list: FileDiffListState,
    preview_list: FileDiffListState,
    scrollbar: Entity<ScrollbarState>,
    horizontal_scrollbar: Entity<ScrollbarState>,
    content_widths: FileDiffContentWidths,
    preview_scrollbar: Entity<ScrollbarState>,
    focus: FileDiffFocus,
    notice: Option<SharedString>,
    stats: Option<FileDiffStats>,
    error: Option<Arc<str>>,
    old_subscription: Option<Subscription>,
}

struct DocumentUi {
    store: Entity<FileDocumentStore>,
    editor: Entity<TextArea>,
    mode: FileEditorMode,
    wrap: bool,
    focus: FileEditorFocus,
    _subscriptions: Vec<Subscription>,
}

/// One retained document presentation. Moving this entity between the inspector and main content
/// moves the same editor, selection, IME, draft, and scroll identity; it never creates a second
/// product snapshot or transport request.
#[derive(Clone, Debug, PartialEq, Eq)]
struct PreparationTag {
    hash: Arc<str>,
    draft_revision: u64,
    generation: u64,
    from_draft: bool,
}

pub struct FileDocumentSurface {
    workspace: Arc<str>,
    path: RelativeFilePath,
    kind: FileKind,
    theme: Theme,
    retained_placement: bool,
    visible: bool,
    ephemeral_placement: bool,
    editable_placement: bool,
    services: Rc<RefCell<FilePresentationServices>>,
    prepared_tag: Option<PreparationTag>,
    reopening: bool,
    preparing: Option<PreparationTag>,
    prepare_pending: bool,
    prepare_generation: u64,
    prepared_size: Option<usize>,
    highlight_notice: Option<SharedString>,
    prepared: Option<PreparedDocument>,
    lightbox_open: bool,
    lightbox_overlay_focus: FocusHandle,
    lightbox_open_focus: FocusHandle,
    lightbox_close_focus: FocusHandle,
    markdown_link: MarkdownLinkActivate,
    diff_generation: u64,
    pending_diff_spec: Option<Option<GitDiffSpec>>,
    diff: Option<DiffUi>,
    ui: DocumentUi,
}

impl FileDocumentSurface {
    fn new(
        store: Entity<FileDocumentStore>,
        workspace: Arc<str>,
        path: RelativeFilePath,
        theme: Theme,
        services: Rc<RefCell<FilePresentationServices>>,
        on_navigate: FilesInspectorNavigationHandler,
        cx: &mut Context<Self>,
    ) -> Self {
        let snapshot = store.read(cx).snapshot().clone();
        let initial = document_text(&snapshot).unwrap_or_default();
        let editor = cx.new({
            let path = path.clone();
            move |cx| {
                let mut area = TextArea::new(
                    format!("file-editor:{}", path.as_str()),
                    initial,
                    "",
                    theme,
                    cx,
                );
                area.set_layout(
                    TextAreaLayout::Editor {
                        wrap: false,
                        line_numbers: true,
                    },
                    cx,
                );
                area.set_read_only(true, cx);
                area
            }
        });
        let edit_store = store.clone();
        let edit_path = path.clone();
        let edit_navigate = on_navigate.clone();
        let edit_subscription = cx.subscribe(&editor, move |this, _, event, cx| {
            if let TextAreaEvent::Changed { value } = event {
                this.highlight_notice = None;
                if this.ephemeral_placement {
                    this.ephemeral_placement = false;
                    let navigate = edit_navigate.clone();
                    let event = FilesInspectorNavigation::Main {
                        path: edit_path.clone(),
                        kind: this.kind,
                        ephemeral: false,
                    };
                    cx.defer(move |cx| navigate(event, cx));
                }
                edit_store.update(cx, |store, cx| {
                    store.text_update(value.as_ref());
                    cx.notify();
                });
            }
        });
        let observe_editor = editor.clone();
        let store_subscription = cx.observe(&store, move |_this, store, cx| {
            let snapshot = store.read(cx).snapshot().clone();
            if let Some(text) = document_text(&snapshot)
                && observe_editor.read(cx).value().as_ref() != text.as_str()
            {
                observe_editor.update(cx, |area, cx| area.set_value(text, cx));
            }
            observe_editor.update(cx, |area, cx| {
                area.set_read_only(
                    !(_this.editable_placement
                        && matches!(snapshot.payload, Some(DocumentPayload::EditableText(_)))),
                    cx,
                );
            });
            _this.prepare(cx);
            _this.diff_projection_reconcile(cx);
            cx.notify();
        });

        let link_path = path.clone();
        let markdown_link: MarkdownLinkActivate =
            Rc::new(move |target, _window, cx| match target {
                MarkdownLinkTarget::Http(url) => cx.open_url(url.as_ref()),
                MarkdownLinkTarget::WorkspaceRelative(target) => {
                    match resolve_markdown_link(&link_path, target.as_ref()) {
                        MarkdownLink::InternalFile { path, .. } => on_navigate(
                            FilesInspectorNavigation::Preview {
                                source: link_path.clone(),
                                path,
                                kind: FileKind::File,
                            },
                            cx,
                        ),
                        MarkdownLink::AbsoluteHttp(url) => cx.open_url(url.as_ref()),
                        MarkdownLink::SameDocumentAnchor(_) | MarkdownLink::Rejected => {}
                    }
                }
                MarkdownLinkTarget::SameDocumentAnchor(_) => {}
            });
        let mut this = Self {
            workspace,
            path,
            kind: FileKind::File,
            theme,
            retained_placement: false,
            visible: false,
            ephemeral_placement: false,
            editable_placement: false,
            services,
            prepared_tag: None,
            reopening: false,
            preparing: None,
            prepare_pending: false,
            prepare_generation: 0,
            prepared_size: None,
            highlight_notice: None,
            prepared: None,
            lightbox_open: false,
            lightbox_overlay_focus: cx.focus_handle(),
            lightbox_open_focus: cx.focus_handle(),
            lightbox_close_focus: cx.focus_handle(),
            markdown_link,
            diff_generation: 0,
            pending_diff_spec: None,
            diff: None,
            ui: DocumentUi {
                store,
                editor,
                mode: FileEditorMode::Source,
                wrap: false,
                focus: FileEditorFocus {
                    wrap: cx.focus_handle(),
                    rendered: cx.focus_handle(),
                    source: cx.focus_handle(),
                    revert: cx.focus_handle(),
                },
                _subscriptions: vec![edit_subscription, store_subscription],
            },
        };
        this.prepare(cx);
        this
    }
    fn prepare(&mut self, cx: &mut Context<Self>) {
        let snapshot = self.ui.store.read(cx).snapshot().clone();
        if !self.visible {
            return;
        }
        let Some(hash) = snapshot.authoritative_hash.clone() else {
            return;
        };
        let base_matches = |tag: &PreparationTag| {
            tag.hash == hash && tag.draft_revision == snapshot.draft_revision
        };
        if self.prepared_tag.as_ref().is_some_and(base_matches) {
            let staged = matches!(
                self.prepared,
                Some(
                    PreparedDocument::NativeImage { .. }
                        | PreparedDocument::Audio { .. }
                        | PreparedDocument::Video { .. }
                        | PreparedDocument::Pdf { .. }
                )
            );
            if staged
                && !self.prepared_tag.as_ref().is_some_and(|tag| tag.from_draft)
                && snapshot.payload.is_some()
            {
                self.ui.store.update(cx, |store, cx| {
                    store.payload_release_after_staging(hash.clone());
                    cx.notify();
                });
            }
            return;
        }
        if self.preparing.as_ref().is_some_and(base_matches) {
            return;
        }
        if self.preparing.is_some() {
            self.prepare_pending = true;
            return;
        }
        let bytes: Arc<[u8]> = if let Some(draft) = snapshot.draft.as_ref() {
            Arc::from(draft.as_bytes())
        } else {
            match snapshot.payload.as_ref() {
                Some(
                    DocumentPayload::EditableText(value) | DocumentPayload::ReadOnlyText(value),
                ) => Arc::from(value.as_bytes()),
                Some(DocumentPayload::Binary(value)) => value.clone(),
                None => return,
            }
        };
        self.prepare_generation = self.prepare_generation.saturating_add(1);
        let tag = PreparationTag {
            hash: hash.clone(),
            draft_revision: snapshot.draft_revision,
            generation: self.prepare_generation,
            from_draft: snapshot.draft.is_some(),
        };
        self.preparing = Some(tag.clone());
        self.prepare_pending = false;
        let background = self.services.borrow().background.clone();
        let path = self.path.clone();
        let revision: Arc<str> = Arc::from(format!("{}:{}", hash, snapshot.draft_revision));
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let prepared = executor
                .spawn(async move {
                    background
                        .lock()
                        .map_err(|_| Arc::from("File presentation service is unavailable."))
                        .map(|mut services| services.prepare(path, revision, bytes))
                })
                .await;
            this.update(cx, |this, cx| {
                if this.preparing.as_ref() != Some(&tag) {
                    return;
                }
                let current = this.ui.store.read(cx).snapshot();
                let current_matches = this.visible
                    && current.authoritative_hash.as_ref() == Some(&tag.hash)
                    && current.draft_revision == tag.draft_revision;
                this.preparing = None;
                if !current_matches {
                    this.prepare_pending = true;
                    this.prepare(cx);
                    return;
                }
                match prepared {
                    Ok(prepared) => this.preparation_apply(tag.clone(), prepared, cx),
                    Err(error) => {
                        this.prepared = Some(PreparedDocument::Unavailable(error));
                        this.prepared_tag = Some(tag.clone());
                    }
                }
                let pending = std::mem::take(&mut this.prepare_pending);
                cx.notify();
                if pending {
                    this.prepare(cx);
                }
            })
            .ok();
        })
        .detach();
    }
    fn preparation_apply(
        &mut self,
        tag: PreparationTag,
        prepared: BackgroundPreparation,
        cx: &mut Context<Self>,
    ) {
        let size = prepared.bytes.len();
        let staging_error = prepared.error.clone();
        let document = match prepared.presentation.kind {
            FilePresentationKind::EditableText | FilePresentationKind::ReadOnlyText => {
                if let Some(parsed) = prepared.parsed {
                    let projection_limited = parsed.limit != ProjectionLimit::Complete;
                    let text_status = self.ui.editor.update(cx, |area, cx| {
                        area.set_highlights((*parsed.highlights).clone(), cx)
                    });
                    self.highlight_notice = (projection_limited || text_status.limit_truncated)
                        .then(|| {
                            "Syntax highlighting was limited to the safe presentation bounds."
                                .into()
                        });
                }
                PreparedDocument::Editor
            }
            FilePresentationKind::Markdown => prepared
                .markdown
                .map(PreparedDocument::Markdown)
                .unwrap_or_else(|| {
                    PreparedDocument::MarkdownUnavailable(Arc::from(
                        "Rendered Markdown is unavailable above the safe 250,000-character limit.",
                    ))
                }),
            FilePresentationKind::GpuiImage => {
                let format = match prepared.presentation.extension.as_deref() {
                    Some("png") => Some(ImageFormat::Png),
                    Some("jpg" | "jpeg") => Some(ImageFormat::Jpeg),
                    Some("gif") => Some(ImageFormat::Gif),
                    Some("webp") => Some(ImageFormat::Webp),
                    _ => None,
                };
                match (format, prepared.presentation.image) {
                    (Some(format), ImageProbe::Safe(dimensions)) => {
                        let key = DecodedImageKey {
                            workspace: self.workspace.clone(),
                            path: Arc::from(self.path.as_str()),
                            hash: tag.hash.clone(),
                        };
                        match self.services.borrow_mut().image_decode(
                            key.clone(),
                            format,
                            prepared.bytes,
                            dimensions.estimated_rgba_bytes(),
                            cx,
                        ) {
                            Ok(image) => PreparedDocument::Image {
                                image,
                                dimensions: (dimensions.width, dimensions.height),
                                key,
                            },
                            Err(error) => PreparedDocument::Unavailable(error),
                        }
                    }
                    _ => PreparedDocument::Unavailable(Arc::from(
                        "This image cannot be decoded safely.",
                    )),
                }
            }
            FilePresentationKind::Html => {
                match prepared.staged {
                    Some(BackgroundStaged::Html(lease)) => match lease.sanitized_source() {
                        Ok(source) => PreparedDocument::Html {
                            source: NativePreviewSource::sanitized_html(source),
                            _lease: StagedLease::Html(lease),
                        },
                        Err(error) => PreparedDocument::Unavailable(Arc::from(error.to_string())),
                    },
                    _ => PreparedDocument::HtmlUnavailable(staging_error.clone().unwrap_or_else(
                        || Arc::from("HTML rendered preview staging is unavailable."),
                    )),
                }
            }
            FilePresentationKind::NativeImage
            | FilePresentationKind::Audio
            | FilePresentationKind::Video
            | FilePresentationKind::Pdf => match prepared.staged {
                Some(BackgroundStaged::Raw(lease)) => match lease.staged_file() {
                    Ok(file) => match prepared.presentation.kind {
                        FilePresentationKind::NativeImage => PreparedDocument::NativeImage {
                            source: NativePreviewSource::image(file),
                            _lease: StagedLease::Raw(lease),
                        },
                        FilePresentationKind::Audio => PreparedDocument::Audio {
                            source: NativePreviewSource::audio(file),
                            _lease: StagedLease::Raw(lease),
                        },
                        FilePresentationKind::Video => PreparedDocument::Video {
                            source: NativePreviewSource::video(file),
                            _lease: StagedLease::Raw(lease),
                        },
                        _ => PreparedDocument::Pdf {
                            source: NativePreviewSource::pdf(file),
                            _lease: StagedLease::Raw(lease),
                        },
                    },
                    Err(error) => PreparedDocument::Unavailable(Arc::from(error.to_string())),
                },
                _ => PreparedDocument::Unavailable(
                    staging_error
                        .clone()
                        .unwrap_or_else(|| Arc::from("Native preview staging is unavailable.")),
                ),
            },
            FilePresentationKind::Binary => PreparedDocument::Binary {
                facts: vec![
                    BinaryFact {
                        label: "Type".into(),
                        value: "Binary file".into(),
                    },
                    BinaryFact {
                        label: "Size".into(),
                        value: format!("{size} bytes").into(),
                    },
                ],
            },
            FilePresentationKind::Unsupported => PreparedDocument::Unavailable(Arc::from(
                "This file format is not supported for safe preview.",
            )),
        };
        let staged = matches!(
            document,
            PreparedDocument::NativeImage { .. }
                | PreparedDocument::Audio { .. }
                | PreparedDocument::Video { .. }
                | PreparedDocument::Pdf { .. }
        );
        if let PreparedDocument::Image { key, .. } = &document {
            self.services.borrow_mut().image_pin(key, self.visible);
        }
        self.prepared_size = Some(size);
        self.prepared = Some(document);
        self.prepared_tag = Some(tag.clone());
        if staged && !tag.from_draft {
            self.ui.store.update(cx, |store, cx| {
                store.payload_release_after_staging(tag.hash);
                cx.notify();
            });
        }
    }
    fn file_kind_reconcile(
        &mut self,
        kind: FileKind,
        spec: Option<GitDiffSpec>,
        cx: &mut Context<Self>,
    ) {
        self.kind = kind;
        self.git_diff_reconcile(spec, cx);
    }
    fn git_diff_reconcile(&mut self, spec: Option<GitDiffSpec>, cx: &mut Context<Self>) {
        let spec = if self.kind == FileKind::Diff {
            spec
        } else {
            None
        };
        if !self.visible {
            self.pending_diff_spec = Some(spec);
            return;
        }
        let same = self
            .diff
            .as_ref()
            .zip(spec.as_ref())
            .is_some_and(|(current, next)| {
                current.spec.base == next.base
                    && current.spec.old_path == next.old_path
                    && current.spec.change == next.change
            });
        if same {
            self.diff_projection_reconcile(cx);
            return;
        }
        if let Some(diff) = self.diff.take() {
            if let Some(old) = diff.spec.old_store {
                old.update(cx, |store, cx| {
                    store.document_retain(false);
                    store.document_visibility_update(false);
                    cx.notify();
                });
            }
        }
        let Some(spec) = spec else {
            cx.notify();
            return;
        };
        let empty_lines = Rc::new(Vec::<FileDiffLine>::new());
        let empty_preview = Rc::new(Vec::<FileDiffPreviewLine>::new());
        let list = FileDiffListState::new(&empty_lines);
        let preview_list = FileDiffListState::new_preview(&empty_preview);
        let scrollbar = cx.new({
            let list = list.clone();
            move |_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Automatic,
                    ScrollbarPlacement::Overlay,
                    list.list_state(),
                )
            }
        });
        let horizontal_scrollbar = cx.new(|_| {
            ScrollbarState::horizontal(
                ScrollbarAppearance::Automatic,
                ScrollbarPlacement::Overlay,
                SharedScrollHandle::new(),
            )
        });
        let preview_scrollbar = cx.new({
            let list = preview_list.clone();
            move |_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Automatic,
                    ScrollbarPlacement::Overlay,
                    list.list_state(),
                )
            }
        });
        let old_subscription = spec.old_store.as_ref().map(|old| {
            cx.observe(old, |this, _, cx| {
                this.diff_projection_reconcile(cx);
                cx.notify();
            })
        });
        if let (Some(base), Some(old)) = (spec.base.as_ref(), spec.old_store.as_ref()) {
            let needs = old
                .read(cx)
                .snapshot()
                .revisions
                .get(base)
                .is_none_or(|revision| {
                    matches!(
                        revision.state,
                        LoadState::Idle | LoadState::Evicted | LoadState::Failed(_)
                    )
                });
            if needs {
                old.update(cx, |store, cx| {
                    store.revision_load(base.clone());
                    cx.notify();
                });
            }
            old.update(cx, |store, cx| {
                store.document_retain(true);
                store.document_visibility_update(false);
                cx.notify();
            });
        }
        self.diff = Some(DiffUi {
            spec,
            mode: FileDiffMode::Preview,
            wrap: false,
            generation: 0,
            pending: false,
            in_flight: false,
            text: None,
            requested: None,
            lines: empty_lines,
            preview_lines: empty_preview,
            list,
            preview_list,
            scrollbar,
            horizontal_scrollbar,
            content_widths: FileDiffContentWidths::default(),
            preview_scrollbar,
            focus: FileDiffFocus {
                wrap: cx.focus_handle(),
                preview: cx.focus_handle(),
                unified: cx.focus_handle(),
                split: cx.focus_handle(),
                edit: cx.focus_handle(),
            },
            notice: None,
            stats: None,
            error: None,
            old_subscription,
        });
        self.diff_projection_reconcile(cx);
        cx.notify();
    }
    fn diff_projection_reconcile(&mut self, cx: &mut Context<Self>) {
        let Some(diff) = self.diff.as_mut() else {
            return;
        };
        if diff.spec.change.binary || matches!(diff.spec.change.status, GitFileStatus::Submodule) {
            diff.error = Some(Arc::from("Binary and submodule diffs are unavailable."));
            return;
        }
        let old: Arc<str> = if diff.spec.base.is_none()
            && matches!(
                diff.spec.change.status,
                GitFileStatus::Added | GitFileStatus::Untracked
            ) {
            Arc::from("")
        } else if diff.spec.base.is_none() {
            diff.error = Some(Arc::from("The exact Git base revision is unavailable."));
            return;
        } else {
            let Some(base) = diff.spec.base.as_ref() else {
                return;
            };
            let Some(store) = diff.spec.old_store.as_ref() else {
                diff.error = Some(Arc::from("The Git base revision is unavailable."));
                return;
            };
            let snapshot = store.read(cx).snapshot();
            let Some(revision) = snapshot.revisions.get(base) else {
                return;
            };
            match revision.payload.as_ref() {
                Some(
                    DocumentPayload::EditableText(value) | DocumentPayload::ReadOnlyText(value),
                ) => value.clone(),
                Some(DocumentPayload::Binary(_)) => {
                    diff.error = Some(Arc::from("The base revision is binary."));
                    return;
                }
                None => {
                    match &revision.state {
                        LoadState::Failed(message) => diff.error = Some(message.clone()),
                        LoadState::Evicted => {
                            diff.error = Some(Arc::from(
                                "The Git base revision left the safe cache; reopen the diff to retry.",
                            ))
                        }
                        _ => {}
                    }
                    return;
                }
            }
        };
        let new: Arc<str> = if diff.spec.change.status == GitFileStatus::Deleted {
            Arc::from("")
        } else {
            let snapshot = self.ui.store.read(cx).snapshot();
            match snapshot.payload.as_ref() {
                Some(
                    DocumentPayload::EditableText(value) | DocumentPayload::ReadOnlyText(value),
                ) => value.clone(),
                Some(DocumentPayload::Binary(_)) => {
                    diff.error = Some(Arc::from("The current file is binary."));
                    return;
                }
                None => return,
            }
        };
        if old.len() > 1_000_000 || new.len() > 1_000_000 {
            diff.error = Some(Arc::from(
                "Diff input exceeds the safe projection byte limit.",
            ));
            diff.stats = None;
            diff.notice =
                Some("Exact preview and counts are unavailable for this large diff.".into());
            return;
        }
        let text = FileDiffText {
            old: old.to_string().into(),
            new: new.to_string().into(),
        };
        if diff.requested.as_ref() == Some(&text) && diff.error.is_none() {
            return;
        }
        diff.requested = Some(text);
        diff.error = None;
        if diff.in_flight {
            diff.pending = true;
            return;
        }
        self.diff_projection_start(cx);
    }
    fn diff_projection_start(&mut self, cx: &mut Context<Self>) {
        let Some(diff) = self.diff.as_mut() else {
            return;
        };
        let Some(text) = diff.requested.clone() else {
            return;
        };
        self.diff_generation = self.diff_generation.saturating_add(1);
        let generation = self.diff_generation;
        diff.generation = generation;
        diff.in_flight = true;
        diff.pending = false;
        let old: Arc<str> = Arc::from(text.old.as_ref());
        let new: Arc<str> = Arc::from(text.new.as_ref());
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let (projected, preview, preview_truncated, stats, widths) = executor.spawn(async move {
                let projected = project_line_diff(&old, &new); let mut preview = Vec::new(); let mut truncated = false;
                if projected.limit != DiffLimit::InputTooLarge { for (index, value) in new.split('\n').enumerate() { if index == 20_000 { truncated = true; break; } preview.push(FileDiffPreviewLine { id: format!("preview-{}", index + 1).into(), line: (index + 1) as u32, text: value.to_owned().into() }); } }
                let cells = |value: &str| { let mut column = 0usize; for ch in value.chars() { column = if ch == '\t' { ((column / 4) + 1) * 4 } else { column.saturating_add(ch.width().unwrap_or(0)) }; } column };
                let mut added = 0u32; let mut removed = 0u32; let mut old_cells = 0usize; let mut new_cells = 0usize;
                for line in projected.lines.iter() { match line.kind { FileDiffLineKind::Added => added = added.saturating_add(1), FileDiffLineKind::Removed => removed = removed.saturating_add(1), FileDiffLineKind::Changed => { added = added.saturating_add(1); removed = removed.saturating_add(1); }, _ => {} } old_cells = old_cells.max(line.old_text.as_ref().map(|value| cells(value.as_ref())).unwrap_or(0)); new_cells = new_cells.max(line.new_text.as_ref().map(|value| cells(value.as_ref())).unwrap_or(0)); }
                let preview_cells = preview.iter().map(|line| cells(line.text.as_ref())).max().unwrap_or(0); let stats = (projected.limit != DiffLimit::InputTooLarge).then_some(FileDiffStats { added, removed, counts_exact: projected.limit == DiffLimit::Complete }); let widths = FileDiffContentWidths { preview: 80.0 + preview_cells as f32 * 8.0, unified: 96.0 + old_cells.max(new_cells) as f32 * 8.0, split_old: 72.0 + old_cells as f32 * 8.0, split_new: 72.0 + new_cells as f32 * 8.0 }; (projected, preview, truncated, stats, widths)
            }).await;
            this.update(cx, |this, cx| { let Some(diff) = this.diff.as_mut() else { return; }; if diff.generation != generation { return; } diff.in_flight = false; if !this.visible { diff.pending = true; return; } let is_current = diff.requested.as_ref() == Some(&text); if is_current { let lines = Rc::new((*projected.lines).clone()); diff.list.reconcile(&lines); diff.lines = lines; diff.preview_list.reconcile_preview(&preview); diff.preview_lines = Rc::new(preview); diff.stats = stats; diff.content_widths = widths; diff.notice = match projected.limit { DiffLimit::Complete if preview_truncated => Some("Current preview is truncated to 20,000 lines.".into()), DiffLimit::Complete => None, DiffLimit::TimedCoarse => Some(if preview_truncated { "Diff is coarse and current preview is truncated to 20,000 lines." } else { "Diff used a bounded coarse projection." }.into()), DiffLimit::TruncatedOutput => Some("Diff output was truncated to the safe limit.".into()), DiffLimit::InputTooLarge => Some("Diff input exceeds the safe projection limit; exact current preview is unavailable.".into()) }; diff.text = Some(text.clone()); }
                let rerun = diff.pending || !is_current; diff.pending = false; cx.notify(); if rerun { this.diff_projection_start(cx); }
            }).ok();
        }).detach();
    }

    fn staged_demote(&mut self) {
        let Some(prepared) = self.prepared.take() else {
            return;
        };
        self.prepared = Some(match prepared {
            PreparedDocument::NativeImage { _lease: lease, .. } => {
                PreparedDocument::DormantNative {
                    kind: FilePresentationKind::NativeImage,
                    key: lease.key(),
                }
            }
            PreparedDocument::Audio { _lease: lease, .. } => PreparedDocument::DormantNative {
                kind: FilePresentationKind::Audio,
                key: lease.key(),
            },
            PreparedDocument::Video { _lease: lease, .. } => PreparedDocument::DormantNative {
                kind: FilePresentationKind::Video,
                key: lease.key(),
            },
            PreparedDocument::Pdf { _lease: lease, .. } => PreparedDocument::DormantNative {
                kind: FilePresentationKind::Pdf,
                key: lease.key(),
            },
            PreparedDocument::Html { _lease: lease, .. } => {
                PreparedDocument::DormantHtml { key: lease.key() }
            }
            value => value,
        });
    }
    fn staged_reopen(&mut self, cx: &mut Context<Self>) {
        if self.reopening || !self.visible {
            return;
        }
        let (kind, key) = match self.prepared.as_ref() {
            Some(PreparedDocument::DormantNative { kind, key }) => (Some(*kind), key.clone()),
            Some(PreparedDocument::DormantHtml { key }) => (None, key.clone()),
            _ => return,
        };
        let tag = self.prepared_tag.clone();
        self.reopening = true;
        let background = self.services.borrow().background.clone();
        let executor = cx.background_executor().clone();
        cx.spawn(async move |this, cx| {
            let reopened = executor
                .spawn(async move {
                    background
                        .lock()
                        .ok()
                        .and_then(|mut service| service.reopen(&key))
                })
                .await;
            this.update(cx, |this, cx| {
                this.reopening = false;
                let current = this.ui.store.read(cx).snapshot();
                let valid = this.visible
                    && tag.as_ref().is_some_and(|tag| {
                        current.authoritative_hash.as_ref() == Some(&tag.hash)
                            && current.draft_revision == tag.draft_revision
                    });
                if !valid {
                    return;
                }
                match reopened {
                    Some(BackgroundStaged::Raw(lease)) => match lease.staged_file() {
                        Ok(file) => {
                            this.prepared = Some(match kind {
                                Some(FilePresentationKind::NativeImage) => {
                                    PreparedDocument::NativeImage {
                                        source: NativePreviewSource::image(file),
                                        _lease: StagedLease::Raw(lease),
                                    }
                                }
                                Some(FilePresentationKind::Audio) => PreparedDocument::Audio {
                                    source: NativePreviewSource::audio(file),
                                    _lease: StagedLease::Raw(lease),
                                },
                                Some(FilePresentationKind::Video) => PreparedDocument::Video {
                                    source: NativePreviewSource::video(file),
                                    _lease: StagedLease::Raw(lease),
                                },
                                _ => PreparedDocument::Pdf {
                                    source: NativePreviewSource::pdf(file),
                                    _lease: StagedLease::Raw(lease),
                                },
                            });
                        }
                        Err(_) => this.ui.store.update(cx, |store, cx| {
                            store.document_load();
                            cx.notify();
                        }),
                    },
                    Some(BackgroundStaged::Html(lease)) => match lease.sanitized_source() {
                        Ok(source) => {
                            this.prepared = Some(PreparedDocument::Html {
                                source: NativePreviewSource::sanitized_html(source),
                                _lease: StagedLease::Html(lease),
                            })
                        }
                        Err(_) => {
                            this.prepared_tag = None;
                            this.prepare(cx);
                        }
                    },
                    None if kind.is_none() => {
                        this.prepared_tag = None;
                        this.prepare(cx);
                    }
                    None => this.ui.store.update(cx, |store, cx| {
                        store.document_load();
                        cx.notify();
                    }),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn recent_demote(&mut self, cx: &mut Context<Self>) {
        self.native_deactivate();
        self.staged_demote();
        self.diff_generation = self.diff_generation.saturating_add(1);
        if let Some(diff) = self.diff.as_mut() {
            diff.in_flight = false;
            diff.pending = false;
            diff.text = None;
            diff.requested = None;
            diff.lines = Rc::new(Vec::new());
            diff.preview_lines = Rc::new(Vec::new());
            diff.stats = None;
            diff.content_widths = FileDiffContentWidths::default();
            diff.notice = None;
            diff.list.reconcile(&diff.lines);
            diff.preview_list.reconcile_preview(&diff.preview_lines);
            if let Some(old) = diff.spec.old_store.as_ref() {
                old.update(cx, |store, cx| {
                    store.document_retain(false);
                    store.document_visibility_update(false);
                    cx.notify();
                });
            }
        }
    }

    fn editable_placement_reconcile(&mut self, editable: bool, cx: &mut Context<Self>) {
        if self.editable_placement == editable {
            return;
        }
        self.editable_placement = editable;
        let editable_payload = matches!(
            self.ui.store.read(cx).snapshot().payload,
            Some(DocumentPayload::EditableText(_))
        );
        self.ui.editor.update(cx, |area, cx| {
            area.set_read_only(!(editable && editable_payload), cx)
        });
        cx.notify();
    }

    fn visibility_reconcile(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible == visible {
            return;
        }
        self.visible = visible;
        if !visible {
            self.lightbox_open = false;
            self.native_deactivate();
        } else {
            if let Some(spec) = self.pending_diff_spec.take() {
                self.git_diff_reconcile(spec, cx);
            }
            self.staged_reopen(cx);
            self.prepare(cx);
            self.diff_projection_reconcile(cx);
        }
        cx.notify();
    }
    fn native_deactivate(&self) {
        match self.prepared.as_ref() {
            Some(
                PreparedDocument::NativeImage { source, .. }
                | PreparedDocument::Html { source, .. }
                | PreparedDocument::Audio { source, .. }
                | PreparedDocument::Pdf { source, .. },
            ) => source.deactivate(),
            Some(PreparedDocument::Video { source, .. }) => source.deactivate(),
            _ => {}
        }
    }
    pub fn path(&self) -> &RelativeFilePath {
        &self.path
    }
    pub fn dirty(&self, cx: &App) -> bool {
        let snapshot = self.ui.store.read(cx).snapshot();
        let authoritative = match snapshot.payload.as_ref() {
            Some(DocumentPayload::EditableText(value) | DocumentPayload::ReadOnlyText(value)) => {
                Some(value.as_ref())
            }
            _ => None,
        };
        snapshot.draft.as_deref() != None && snapshot.draft.as_deref() != authoritative
    }
    pub fn theme_reconcile(&mut self, theme: Theme, cx: &mut Context<Self>) {
        if self.theme != theme {
            self.theme = theme;
            self.ui
                .editor
                .update(cx, |area, cx| area.theme_reconcile(theme, cx));
            cx.notify();
        }
    }
}
fn document_text(snapshot: &crate::connectivity::FileDocumentSnapshot) -> Option<String> {
    snapshot
        .draft
        .as_ref()
        .map(|v| v.to_string())
        .or_else(|| match snapshot.payload.as_ref() {
            Some(DocumentPayload::EditableText(v)) => Some(v.to_string()),
            Some(DocumentPayload::ReadOnlyText(v)) => {
                let mut projected: String = v.chars().take(250_000).collect();
                if projected.len() < v.len() {
                    projected.push_str(
                        "

… Read-only preview truncated …",
                    );
                }
                Some(projected)
            }
            _ => None,
        })
}
impl Render for FileDocumentSurface {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let snapshot = self.ui.store.read(cx).snapshot().clone();
        let path = self.path.as_str().to_owned();
        let authoritative_text = match snapshot.payload.as_ref() {
            Some(DocumentPayload::EditableText(value) | DocumentPayload::ReadOnlyText(value)) => {
                Some(value.as_ref())
            }
            _ => None,
        };
        let dirty = snapshot
            .draft
            .as_deref()
            .is_some_and(|draft| Some(draft) != authoritative_text);
        let state = FileEditorState {
            dirty,
            read_only: !self.editable_placement
                || !matches!(snapshot.payload, Some(DocumentPayload::EditableText(_))),
            saving: snapshot.saving_revision.is_some(),
            error: snapshot
                .conflict
                .as_ref()
                .map(|v| v.message.to_string().into())
                .or_else(|| snapshot.error.as_ref().map(|v| v.to_string().into()))
                .or_else(|| match &snapshot.state {
                    LoadState::Failed(v) => Some(v.to_string().into()),
                    _ => None,
                }),
        };
        let entity = cx.entity();
        let save_entity = entity.clone();
        let wrap_entity = entity.clone();
        let revert_entity = entity.clone();
        if let Some(diff) = self.diff.as_ref() {
            if let Some(text) = diff.text.clone() {
                let entity = cx.entity();
                let mode_entity = entity.clone();
                let wrap_entity = entity.clone();
                let save_entity = entity.clone();
                let stats = diff
                    .spec
                    .change
                    .insertions
                    .zip(diff.spec.change.deletions)
                    .map(|(added, removed)| FileDiffStats {
                        added: added.min(u32::MAX as u64) as u32,
                        removed: removed.min(u32::MAX as u64) as u32,
                        counts_exact: true,
                    })
                    .or(diff.stats);
                let notice = diff
                    .error
                    .as_ref()
                    .map(|value| value.to_string().into())
                    .or_else(|| diff.pending.then(|| "Updating diff…".into()))
                    .or_else(|| diff.notice.clone());
                return FileDiff {
                    id: format!("diff:{}", path).into(),
                    theme: self.theme,
                    text,
                    lines: diff.lines.clone(),
                    list_state: diff.list.clone(),
                    preview_lines: diff.preview_lines.clone(),
                    preview_list_state: diff.preview_list.clone(),
                    mode: diff.mode,
                    wrap: diff.wrap,
                    stats,
                    content_widths: diff.content_widths,
                    notice,
                    scrollbar: diff.scrollbar.clone(),
                    preview_scrollbar: diff.preview_scrollbar.clone(),
                    horizontal_scrollbar: diff.horizontal_scrollbar.clone(),
                    editor: matches!(snapshot.payload, Some(DocumentPayload::EditableText(_)))
                        .then(|| self.ui.editor.clone()),
                    focus: diff.focus.clone(),
                    on_mode_change: Some(Rc::new(
                        move |mode: FileDiffMode, _window: &mut Window, cx: &mut App| {
                            mode_entity.update(cx, |this, cx| {
                                if mode != FileDiffMode::Edit
                                    || matches!(
                                        this.ui.store.read(cx).snapshot().payload,
                                        Some(DocumentPayload::EditableText(_))
                                    )
                                {
                                    if let Some(diff) = this.diff.as_mut() {
                                        diff.mode = mode;
                                    }
                                    cx.notify();
                                }
                            })
                        },
                    )),
                    on_wrap_change: Some(Rc::new(move |wrap, _, cx| {
                        wrap_entity.update(cx, |this, cx| {
                            if let Some(diff) = this.diff.as_mut() {
                                diff.wrap = wrap;
                            }
                            this.ui.editor.update(cx, |area, cx| {
                                area.set_layout(
                                    TextAreaLayout::Editor {
                                        wrap,
                                        line_numbers: true,
                                    },
                                    cx,
                                )
                            });
                            cx.notify();
                        })
                    })),
                    on_save: (self.editable_placement
                        && matches!(snapshot.payload, Some(DocumentPayload::EditableText(_))))
                    .then(|| {
                        Rc::new(move |_: &mut Window, cx: &mut App| {
                            save_entity.update(cx, |this, cx| {
                                this.ui.store.update(cx, |store, cx| {
                                    store.text_save();
                                    cx.notify();
                                })
                            })
                        }) as crate::ui::file_editor::FileEditorHandler
                    }),
                }
                .into_any_element();
            }
            if diff.pending || diff.error.is_none() {
                return div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child("Loading diff…")
                    .into_any_element();
            }
            if let Some(error) = diff.error.as_ref() {
                return div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(20.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child(error.to_string())
                    .into_any_element();
            }
        }
        if self.kind == FileKind::Diff && self.diff.is_none() {
            return div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .p(px(20.0))
                .text_color(self.theme.role(ThemeRole::TextSecondary))
                .child("Git comparison or this changed path is no longer available.")
                .into_any_element();
        }
        let has_text = document_text(&snapshot).is_some();
        let rendered: Option<AnyElement> = match self.prepared.as_ref() {
            Some(PreparedDocument::Markdown(document)) => Some(
                FilePreview {
                    id: format!("rendered:{}", path).into(),
                    theme: self.theme,
                    size: format!("{} bytes", self.prepared_size.unwrap_or(0)).into(),
                    updating: snapshot.stale,
                    native_visible: self.visible,
                    mode: None,
                    mode_focus: None,
                    on_markdown_link_open: Some(self.markdown_link.clone()),
                    on_mode_select: None,
                    kind: FilePreviewKind::Markdown(document.clone()),
                }
                .into_any_element(),
            ),
            Some(PreparedDocument::Html { source, .. }) => Some(
                FilePreview {
                    id: format!("rendered:{}", path).into(),
                    theme: self.theme,
                    size: format!("{} bytes", self.prepared_size.unwrap_or(0)).into(),
                    updating: snapshot.stale,
                    native_visible: self.visible,
                    mode: None,
                    mode_focus: None,
                    on_markdown_link_open: Some(self.markdown_link.clone()),
                    on_mode_select: None,
                    kind: FilePreviewKind::Html(source.clone()),
                }
                .into_any_element(),
            ),
            Some(
                PreparedDocument::MarkdownUnavailable(message)
                | PreparedDocument::HtmlUnavailable(message),
            ) => Some(
                div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(20.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child(message.to_string())
                    .into_any_element(),
            ),
            _ => None,
        };
        let source_with_rendered = matches!(
            self.prepared,
            Some(
                PreparedDocument::Markdown(_)
                    | PreparedDocument::MarkdownUnavailable(_)
                    | PreparedDocument::Html { .. }
                    | PreparedDocument::HtmlUnavailable(_)
            )
        );
        let editor_visible = matches!(self.prepared, Some(PreparedDocument::Editor))
            || source_with_rendered
            || (self.prepared.is_none() && has_text);
        if editor_visible {
            FileEditor {
                id: format!("document:{}", path).into(),
                theme: self.theme,
                status: document_status(&snapshot)
                    .or_else(|| match snapshot.payload.as_ref() {
                        Some(DocumentPayload::ReadOnlyText(value))
                            if value.chars().take(250_001).count() > 250_000 =>
                        {
                            Some(format!("Preview truncated; {} bytes total", value.len()).into())
                        }
                        _ => None,
                    })
                    .or_else(|| self.highlight_notice.clone()),
                mode: self.ui.mode,
                show_mode_control: source_with_rendered,
                wrap: self.ui.wrap,
                state,
                editor: self.ui.editor.clone(),
                rendered,
                focus: self.ui.focus.clone(),
                on_mode_change: source_with_rendered.then(|| {
                    let mode_entity = entity.clone();
                    Rc::new(
                        move |mode: FileEditorMode, _window: &mut Window, cx: &mut App| {
                            mode_entity.update(cx, |this, cx| {
                                this.ui.mode = mode;
                                cx.notify();
                            })
                        },
                    ) as crate::ui::file_editor::FileEditorModeHandler
                }),
                on_wrap_change: Some(Rc::new(move |wrap, _, cx| {
                    wrap_entity.update(cx, |this, cx| {
                        this.ui.wrap = wrap;
                        this.ui.editor.update(cx, |area, cx| {
                            area.set_layout(
                                TextAreaLayout::Editor {
                                    wrap,
                                    line_numbers: true,
                                },
                                cx,
                            )
                        });
                        cx.notify();
                    });
                })),
                on_save: Some(Rc::new(move |_, cx| {
                    save_entity.update(cx, |this, cx| {
                        this.ui.store.update(cx, |store, cx| {
                            store.text_save();
                            cx.notify();
                        });
                    });
                })),
                on_revert: Some(Rc::new(move |_, cx| {
                    revert_entity.update(cx, |this, cx| {
                        let authoritative = match this.ui.store.read(cx).snapshot().payload.as_ref()
                        {
                            Some(
                                DocumentPayload::EditableText(value)
                                | DocumentPayload::ReadOnlyText(value),
                            ) => Some(value.to_string()),
                            _ => None,
                        };
                        if let Some(value) = authoritative {
                            this.ui.store.update(cx, |store, cx| {
                                store.text_revert();
                                cx.notify();
                            });
                            this.ui
                                .editor
                                .update(cx, |area, cx| area.set_value(value, cx));
                        }
                    });
                })),
            }
            .into_any_element()
        } else if let Some(kind) = match self.prepared.as_ref() {
            Some(PreparedDocument::Markdown(document)) => {
                Some(FilePreviewKind::Markdown(document.clone()))
            }
            Some(PreparedDocument::Image {
                image, dimensions, ..
            }) => {
                let open = entity.clone();
                Some(FilePreviewKind::Image {
                    image: image.clone(),
                    dimensions: Some(*dimensions),
                    alt: path.clone().into(),
                    focus_handle: Some(self.lightbox_open_focus.clone()),
                    on_open_lightbox: Some(Rc::new(move |_window: &mut Window, cx: &mut App| {
                        open.update(cx, |this, cx| {
                            this.lightbox_open = true;
                            cx.notify();
                        })
                    })),
                })
            }
            Some(PreparedDocument::NativeImage { source, .. }) => {
                let open = entity.clone();
                Some(FilePreviewKind::NativeImage {
                    source: source.clone(),
                    focus_handle: Some(self.lightbox_open_focus.clone()),
                    on_open_lightbox: Some(Rc::new(move |_window: &mut Window, cx: &mut App| {
                        open.update(cx, |this, cx| {
                            this.lightbox_open = true;
                            cx.notify();
                        })
                    })),
                })
            }
            Some(PreparedDocument::Html { source, .. }) => {
                Some(FilePreviewKind::Html(source.clone()))
            }
            Some(PreparedDocument::Audio { source, .. }) => {
                Some(FilePreviewKind::Audio(source.clone()))
            }
            Some(PreparedDocument::Video { source, .. }) => {
                let open = entity.clone();
                Some(FilePreviewKind::Video {
                    source: source.clone(),
                    focus_handle: Some(self.lightbox_open_focus.clone()),
                    on_open_lightbox: Some(Rc::new(move |_window: &mut Window, cx: &mut App| {
                        open.update(cx, |this, cx| {
                            this.lightbox_open = true;
                            cx.notify();
                        })
                    })),
                })
            }
            Some(PreparedDocument::Pdf { source, .. }) => {
                Some(FilePreviewKind::Pdf(source.clone()))
            }
            Some(PreparedDocument::Binary { facts }) => {
                Some(FilePreviewKind::Binary(facts.clone()))
            }
            _ => None,
        } {
            let preview = FilePreview {
                id: format!("preview:{}", path).into(),
                theme: self.theme,
                size: format!(
                    "{} bytes",
                    self.prepared_size
                        .or_else(|| snapshot.payload.as_ref().map(DocumentPayload::byte_len))
                        .unwrap_or(0)
                )
                .into(),
                updating: snapshot.stale || matches!(snapshot.state, LoadState::Loading),
                native_visible: embedded_native_visible(self.visible, self.lightbox_open),
                mode: None,
                mode_focus: None,
                on_markdown_link_open: Some(self.markdown_link.clone()),
                on_mode_select: None,
                kind,
            };
            if self.lightbox_open {
                let media = match self.prepared.as_ref() {
                    Some(PreparedDocument::Image { image, .. }) => {
                        Some(PreviewLightboxMedia::Image {
                            image: image.clone(),
                            alt: path.clone().into(),
                        })
                    }
                    Some(PreparedDocument::NativeImage { source, .. }) => {
                        Some(PreviewLightboxMedia::NativeImage(source.clone()))
                    }
                    Some(PreparedDocument::Video { source, .. }) => {
                        Some(PreviewLightboxMedia::Video(source.clone()))
                    }
                    _ => None,
                };
                if let Some(media) = media {
                    let close = entity.clone();
                    div()
                        .size_full()
                        .relative()
                        .child(preview)
                        .child(FilePreviewLightbox {
                            id: format!("lightbox:{}", path).into(),
                            theme: self.theme,
                            media,
                            native_visible: self.visible,
                            overlay_focus: self.lightbox_overlay_focus.clone(),
                            close_focus: self.lightbox_close_focus.clone(),
                            on_close: Rc::new(move |window: &mut Window, cx: &mut App| {
                                close.update(cx, |this, cx| {
                                    this.lightbox_open = false;
                                    this.lightbox_open_focus.focus(window);
                                    cx.notify();
                                })
                            }),
                        })
                        .into_any_element()
                } else {
                    preview.into_any_element()
                }
            } else {
                preview.into_any_element()
            }
        } else {
            let message = match self.prepared.as_ref() {
                Some(PreparedDocument::Unavailable(message)) => message.to_string(),
                _ => match (&snapshot.state, snapshot.payload.as_ref()) {
                    (LoadState::Loading, _) if snapshot.payload.is_none() => {
                        "Loading file…".to_owned()
                    }
                    (LoadState::Evicted, _) => {
                        "File content was released. It will load again when needed.".to_owned()
                    }
                    (_, _) => "This file cannot be edited or previewed safely.".to_owned(),
                },
            };
            div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .p(px(20.0))
                .font_family(fonts::UI_FAMILY)
                .text_color(self.theme.role(ThemeRole::TextSecondary))
                .child(message)
                .into_any_element()
        }
    }
}

/// Retained per-workspace Files inspector. It owns one browser observation and one stable document
/// entity for each validated path materialized during this process lifetime.
pub struct FilesInspectorSurface {
    connectivity: Entity<ConnectivityController>,
    workspace: WorkspaceKey,
    services: Rc<RefCell<FilePresentationServices>>,
    browser: Entity<FileBrowserStore>,
    theme: Theme,
    git: Option<Arc<GitState>>,
    scope: FileBrowserScope,
    layout: FileBrowserLayout,
    expanded: BTreeSet<RelativeDirectoryPath>,
    selected: Option<RelativeFilePath>,
    selected_row: Option<SharedString>,
    preview: Option<RelativeFilePath>,
    entries: Rc<Vec<FileBrowserEntry>>,
    list: FileBrowserListState,
    scrollbar: Entity<ScrollbarState>,
    focus: FileBrowserFocusHandles,
    documents: BTreeMap<RelativeFilePath, Entity<FileDocumentSurface>>,
    recent_documents: VecDeque<RelativeFilePath>,
    retained_main: BTreeSet<RelativeFilePath>,
    visible_main: Option<RelativeFilePath>,
    workspace_active: bool,
    inspector_visible: bool,
    native_allowed: bool,
    on_navigate: FilesInspectorNavigationHandler,
    _browser_subscription: Subscription,
}
impl FilesInspectorSurface {
    pub fn new(
        connectivity: Entity<ConnectivityController>,
        workspace: WorkspaceKey,
        services: Rc<RefCell<FilePresentationServices>>,
        theme: Theme,
        on_navigate: FilesInspectorNavigationHandler,
        cx: &mut Context<Self>,
    ) -> Self {
        let browser = connectivity
            .update(cx, |controller, cx| {
                controller.file_browser_materialize(&workspace, cx)
            })
            .expect("local workspace file browser");
        let subscription = cx.observe(&browser, |this, _, cx| {
            this.entries_rebuild(cx);
            cx.notify();
        });
        let entries = Rc::new(Vec::new());
        let list = FileBrowserListState::new(&entries);
        let scrollbar = cx.new({
            let list = list.clone();
            move |_| {
                ScrollbarState::vertical_list(
                    ScrollbarAppearance::Automatic,
                    ScrollbarPlacement::Overlay,
                    list.list_state(),
                )
            }
        });
        let mut this = Self {
            connectivity,
            workspace,
            services,
            browser,
            theme,
            git: None,
            scope: FileBrowserScope::Changes,
            layout: FileBrowserLayout::List,
            expanded: BTreeSet::new(),
            selected: None,
            selected_row: None,
            preview: None,
            entries,
            list,
            scrollbar,
            focus: FileBrowserFocusHandles {
                root: cx.focus_handle(),
                all_files: cx.focus_handle(),
                changes: cx.focus_handle(),
                list: cx.focus_handle(),
                tree: cx.focus_handle(),
            },
            documents: BTreeMap::new(),
            recent_documents: VecDeque::new(),
            retained_main: BTreeSet::new(),
            visible_main: None,
            workspace_active: true,
            inspector_visible: true,
            native_allowed: true,
            on_navigate,
            _browser_subscription: subscription,
        };
        this.entries_rebuild(cx);
        this
    }
    pub fn reconcile(&mut self, theme: Theme, git: Option<Arc<GitState>>, cx: &mut Context<Self>) {
        self.theme = theme;
        self.git = git;
        let paths: Vec<_> = self.documents.keys().cloned().collect();
        for path in paths {
            let spec = self.git_diff_spec(&path, cx);
            if let Some(doc) = self.documents.get(&path) {
                doc.update(cx, |doc, cx| {
                    doc.theme_reconcile(theme, cx);
                    doc.git_diff_reconcile(spec, cx);
                });
            }
        }
        self.entries_rebuild(cx);
        cx.notify();
    }
    pub fn workspace_active_reconcile(&mut self, active: bool, cx: &mut Context<Self>) {
        if self.workspace_active == active {
            return;
        }
        self.workspace_active = active;
        self.browser_visibility_reconcile(cx);
        self.retention_reconcile(cx);
        cx.notify();
    }
    pub fn inspector_visible_reconcile(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.inspector_visible == visible {
            return;
        }
        self.inspector_visible = visible;
        self.browser_visibility_reconcile(cx);
        self.retention_reconcile(cx);
        cx.notify();
    }
    pub fn native_allowed_reconcile(&mut self, allowed: bool, cx: &mut Context<Self>) {
        if self.native_allowed == allowed {
            return;
        }
        self.native_allowed = allowed;
        self.retention_reconcile(cx);
        cx.notify();
    }
    pub fn route_preview_reconcile(
        &mut self,
        target: Option<(RelativeFilePath, FileKind)>,
        cx: &mut Context<Self>,
    ) {
        let path = target.as_ref().map(|(path, _)| path.clone());
        self.preview = path.clone();
        self.selected = path.clone();
        if let Some((path, kind)) = target {
            let document = self.document_materialize(path.clone(), cx);
            let spec = self.git_diff_spec(&path, cx);
            document.update(cx, |document, cx| {
                document.file_kind_reconcile(kind, spec, cx)
            });
        }
        self.browser_visibility_reconcile(cx);
        self.retention_reconcile(cx);
        cx.notify();
    }
    pub fn main_file_kind_reconcile(
        &mut self,
        path: RelativeFilePath,
        kind: FileKind,
        ephemeral: bool,
        cx: &mut Context<Self>,
    ) {
        let document = self.document_materialize(path.clone(), cx);
        let spec = self.git_diff_spec(&path, cx);
        document.update(cx, |document, cx| {
            document.ephemeral_placement = ephemeral;
            document.file_kind_reconcile(kind, spec, cx)
        });
    }
    pub fn main_paths_reconcile(
        &mut self,
        paths: BTreeSet<RelativeFilePath>,
        visible: Option<RelativeFilePath>,
        cx: &mut Context<Self>,
    ) {
        self.retained_main = paths;
        self.visible_main = visible.clone();
        for (path, document) in &self.documents {
            document.update(cx, |document, cx| {
                document.editable_placement_reconcile(visible.as_ref() == Some(path), cx)
            });
        }
        self.retention_reconcile(cx);
    }
    fn retention_reconcile(&mut self, cx: &mut Context<Self>) {
        let preview = self.preview.as_ref();
        let mut staged_hidden = Vec::new();
        for (path, document) in &self.documents {
            let retain = preview == Some(path) || self.retained_main.contains(path);
            let visible = self.workspace_active
                && self.native_allowed
                && (self.visible_main.as_ref() == Some(path)
                    || (self.inspector_visible && preview == Some(path)));
            let was_retained = document.read(cx).retained_placement;
            let store = document.read(cx).ui.store.clone();
            store.update(cx, |store, cx| {
                store.document_retain(retain);
                store.document_visibility_update(visible);
                cx.notify();
            });
            if let Some(PreparedDocument::Image { key, .. }) = document.read(cx).prepared.as_ref() {
                self.services.borrow_mut().image_pin(key, visible);
            }
            document.update(cx, |document, cx| {
                document.retained_placement = retain;
                document.visibility_reconcile(visible, cx)
            });
            if retain || document.read(cx).dirty(cx) {
                self.recent_documents.retain(|item| item != path);
            } else if was_retained {
                document.update(cx, |document, cx| document.recent_demote(cx));
                self.recent_documents.retain(|item| item != path);
                self.recent_documents.push_back(path.clone());
                let staged = matches!(
                    document.read(cx).prepared,
                    Some(PreparedDocument::Image { .. })
                );
                if staged {
                    staged_hidden.push(path.clone());
                }
            }
        }
        for path in staged_hidden {
            self.recent_documents.retain(|item| item != &path);
            if let Some(document) = self.documents.remove(&path) {
                document.read(cx).native_deactivate();
            }
        }
        self.recent_documents_evict(cx);
    }
    fn recent_documents_evict(&mut self, cx: &mut Context<Self>) {
        loop {
            let chars: usize = self
                .recent_documents
                .iter()
                .filter_map(|path| self.documents.get(path))
                .map(|doc| {
                    doc.read(cx)
                        .ui
                        .editor
                        .read(cx)
                        .value()
                        .chars()
                        .count()
                        .min(250_001)
                })
                .sum();
            let oversized = self
                .recent_documents
                .iter()
                .find(|path| {
                    self.documents.get(*path).is_some_and(|doc| {
                        doc.read(cx).ui.editor.read(cx).value().chars().count() > 250_000
                    })
                })
                .cloned();
            if self.recent_documents.len() <= 12 && chars <= 1_000_000 && oversized.is_none() {
                break;
            }
            let path = if let Some(path) = oversized {
                self.recent_documents.retain(|item| item != &path);
                path
            } else {
                let Some(path) = self.recent_documents.pop_front() else {
                    break;
                };
                path
            };
            if let Some(document) = self.documents.remove(&path) {
                document.read(cx).native_deactivate();
                if let Some(PreparedDocument::Image { key, .. }) =
                    document.read(cx).prepared.as_ref()
                {
                    self.services.borrow_mut().image_pin(key, false);
                }
            }
        }
    }
    fn git_diff_spec(
        &mut self,
        path: &RelativeFilePath,
        cx: &mut Context<Self>,
    ) -> Option<GitDiffSpec> {
        let git = self.git.as_ref()?;
        if git.comparison != GitComparison::Ready {
            return None;
        }
        let change = git
            .files
            .iter()
            .find(|change| change.path == path.as_str())?
            .clone();
        if change.binary || matches!(change.status, GitFileStatus::Submodule) {
            return Some(GitDiffSpec {
                change,
                base: None,
                old_path: path.clone(),
                old_store: None,
            });
        }
        if matches!(
            change.status,
            GitFileStatus::Added | GitFileStatus::Untracked
        ) {
            return Some(GitDiffSpec {
                change,
                base: None,
                old_path: path.clone(),
                old_store: None,
            });
        }
        let base = git.base.as_deref().map(Arc::<str>::from);
        let old_path = if matches!(
            change.status,
            GitFileStatus::Renamed | GitFileStatus::Copied
        ) {
            RelativeFilePath::parse(change.previous_path.as_deref()?).ok()?
        } else {
            path.clone()
        };
        let old_store = if base.is_some() {
            self.connectivity.update(cx, |controller, cx| {
                controller.file_document_materialize(&self.workspace, old_path.clone(), cx)
            })
        } else {
            None
        };
        Some(GitDiffSpec {
            change,
            base,
            old_path,
            old_store,
        })
    }

    pub fn document_materialize(
        &mut self,
        path: RelativeFilePath,
        cx: &mut Context<Self>,
    ) -> Entity<FileDocumentSurface> {
        if let Some(doc) = self.documents.get(&path) {
            self.recent_documents.retain(|item| item != &path);
            return doc.clone();
        }
        let store = self
            .connectivity
            .update(cx, |controller, cx| {
                controller.file_document_materialize(&self.workspace, path.clone(), cx)
            })
            .expect("local file document");
        let doc = cx.new({
            let path = path.clone();
            let workspace: Arc<str> = Arc::from(self.workspace.id());
            let theme = self.theme;
            let services = self.services.clone();
            let on_navigate = self.on_navigate.clone();
            move |cx| {
                FileDocumentSurface::new(store, workspace, path, theme, services, on_navigate, cx)
            }
        });
        self.documents.insert(path.clone(), doc.clone());
        let editable = self.visible_main.as_ref() == Some(&path);
        doc.update(cx, |document, cx| {
            document.editable_placement_reconcile(editable, cx)
        });
        let spec = self.git_diff_spec(&path, cx);
        doc.update(cx, |document, cx| document.git_diff_reconcile(spec, cx));
        let retain = self.preview.as_ref() == Some(&path) || self.retained_main.contains(&path);
        let document_store = doc.read(cx).ui.store.clone();
        let visible = self.workspace_active
            && self.native_allowed
            && (self.visible_main.as_ref() == Some(&path)
                || (self.inspector_visible && self.preview.as_ref() == Some(&path)));
        document_store.update(cx, |store, cx| {
            store.document_retain(retain);
            store.document_visibility_update(visible);
            cx.notify();
        });
        doc.update(cx, |document, cx| {
            document.visibility_reconcile(visible, cx)
        });
        doc
    }
    pub fn document(&self, path: &RelativeFilePath) -> Option<Entity<FileDocumentSurface>> {
        self.documents.get(path).cloned()
    }
    pub fn preview_matches(&self, path: &RelativeFilePath) -> bool {
        self.preview.as_ref() == Some(path)
    }
    fn browser_visibility_reconcile(&mut self, cx: &mut Context<Self>) {
        let browser_visible = self.preview.is_none() && self.scope == FileBrowserScope::AllFiles;
        let materialized: Vec<_> = self
            .browser
            .read(cx)
            .snapshot()
            .directories
            .keys()
            .cloned()
            .collect();
        for path in materialized {
            let visible = browser_visible && self.expanded.contains(&path);
            self.browser.update(cx, |store, cx| {
                store.directory_visibility_update(&path, visible);
                cx.notify();
            });
        }
    }
    fn entries_rebuild(&mut self, cx: &mut Context<Self>) {
        let next = if self.scope == FileBrowserScope::Changes {
            self.git_entries()
        } else {
            self.tree_entries(cx)
        };
        self.list.reconcile(&next);
        self.entries = Rc::new(next);
    }
    fn tree_entries(&self, cx: &App) -> Vec<FileBrowserEntry> {
        let snapshot = self.browser.read(cx).snapshot().clone();
        let mut out = Vec::new();
        fn visit(
            dir: &RelativeDirectoryPath,
            depth: usize,
            snapshot: &crate::connectivity::FileBrowserSnapshot,
            expanded: &BTreeSet<RelativeDirectoryPath>,
            out: &mut Vec<FileBrowserEntry>,
        ) {
            let Some(row) = snapshot.directories.get(dir) else {
                return;
            };
            for entry in &row.entries {
                let is_dir = entry.entry_type == FileTreeEntryType::Directory;
                let child_dir = is_dir
                    .then(|| RelativeDirectoryPath::parse(&entry.path).ok())
                    .flatten();
                let is_expanded = child_dir.as_ref().is_some_and(|v| expanded.contains(v));
                let (icon, role) = if is_dir {
                    (
                        FileBrowserIconFamily::Directory {
                            expanded: is_expanded,
                        },
                        ThemeRole::FileDirectory,
                    )
                } else {
                    icon_family(&entry.path)
                };
                out.push(FileBrowserEntry {
                    id: if is_dir {
                        format!("\0dir:{}", entry.path).into()
                    } else {
                        entry.path.clone().into()
                    },
                    name: entry.name.clone().into(),
                    directory: parent_label(&entry.path),
                    depth,
                    kind: if is_dir {
                        FileBrowserEntryKind::Directory {
                            expanded: is_expanded,
                        }
                    } else {
                        FileBrowserEntryKind::File
                    },
                    icon,
                    icon_role: role,
                    status: None,
                    changes: None,
                });
                if let Some(child) = child_dir.filter(|_| is_expanded) {
                    visit(&child, depth + 1, snapshot, expanded, out);
                }
            }
            if row.next_cursor.is_some() {
                out.push(FileBrowserEntry {
                    id: format!("\0page:{}", dir.as_str()).into(),
                    name: "Load more…".into(),
                    directory: (!dir.as_str().is_empty()).then(|| dir.as_str().to_owned().into()),
                    depth,
                    kind: FileBrowserEntryKind::LoadMore,
                    icon: FileBrowserIconFamily::Other,
                    icon_role: ThemeRole::FileOther,
                    status: Some(FileBrowserStatus {
                        label: "More files".into(),
                        role: ThemeRole::TextSecondary,
                    }),
                    changes: None,
                });
            }
        }
        visit(
            &RelativeDirectoryPath::root(),
            0,
            &snapshot,
            &self.expanded,
            &mut out,
        );
        out
    }
    fn git_entries(&self) -> Vec<FileBrowserEntry> {
        let Some(git) = self.git.as_ref() else {
            return Vec::new();
        };
        if self.layout == FileBrowserLayout::List {
            return git
                .files
                .iter()
                .filter_map(|change| git_entry(change, self.layout))
                .collect();
        }
        let mut directories = BTreeSet::new();
        let mut files = BTreeMap::new();
        for change in &git.files {
            let Ok(path) = RelativeFilePath::parse(&change.path) else {
                continue;
            };
            let mut prefix = String::new();
            let components: Vec<_> = path.as_str().split('/').collect();
            for component in components.iter().take(components.len().saturating_sub(1)) {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(component);
                if let Ok(directory) = RelativeDirectoryPath::parse(&prefix) {
                    directories.insert(directory);
                }
            }
            files.insert(path, change);
        }
        let ancestors_visible = |value: &str| {
            let parts: Vec<_> = value.split('/').collect();
            let mut prefix = String::new();
            for component in parts.iter().take(parts.len().saturating_sub(1)) {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(component);
                if let Ok(directory) = RelativeDirectoryPath::parse(&prefix)
                    && !self.expanded.contains(&directory)
                {
                    return false;
                }
            }
            true
        };
        let mut rows = Vec::new();
        for directory in &directories {
            if !ancestors_visible(directory.as_str()) {
                continue;
            }
            let expanded = self.expanded.contains(directory);
            rows.push(FileBrowserEntry {
                id: format!("\0dir:{}", directory.as_str()).into(),
                name: directory
                    .as_str()
                    .rsplit('/')
                    .next()
                    .unwrap_or(directory.as_str())
                    .to_owned()
                    .into(),
                directory: parent_label(directory.as_str()),
                depth: directory.as_str().matches('/').count(),
                kind: FileBrowserEntryKind::Directory { expanded },
                icon: FileBrowserIconFamily::Directory { expanded },
                icon_role: ThemeRole::FileDirectory,
                status: None,
                changes: None,
            });
        }
        for (path, change) in files {
            if ancestors_visible(path.as_str()) {
                if let Some(row) = git_entry(change, FileBrowserLayout::Tree) {
                    rows.push(row);
                }
            }
        }
        rows.sort_by(|left, right| {
            left.id
                .as_ref()
                .trim_start_matches("\0dir:")
                .cmp(right.id.as_ref().trim_start_matches("\0dir:"))
                .then_with(|| {
                    matches!(left.kind, FileBrowserEntryKind::File)
                        .cmp(&matches!(right.kind, FileBrowserEntryKind::File))
                })
        });
        rows
    }
    fn disclosure(&self, cx: &App) -> Option<SharedString> {
        if self.scope == FileBrowserScope::Changes {
            let Some(git) = self.git.as_ref() else {
                return Some("Loading changes…".into());
            };
            let invalid_paths = git.files.iter().any(|change| {
                RelativeFilePath::parse(&change.path).is_err()
                    || (matches!(
                        change.status,
                        GitFileStatus::Renamed | GitFileStatus::Copied
                    ) && change
                        .previous_path
                        .as_deref()
                        .is_none_or(|path| RelativeFilePath::parse(path).is_err()))
            });
            if git.files_truncated || invalid_paths {
                return Some("Some changed paths were omitted.".into());
            }
            if git.comparison == GitComparison::Unavailable {
                return Some("Git comparison is unavailable for this workspace.".into());
            }
            if git.files.is_empty() {
                return Some("No changes".into());
            }
        }
        let snapshot = self.browser.read(cx).snapshot();
        if self.scope == FileBrowserScope::AllFiles {
            if snapshot.directory_limit_reached {
                return Some(
                    "File browser reached the safe directory limit; some folders remain collapsed."
                        .into(),
                );
            }
            if snapshot
                .directories
                .values()
                .any(|directory| directory.entries_truncated)
            {
                return Some("File list reached the 50,000-entry safety limit.".into());
            }
            let root = snapshot.directories.get(&RelativeDirectoryPath::root());
            match root.map(|root| (&root.state, root.entries.is_empty())) {
                None | Some((LoadState::Idle | LoadState::Loading, true)) => {
                    return Some("Loading files…".into());
                }
                Some((LoadState::Loading, false)) => return Some("Updating files…".into()),
                Some((LoadState::Failed(message), _)) => {
                    return Some(format!("Could not update files: {message}").into());
                }
                Some((LoadState::Ready, true)) => return Some("No files".into()),
                _ => {}
            }
            if snapshot
                .directories
                .values()
                .any(|directory| directory.next_cursor.is_some())
            {
                return Some(
                    "More files are available. Choose Load more to continue paging.".into(),
                );
            }
        }
        if snapshot.availability != FileAvailability::Online {
            return Some("Offline — showing retained file rows.".into());
        }
        None
    }
}
impl Render for FilesInspectorSurface {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        let scope_entity = entity.clone();
        let layout_entity = entity.clone();
        let select_entity = entity.clone();
        let open_entity = entity.clone();
        let toggle_entity = entity.clone();
        let tabs_entity = entity.clone();
        let transfer_entity = entity.clone();
        let on_tab_select: TabSelectHandler = Rc::new(move |id, _, cx| {
            let navigate = tabs_entity.update(cx, |this, cx| {
                if id.as_ref() != "files"
                    || this
                        .preview
                        .as_ref()
                        .and_then(|path| this.documents.get(path))
                        .is_some_and(|document| document.read(cx).dirty(cx))
                {
                    return None;
                }
                this.preview = None;
                this.browser_visibility_reconcile(cx);
                this.retention_reconcile(cx);
                cx.notify();
                Some(this.on_navigate.clone())
            });
            if let Some(navigate) = navigate {
                navigate(FilesInspectorNavigation::ClosePreview, cx);
            }
        });
        let preview_doc = self
            .preview
            .as_ref()
            .and_then(|p| self.documents.get(p))
            .cloned();
        let disclosure = self.disclosure(cx);
        div()
            .debug_selector(|| "files-inspector-surface".into())
            .w(px(250.0))
            .h_full()
            .min_h_0()
            .flex()
            .flex_col()
            .bg(self.theme.role(ThemeRole::Surface))
            .child(
                div()
                    .relative()
                    .child(Tabs {
                        id: format!("files-tabs:{}", self.workspace.id()).into(),
                        theme: self.theme,
                        size: TabsSize::Small,
                        items: std::iter::once(TabItem {
                            id: "files".into(),
                            label: "Files".into(),
                            icon: None,
                            selected: self.preview.is_none(),
                            disabled: false,
                        })
                        .chain(self.preview.as_ref().map(|path| TabItem {
                            id: format!("preview:{}", path.as_str()).into(),
                            label: path.as_str().to_owned().into(),
                            icon: None,
                            selected: true,
                            disabled: false,
                        }))
                        .collect(),
                        on_select: on_tab_select,
                    })
                    .when(self.preview.is_some(), |header| {
                        header.child(div().absolute().right(px(4.0)).top(px(2.0)).child(Button {
                            id: "inspector-to-main".into(),
                            theme: self.theme,
                            label: "Move to main".into(),
                            size: ControlSize::Small,
                            variant: ButtonVariant::Ghost,
                            icon: Some(IconName::PanelExpand),
                            icon_only: true,
                            disabled: false,
                            force_focused: false,
                            focus_handle: None,
                            on_activate: Some(Rc::new(
                                move |_window: &mut Window, cx: &mut App| {
                                    let navigation = transfer_entity.update(cx, |this, cx| {
                                        let path = this.preview.clone()?;
                                        let kind = this
                                            .documents
                                            .get(&path)
                                            .map(|document| document.read(cx).kind)
                                            .unwrap_or(FileKind::File);
                                        Some((
                                            this.on_navigate.clone(),
                                            FilesInspectorNavigation::Main {
                                                path,
                                                kind,
                                                ephemeral: false,
                                            },
                                        ))
                                    });
                                    if let Some((navigate, event)) = navigation {
                                        navigate(event, cx);
                                    }
                                },
                            )),
                        }))
                    }),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .child(if let Some(doc) = preview_doc {
                        doc.into_any_element()
                    } else {
                        FileBrowser {
                            id: format!("files:{}", self.workspace.id()).into(),
                            theme: self.theme,
                            width: 250.0,
                            scope: self.scope,
                            layout: self.layout,
                            change_stats: self
                                .git
                                .as_ref()
                                .map(|g| FileBrowserChangeStats {
                                    files: g.changed_files.min(u32::MAX as u64) as u32,
                                    added: Some(g.insertions.min(u32::MAX as u64) as u32),
                                    deleted: Some(g.deletions.min(u32::MAX as u64) as u32),
                                    counts_exact: g.counts_exact,
                                })
                                .unwrap_or_default(),
                            entries: self.entries.clone(),
                            selected_entry_id: self.selected_row.clone().or_else(|| {
                                self.selected.as_ref().map(|p| p.as_str().to_owned().into())
                            }),
                            list_state: self.list.clone(),
                            focus: self.focus.clone(),
                            scrollbar: self.scrollbar.clone(),
                            on_scope_change: Some(Rc::new(move |scope, _, cx| {
                                scope_entity.update(cx, |this, cx| {
                                    this.scope = scope;
                                    if scope == FileBrowserScope::AllFiles {
                                        let root = RelativeDirectoryPath::root();
                                        this.browser.update(cx, |store, cx| {
                                            store.directory_materialize(root.clone());
                                            cx.notify();
                                        });
                                        if this
                                            .browser
                                            .read(cx)
                                            .snapshot()
                                            .directories
                                            .contains_key(&root)
                                        {
                                            this.expanded.insert(root);
                                        }
                                    }
                                    this.preview = None;
                                    this.browser_visibility_reconcile(cx);
                                    this.entries_rebuild(cx);
                                    cx.notify();
                                })
                            })),
                            on_layout_change: Some(Rc::new(move |layout, _, cx| {
                                layout_entity.update(cx, |this, cx| {
                                    this.layout = layout;
                                    this.entries_rebuild(cx);
                                    cx.notify();
                                })
                            })),
                            on_entry_select: Some(Rc::new(move |id, _, cx| {
                                if id.as_ref().strip_prefix("\0dir:").is_some() {
                                    let row = id.clone();
                                    select_entity.update(cx, |this, cx| {
                                        this.selected_row = Some(row);
                                        this.selected = None;
                                        cx.notify();
                                    });
                                } else if id.as_ref().strip_prefix("\0page:").is_some() {
                                    let row = id.clone();
                                    select_entity.update(cx, |this, cx| {
                                        this.selected_row = Some(row);
                                        cx.notify();
                                    });
                                } else if let Ok(path) = RelativeFilePath::parse(id.as_ref()) {
                                    let row = id.clone();
                                    let navigation = select_entity.update(cx, |this, cx| {
                                        if this
                                            .preview
                                            .as_ref()
                                            .is_some_and(|current| current != &path)
                                            && this
                                                .preview
                                                .as_ref()
                                                .and_then(|current| this.documents.get(current))
                                                .is_some_and(|document| document.read(cx).dirty(cx))
                                        {
                                            return None;
                                        }
                                        this.selected_row = Some(row);
                                        this.selected = Some(path.clone());
                                        let event = FilesInspectorNavigation::Main {
                                            path,
                                            kind: if this.scope == FileBrowserScope::Changes {
                                                FileKind::Diff
                                            } else {
                                                FileKind::File
                                            },
                                            ephemeral: true,
                                        };
                                        cx.notify();
                                        Some((this.on_navigate.clone(), event))
                                    });
                                    if let Some((navigate, event)) = navigation {
                                        navigate(event, cx);
                                    }
                                }
                            })),
                            on_entry_open: Some(Rc::new(move |id, _, cx| {
                                if let Some(directory) = id
                                    .as_ref()
                                    .strip_prefix("\0dir:")
                                    .and_then(|path| RelativeDirectoryPath::parse(path).ok())
                                {
                                    open_entity.update(cx, |this, cx| {
                                        if !this.expanded.remove(&directory) {
                                            this.browser.update(cx, |store, cx| {
                                                store.directory_materialize(directory.clone());
                                                cx.notify();
                                            });
                                            if this
                                                .browser
                                                .read(cx)
                                                .snapshot()
                                                .directories
                                                .contains_key(&directory)
                                            {
                                                this.expanded.insert(directory.clone());
                                            }
                                        }
                                        this.browser_visibility_reconcile(cx);
                                        this.entries_rebuild(cx);
                                        cx.notify();
                                    });
                                } else if let Some(directory) = id
                                    .as_ref()
                                    .strip_prefix("\0page:")
                                    .and_then(|path| RelativeDirectoryPath::parse(path).ok())
                                {
                                    open_entity.update(cx, |this, cx| {
                                        this.browser.update(cx, |store, cx| {
                                            store.directory_load_more(&directory);
                                            cx.notify();
                                        })
                                    });
                                } else if let Ok(path) = RelativeFilePath::parse(id.as_ref()) {
                                    let navigation = open_entity.update(cx, |this, cx| {
                                        this.selected = Some(path.clone());
                                        let event = FilesInspectorNavigation::Main {
                                            path,
                                            kind: if this.scope == FileBrowserScope::Changes {
                                                FileKind::Diff
                                            } else {
                                                FileKind::File
                                            },
                                            ephemeral: false,
                                        };
                                        cx.notify();
                                        (this.on_navigate.clone(), event)
                                    });
                                    (navigation.0)(navigation.1, cx);
                                }
                            })),
                            on_entry_toggle: Some(Rc::new(move |id, _, cx| {
                                let Some(raw) = id.as_ref().strip_prefix("\0dir:") else {
                                    return;
                                };
                                if let Ok(path) = RelativeDirectoryPath::parse(raw) {
                                    toggle_entity.update(cx, |this, cx| {
                                        if !this.expanded.remove(&path) {
                                            this.browser.update(cx, |store, cx| {
                                                store.directory_materialize(path.clone());
                                                cx.notify();
                                            });
                                            if this
                                                .browser
                                                .read(cx)
                                                .snapshot()
                                                .directories
                                                .contains_key(&path)
                                            {
                                                this.expanded.insert(path.clone());
                                            }
                                        }
                                        this.browser_visibility_reconcile(cx);
                                        this.entries_rebuild(cx);
                                        cx.notify();
                                    });
                                }
                            })),
                        }
                        .into_any_element()
                    }),
            )
            .children(disclosure.map(|text| {
                div()
                    .flex_none()
                    .p(px(8.0))
                    .text_size(px(11.0))
                    .text_color(self.theme.role(ThemeRole::TextSecondary))
                    .child(text)
            }))
    }
}

fn document_status(snapshot: &crate::connectivity::FileDocumentSnapshot) -> Option<SharedString> {
    if snapshot.stale {
        Some("Updating…".into())
    } else if snapshot.availability != FileAvailability::Online {
        Some("Offline".into())
    } else {
        None
    }
}
fn parent_label(path: &str) -> Option<SharedString> {
    path.rsplit_once('/').map(|(p, _)| p.to_owned().into())
}
fn icon_family(path: &str) -> (FileBrowserIconFamily, ThemeRole) {
    let path = RelativeFilePath::parse(path).ok();
    match path.as_ref().map(file_family).unwrap_or(FileFamily::Other) {
        FileFamily::Code => (FileBrowserIconFamily::Code, ThemeRole::FileCode),
        FileFamily::Data => (FileBrowserIconFamily::Data, ThemeRole::FileData),
        FileFamily::Style => (FileBrowserIconFamily::Style, ThemeRole::FileStyle),
        FileFamily::Image => (FileBrowserIconFamily::Image, ThemeRole::FileImage),
        FileFamily::Video => (FileBrowserIconFamily::Video, ThemeRole::FileVideo),
        FileFamily::Audio => (FileBrowserIconFamily::Audio, ThemeRole::FileAudio),
        FileFamily::Shell => (FileBrowserIconFamily::Shell, ThemeRole::FileShell),
        FileFamily::Secret => (FileBrowserIconFamily::Secret, ThemeRole::FileSecret),
        FileFamily::Archive => (FileBrowserIconFamily::Archive, ThemeRole::FileArchive),
        FileFamily::Prose => (FileBrowserIconFamily::Prose, ThemeRole::FileProse),
        FileFamily::Config => (FileBrowserIconFamily::Config, ThemeRole::FileConfig),
        FileFamily::Directory => (
            FileBrowserIconFamily::Directory { expanded: false },
            ThemeRole::FileDirectory,
        ),
        FileFamily::Other => (FileBrowserIconFamily::Other, ThemeRole::FileOther),
    }
}

fn git_entry(change: &GitFileChange, layout: FileBrowserLayout) -> Option<FileBrowserEntry> {
    RelativeFilePath::parse(&change.path).ok()?;
    let (icon, icon_role) = icon_family(&change.path);
    let (label, role) = match change.status {
        GitFileStatus::Added | GitFileStatus::Untracked => ("Created", ThemeRole::DiffSuccess),
        GitFileStatus::Deleted => ("Deleted", ThemeRole::DiffError),
        GitFileStatus::Renamed => ("Renamed", ThemeRole::Warning),
        GitFileStatus::Copied => ("Copied", ThemeRole::DiffSuccess),
        GitFileStatus::Conflicted => ("Conflict", ThemeRole::DiffError),
        GitFileStatus::Modified => ("Modified", ThemeRole::Warning),
        GitFileStatus::TypeChanged => ("Type changed", ThemeRole::Warning),
        GitFileStatus::Submodule => ("Submodule", ThemeRole::TextSecondary),
    };
    let depth = if layout == FileBrowserLayout::Tree {
        change.path.matches('/').count()
    } else {
        0
    };
    let name = change.path.rsplit('/').next().unwrap_or(&change.path);
    Some(FileBrowserEntry {
        id: change.path.clone().into(),
        name: name.to_owned().into(),
        directory: parent_label(&change.path),
        depth,
        kind: FileBrowserEntryKind::File,
        icon,
        icon_role,
        status: Some(FileBrowserStatus {
            label: label.into(),
            role,
        }),
        changes: Some(FileBrowserChangeStats {
            files: 1,
            added: change
                .insertions
                .map(|value| value.min(u32::MAX as u64) as u32),
            deleted: change
                .deletions
                .map(|value| value.min(u32::MAX as u64) as u32),
            counts_exact: change.insertions.is_some() && change.deletions.is_some(),
        }),
    })
}
