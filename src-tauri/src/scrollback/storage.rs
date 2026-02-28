use std::fs;
use std::path::PathBuf;

use crate::error::PersistenceError;

pub struct ScrollbackStorage {
    base_dir: PathBuf,
}

impl ScrollbackStorage {
    pub fn new(base_dir: impl Into<PathBuf>) -> Result<Self, PersistenceError> {
        let base_dir = base_dir.into();
        fs::create_dir_all(&base_dir)?;
        Ok(Self { base_dir })
    }

    fn file_path(&self, pane_id: &str) -> Result<PathBuf, PersistenceError> {
        if pane_id.is_empty()
            || pane_id.contains('/')
            || pane_id.contains('\\')
            || pane_id.contains("..")
        {
            return Err(PersistenceError::Corrupted {
                reason: format!("invalid pane_id: {pane_id}"),
            });
        }
        Ok(self.base_dir.join(format!("{pane_id}.zst")))
    }

    pub fn save(&self, pane_id: &str, data: &[u8]) -> Result<(), PersistenceError> {
        let path = self.file_path(pane_id)?;
        let compressed = zstd::encode_all(data, 3).map_err(PersistenceError::Io)?;
        fs::write(&path, &compressed)?;
        Ok(())
    }

    pub fn load(&self, pane_id: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        let path = self.file_path(pane_id)?;
        match fs::read(&path) {
            Ok(compressed) => {
                let data = zstd::decode_all(compressed.as_slice()).map_err(PersistenceError::Io)?;
                Ok(Some(data))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn delete(&self, pane_id: &str) -> Result<(), PersistenceError> {
        let path = self.file_path(pane_id)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, ScrollbackStorage) {
        let dir = TempDir::new().unwrap();
        let storage = ScrollbackStorage::new(dir.path().join("scrollback")).unwrap();
        (dir, storage)
    }

    #[test]
    fn save_creates_compressed_file() {
        let (dir, storage) = setup();
        let data = b"hello scrollback";

        storage.save("pane-1", data).unwrap();

        let file_path = dir.path().join("scrollback").join("pane-1.zst");
        assert!(file_path.exists());
        // Compressed file should differ from raw data
        let raw = fs::read(&file_path).unwrap();
        assert_ne!(raw, data);
    }

    #[test]
    fn load_decompresses_correctly() {
        let (_dir, storage) = setup();
        let data = b"terminal output data";

        storage.save("pane-2", data).unwrap();

        let loaded = storage.load("pane-2").unwrap();
        assert_eq!(loaded, Some(data.to_vec()));
    }

    #[test]
    fn roundtrip_identity() {
        let (_dir, storage) = setup();
        let data = b"arbitrary \x00\x01\x02 binary data with \xff bytes";

        storage.save("pane-rt", data).unwrap();
        let loaded = storage.load("pane-rt").unwrap().unwrap();

        assert_eq!(loaded, data);
    }

    #[test]
    fn load_missing_returns_none() {
        let (_dir, storage) = setup();

        let loaded = storage.load("nonexistent-pane").unwrap();
        assert_eq!(loaded, None);
    }

    #[test]
    fn save_large_buffer() {
        let (_dir, storage) = setup();
        let data = vec![42u8; 1_000_000]; // 1MB

        storage.save("pane-large", &data).unwrap();

        let loaded = storage.load("pane-large").unwrap().unwrap();
        assert_eq!(loaded.len(), 1_000_000);
        assert_eq!(loaded, data);
    }

    #[test]
    fn delete_removes_file() {
        let (dir, storage) = setup();
        let data = b"to be deleted";

        storage.save("pane-del", data).unwrap();
        let file_path = dir.path().join("scrollback").join("pane-del.zst");
        assert!(file_path.exists());

        storage.delete("pane-del").unwrap();
        assert!(!file_path.exists());

        let loaded = storage.load("pane-del").unwrap();
        assert_eq!(loaded, None);
    }

    #[test]
    fn rejects_path_traversal_with_slash() {
        let (_dir, storage) = setup();
        let result = storage.save("../../etc/evil", b"bad data");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("invalid pane_id"));
    }

    #[test]
    fn rejects_path_traversal_with_backslash() {
        let (_dir, storage) = setup();
        let result = storage.load("..\\..\\etc\\evil");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_empty_pane_id() {
        let (_dir, storage) = setup();
        let result = storage.save("", b"data");
        assert!(result.is_err());
    }

    #[test]
    fn rejects_dotdot_pane_id() {
        let (_dir, storage) = setup();
        let result = storage.delete("..");
        assert!(result.is_err());
    }

    #[test]
    fn save_handles_unicode() {
        let (_dir, storage) = setup();
        let data = "你好世界 🌍 こんにちは 한국어 العربية".as_bytes();

        storage.save("pane-unicode", data).unwrap();

        let loaded = storage.load("pane-unicode").unwrap().unwrap();
        assert_eq!(loaded, data);
        let text = String::from_utf8(loaded).unwrap();
        assert!(text.contains("你好世界"));
        assert!(text.contains("🌍"));
    }
}
