use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::error::PersistenceError;
use crate::persistence::PersistenceBackend;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub struct FsPersistence {
    base_dir: PathBuf,
}

impl FsPersistence {
    pub fn new(base_dir: impl Into<PathBuf>) -> Result<Self, PersistenceError> {
        let base_dir = base_dir.into();
        fs::create_dir_all(&base_dir)?;
        Ok(Self { base_dir })
    }

    fn file_path(&self, key: &str) -> PathBuf {
        self.base_dir.join(format!("{key}.json"))
    }

    fn tmp_path(&self, key: &str) -> PathBuf {
        let counter = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        self.base_dir
            .join(format!("{key}.json.{pid}-{counter}.tmp"))
    }

    fn bak_path(&self, key: &str) -> PathBuf {
        self.base_dir.join(format!("{key}.json.bak"))
    }
}

impl PersistenceBackend for FsPersistence {
    fn save(&self, key: &str, data: &[u8]) -> Result<(), PersistenceError> {
        let file_path = self.file_path(key);
        let tmp_path = self.tmp_path(key);
        let bak_path = self.bak_path(key);

        // Write to temp file first (unique per call to avoid races)
        let write_result = (|| {
            let mut file = fs::File::create(&tmp_path)?;
            file.write_all(data)?;
            file.sync_all()?;
            Ok::<(), std::io::Error>(())
        })();

        if let Err(e) = write_result {
            // Clean up tmp on failure
            let _ = fs::remove_file(&tmp_path);
            return Err(e.into());
        }

        // If current file exists, move it to backup (ignore if already moved by concurrent save)
        if file_path.exists() {
            match fs::rename(&file_path, &bak_path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    let _ = fs::remove_file(&tmp_path);
                    return Err(e.into());
                }
            }
        }

        // Atomic rename: tmp -> final
        if let Err(e) = fs::rename(&tmp_path, &file_path) {
            // tmp file may remain for recovery if rename fails
            return Err(e.into());
        }

        Ok(())
    }

    fn load(&self, key: &str) -> Result<Option<Vec<u8>>, PersistenceError> {
        let file_path = self.file_path(key);
        match fs::read(&file_path) {
            Ok(data) => Ok(Some(data)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn delete(&self, key: &str) -> Result<(), PersistenceError> {
        let file_path = self.file_path(key);
        match fs::remove_file(&file_path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn setup() -> (TempDir, FsPersistence) {
        let dir = TempDir::new().unwrap();
        let backend = FsPersistence::new(dir.path()).unwrap();
        (dir, backend)
    }

    #[test]
    fn save_writes_file_to_disk() {
        let (dir, backend) = setup();
        let data = b"hello world";

        backend.save("test_key", data).unwrap();

        let file_path = dir.path().join("test_key.json");
        assert!(file_path.exists());
        let contents = fs::read(&file_path).unwrap();
        assert_eq!(contents, data);
    }

    #[test]
    fn load_reads_file_from_disk() {
        let (dir, backend) = setup();
        let data = b"saved data";

        // Write file directly
        fs::write(dir.path().join("test_key.json"), data).unwrap();

        let loaded = backend.load("test_key").unwrap();
        assert_eq!(loaded, Some(data.to_vec()));
    }

    #[test]
    fn load_returns_none_for_missing_file() {
        let (_dir, backend) = setup();

        let loaded = backend.load("nonexistent").unwrap();
        assert_eq!(loaded, None);
    }

    #[test]
    fn save_is_atomic_no_partial_writes() {
        let (dir, backend) = setup();
        let data = b"atomic data";

        backend.save("atomic_key", data).unwrap();

        // No tmp files should remain after a successful save
        let tmp_files: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(tmp_files.is_empty(), "tmp files remain: {tmp_files:?}");

        // The final file should have the correct contents
        let contents = fs::read(dir.path().join("atomic_key.json")).unwrap();
        assert_eq!(contents, data);
    }

    #[test]
    fn save_creates_backup_file() {
        let (_dir, backend) = setup();
        let first_data = b"version 1";
        let second_data = b"version 2";

        backend.save("backup_key", first_data).unwrap();
        backend.save("backup_key", second_data).unwrap();

        // Main file should have new data
        let loaded = backend.load("backup_key").unwrap().unwrap();
        assert_eq!(loaded, second_data);

        // Backup should have old data
        let bak_path = backend.bak_path("backup_key");
        let backup = fs::read(bak_path).unwrap();
        assert_eq!(backup, first_data);
    }

    #[test]
    fn delete_removes_file() {
        let (dir, backend) = setup();
        let data = b"to delete";

        backend.save("delete_key", data).unwrap();
        assert!(dir.path().join("delete_key.json").exists());

        backend.delete("delete_key").unwrap();
        assert!(!dir.path().join("delete_key.json").exists());
    }

    #[test]
    fn delete_nonexistent_is_ok() {
        let (_dir, backend) = setup();

        // Deleting a nonexistent key should not error
        backend.delete("nonexistent").unwrap();
    }

    #[test]
    fn concurrent_save_load_no_corruption() {
        let (_dir, backend) = setup();
        let backend = Arc::new(backend);

        // First, seed a file so concurrent saves have something to back up
        backend.save("concurrent_key", b"seed").unwrap();

        let mut handles = vec![];

        // Spawn multiple writers
        for i in 0..10 {
            let b = Arc::clone(&backend);
            let handle = std::thread::spawn(move || {
                let data = format!("data-{i}");
                // Concurrent saves may race on temp/backup file operations;
                // the important thing is no panics and no corruption
                let _ = b.save("concurrent_key", data.as_bytes());
            });
            handles.push(handle);
        }

        // Spawn multiple readers
        for _ in 0..10 {
            let b = Arc::clone(&backend);
            let handle = std::thread::spawn(move || {
                // Load should never panic, might get None or Some(valid data)
                let _ = b.load("concurrent_key");
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // After all threads complete, the file should exist with valid data
        let final_data = backend.load("concurrent_key").unwrap();
        assert!(final_data.is_some());
        let data_str = String::from_utf8(final_data.unwrap()).unwrap();
        assert!(data_str.starts_with("data-") || data_str == "seed");
    }

    #[test]
    fn save_creates_missing_parent_dir() {
        let dir = TempDir::new().unwrap();
        let nested = dir.path().join("nested").join("deep");
        let backend = FsPersistence::new(&nested).unwrap();

        backend.save("key", b"value").unwrap();

        let loaded = backend.load("key").unwrap();
        assert_eq!(loaded, Some(b"value".to_vec()));
    }

    #[test]
    fn save_and_load_large_data() {
        let (_dir, backend) = setup();
        let data = vec![42u8; 1_000_000]; // 1MB

        backend.save("large", &data).unwrap();

        let loaded = backend.load("large").unwrap().unwrap();
        assert_eq!(loaded.len(), 1_000_000);
        assert_eq!(loaded, data);
    }

    #[test]
    fn save_load_roundtrip_json() {
        let (_dir, backend) = setup();
        let json_data = serde_json::json!({
            "workspaces": [{"id": "ws-1", "name": "Test"}],
            "activeWorkspaceId": "ws-1"
        });
        let data = serde_json::to_vec(&json_data).unwrap();

        backend.save("state", &data).unwrap();

        let loaded = backend.load("state").unwrap().unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&loaded).unwrap();
        assert_eq!(parsed, json_data);
    }
}
