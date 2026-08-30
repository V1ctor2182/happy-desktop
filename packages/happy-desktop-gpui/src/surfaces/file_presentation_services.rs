use crate::files::{
    FilePresentation, FilePresentationKind, MAX_DECODED_IMAGE_CACHE_BYTES,
    MAX_DECODED_IMAGE_CACHE_ENTRIES, MAX_PRESENTATION_CHARS, ParsedEditorEntry, PresentationCache,
    PresentationCacheKey, PreviewStageError, PreviewStageKey, PreviewStager, ReopenedPreview,
    SanitizedHtmlPreview, StagedRawPreview,
};
use gpui::{App, Image, ImageFormat};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct DecodedImageKey {
    pub workspace: Arc<str>,
    pub path: Arc<str>,
    pub hash: Arc<str>,
}
struct DecodedImageEntry {
    image: Arc<Image>,
    bytes: u64,
    pinned: bool,
    used: u64,
}

pub enum BackgroundStaged {
    Raw(StagedRawPreview),
    Html(SanitizedHtmlPreview),
}
pub struct BackgroundPreparation {
    pub presentation: FilePresentation,
    pub text: Option<Arc<str>>,
    pub markdown: Option<crate::ui::chat_markdown::MarkdownDocument>,
    pub parsed: Option<Arc<ParsedEditorEntry>>,
    pub bytes: Arc<[u8]>,
    pub staged: Option<BackgroundStaged>,
    pub error: Option<Arc<str>>,
}
pub struct BackgroundFileServices {
    parser: PresentationCache,
    stager: Option<PreviewStager>,
    staging_attempted: bool,
    staging_error: Option<Arc<str>>,
}
impl BackgroundFileServices {
    fn new() -> Self {
        Self {
            parser: PresentationCache::new(),
            stager: None,
            staging_attempted: false,
            staging_error: None,
        }
    }
    fn stager(&mut self) -> Result<&mut PreviewStager, Arc<str>> {
        if !self.staging_attempted {
            self.staging_attempted = true;
            #[cfg(test)]
            let opened = Err(PreviewStageError::ApplicationSupportUnavailable);
            #[cfg(not(test))]
            let opened = PreviewStager::new();
            match opened {
                Ok(value) => self.stager = Some(value),
                Err(error) => self.staging_error = Some(Arc::from(error.to_string())),
            }
        }
        self.stager.as_mut().ok_or_else(|| {
            self.staging_error
                .clone()
                .unwrap_or_else(|| Arc::from("Native preview staging is unavailable."))
        })
    }
    pub fn reopen(&mut self, key: &PreviewStageKey) -> Option<BackgroundStaged> {
        let reopened = self.stager().ok()?.reopen(key)?;
        Some(match reopened {
            ReopenedPreview::Raw(value) => BackgroundStaged::Raw(value),
            ReopenedPreview::SanitizedHtml(value) => BackgroundStaged::Html(value),
        })
    }
    pub fn prepare(
        &mut self,
        path: crate::files::RelativeFilePath,
        revision: Arc<str>,
        bytes: Arc<[u8]>,
    ) -> BackgroundPreparation {
        let presentation = FilePresentation::from_external_bytes(&path, &bytes);
        let text: Option<Arc<str>> = std::str::from_utf8(&bytes).ok().map(Arc::from);
        let markdown = if presentation.kind == FilePresentationKind::Markdown
            && text
                .as_deref()
                .is_some_and(|value| value.chars().count() <= MAX_PRESENTATION_CHARS)
        {
            text.as_deref()
                .map(crate::ui::chat_markdown::MarkdownDocument::parse)
        } else {
            None
        };
        let parsed = if presentation.is_text() {
            text.clone().and_then(|text| {
                self.parser
                    .project(
                        PresentationCacheKey {
                            path: path.clone(),
                            revision,
                        },
                        &presentation,
                        text,
                    )
                    .ok()
            })
        } else {
            None
        };
        let mut error = None;
        let mut staged = None;
        match presentation.kind {
            FilePresentationKind::Html => match self.stager().and_then(|stager| {
                stager
                    .stage_html(&presentation, &bytes)
                    .map_err(|e| Arc::from(e.to_string()))
            }) {
                Ok(value) => staged = Some(BackgroundStaged::Html(value)),
                Err(e) => error = Some(e),
            },
            FilePresentationKind::NativeImage
            | FilePresentationKind::Audio
            | FilePresentationKind::Video
            | FilePresentationKind::Pdf => match self.stager().and_then(|stager| {
                stager
                    .stage_raw(&presentation, &bytes)
                    .map_err(|e| Arc::from(e.to_string()))
            }) {
                Ok(value) => staged = Some(BackgroundStaged::Raw(value)),
                Err(e) => error = Some(e),
            },
            _ => {}
        }
        BackgroundPreparation {
            presentation,
            text,
            markdown,
            parsed,
            bytes,
            staged,
            error,
        }
    }
}

/// One app-lifetime service. Parser/stager work is Send and background-only; GPUI images stay foreground-only.
pub struct FilePresentationServices {
    pub background: Arc<Mutex<BackgroundFileServices>>,
    images: BTreeMap<DecodedImageKey, DecodedImageEntry>,
    image_bytes: u64,
    clock: u64,
}
impl FilePresentationServices {
    pub fn new() -> Self {
        Self {
            background: Arc::new(Mutex::new(BackgroundFileServices::new())),
            images: BTreeMap::new(),
            image_bytes: 0,
            clock: 0,
        }
    }
    pub fn image(&mut self, key: &DecodedImageKey) -> Option<Arc<Image>> {
        self.clock = self.clock.saturating_add(1);
        let entry = self.images.get_mut(key)?;
        entry.used = self.clock;
        Some(entry.image.clone())
    }
    pub fn image_decode(
        &mut self,
        key: DecodedImageKey,
        format: ImageFormat,
        bytes: Arc<[u8]>,
        estimated_rgba: u64,
        cx: &mut App,
    ) -> Result<Arc<Image>, Arc<str>> {
        if let Some(image) = self.image(&key) {
            return Ok(image);
        }
        if estimated_rgba > MAX_DECODED_IMAGE_CACHE_BYTES {
            return Err(Arc::from("This image is too large to decode safely."));
        }
        while self.images.len() >= MAX_DECODED_IMAGE_CACHE_ENTRIES
            || self.image_bytes.saturating_add(estimated_rgba) > MAX_DECODED_IMAGE_CACHE_BYTES
        {
            let victim = self
                .images
                .iter()
                .filter(|(_, value)| !value.pinned)
                .min_by_key(|(_, value)| value.used)
                .map(|(key, _)| key.clone());
            let Some(victim) = victim else {
                return Err(Arc::from(
                    "Visible image previews are using the safe decode budget.",
                ));
            };
            if let Some(value) = self.images.remove(&victim) {
                self.image_bytes = self.image_bytes.saturating_sub(value.bytes);
                value.image.remove_asset(cx);
            }
        }
        self.clock = self.clock.saturating_add(1);
        let image = Arc::new(Image::from_bytes(format, bytes.to_vec()));
        self.images.insert(
            key,
            DecodedImageEntry {
                image: image.clone(),
                bytes: estimated_rgba,
                pinned: false,
                used: self.clock,
            },
        );
        self.image_bytes = self.image_bytes.saturating_add(estimated_rgba);
        Ok(image)
    }
    pub fn image_pin(&mut self, key: &DecodedImageKey, pinned: bool) {
        if let Some(value) = self.images.get_mut(key) {
            value.pinned = pinned;
        }
    }
}
