use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryEntry {
    pub pid: u32,
    pub socket_path: String,
    pub started_at: u64,
}

pub fn discovery_path() -> PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR")
        .or_else(|_| std::env::var("TMPDIR"))
        .unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(runtime_dir).join("obelisk-discovery.json")
}

pub fn write_entry(entry: &DiscoveryEntry) -> Result<(), std::io::Error> {
    write_entry_to(&discovery_path(), entry)
}

pub fn remove_entry(pid: u32) -> Result<(), std::io::Error> {
    remove_entry_from(&discovery_path(), pid)
}

pub fn read_entries() -> Result<Vec<DiscoveryEntry>, std::io::Error> {
    read_entries_from(&discovery_path())
}

fn write_entry_to(path: &Path, entry: &DiscoveryEntry) -> Result<(), std::io::Error> {
    let mut entries = read_entries_from(path).unwrap_or_default();
    // Remove stale entries (dead PIDs)
    entries.retain(|e| is_pid_alive(e.pid));
    // Remove any existing entry for this PID
    entries.retain(|e| e.pid != entry.pid);
    entries.push(entry.clone());
    let json = serde_json::to_string_pretty(&entries).map_err(std::io::Error::other)?;
    std::fs::write(path, json)
}

fn remove_entry_from(path: &Path, pid: u32) -> Result<(), std::io::Error> {
    let mut entries = read_entries_from(path).unwrap_or_default();
    entries.retain(|e| e.pid != pid);
    if entries.is_empty() {
        let _ = std::fs::remove_file(path);
    } else {
        let json = serde_json::to_string_pretty(&entries).map_err(std::io::Error::other)?;
        std::fs::write(path, json)?;
    }
    Ok(())
}

fn read_entries_from(path: &Path) -> Result<Vec<DiscoveryEntry>, std::io::Error> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(path)?;
    serde_json::from_str(&content)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

fn is_pid_alive(pid: u32) -> bool {
    // Use kill(pid, 0) to check if a process exists (works on Linux and macOS).
    // EPERM means the process exists but belongs to another user — still alive.
    let ret = unsafe { libc::kill(pid as i32, 0) };
    ret == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_path(dir: &Path) -> PathBuf {
        dir.join("obelisk-discovery.json")
    }

    #[test]
    fn write_and_read_entry() {
        let tmp = TempDir::new().unwrap();
        let path = test_path(tmp.path());

        let entry = DiscoveryEntry {
            pid: std::process::id(),
            socket_path: "/tmp/test.sock".to_string(),
            started_at: 1234567890,
        };

        write_entry_to(&path, &entry).unwrap();
        let entries = read_entries_from(&path).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].pid, std::process::id());
        assert_eq!(entries[0].socket_path, "/tmp/test.sock");
        assert_eq!(entries[0].started_at, 1234567890);
    }

    #[test]
    fn remove_entry_cleans_up() {
        let tmp = TempDir::new().unwrap();
        let path = test_path(tmp.path());

        let entry = DiscoveryEntry {
            pid: std::process::id(),
            socket_path: "/tmp/test.sock".to_string(),
            started_at: 1234567890,
        };

        write_entry_to(&path, &entry).unwrap();
        assert_eq!(read_entries_from(&path).unwrap().len(), 1);

        remove_entry_from(&path, std::process::id()).unwrap();
        let entries = read_entries_from(&path).unwrap_or_default();
        assert!(entries.is_empty());
    }

    #[test]
    fn is_pid_alive_current_process() {
        // Current process PID should always be alive
        assert!(is_pid_alive(std::process::id()));
    }

    #[test]
    fn is_pid_alive_dead_pid() {
        // PID 999999999 almost certainly doesn't exist
        assert!(!is_pid_alive(999_999_999));
    }

    #[test]
    fn is_pid_alive_pid_1_returns_true() {
        // PID 1 (init/systemd) always exists; kill(1, 0) returns EPERM for non-root
        assert!(is_pid_alive(1));
    }

    #[test]
    fn stale_pid_cleanup() {
        let tmp = TempDir::new().unwrap();
        let path = test_path(tmp.path());

        // Write an entry with a PID that doesn't exist
        let stale_entry = DiscoveryEntry {
            pid: 999_999_999,
            socket_path: "/tmp/stale.sock".to_string(),
            started_at: 1000,
        };

        // Write it directly to the file to bypass cleanup
        let json = serde_json::to_string_pretty(&vec![stale_entry]).unwrap();
        std::fs::write(&path, json).unwrap();

        // Now write a real entry — stale entry should be cleaned
        let real_entry = DiscoveryEntry {
            pid: std::process::id(),
            socket_path: "/tmp/real.sock".to_string(),
            started_at: 2000,
        };
        write_entry_to(&path, &real_entry).unwrap();

        let entries = read_entries_from(&path).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].pid, std::process::id());
    }
}
