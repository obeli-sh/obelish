use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::WorkspaceError;
use crate::workspace::types::{
    LayoutNode, PaneCloseResult, PaneInfo, PaneSplitResult, PaneType, SplitDirection, SurfaceInfo,
    WorkspaceInfo,
};

pub struct WorkspaceState {
    workspaces: Vec<WorkspaceInfo>,
    active_workspace_id: Option<String>,
    panes: HashMap<String, PaneInfo>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        Self {
            workspaces: Vec::new(),
            active_workspace_id: None,
            panes: HashMap::new(),
        }
    }

    pub fn create_workspace(
        &mut self,
        name: String,
        pane_id: String,
        pty_id: String,
    ) -> WorkspaceInfo {
        let workspace_id = uuid::Uuid::new_v4().to_string();
        let surface_id = uuid::Uuid::new_v4().to_string();

        let pane = PaneInfo {
            id: pane_id.clone(),
            pty_id,
            pane_type: PaneType::Terminal,
            cwd: None,
        };
        self.panes.insert(pane_id.clone(), pane);

        let surface = SurfaceInfo {
            id: surface_id,
            name: name.clone(),
            layout: LayoutNode::Leaf {
                pane_id: pane_id.clone(),
            },
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let workspace = WorkspaceInfo {
            id: workspace_id.clone(),
            name,
            surfaces: vec![surface],
            active_surface_index: 0,
            created_at: now,
        };

        self.workspaces.push(workspace.clone());
        self.active_workspace_id = Some(workspace_id);

        workspace
    }

    pub fn close_workspace(&mut self, id: &str) -> Result<Vec<String>, WorkspaceError> {
        if self.workspaces.len() <= 1 {
            let is_target = self.workspaces.first().is_some_and(|w| w.id == id);
            if is_target {
                return Err(WorkspaceError::LastWorkspace);
            }
        }

        let pos = self
            .workspaces
            .iter()
            .position(|w| w.id == id)
            .ok_or_else(|| WorkspaceError::NotFound { id: id.to_string() })?;

        let workspace = self.workspaces.remove(pos);

        let mut pty_ids = Vec::new();
        for surface in &workspace.surfaces {
            self.collect_pane_ids(&surface.layout, &mut pty_ids);
        }

        if self.active_workspace_id.as_deref() == Some(id) {
            self.active_workspace_id = self.workspaces.first().map(|w| w.id.clone());
        }

        Ok(pty_ids)
    }

    pub fn list_workspaces(&self) -> &[WorkspaceInfo] {
        &self.workspaces
    }

    pub fn get_workspace(&self, id: &str) -> Option<&WorkspaceInfo> {
        self.workspaces.iter().find(|w| w.id == id)
    }

    pub fn split_pane(
        &mut self,
        pane_id: &str,
        direction: SplitDirection,
        new_pane_id: String,
        new_pty_id: String,
    ) -> Result<PaneSplitResult, WorkspaceError> {
        if !self.panes.contains_key(pane_id) {
            return Err(WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            });
        }

        let new_pane = PaneInfo {
            id: new_pane_id.clone(),
            pty_id: new_pty_id,
            pane_type: PaneType::Terminal,
            cwd: None,
        };
        self.panes.insert(new_pane_id.clone(), new_pane.clone());

        let workspace = self
            .workspaces
            .iter_mut()
            .find(|w| {
                w.surfaces
                    .iter()
                    .any(|s| layout_contains_pane(&s.layout, pane_id))
            })
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;

        for surface in &mut workspace.surfaces {
            if layout_contains_pane(&surface.layout, pane_id) {
                surface.layout =
                    split_layout_node(surface.layout.clone(), pane_id, direction, &new_pane_id);
                break;
            }
        }

        Ok(PaneSplitResult {
            workspace: workspace.clone(),
            new_pane,
        })
    }

    pub fn close_pane(&mut self, pane_id: &str) -> Result<PaneCloseResult, WorkspaceError> {
        let pane = self
            .panes
            .remove(pane_id)
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;

        let pty_id = pane.pty_id.clone();

        let workspace = self
            .workspaces
            .iter_mut()
            .find(|w| {
                w.surfaces
                    .iter()
                    .any(|s| layout_contains_pane(&s.layout, pane_id))
            })
            .ok_or_else(|| {
                // Put pane back since we couldn't find its workspace
                self.panes.insert(pane_id.to_string(), pane);
                WorkspaceError::PaneNotFound {
                    id: pane_id.to_string(),
                }
            })?;

        // Find which surface contains the pane and remove it from the layout
        let mut surface_to_remove = None;
        for (i, surface) in workspace.surfaces.iter_mut().enumerate() {
            if layout_contains_pane(&surface.layout, pane_id) {
                match remove_from_layout(&surface.layout, pane_id) {
                    Some(new_layout) => {
                        surface.layout = new_layout;
                    }
                    None => {
                        // The pane was the only leaf in this surface
                        surface_to_remove = Some(i);
                    }
                }
                break;
            }
        }

        if let Some(idx) = surface_to_remove {
            workspace.surfaces.remove(idx);
            if workspace.active_surface_index >= workspace.surfaces.len()
                && !workspace.surfaces.is_empty()
            {
                workspace.active_surface_index = workspace.surfaces.len() - 1;
            }
        }

        // Check if workspace has no surfaces left
        let workspace_closed = workspace.surfaces.is_empty();
        let workspace_info = if workspace_closed {
            None
        } else {
            Some(workspace.clone())
        };

        if workspace_closed {
            let workspace_id = workspace.id.clone();
            self.workspaces.retain(|w| w.id != workspace_id);
            if self.active_workspace_id.as_deref() == Some(&workspace_id) {
                self.active_workspace_id = self.workspaces.first().map(|w| w.id.clone());
            }
        }

        Ok(PaneCloseResult {
            pty_id,
            workspace_closed,
            workspace: workspace_info,
        })
    }

    pub fn get_pane(&self, id: &str) -> Option<&PaneInfo> {
        self.panes.get(id)
    }

    fn collect_pane_ids(&mut self, layout: &LayoutNode, pty_ids: &mut Vec<String>) {
        match layout {
            LayoutNode::Leaf { pane_id } => {
                if let Some(pane) = self.panes.remove(pane_id) {
                    pty_ids.push(pane.pty_id);
                }
            }
            LayoutNode::Split { children, .. } => {
                self.collect_pane_ids(&children[0], pty_ids);
                self.collect_pane_ids(&children[1], pty_ids);
            }
        }
    }
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self::new()
    }
}

