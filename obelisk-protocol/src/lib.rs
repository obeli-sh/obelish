pub mod error;
pub mod framing;
pub mod methods;
pub mod rpc;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub root_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub is_main: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub worktree_path: String,
    #[serde(default)]
    pub branch_name: Option<String>,
    #[serde(default)]
    pub is_root_worktree: bool,
    pub surfaces: Vec<SurfaceInfo>,
    pub active_surface_index: usize,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SurfaceInfo {
    pub id: String,
    pub name: String,
    pub layout: LayoutNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
#[ts(export)]
pub enum LayoutNode {
    #[serde(rename = "leaf")]
    Leaf {
        #[serde(rename = "paneId")]
        pane_id: String,
        #[serde(rename = "ptyId")]
        pty_id: String,
    },
    #[serde(rename = "split")]
    Split {
        direction: SplitDirection,
        children: Box<[LayoutNode; 2]>,
        sizes: [f64; 2],
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PaneInfo {
    pub id: String,
    pub pty_id: String,
    pub pane_type: PaneType,
    pub cwd: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum PaneType {
    Terminal,
    Browser,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitInfo {
    pub branch: Option<String>,
    pub is_dirty: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Notification {
    pub id: String,
    pub pane_id: String,
    pub workspace_id: String,
    pub osc_type: u32,
    pub title: String,
    pub body: Option<String>,
    pub timestamp: u64,
    pub read: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_info_roundtrip() {
        let project = ProjectInfo {
            id: "proj-1".to_string(),
            name: "My Project".to_string(),
            root_path: "/home/user/project".to_string(),
        };
        let json = serde_json::to_string(&project).unwrap();
        let deserialized: ProjectInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(project, deserialized);
    }

    #[test]
    fn worktree_info_roundtrip() {
        let worktree = WorktreeInfo {
            path: "/home/user/project-feature".to_string(),
            branch: Some("feature/cool".to_string()),
            is_main: false,
        };
        let json = serde_json::to_string(&worktree).unwrap();
        let deserialized: WorktreeInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(worktree, deserialized);
    }

    #[test]
    fn workspace_info_roundtrip_with_new_fields() {
        let workspace = WorkspaceInfo {
            id: "ws-1".to_string(),
            name: "Dev".to_string(),
            project_id: "proj-1".to_string(),
            worktree_path: "/home/user/project".to_string(),
            branch_name: Some("main".to_string()),
            is_root_worktree: true,
            surfaces: vec![],
            active_surface_index: 0,
            created_at: 1000,
        };
        let json = serde_json::to_string(&workspace).unwrap();
        let deserialized: WorkspaceInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(workspace, deserialized);
    }

    #[test]
    fn workspace_info_backward_compat_missing_new_fields() {
        // Old-format JSON without the new fields
        let old_json = r#"{
            "id": "ws-1",
            "name": "Dev",
            "surfaces": [],
            "activeSurfaceIndex": 0,
            "createdAt": 1000
        }"#;
        let workspace: WorkspaceInfo = serde_json::from_str(old_json).unwrap();
        assert_eq!(workspace.id, "ws-1");
        assert_eq!(workspace.name, "Dev");
        assert_eq!(workspace.project_id, "");
        assert_eq!(workspace.worktree_path, "");
        assert_eq!(workspace.branch_name, None);
        assert!(!workspace.is_root_worktree);
        assert!(workspace.surfaces.is_empty());
        assert_eq!(workspace.active_surface_index, 0);
        assert_eq!(workspace.created_at, 1000);
    }
}
