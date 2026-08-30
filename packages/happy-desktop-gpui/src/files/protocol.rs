//! Exact protocol-v23 models and validation for workspace file routes.

use serde::{Deserialize, Serialize};
use std::{fmt, sync::Arc};

pub const MAX_PATH_BYTES: usize = 16_384;
pub const MAX_QUERY_BYTES: usize = 512;
pub const MAX_CURSOR_BYTES: usize = 4_096;
pub const MAX_REQUEST_ID_BYTES: usize = 256;
pub const MAX_REVISION_BYTES: usize = 4_096;
pub const MAX_TREE_PAGE: u16 = 500;
pub const MAX_SEARCH_RESULTS: u8 = 50;
pub const MAX_FILE_JSON_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_FILE_BYTES: usize = 44 * 1024 * 1024;
pub const MAX_EDITOR_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_DIRECTORY_COUNT: usize = 2_048;
pub const MAX_ENTRY_COUNT: usize = 50_000;
pub const MAX_PENDING_REQUESTS: usize = 128;
pub const MAX_ERROR_BYTES: usize = 4_096;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileInputError {
    EmptyPath,
    PathTooLong,
    InvalidPath,
    MissingRevision,
    ValueTooLong(&'static str),
    InvalidLimit,
    ContentTooLarge,
    InvalidHash,
}
impl fmt::Display for FileInputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::EmptyPath => "A file path is required.",
            Self::PathTooLong => "The file path is too long.",
            Self::InvalidPath => "The file path is not a valid relative POSIX path.",
            Self::MissingRevision => "A file revision is required.",
            Self::ValueTooLong(_) => "The request value is too long.",
            Self::InvalidLimit => "The requested page size is invalid.",
            Self::ContentTooLarge => "The file is too large.",
            Self::InvalidHash => "The file revision hash is invalid.",
        })
    }
}
impl std::error::Error for FileInputError {}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RelativeFilePath(Arc<str>);
impl RelativeFilePath {
    pub fn parse(value: impl AsRef<str>) -> Result<Self, FileInputError> {
        validate_relative_path(value.as_ref(), false)?;
        Ok(Self(Arc::from(value.as_ref())))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RelativeDirectoryPath(Arc<str>);
impl RelativeDirectoryPath {
    pub fn root() -> Self {
        Self(Arc::from(""))
    }
    pub fn parse(value: impl AsRef<str>) -> Result<Self, FileInputError> {
        validate_relative_path(value.as_ref(), true)?;
        Ok(Self(Arc::from(value.as_ref())))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub fn validate_relative_path(value: &str, allow_root: bool) -> Result<(), FileInputError> {
    if value.len() > MAX_PATH_BYTES {
        return Err(FileInputError::PathTooLong);
    }
    if value.is_empty() {
        return if allow_root {
            Ok(())
        } else {
            Err(FileInputError::EmptyPath)
        };
    }
    if value.starts_with('/') || value.contains('\\') || value.contains('\0') {
        return Err(FileInputError::InvalidPath);
    }
    if value
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(FileInputError::InvalidPath);
    }
    Ok(())
}

fn bounded(value: &str, max: usize, name: &'static str) -> Result<(), FileInputError> {
    if value.len() <= max {
        Ok(())
    } else {
        Err(FileInputError::ValueTooLong(name))
    }
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileTreeEntryType {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub path: String,
    pub file_name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResponse {
    pub files: Vec<FileMatch>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileSearchQuery {
    pub query: String,
    pub limit: Option<u8>,
}
impl FileSearchQuery {
    pub fn new(query: String, limit: Option<u8>) -> Result<Self, FileInputError> {
        bounded(&query, MAX_QUERY_BYTES, "query")?;
        if limit.is_some_and(|n| n == 0 || n > MAX_SEARCH_RESULTS) {
            return Err(FileInputError::InvalidLimit);
        }
        Ok(Self { query, limit })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: FileTreeEntryType,
    pub size: u64,
    pub modified: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeResponse {
    pub entries: Vec<FileTreeEntry>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileTreeQuery {
    pub path: RelativeDirectoryPath,
    pub cursor: Option<String>,
    pub limit: Option<u16>,
}
impl FileTreeQuery {
    pub fn new(
        path: RelativeDirectoryPath,
        cursor: Option<String>,
        limit: Option<u16>,
    ) -> Result<Self, FileInputError> {
        if let Some(cursor) = &cursor {
            bounded(cursor, MAX_CURSOR_BYTES, "cursor")?;
        }
        if limit.is_some_and(|n| n == 0 || n > MAX_TREE_PAGE) {
            return Err(FileInputError::InvalidLimit);
        }
        Ok(Self {
            path,
            cursor,
            limit,
        })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct FileContentResponse {
    pub content: String,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
    pub expected_hash: Option<String>,
}
impl WriteFileRequest {
    pub fn validate(&self) -> Result<(), FileInputError> {
        validate_relative_path(&self.path, false)?;
        if self.content.len() > MAX_FILE_JSON_BYTES as usize {
            return Err(FileInputError::ContentTooLarge);
        }
        if self
            .expected_hash
            .as_deref()
            .is_some_and(|hash| !valid_hash(hash))
        {
            return Err(FileInputError::InvalidHash);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct WriteFileResponse {
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileRevisionQuery {
    pub path: RelativeFilePath,
    pub revision: String,
}
impl FileRevisionQuery {
    pub fn new(path: RelativeFilePath, revision: String) -> Result<Self, FileInputError> {
        if revision.is_empty() {
            return Err(FileInputError::MissingRevision);
        }
        bounded(&revision, MAX_REVISION_BYTES, "revision")?;
        Ok(Self { path, revision })
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct FileRevisionResponse {
    pub content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FilesUpdatedPayload {
    pub workspace_id: String,
    pub paths: Option<Vec<String>>,
}
impl FilesUpdatedPayload {
    pub fn validate(&self) -> Result<(), FileInputError> {
        bounded(&self.workspace_id, MAX_REQUEST_ID_BYTES, "workspaceId")?;
        if let Some(paths) = &self.paths {
            if paths.len() > MAX_ENTRY_COUNT {
                return Err(FileInputError::ValueTooLong("paths"));
            }
            for path in paths {
                validate_relative_path(path, false)?;
            }
        }
        Ok(())
    }
}
