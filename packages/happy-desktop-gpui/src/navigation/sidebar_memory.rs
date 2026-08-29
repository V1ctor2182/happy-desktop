//! Window-local sidebar fold and pinned-row preferences.

use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PinnedDestination {
    Social,
    Inbox,
}

impl PinnedDestination {
    pub const ALL: [Self; 2] = [Self::Social, Self::Inbox];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Social => "social",
            Self::Inbox => "inbox",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|item| item.as_str() == value)
    }
}

pub struct SidebarMemory {
    path: Option<PathBuf>,
    collapsed: BTreeSet<String>,
    pinned: Vec<PinnedDestination>,
    persistence_error: Option<String>,
}

impl SidebarMemory {
    pub fn memory_only() -> Self {
        Self {
            path: None,
            collapsed: BTreeSet::new(),
            pinned: PinnedDestination::ALL.into(),
            persistence_error: None,
        }
    }

    pub fn restore(path: PathBuf) -> Self {
        let document = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Document>(&bytes).ok())
            .filter(|document| document.version == VERSION);
        let collapsed = document
            .as_ref()
            .map(|document| {
                document
                    .collapsed
                    .iter()
                    .filter(|value| !value.is_empty())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let mut pinned: Vec<_> = document
            .as_ref()
            .into_iter()
            .flat_map(|document| &document.pinned)
            .filter_map(|value| PinnedDestination::parse(value))
            .collect();
        pinned.dedup();
        for destination in PinnedDestination::ALL {
            if !pinned.contains(&destination) {
                pinned.push(destination);
            }
        }
        Self {
            path: Some(path),
            collapsed,
            pinned,
            persistence_error: None,
        }
    }

    pub fn is_collapsed(&self, stable_row_id: &str) -> bool {
        self.collapsed.contains(stable_row_id)
    }

    pub fn collapse_toggle(&mut self, stable_row_id: &str) {
        if !self.collapsed.remove(stable_row_id) {
            self.collapsed.insert(stable_row_id.to_owned());
        }
        self.persist();
    }

    pub fn pinned(&self) -> &[PinnedDestination] {
        &self.pinned
    }

    pub fn take_persistence_error(&mut self) -> Option<String> {
        self.persistence_error.take()
    }

    fn persist(&mut self) {
        let Some(path) = &self.path else { return };
        let document = Document {
            version: VERSION,
            collapsed: self.collapsed.iter().cloned().collect(),
            pinned: self
                .pinned
                .iter()
                .map(|item| item.as_str().into())
                .collect(),
        };
        let result = serde_json::to_vec(&document)
            .map_err(io::Error::other)
            .and_then(|bytes| atomic_write(path, &bytes));
        self.persistence_error = result.err().map(|error| error.to_string());
    }
}

#[derive(Serialize, Deserialize)]
struct Document {
    version: u32,
    collapsed: Vec<String>,
    pinned: Vec<String>,
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("sidebar");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), nonce));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
