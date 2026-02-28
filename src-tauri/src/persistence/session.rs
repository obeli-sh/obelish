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
        let data = serde_json::to_vec_pretty(&session)?;
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
        if self.dirty.load(Ordering::Acquire) {
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
        );
        state
    }

    fn make_complex_workspace_state() -> WorkspaceState {
        let mut state = WorkspaceState::new();
        state.create_workspace(
            "Workspace 1".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
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
                    "layout": {"type": "leaf", "paneId": "pane-1"}
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

        assert_eq!(session.workspaces.len(), deserialized.workspaces.len());
        assert_eq!(
            session.active_workspace_id,
            deserialized.active_workspace_id
        );
        assert_eq!(session.panes.len(), deserialized.panes.len());

        // Verify workspace names match
        for (orig, deser) in session
            .workspaces
            .iter()
            .zip(deserialized.workspaces.iter())
        {
            assert_eq!(orig.name, deser.name);
            assert_eq!(orig.id, deser.id);
            assert_eq!(orig.surfaces.len(), deser.surfaces.len());
        }
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

        // Verify the restored state produces the same session
        assert_eq!(restored_session.workspaces.len(), session.workspaces.len());
        assert_eq!(restored_session.panes.len(), session.panes.len());
        assert_eq!(
            restored_session.active_workspace_id,
            session.active_workspace_id
        );
    }
}