fn layout_contains_pane(layout: &LayoutNode, pane_id: &str) -> bool {
    match layout {
        LayoutNode::Leaf { pane_id: id } => id == pane_id,
        LayoutNode::Split { children, .. } => {
            layout_contains_pane(&children[0], pane_id)
                || layout_contains_pane(&children[1], pane_id)
        }
    }
}

fn split_layout_node(
    layout: LayoutNode,
    target_pane_id: &str,
    direction: SplitDirection,
    new_pane_id: &str,
) -> LayoutNode {
    match layout {
        LayoutNode::Leaf { ref pane_id } if pane_id == target_pane_id => LayoutNode::Split {
            direction,
            children: Box::new([
                layout.clone(),
                LayoutNode::Leaf {
                    pane_id: new_pane_id.to_string(),
                },
            ]),
            sizes: [0.5, 0.5],
        },
        LayoutNode::Split {
            direction: d,
            children,
            sizes,
        } => {
            let [left, right] = *children;
            LayoutNode::Split {
                direction: d,
                children: Box::new([
                    split_layout_node(left, target_pane_id, direction.clone(), new_pane_id),
                    split_layout_node(right, target_pane_id, direction, new_pane_id),
                ]),
                sizes,
            }
        }
        other => other,
    }
}

fn remove_from_layout(layout: &LayoutNode, pane_id: &str) -> Option<LayoutNode> {
    match layout {
        LayoutNode::Leaf { pane_id: id } if id == pane_id => None,
        LayoutNode::Leaf { .. } => Some(layout.clone()),
        LayoutNode::Split { children, .. } => {
            let left_contains = layout_contains_pane(&children[0], pane_id);
            let right_contains = layout_contains_pane(&children[1], pane_id);

            if !left_contains && !right_contains {
                return Some(layout.clone());
            }

            if left_contains {
                match remove_from_layout(&children[0], pane_id) {
                    Some(new_left) => Some(LayoutNode::Split {
                        direction: match layout {
                            LayoutNode::Split { direction, .. } => direction.clone(),
                            _ => unreachable!(),
                        },
                        children: Box::new([new_left, children[1].clone()]),
                        sizes: match layout {
                            LayoutNode::Split { sizes, .. } => *sizes,
                            _ => unreachable!(),
                        },
                    }),
                    None => Some(children[1].clone()),
                }
            } else {
                match remove_from_layout(&children[1], pane_id) {
                    Some(new_right) => Some(LayoutNode::Split {
                        direction: match layout {
                            LayoutNode::Split { direction, .. } => direction.clone(),
                            _ => unreachable!(),
                        },
                        children: Box::new([children[0].clone(), new_right]),
                        sizes: match layout {
                            LayoutNode::Split { sizes, .. } => *sizes,
                            _ => unreachable!(),
                        },
                    }),
                    None => Some(children[0].clone()),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_state() -> WorkspaceState {
        WorkspaceState::new()
    }

    #[test]
    fn create_workspace_returns_valid_info() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        assert!(!ws.id.is_empty());
        assert_eq!(ws.name, "Test");
        assert!(ws.created_at > 0);
    }

    #[test]
    fn create_workspace_has_one_surface_with_one_pane() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        assert_eq!(ws.surfaces.len(), 1);
        assert_eq!(ws.active_surface_index, 0);
        match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id } => assert_eq!(pane_id, "pane-1"),
            _ => panic!("expected leaf layout"),
        }
    }

    #[test]
    fn create_workspace_registers_pane() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        let pane = state.get_pane("pane-1").expect("pane should exist");
        assert_eq!(pane.id, "pane-1");
        assert_eq!(pane.pty_id, "pty-1");
        assert!(matches!(pane.pane_type, PaneType::Terminal));
    }

    #[test]
    fn close_workspace_removes_from_state() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
        );

        state.close_workspace(&ws1.id).unwrap();

        assert_eq!(state.list_workspaces().len(), 1);
        assert!(state.get_workspace(&ws1.id).is_none());
    }

    #[test]
    fn close_workspace_returns_pty_ids() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
        );

        // Split a pane to have multiple pty_ids in workspace 1
        state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-3".to_string(),
                "pty-3".to_string(),
            )
            .unwrap();

        let pty_ids = state.close_workspace(&ws1.id).unwrap();
        assert_eq!(pty_ids.len(), 2);
        assert!(pty_ids.contains(&"pty-1".to_string()));
        assert!(pty_ids.contains(&"pty-3".to_string()));
    }

    #[test]
    fn close_last_workspace_returns_error() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Only".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        let err = state.close_workspace(&ws.id).unwrap_err();
        assert!(matches!(err, WorkspaceError::LastWorkspace));
    }

    #[test]
    fn list_workspaces_returns_all() {
        let mut state = new_state();
        state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
        );

        let list = state.list_workspaces();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "First");
        assert_eq!(list[1].name, "Second");
    }

    #[test]
    fn split_pane_creates_split_node() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        let result = state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        match &result.workspace.surfaces[0].layout {
            LayoutNode::Split {
                direction,
                children,
                sizes,
            } => {
                assert!(matches!(direction, SplitDirection::Horizontal));
                assert!(
                    matches!(&children[0], LayoutNode::Leaf { pane_id } if pane_id == "pane-1")
                );
                assert!(
                    matches!(&children[1], LayoutNode::Leaf { pane_id } if pane_id == "pane-2")
                );
                assert_eq!(sizes, &[0.5, 0.5]);
            }
            _ => panic!("expected split layout"),
        }
    }

    #[test]
    fn split_pane_registers_new_pane() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        state
            .split_pane(
                "pane-1",
                SplitDirection::Vertical,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        let pane = state.get_pane("pane-2").expect("new pane should exist");
        assert_eq!(pane.pty_id, "pty-2");
    }

    #[test]
    fn split_nonexistent_pane_returns_error() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        let err = state
            .split_pane(
                "nonexistent",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::PaneNotFound { id } if id == "nonexistent"));
    }

    #[test]
    fn close_pane_removes_leaf() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
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

        let result = state.close_pane("pane-1").unwrap();
        assert_eq!(result.pty_id, "pty-1");
        assert!(!result.workspace_closed);
        assert!(state.get_pane("pane-1").is_none());
    }

    #[test]
    fn close_pane_collapses_parent_split() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
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

        state.close_pane("pane-1").unwrap();

        let ws = &state.list_workspaces()[0];
        match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id } => assert_eq!(pane_id, "pane-2"),
            _ => panic!("expected layout to collapse back to a leaf"),
        }
    }

    #[test]
    fn close_last_pane_closes_surface() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        let result = state.close_pane("pane-1").unwrap();
        assert_eq!(result.pty_id, "pty-1");
        assert!(result.workspace_closed);
        assert!(state.get_workspace(&ws.id).is_none());
    }

    #[test]
    fn close_last_surface_closes_workspace() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        let result = state.close_pane("pane-1").unwrap();
        assert!(result.workspace_closed);
        assert!(state.get_workspace(&ws.id).is_none());
        assert_eq!(state.list_workspaces().len(), 0);
    }

    #[test]
    fn deeply_nested_split_then_close() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        // Split pane-1 horizontally -> [pane-1, pane-2]
        state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        // Split pane-2 vertically -> [pane-1, [pane-2, pane-3]]
        state
            .split_pane(
                "pane-2",
                SplitDirection::Vertical,
                "pane-3".to_string(),
                "pty-3".to_string(),
            )
            .unwrap();

        // Split pane-3 horizontally -> [pane-1, [pane-2, [pane-3, pane-4]]]
        state
            .split_pane(
                "pane-3",
                SplitDirection::Horizontal,
                "pane-4".to_string(),
                "pty-4".to_string(),
            )
            .unwrap();

        // Close pane-3 -> [pane-1, [pane-2, pane-4]]
        let result = state.close_pane("pane-3").unwrap();
        assert_eq!(result.pty_id, "pty-3");
        assert!(!result.workspace_closed);

        // Verify pane-4 is still accessible
        assert!(state.get_pane("pane-4").is_some());
        assert!(state.get_pane("pane-3").is_none());

        // Close pane-2 -> [pane-1, pane-4]
        state.close_pane("pane-2").unwrap();

        // Close pane-1 -> pane-4 (leaf)
        state.close_pane("pane-1").unwrap();

        let ws = &state.list_workspaces()[0];
        match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id } => assert_eq!(pane_id, "pane-4"),
            _ => panic!("expected single leaf after closing all but one pane"),
        }
    }

    #[test]
    fn layout_tree_serialize_roundtrip() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            children: Box::new([
                LayoutNode::Leaf {
                    pane_id: "pane-1".to_string(),
                },
                LayoutNode::Split {
                    direction: SplitDirection::Vertical,
                    children: Box::new([
                        LayoutNode::Leaf {
                            pane_id: "pane-2".to_string(),
                        },
                        LayoutNode::Leaf {
                            pane_id: "pane-3".to_string(),
                        },
                    ]),
                    sizes: [0.3, 0.7],
                },
            ]),
            sizes: [0.5, 0.5],
        };

        let json = serde_json::to_string(&layout).expect("serialize should succeed");
        let deserialized: LayoutNode =
            serde_json::from_str(&json).expect("deserialize should succeed");

        // Verify the structure matches after roundtrip
        match &deserialized {
            LayoutNode::Split {
                direction,
                children,
                sizes,
            } => {
                assert!(matches!(direction, SplitDirection::Horizontal));
                assert_eq!(sizes, &[0.5, 0.5]);
                assert!(
                    matches!(&children[0], LayoutNode::Leaf { pane_id } if pane_id == "pane-1")
                );
                match &children[1] {
                    LayoutNode::Split {
                        direction,
                        children,
                        sizes,
                    } => {
                        assert!(matches!(direction, SplitDirection::Vertical));
                        assert_eq!(sizes, &[0.3, 0.7]);
                        assert!(
                            matches!(&children[0], LayoutNode::Leaf { pane_id } if pane_id == "pane-2")
                        );
                        assert!(
                            matches!(&children[1], LayoutNode::Leaf { pane_id } if pane_id == "pane-3")
                        );
                    }
                    _ => panic!("expected nested split"),
                }
            }
            _ => panic!("expected split at root"),
        }
    }

    #[test]
    fn layout_leaf_serialize_format() {
        let layout = LayoutNode::Leaf {
            pane_id: "pane-1".to_string(),
        };
        let json = serde_json::to_value(&layout).unwrap();
        assert_eq!(json["type"], "leaf");
        assert_eq!(json["pane_id"], "pane-1");
    }

    #[test]
    fn layout_split_serialize_format() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            children: Box::new([
                LayoutNode::Leaf {
                    pane_id: "a".to_string(),
                },
                LayoutNode::Leaf {
                    pane_id: "b".to_string(),
                },
            ]),
            sizes: [0.5, 0.5],
        };
        let json = serde_json::to_value(&layout).unwrap();
        assert_eq!(json["type"], "split");
        assert_eq!(json["direction"], "horizontal");
    }

    #[test]
    fn close_nonexistent_pane_returns_error() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );

        let err = state.close_pane("nonexistent").unwrap_err();
        assert!(matches!(err, WorkspaceError::PaneNotFound { id } if id == "nonexistent"));
    }

    #[test]
    fn close_nonexistent_workspace_returns_error() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );
        state.create_workspace(
            "Other".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
        );

        let err = state.close_workspace("nonexistent").unwrap_err();
        assert!(matches!(err, WorkspaceError::NotFound { id } if id == "nonexistent"));
    }

    #[test]
    fn workspace_error_serialization() {
        use crate::error::BackendError;

        let cases: Vec<(BackendError, &str)> = vec![
            (
                WorkspaceError::NotFound {
                    id: "ws-1".to_string(),
                }
                .into(),
                "WorkspaceNotFound",
            ),
            (
                WorkspaceError::PaneNotFound {
                    id: "pane-1".to_string(),
                }
                .into(),
                "PaneNotFound",
            ),
            (
                WorkspaceError::SurfaceNotFound {
                    id: "surf-1".to_string(),
                }
                .into(),
                "SurfaceNotFound",
            ),
            (
                WorkspaceError::InvalidSplit {
                    reason: "bad".to_string(),
                }
                .into(),
                "InvalidSplit",
            ),
            (WorkspaceError::LastWorkspace.into(), "LastWorkspace"),
        ];

        for (error, expected_kind) in cases {
            let json = serde_json::to_value(&error).expect("serialize should succeed");
            assert_eq!(json["kind"], expected_kind);
        }
    }

    #[test]
    fn active_workspace_updates_on_close() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );
        let ws2 = state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
        );

        // Active should be ws2 (last created)
        assert_eq!(state.active_workspace_id.as_deref(), Some(ws2.id.as_str()));

        // Close ws2, active should switch to ws1
        state.close_workspace(&ws2.id).unwrap();
        assert_eq!(state.active_workspace_id.as_deref(), Some(ws1.id.as_str()));
    }

    #[test]
    fn close_workspace_cleans_up_panes() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
        );

        state.close_workspace(&ws1.id).unwrap();

        // Pane from closed workspace should be removed
        assert!(state.get_pane("pane-1").is_none());
        // Pane from remaining workspace should still exist
        assert!(state.get_pane("pane-2").is_some());
    }
}
