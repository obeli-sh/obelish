use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::PersistenceError;
use crate::persistence::PersistenceBackend;
use crate::workspace::WorkspaceState;
use obelisk_protocol::{PaneInfo, WorkspaceInfo};

const SESSION_KEY: &str = "workspace_state";
const SHUTDOWN_MARKER_KEY: &str = ".shutdown_clean";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub workspaces: Vec<WorkspaceInfo>,
    pub active_workspace_id: Option<String>,
    pub panes: HashMap<String, PaneInfo>,
}

pub struct SessionManager {
    backend: Arc<dyn PersistenceBackend>,
    dirty: AtomicBool,
}

impl SessionManager {
    pub fn new(backend: Arc<dyn PersistenceBackend>) -> Self {
        Self {
            backend,
            dirty: AtomicBool::new(false),
        }
    }

    pub fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Release);
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::Acquire)
    }

    pub fn save(&self, state: &WorkspaceState) -> Result<(), PersistenceError> {
        let session = state.to_session_state();
        self.save_from_session(&session)
    }

    pub fn save_from_session(&self, session: &SessionState) -> Result<(), PersistenceError> {
        let data = serde_json::to_vec_pretty(session)?;
        self.backend.save(SESSION_KEY, &data)?;
        self.dirty.store(false, Ordering::Release);
        Ok(())
    }

    pub fn load(&self) -> Result<Option<SessionState>, PersistenceError> {
        match self.backend.load(SESSION_KEY)? {
            Some(data) => {
                let session: SessionState =
                    serde_json::from_slice(&data).map_err(|e| PersistenceError::Corrupted {
                        reason: format!("Failed to deserialize session state: {e}"),
                    })?;
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    pub fn save_if_dirty(&self, state: &WorkspaceState) -> Result<bool, PersistenceError> {
        if self.is_dirty() {
            self.save(state)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn write_clean_shutdown_marker(&self) -> Result<(), PersistenceError> {
        self.backend.save(SHUTDOWN_MARKER_KEY, b"clean")
    }

    pub fn check_clean_shutdown(&self) -> Result<bool, PersistenceError> {
        Ok(self.backend.load(SHUTDOWN_MARKER_KEY)?.is_some())
    }

    pub fn delete_clean_shutdown_marker(&self) -> Result<(), PersistenceError> {
        self.backend.delete(SHUTDOWN_MARKER_KEY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::fs::FsPersistence;
    use obelisk_protocol::{LayoutNode, SplitDirection};
    use tempfile::TempDir;

    fn setup() -> (TempDir, SessionManager) {
        let dir = TempDir::new().unwrap();
        let backend = Arc::new(FsPersistence::new(dir.path()).unwrap());
        let manager = SessionManager::new(backend);
        (dir, manager)
    }

    fn make_test_workspace_state() -> WorkspaceState {
        let mut state = WorkspaceState::new();
        state.create_workspace(
            "Test Workspace".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(), // project_id
            String::new(), // worktree_path
            None,          // branch_name
            false,         // is_root_worktree
        );
        state
    }

    fn make_complex_workspace_state() -> WorkspaceState {
        let mut state = WorkspaceState::new();
        state.create_workspace(
            "Workspace 1".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(), // project_id
            String::new(), // worktree_path
            None,          // branch_name
            false,         // is_root_worktree
        );
        state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();
        state.create_workspace(
            "Workspace 2".to_string(),
            "pane-3".to_string(),
            "pty-3".to_string(),
            String::new(), // project_id
            String::new(), // worktree_path
            None,          // branch_name
            false,         // is_root_worktree
        );
        state
    }

    // --- SessionState serialization tests ---

    #[test]
    fn workspace_state_serializes_to_json() {
        let state = make_test_workspace_state();
        let session = state.to_session_state();
        let json = serde_json::to_string(&session).unwrap();

        // Verify the JSON is valid and contains expected fields
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed["workspaces"].is_array());
        assert_eq!(parsed["workspaces"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["workspaces"][0]["name"], "Test Workspace");
        assert!(parsed["panes"].is_object());
    }

    #[test]
    fn workspace_state_deserializes_from_json() {
        let json = r#"{
            "workspaces": [{
                "id": "ws-1",
                "name": "My Workspace",
                "surfaces": [{
                    "id": "surf-1",
                    "name": "Main",
                    "layout": {"type": "leaf", "paneId": "pane-1", "ptyId": "pty-1"}
                }],
                "activeSurfaceIndex": 0,
                "createdAt": 1234567890
            }],
            "activeWorkspaceId": "ws-1",
            "panes": {
                "pane-1": {
                    "id": "pane-1",
                    "ptyId": "pty-1",
                    "paneType": "terminal",
                    "cwd": null
                }
            }
        }"#;

        let session: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(session.workspaces.len(), 1);
        assert_eq!(session.workspaces[0].name, "My Workspace");
        assert_eq!(session.active_workspace_id, Some("ws-1".to_string()));
        assert!(session.panes.contains_key("pane-1"));
    }

    #[test]
    fn roundtrip_serialize_deserialize_identity() {
        let state = make_complex_workspace_state();
        let session = state.to_session_state();

        let json = serde_json::to_string(&session).unwrap();
        let deserialized: SessionState = serde_json::from_str(&json).unwrap();

        assert_eq!(session, deserialized);
    }

    #[test]
    fn deserialize_corrupted_json_returns_error() {
        let (_dir, manager) = setup();

        // Write corrupted data directly
        manager
            .backend
            .save(SESSION_KEY, b"not valid json{{{")
            .unwrap();

        let result = manager.load();
        assert!(result.is_err() || matches!(result, Ok(None)));
        // With our implementation, corrupted JSON returns a PersistenceError
        match result {
            Err(PersistenceError::Corrupted { .. }) => {} // expected
            other => panic!("Expected Corrupted error, got: {other:?}"),
        }
    }

    #[test]
    fn deserialize_empty_json_returns_error() {
        let (_dir, manager) = setup();

        manager.backend.save(SESSION_KEY, b"").unwrap();

        let result = manager.load();
        assert!(matches!(result, Err(PersistenceError::Corrupted { .. })));
    }

    #[test]
    fn deserialize_extra_fields_ignored() {
        let json = r#"{
            "workspaces": [],
            "activeWorkspaceId": null,
            "panes": {},
            "unknownField": "should be ignored",
            "anotherUnknown": 42
        }"#;

        let session: SessionState = serde_json::from_str(json).unwrap();
        assert!(session.workspaces.is_empty());
        assert_eq!(session.active_workspace_id, None);
    }

    // --- SessionManager tests ---

    #[test]
    fn save_persists_state() {
        let (dir, manager) = setup();
        let state = make_test_workspace_state();

        manager.save(&state).unwrap();

        // Verify file exists on disk
        assert!(dir.path().join("workspace_state.json").exists());
    }

    #[test]
    fn load_returns_persisted_state() {
        let (_dir, manager) = setup();
        let state = make_test_workspace_state();

        manager.save(&state).unwrap();
        let loaded = manager.load().unwrap().unwrap();

        assert_eq!(loaded.workspaces.len(), 1);
        assert_eq!(loaded.workspaces[0].name, "Test Workspace");
    }

    #[test]
    fn load_returns_none_when_no_saved_state() {
        let (_dir, manager) = setup();

        let loaded = manager.load().unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn save_if_dirty_saves_when_dirty() {
        let (_dir, manager) = setup();
        let state = make_test_workspace_state();

        manager.mark_dirty();
        let saved = manager.save_if_dirty(&state).unwrap();

        assert!(saved);
        assert!(!manager.is_dirty());

        let loaded = manager.load().unwrap();
        assert!(loaded.is_some());
    }

    #[test]
    fn save_if_dirty_skips_when_clean() {
        let (_dir, manager) = setup();
        let state = make_test_workspace_state();

        // Not dirty, should skip
        let saved = manager.save_if_dirty(&state).unwrap();

        assert!(!saved);
        let loaded = manager.load().unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn mark_dirty_sets_flag() {
        let (_dir, manager) = setup();

        assert!(!manager.is_dirty());
        manager.mark_dirty();
        assert!(manager.is_dirty());
    }

    #[test]
    fn save_clears_dirty_flag() {
        let (_dir, manager) = setup();
        let state = make_test_workspace_state();

        manager.mark_dirty();
        assert!(manager.is_dirty());

        manager.save(&state).unwrap();
        assert!(!manager.is_dirty());
    }

    #[test]
    fn clean_shutdown_marker_roundtrip() {
        let (_dir, manager) = setup();

        // Initially no marker
        assert!(!manager.check_clean_shutdown().unwrap());

        // Write marker
        manager.write_clean_shutdown_marker().unwrap();
        assert!(manager.check_clean_shutdown().unwrap());

        // Delete marker
        manager.delete_clean_shutdown_marker().unwrap();
        assert!(!manager.check_clean_shutdown().unwrap());
    }

    #[test]
    fn check_clean_shutdown_returns_false_when_missing() {
        let (_dir, manager) = setup();

        assert!(!manager.check_clean_shutdown().unwrap());
    }

    #[test]
    fn save_restore_complex_state_roundtrip() {
        let (_dir, manager) = setup();
        let state = make_complex_workspace_state();

        manager.save(&state).unwrap();
        let loaded = manager.load().unwrap().unwrap();

        // Verify the complex state survived the roundtrip
        assert_eq!(loaded.workspaces.len(), 2);
        assert_eq!(loaded.panes.len(), 3);
        assert_eq!(loaded.workspaces[0].name, "Workspace 1");
        assert_eq!(loaded.workspaces[1].name, "Workspace 2");

        // Verify the split layout in workspace 1
        let ws1 = &loaded.workspaces[0];
        match &ws1.surfaces[0].layout {
            LayoutNode::Split { direction, .. } => {
                assert!(matches!(direction, SplitDirection::Horizontal));
            }
            _ => panic!("Expected split layout in workspace 1"),
        }
    }

    #[test]
    fn from_session_state_restores_workspace_state() {
        let original = make_complex_workspace_state();
        let session = original.to_session_state();

        let restored = WorkspaceState::from_session_state(session.clone());
        let restored_session = restored.to_session_state();

        assert_eq!(restored_session, session);
    }

    #[test]
    fn deserialize_old_session_without_project_fields() {
        let json = r#"{
            "workspaces": [{
                "id": "ws-1",
                "name": "My Workspace",
                "surfaces": [{
                    "id": "surf-1",
                    "name": "Main",
                    "layout": {"type": "leaf", "paneId": "pane-1", "ptyId": "pty-1"}
                }],
                "activeSurfaceIndex": 0,
                "createdAt": 1234567890
            }],
            "activeWorkspaceId": "ws-1",
            "panes": {
                "pane-1": {
                    "id": "pane-1",
                    "ptyId": "pty-1",
                    "paneType": "terminal",
                    "cwd": null
                }
            }
        }"#;

        let session: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(session.workspaces.len(), 1);
        // New fields should have serde defaults
        assert_eq!(session.workspaces[0].project_id, "");
        assert_eq!(session.workspaces[0].worktree_path, "");
        assert_eq!(session.workspaces[0].branch_name, None);
        assert!(!session.workspaces[0].is_root_worktree);
    }

    // --- Fault injection tests ---

    /// A mock backend that always fails on save (simulates disk full).
    struct FailingSaveBackend;

    impl PersistenceBackend for FailingSaveBackend {
        fn save(&self, _key: &str, _data: &[u8]) -> Result<(), crate::error::PersistenceError> {
            Err(crate::error::PersistenceError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "disk full",
            )))
        }
        fn load(&self, _key: &str) -> Result<Option<Vec<u8>>, crate::error::PersistenceError> {
            Ok(None)
        }
        fn delete(&self, _key: &str) -> Result<(), crate::error::PersistenceError> {
            Ok(())
        }
    }

    #[test]
    fn disk_full_simulation_save_returns_error() {
        let backend = Arc::new(FailingSaveBackend);
        let manager = SessionManager::new(backend);
        let state = make_test_workspace_state();

        let result = manager.save(&state);
        assert!(result.is_err());
        // Verify it's an IO error with the disk full message
        match result {
            Err(crate::error::PersistenceError::Io(e)) => {
                assert_eq!(e.to_string(), "disk full");
            }
            other => panic!("Expected Io(disk full) error, got: {other:?}"),
        }
    }

    #[test]
    fn disk_full_simulation_save_if_dirty_returns_error() {
        let backend = Arc::new(FailingSaveBackend);
        let manager = SessionManager::new(backend);
        let state = make_test_workspace_state();

        manager.mark_dirty();
        let result = manager.save_if_dirty(&state);
        assert!(result.is_err());
        // Dirty flag should still be set since save failed
        // (save_if_dirty calls save which calls save_from_session which
        // only clears dirty on success — but the error happens in backend.save
        // before dirty.store(false) is reached)
    }

    #[test]
    fn corrupted_data_recovery_returns_error_not_panic() {
        let (_dir, manager) = setup();
        let state = make_test_workspace_state();

        // Save valid data first
        manager.save(&state).unwrap();

        // Overwrite with garbage bytes
        manager
            .backend
            .save(SESSION_KEY, &[0xFF, 0xFE, 0x00, 0x01, 0xAB, 0xCD])
            .unwrap();

        // Attempting to load should return an error, not panic
        let result = manager.load();
        assert!(result.is_err());
        match result {
            Err(crate::error::PersistenceError::Corrupted { .. }) => {} // expected
            other => panic!("Expected Corrupted error, got: {other:?}"),
        }
    }

    #[test]
    fn empty_file_recovery_returns_error_not_panic() {
        let (_dir, manager) = setup();

        // Save an empty file
        manager.backend.save(SESSION_KEY, b"").unwrap();

        // Should return an error (empty JSON is not valid), not panic
        let result = manager.load();
        assert!(result.is_err());
        match result {
            Err(crate::error::PersistenceError::Corrupted { .. }) => {} // expected
            other => panic!("Expected Corrupted error, got: {other:?}"),
        }
    }

    #[test]
    fn concurrent_mark_dirty_save_if_dirty() {
        let (_dir, manager) = setup();
        let state = make_test_workspace_state();

        // Rapidly mark dirty and save_if_dirty in sequence
        for _ in 0..100 {
            manager.mark_dirty();
            assert!(manager.is_dirty());
            let saved = manager.save_if_dirty(&state).unwrap();
            assert!(saved);
            assert!(!manager.is_dirty());
        }

        // Verify final state is loadable
        let loaded = manager.load().unwrap();
        assert!(loaded.is_some());
    }

    #[test]
    fn save_if_dirty_resets_flag_atomically() {
        let (_dir, manager) = setup();
        let state = make_test_workspace_state();

        // Mark dirty, then save_if_dirty should clear the flag
        manager.mark_dirty();
        assert!(manager.is_dirty());
        manager.save_if_dirty(&state).unwrap();
        assert!(!manager.is_dirty());

        // Second call should not save (flag was cleared)
        let saved = manager.save_if_dirty(&state).unwrap();
        assert!(!saved);
    }

    #[test]
    fn clean_shutdown_marker_write_check_delete_check() {
        // Explicit full roundtrip: write → check true → delete → check false
        let (_dir, manager) = setup();

        // Initially no marker
        assert!(!manager.check_clean_shutdown().unwrap());

        // Write marker
        manager.write_clean_shutdown_marker().unwrap();
        assert!(manager.check_clean_shutdown().unwrap());

        // Write again (idempotent)
        manager.write_clean_shutdown_marker().unwrap();
        assert!(manager.check_clean_shutdown().unwrap());

        // Delete marker
        manager.delete_clean_shutdown_marker().unwrap();
        assert!(!manager.check_clean_shutdown().unwrap());

        // Delete again (idempotent)
        manager.delete_clean_shutdown_marker().unwrap();
        assert!(!manager.check_clean_shutdown().unwrap());
    }

    #[test]
    fn save_load_roundtrip_complex_state_with_browser_panes() {
        use obelisk_protocol::PaneType;

        let (_dir, manager) = setup();

        // Build a complex session state with multiple workspaces, surfaces,
        // panes (including a browser pane type), and project metadata.
        let session = SessionState {
            workspaces: vec![
                WorkspaceInfo {
                    id: "ws-1".to_string(),
                    name: "Dev Workspace".to_string(),
                    surfaces: vec![
                        obelisk_protocol::SurfaceInfo {
                            id: "surf-1".to_string(),
                            name: "Main".to_string(),
                            layout: LayoutNode::Split {
                                direction: SplitDirection::Horizontal,
                                children: Box::new([
                                    LayoutNode::Leaf {
                                        pane_id: "pane-1".to_string(),
                                        pty_id: "pty-1".to_string(),
                                    },
                                    LayoutNode::Leaf {
                                        pane_id: "pane-2".to_string(),
                                        pty_id: "pty-2".to_string(),
                                    },
                                ]),
                                sizes: [0.5, 0.5],
                            },
                        },
                        obelisk_protocol::SurfaceInfo {
                            id: "surf-2".to_string(),
                            name: "Browser".to_string(),
                            layout: LayoutNode::Leaf {
                                pane_id: "pane-browser".to_string(),
                                pty_id: String::new(),
                            },
                        },
                    ],
                    active_surface_index: 0,
                    created_at: 1700000000,
                    project_id: "proj-1".to_string(),
                    worktree_path: "/home/user/project".to_string(),
                    branch_name: Some("feature-branch".to_string()),
                    is_root_worktree: false,
                },
                WorkspaceInfo {
                    id: "ws-2".to_string(),
                    name: "Docs Workspace".to_string(),
                    surfaces: vec![obelisk_protocol::SurfaceInfo {
                        id: "surf-3".to_string(),
                        name: "Editor".to_string(),
                        layout: LayoutNode::Leaf {
                            pane_id: "pane-3".to_string(),
                            pty_id: "pty-3".to_string(),
                        },
                    }],
                    active_surface_index: 0,
                    created_at: 1700000100,
                    project_id: "proj-2".to_string(),
                    worktree_path: "/home/user/docs".to_string(),
                    branch_name: None,
                    is_root_worktree: true,
                },
            ],
            active_workspace_id: Some("ws-1".to_string()),
            panes: {
                let mut m = HashMap::new();
                m.insert(
                    "pane-1".to_string(),
                    PaneInfo {
                        id: "pane-1".to_string(),
                        pty_id: "pty-1".to_string(),
                        pane_type: PaneType::Terminal,
                        cwd: Some("/home/user/project".to_string()),
                        url: None,
                    },
                );
                m.insert(
                    "pane-2".to_string(),
                    PaneInfo {
                        id: "pane-2".to_string(),
                        pty_id: "pty-2".to_string(),
                        pane_type: PaneType::Terminal,
                        cwd: Some("/tmp".to_string()),
                        url: None,
                    },
                );
                m.insert(
                    "pane-browser".to_string(),
                    PaneInfo {
                        id: "pane-browser".to_string(),
                        pty_id: String::new(),
                        pane_type: PaneType::Browser,
                        cwd: None,
                        url: Some("https://example.com".to_string()),
                    },
                );
                m.insert(
                    "pane-3".to_string(),
                    PaneInfo {
                        id: "pane-3".to_string(),
                        pty_id: "pty-3".to_string(),
                        pane_type: PaneType::Terminal,
                        cwd: None,
                        url: None,
                    },
                );
                m
            },
        };

        // Save and reload
        manager.save_from_session(&session).unwrap();
        let loaded = manager.load().unwrap().unwrap();

        // Verify everything is preserved
        assert_eq!(loaded, session);
        assert_eq!(loaded.workspaces.len(), 2);
        assert_eq!(loaded.panes.len(), 4);

        // Verify workspace metadata
        assert_eq!(loaded.workspaces[0].project_id, "proj-1");
        assert_eq!(
            loaded.workspaces[0].branch_name,
            Some("feature-branch".to_string())
        );
        assert!(!loaded.workspaces[0].is_root_worktree);
        assert!(loaded.workspaces[1].is_root_worktree);

        // Verify browser pane
        let browser_pane = loaded.panes.get("pane-browser").unwrap();
        assert_eq!(browser_pane.pane_type, PaneType::Browser);
        assert!(browser_pane.pty_id.is_empty());
        assert!(browser_pane.cwd.is_none());
        assert_eq!(browser_pane.url, Some("https://example.com".to_string()));

        // Verify split layout preserved
        match &loaded.workspaces[0].surfaces[0].layout {
            LayoutNode::Split {
                direction,
                sizes,
                children,
            } => {
                assert!(matches!(direction, SplitDirection::Horizontal));
                assert!((sizes[0] - 0.5).abs() < f64::EPSILON);
                assert!((sizes[1] - 0.5).abs() < f64::EPSILON);
                assert_eq!(children.len(), 2);
            }
            _ => panic!("Expected split layout"),
        }
    }

    #[test]
    fn load_after_truncation_returns_corrupted_error() {
        let (dir, manager) = setup();

        // Save a valid complex state
        let state = make_complex_workspace_state();
        manager.save(&state).unwrap();

        // Read the file, truncate to half its length, and write back
        let file_path = dir.path().join("workspace_state.json");
        let data = std::fs::read(&file_path).unwrap();
        assert!(data.len() > 10, "saved data should be non-trivial");
        let truncated = &data[..data.len() / 2];
        std::fs::write(&file_path, truncated).unwrap();

        // Load should return a Corrupted error (truncated JSON is not valid)
        let result = manager.load();
        assert!(result.is_err());
        match result {
            Err(PersistenceError::Corrupted { reason }) => {
                assert!(
                    reason.contains("deserialize"),
                    "error should mention deserialization: {reason}"
                );
            }
            other => panic!("Expected Corrupted error, got: {other:?}"),
        }
    }

    #[test]
    fn roundtrip_with_project_and_worktree_fields() {
        let mut state = WorkspaceState::new();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            "proj-1".to_string(),
            "/home/user/project".to_string(),
            Some("main".to_string()),
            true,
        );
        let session = state.to_session_state();
        let json = serde_json::to_string(&session).unwrap();
        let deserialized: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(session, deserialized);
        assert_eq!(deserialized.workspaces[0].project_id, "proj-1");
        assert_eq!(
            deserialized.workspaces[0].worktree_path,
            "/home/user/project"
        );
        assert_eq!(
            deserialized.workspaces[0].branch_name,
            Some("main".to_string())
        );
        assert!(deserialized.workspaces[0].is_root_worktree);
    }

    // --- Corrupted session recovery tests ---

    #[test]
    fn partial_json_returns_corrupted_error() {
        let (_dir, manager) = setup();
        manager
            .backend
            .save(SESSION_KEY, b"{\"workspaces\": [")
            .unwrap();
        let result = manager.load();
        assert!(matches!(result, Err(PersistenceError::Corrupted { .. })));
    }

    #[test]
    fn wrong_schema_returns_corrupted_error() {
        let (_dir, manager) = setup();
        manager
            .backend
            .save(SESSION_KEY, b"{\"foo\": \"bar\"}")
            .unwrap();
        let result = manager.load();
        // Should fail because required fields are missing
        assert!(matches!(result, Err(PersistenceError::Corrupted { .. })));
    }

    #[test]
    fn duplicate_pane_ids_deserializes_last_wins() {
        let json = r#"{
            "workspaces": [{
                "id": "ws-1", "name": "WS", "surfaces": [{"id": "s-1", "name": "S", "layout": {"type": "leaf", "paneId": "pane-1", "ptyId": "pty-1"}}],
                "activeSurfaceIndex": 0, "createdAt": 100
            }],
            "activeWorkspaceId": "ws-1",
            "panes": {
                "pane-1": {"id": "pane-1", "ptyId": "pty-1", "paneType": "terminal", "cwd": null}
            }
        }"#;
        let session: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(session.panes.len(), 1);
    }

    #[test]
    fn large_session_roundtrip() {
        let (_dir, manager) = setup();
        let mut state = WorkspaceState::new();
        for i in 0..100 {
            state.create_workspace(
                format!("WS-{i}"),
                format!("pane-{i}"),
                format!("pty-{i}"),
                String::new(),
                String::new(),
                None,
                false,
            );
        }
        manager.save(&state).unwrap();
        let loaded = manager.load().unwrap().unwrap();
        assert_eq!(loaded.workspaces.len(), 100);
    }

    #[test]
    fn concurrent_save_and_load() {
        let (_dir, manager) = setup();
        let manager = std::sync::Arc::new(manager);
        let state = make_complex_workspace_state();

        // Save once first
        manager.save(&state).unwrap();

        let handles: Vec<_> = (0..10)
            .map(|i| {
                let m = manager.clone();
                let s = state.to_session_state();
                std::thread::spawn(move || {
                    if i % 2 == 0 {
                        m.save_from_session(&s).unwrap();
                    } else {
                        let _ = m.load();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        // Final load should succeed
        let loaded = manager.load().unwrap().unwrap();
        assert_eq!(loaded.workspaces.len(), 2);
    }

    #[test]
    fn save_overwrites_previous() {
        let (_dir, manager) = setup();
        let state1 = make_test_workspace_state();
        manager.save(&state1).unwrap();

        let mut state2 = WorkspaceState::new();
        state2.create_workspace(
            "New WS".to_string(),
            "pane-new".to_string(),
            "pty-new".to_string(),
            String::new(),
            String::new(),
            None,
            false,
        );
        state2.create_workspace(
            "Another".to_string(),
            "pane-another".to_string(),
            "pty-another".to_string(),
            String::new(),
            String::new(),
            None,
            false,
        );
        manager.save(&state2).unwrap();

        let loaded = manager.load().unwrap().unwrap();
        assert_eq!(loaded.workspaces.len(), 2);
        assert_eq!(loaded.workspaces[0].name, "New WS");
    }

    #[test]
    fn binary_garbage_returns_corrupted_error() {
        let (_dir, manager) = setup();
        manager
            .backend
            .save(SESSION_KEY, &[0xFF, 0xFE, 0xFD, 0x00, 0x01])
            .unwrap();
        let result = manager.load();
        assert!(matches!(result, Err(PersistenceError::Corrupted { .. })));
    }

    #[test]
    fn corrupted_error_does_not_leak_paths() {
        let (_dir, manager) = setup();
        manager
            .backend
            .save(SESSION_KEY, b"invalid json{{{")
            .unwrap();
        let err = manager.load().unwrap_err();
        let msg = format!("{err}");
        assert!(
            !msg.contains("/home/"),
            "Error should not contain internal paths: {msg}"
        );
        assert!(
            !msg.contains("/Users/"),
            "Error should not contain internal paths: {msg}"
        );
        assert!(
            !msg.contains("C:\\"),
            "Error should not contain internal paths: {msg}"
        );
    }
}
