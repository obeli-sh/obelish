use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct DiscoveryEntry {
    pub pid: u32,
    pub socket_path: String,
    pub started_at: u64,
}

pub fn find_instance() -> Result<PathBuf, String> {
    let path = discovery_path();
    if !path.exists() {
        return Err("Obelisk is not running. Start the desktop app first.".to_string());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read discovery file: {e}"))?;

    let entries: Vec<DiscoveryEntry> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse discovery file: {e}"))?;

    // Filter for living processes
    let alive: Vec<_> = entries
        .into_iter()
        .filter(|e| is_pid_alive(e.pid))
        .collect();

    match alive.len() {
        0 => Err("Obelisk is not running. Start the desktop app first.".to_string()),
        1 => Ok(PathBuf::from(&alive[0].socket_path)),
        n => {
            eprintln!("Multiple Obelisk instances found ({n}). Using most recent.");
            let entry = alive.into_iter().max_by_key(|e| e.started_at).unwrap();
            Ok(PathBuf::from(&entry.socket_path))
        }
    }
}

fn discovery_path() -> PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR")
        .or_else(|_| std::env::var("TMPDIR"))
        .unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(runtime_dir).join("obelisk-discovery.json")
}

fn is_pid_alive(pid: u32) -> bool {
    // Use kill(pid, 0) to check if a process exists (works on Linux and macOS)
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_pid_filtered() {
        // PID 999999999 almost certainly doesn't exist
        assert!(!is_pid_alive(999999999));
    }

    #[test]
    fn current_pid_is_alive() {
        assert!(is_pid_alive(std::process::id()));
    }

    #[test]
    fn discovery_entry_deserializes() {
        let json_str = r#"{"pid": 1234, "socket_path": "/tmp/test.sock", "started_at": 1000}"#;
        let entry: DiscoveryEntry = serde_json::from_str(json_str).unwrap();
        assert_eq!(entry.pid, 1234);
        assert_eq!(entry.socket_path, "/tmp/test.sock");
        assert_eq!(entry.started_at, 1000);
    }

    #[test]
    fn discovery_entries_list_deserializes() {
        let json_str = r#"[
            {"pid": 1234, "socket_path": "/tmp/a.sock", "started_at": 1000},
            {"pid": 5678, "socket_path": "/tmp/b.sock", "started_at": 2000}
        ]"#;
        let entries: Vec<DiscoveryEntry> = serde_json::from_str(json_str).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn empty_alive_entries_returns_error() {
        let entries: Vec<DiscoveryEntry> = vec![];
        let alive: Vec<_> = entries
            .into_iter()
            .filter(|e| is_pid_alive(e.pid))
            .collect();
        assert_eq!(alive.len(), 0);
    }

    #[test]
    fn discovery_path_returns_valid_path() {
        let path = discovery_path();
        assert!(path.to_string_lossy().contains("obelisk-discovery.json"));
    }
}
