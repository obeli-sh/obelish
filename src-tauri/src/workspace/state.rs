use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::WorkspaceError;
use crate::persistence::session::SessionState;
use crate::workspace::types::{
    LayoutNode, PaneCloseResult, PaneInfo, PaneSplitResult, PaneType, SplitDirection, SurfaceInfo,
    WorkspaceInfo,
};
use serde::Deserialize;

pub struct WorkspaceState {
    workspaces: Vec<WorkspaceInfo>,
    active_workspace_id: Option<String>,
    panes: HashMap<String, PaneInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaneDropPosition {
    Left,
    Right,
    Top,
    Bottom,
    Center,
}

impl WorkspaceState {
    pub fn new() -> Self {
        Self {
            workspaces: Vec::new(),
            active_workspace_id: None,
            panes: HashMap::new(),
        }
    }

    pub fn to_session_state(&self) -> SessionState {
        SessionState {
            workspaces: self.workspaces.clone(),
            active_workspace_id: self.active_workspace_id.clone(),
            panes: self.panes.clone(),
        }
    }

    pub fn from_session_state(session: SessionState) -> Self {
        Self {
            workspaces: session.workspaces,
            active_workspace_id: session.active_workspace_id,
            panes: session.panes,
        }
    }

    pub fn create_workspace(
        &mut self,
        name: String,
        pane_id: String,
        pty_id: String,
        project_id: String,
        worktree_path: String,
        branch_name: Option<String>,
        is_root_worktree: bool,
    ) -> WorkspaceInfo {
        let workspace_id = uuid::Uuid::new_v4().to_string();
        let surface_id = uuid::Uuid::new_v4().to_string();

        let pane = PaneInfo {
            id: pane_id.clone(),
            pty_id: pty_id.clone(),
            pane_type: PaneType::Terminal,
            cwd: None,
            url: None,
        };
        self.panes.insert(pane_id.clone(), pane);

        let surface = SurfaceInfo {
            id: surface_id,
            name: name.clone(),
            layout: LayoutNode::Leaf {
                pane_id: pane_id.clone(),
                pty_id,
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
            project_id,
            worktree_path,
            branch_name,
            is_root_worktree,
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

    pub fn find_workspace_by_pane(&self, pane_id: &str) -> Option<&WorkspaceInfo> {
        self.workspaces.iter().find(|w| {
            w.surfaces
                .iter()
                .any(|s| layout_contains_pane(&s.layout, pane_id))
        })
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
            url: None,
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
                surface.layout = split_layout_node(
                    surface.layout.clone(),
                    pane_id,
                    direction,
                    &new_pane_id,
                    &new_pane.pty_id,
                );
                break;
            }
        }

        Ok(PaneSplitResult {
            workspace: workspace.clone(),
            new_pane,
        })
    }

    pub fn open_browser_pane(
        &mut self,
        pane_id: &str,
        direction: SplitDirection,
        new_pane_id: String,
        url: String,
    ) -> Result<PaneSplitResult, WorkspaceError> {
        let lower_url = url.to_lowercase();
        if !lower_url.starts_with("http://") && !lower_url.starts_with("https://") {
            return Err(WorkspaceError::InvalidUrl {
                reason: format!("only http:// and https:// URLs are allowed, got: {url}"),
            });
        }

        if !self.panes.contains_key(pane_id) {
            return Err(WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            });
        }

        let new_pane = PaneInfo {
            id: new_pane_id.clone(),
            pty_id: String::new(),
            pane_type: PaneType::Browser,
            cwd: None,
            url: Some(url),
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
                    split_layout_node(surface.layout.clone(), pane_id, direction, &new_pane_id, "");
                break;
            }
        }

        Ok(PaneSplitResult {
            workspace: workspace.clone(),
            new_pane,
        })
    }

    pub fn close_pane(&mut self, pane_id: &str) -> Result<PaneCloseResult, WorkspaceError> {
        // Check pane exists before mutating
        if !self.panes.contains_key(pane_id) {
            return Err(WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            });
        }

        // Find the workspace containing this pane
        let ws_idx = self
            .workspaces
            .iter()
            .position(|w| {
                w.surfaces
                    .iter()
                    .any(|s| layout_contains_pane(&s.layout, pane_id))
            })
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;

        // Pre-check: would closing this pane remove the last workspace?
        let workspace = &self.workspaces[ws_idx];
        let surface_idx = workspace
            .surfaces
            .iter()
            .position(|s| layout_contains_pane(&s.layout, pane_id));
        let would_remove_surface = surface_idx
            .map(|i| remove_from_layout(&workspace.surfaces[i].layout, pane_id).is_none())
            .unwrap_or(false);
        let would_close_workspace = would_remove_surface && workspace.surfaces.len() == 1;

        if would_close_workspace && self.workspaces.len() <= 1 {
            return Err(WorkspaceError::LastWorkspace);
        }

        // Safe to proceed with mutations
        let pane = self.panes.remove(pane_id).unwrap();
        let pty_id = pane.pty_id.clone();

        let workspace = &mut self.workspaces[ws_idx];

        // Find which surface contains the pane and remove it from the layout
        let mut surface_to_remove = None;
        for (i, surface) in workspace.surfaces.iter_mut().enumerate() {
            if layout_contains_pane(&surface.layout, pane_id) {
                match remove_from_layout(&surface.layout, pane_id) {
                    Some(new_layout) => {
                        surface.layout = new_layout;
                    }
                    None => {
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

        let workspace_closed = workspace.surfaces.is_empty();
        let workspace_info = if workspace_closed {
            None
        } else {
            Some(workspace.clone())
        };

        let closed_workspace_id = if workspace_closed {
            let workspace_id = workspace.id.clone();
            self.workspaces.retain(|w| w.id != workspace_id);
            if self.active_workspace_id.as_deref() == Some(&workspace_id) {
                self.active_workspace_id = self.workspaces.first().map(|w| w.id.clone());
            }
            Some(workspace_id)
        } else {
            None
        };

        Ok(PaneCloseResult {
            pty_id,
            workspace_closed,
            workspace: workspace_info,
            closed_workspace_id,
        })
    }

    pub fn swap_panes(
        &mut self,
        pane_id: &str,
        target_pane_id: &str,
    ) -> Result<WorkspaceInfo, WorkspaceError> {
        if pane_id == target_pane_id {
            return Err(WorkspaceError::InvalidSplit {
                reason: "cannot swap a pane with itself".to_string(),
            });
        }
        if !self.panes.contains_key(pane_id) {
            return Err(WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            });
        }
        if !self.panes.contains_key(target_pane_id) {
            return Err(WorkspaceError::PaneNotFound {
                id: target_pane_id.to_string(),
            });
        }

        let source_workspace_idx = self
            .workspaces
            .iter()
            .position(|workspace| {
                workspace
                    .surfaces
                    .iter()
                    .any(|surface| layout_contains_pane(&surface.layout, pane_id))
            })
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;
        let target_workspace_idx = self
            .workspaces
            .iter()
            .position(|workspace| {
                workspace
                    .surfaces
                    .iter()
                    .any(|surface| layout_contains_pane(&surface.layout, target_pane_id))
            })
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: target_pane_id.to_string(),
            })?;
        if source_workspace_idx != target_workspace_idx {
            return Err(WorkspaceError::InvalidSplit {
                reason: "cannot swap panes across workspaces".to_string(),
            });
        }

        let source_pty_id = self
            .panes
            .get(pane_id)
            .map(|pane| pane.pty_id.clone())
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;
        let target_pty_id = self
            .panes
            .get(target_pane_id)
            .map(|pane| pane.pty_id.clone())
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: target_pane_id.to_string(),
            })?;

        let workspace = &mut self.workspaces[source_workspace_idx];
        for surface in &mut workspace.surfaces {
            if layout_contains_pane(&surface.layout, pane_id)
                || layout_contains_pane(&surface.layout, target_pane_id)
            {
                swap_layout_panes(
                    &mut surface.layout,
                    pane_id,
                    target_pane_id,
                    &source_pty_id,
                    &target_pty_id,
                );
            }
        }

        Ok(workspace.clone())
    }

    pub fn move_pane(
        &mut self,
        pane_id: &str,
        target_pane_id: &str,
        position: PaneDropPosition,
    ) -> Result<WorkspaceInfo, WorkspaceError> {
        if pane_id == target_pane_id {
            return Err(WorkspaceError::InvalidSplit {
                reason: "cannot move a pane onto itself".to_string(),
            });
        }
        if !self.panes.contains_key(pane_id) {
            return Err(WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            });
        }
        if !self.panes.contains_key(target_pane_id) {
            return Err(WorkspaceError::PaneNotFound {
                id: target_pane_id.to_string(),
            });
        }

        if matches!(position, PaneDropPosition::Center) {
            return self.swap_panes(pane_id, target_pane_id);
        }

        let source_workspace_idx = self
            .workspaces
            .iter()
            .position(|workspace| {
                workspace
                    .surfaces
                    .iter()
                    .any(|surface| layout_contains_pane(&surface.layout, pane_id))
            })
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;
        let target_workspace_idx = self
            .workspaces
            .iter()
            .position(|workspace| {
                workspace
                    .surfaces
                    .iter()
                    .any(|surface| layout_contains_pane(&surface.layout, target_pane_id))
            })
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: target_pane_id.to_string(),
            })?;
        if source_workspace_idx != target_workspace_idx {
            return Err(WorkspaceError::InvalidSplit {
                reason: "cannot move panes across workspaces".to_string(),
            });
        }

        let source_pty_id = self
            .panes
            .get(pane_id)
            .map(|pane| pane.pty_id.clone())
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;

        let workspace = &mut self.workspaces[source_workspace_idx];
        let source_surface_idx = workspace
            .surfaces
            .iter()
            .position(|surface| layout_contains_pane(&surface.layout, pane_id))
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: pane_id.to_string(),
            })?;
        let target_surface_idx = workspace
            .surfaces
            .iter()
            .position(|surface| layout_contains_pane(&surface.layout, target_pane_id))
            .ok_or_else(|| WorkspaceError::PaneNotFound {
                id: target_pane_id.to_string(),
            })?;
        if source_surface_idx != target_surface_idx {
            return Err(WorkspaceError::InvalidSplit {
                reason: "cannot move panes across surfaces".to_string(),
            });
        }

        let source_surface = &mut workspace.surfaces[source_surface_idx];
        let layout_without_source = remove_from_layout(&source_surface.layout, pane_id)
            .ok_or_else(|| WorkspaceError::InvalidSplit {
                reason: "cannot remove source pane from layout".to_string(),
            })?;

        let (new_layout, inserted) = insert_pane_relative_to_target(
            layout_without_source,
            target_pane_id,
            pane_id,
            &source_pty_id,
            position,
        );
        if !inserted {
            return Err(WorkspaceError::PaneNotFound {
                id: target_pane_id.to_string(),
            });
        }

        source_surface.layout = new_layout;
        Ok(workspace.clone())
    }

    pub fn get_pane(&self, id: &str) -> Option<&PaneInfo> {
        self.panes.get(id)
    }

    pub fn update_pane_pty(&mut self, pane_id: &str, new_pty_id: String) {
        if let Some(pane) = self.panes.get_mut(pane_id) {
            pane.pty_id = new_pty_id.clone();
        }
        // Also update pty_id in layout tree so frontend gets the new PTY ID
        for workspace in &mut self.workspaces {
            for surface in &mut workspace.surfaces {
                update_layout_pty_id(&mut surface.layout, pane_id, &new_pty_id);
            }
        }
    }

    pub fn focus_workspace(&mut self, id: &str) -> Result<(), WorkspaceError> {
        if !self.workspaces.iter().any(|w| w.id == id) {
            return Err(WorkspaceError::NotFound { id: id.to_string() });
        }
        self.active_workspace_id = Some(id.to_string());
        Ok(())
    }

    pub fn active_workspace_id(&self) -> Option<&str> {
        self.active_workspace_id.as_deref()
    }

    pub fn rename_workspace(
        &mut self,
        id: &str,
        new_name: String,
    ) -> Result<WorkspaceInfo, WorkspaceError> {
        let trimmed = new_name.trim().to_string();
        if trimmed.is_empty() {
            return Err(WorkspaceError::InvalidSplit {
                reason: "workspace name cannot be empty".to_string(),
            });
        }
        let ws = self
            .workspaces
            .iter_mut()
            .find(|w| w.id == id)
            .ok_or_else(|| WorkspaceError::NotFound { id: id.to_string() })?;
        ws.name = trimmed;
        Ok(ws.clone())
    }

    pub fn reorder_workspaces(&mut self, ordered_ids: &[String]) -> Result<(), WorkspaceError> {
        if ordered_ids.len() != self.workspaces.len() {
            return Err(WorkspaceError::InvalidSplit {
                reason: format!(
                    "expected {} workspace IDs, got {}",
                    self.workspaces.len(),
                    ordered_ids.len()
                ),
            });
        }

        let mut reordered = Vec::with_capacity(ordered_ids.len());
        for id in ordered_ids {
            let pos = self
                .workspaces
                .iter()
                .position(|w| &w.id == id)
                .ok_or_else(|| WorkspaceError::NotFound { id: id.clone() })?;
            reordered.push(self.workspaces[pos].clone());
        }
        self.workspaces = reordered;
        Ok(())
    }

    fn collect_pane_ids(&mut self, layout: &LayoutNode, pty_ids: &mut Vec<String>) {
        match layout {
            LayoutNode::Leaf { pane_id, .. } => {
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
        LayoutNode::Leaf { pane_id: id, .. } => id == pane_id,
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
    new_pty_id: &str,
) -> LayoutNode {
    match layout {
        LayoutNode::Leaf { ref pane_id, .. } if pane_id == target_pane_id => LayoutNode::Split {
            direction,
            children: Box::new([
                layout.clone(),
                LayoutNode::Leaf {
                    pane_id: new_pane_id.to_string(),
                    pty_id: new_pty_id.to_string(),
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
                    split_layout_node(
                        left,
                        target_pane_id,
                        direction.clone(),
                        new_pane_id,
                        new_pty_id,
                    ),
                    split_layout_node(right, target_pane_id, direction, new_pane_id, new_pty_id),
                ]),
                sizes,
            }
        }
        other => other,
    }
}

fn update_layout_pty_id(layout: &mut LayoutNode, pane_id: &str, new_pty_id: &str) {
    match layout {
        LayoutNode::Leaf {
            pane_id: pid,
            pty_id,
        } if pid == pane_id => {
            *pty_id = new_pty_id.to_string();
        }
        LayoutNode::Split { children, .. } => {
            update_layout_pty_id(&mut children[0], pane_id, new_pty_id);
            update_layout_pty_id(&mut children[1], pane_id, new_pty_id);
        }
        _ => {}
    }
}

fn remove_from_layout(layout: &LayoutNode, pane_id: &str) -> Option<LayoutNode> {
    match layout {
        LayoutNode::Leaf { pane_id: id, .. } if id == pane_id => None,
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

fn swap_layout_panes(
    layout: &mut LayoutNode,
    pane_id: &str,
    target_pane_id: &str,
    source_pty_id: &str,
    target_pty_id: &str,
) {
    match layout {
        LayoutNode::Leaf {
            pane_id: id,
            pty_id,
        } if id == pane_id => {
            *id = target_pane_id.to_string();
            *pty_id = target_pty_id.to_string();
        }
        LayoutNode::Leaf {
            pane_id: id,
            pty_id,
        } if id == target_pane_id => {
            *id = pane_id.to_string();
            *pty_id = source_pty_id.to_string();
        }
        LayoutNode::Split { children, .. } => {
            swap_layout_panes(
                &mut children[0],
                pane_id,
                target_pane_id,
                source_pty_id,
                target_pty_id,
            );
            swap_layout_panes(
                &mut children[1],
                pane_id,
                target_pane_id,
                source_pty_id,
                target_pty_id,
            );
        }
        _ => {}
    }
}

fn insert_pane_relative_to_target(
    layout: LayoutNode,
    target_pane_id: &str,
    source_pane_id: &str,
    source_pty_id: &str,
    position: PaneDropPosition,
) -> (LayoutNode, bool) {
    match layout {
        LayoutNode::Leaf { ref pane_id, .. } if pane_id == target_pane_id => (
            layout_with_inserted_leaf(layout, source_pane_id, source_pty_id, position),
            true,
        ),
        LayoutNode::Split {
            direction,
            children,
            sizes,
        } => {
            let [left, right] = *children;
            let (new_left, inserted_left) = insert_pane_relative_to_target(
                left,
                target_pane_id,
                source_pane_id,
                source_pty_id,
                position,
            );
            if inserted_left {
                return (
                    LayoutNode::Split {
                        direction,
                        children: Box::new([new_left, right]),
                        sizes,
                    },
                    true,
                );
            }

            let (new_right, inserted_right) = insert_pane_relative_to_target(
                right,
                target_pane_id,
                source_pane_id,
                source_pty_id,
                position,
            );
            (
                LayoutNode::Split {
                    direction,
                    children: Box::new([new_left, new_right]),
                    sizes,
                },
                inserted_right,
            )
        }
        other => (other, false),
    }
}

fn layout_with_inserted_leaf(
    target_layout: LayoutNode,
    source_pane_id: &str,
    source_pty_id: &str,
    position: PaneDropPosition,
) -> LayoutNode {
    let source_layout = LayoutNode::Leaf {
        pane_id: source_pane_id.to_string(),
        pty_id: source_pty_id.to_string(),
    };

    match position {
        PaneDropPosition::Left => LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            children: Box::new([source_layout, target_layout]),
            sizes: [0.5, 0.5],
        },
        PaneDropPosition::Right => LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            children: Box::new([target_layout, source_layout]),
            sizes: [0.5, 0.5],
        },
        PaneDropPosition::Top => LayoutNode::Split {
            direction: SplitDirection::Vertical,
            children: Box::new([source_layout, target_layout]),
            sizes: [0.5, 0.5],
        },
        PaneDropPosition::Bottom => LayoutNode::Split {
            direction: SplitDirection::Vertical,
            children: Box::new([target_layout, source_layout]),
            sizes: [0.5, 0.5],
        },
        PaneDropPosition::Center => target_layout,
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
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
        );

        assert_eq!(ws.surfaces.len(), 1);
        assert_eq!(ws.active_surface_index, 0);
        match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id, pty_id } => {
                assert_eq!(pane_id, "pane-1");
                assert_eq!(pty_id, "pty-1");
            }
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
            String::new(),
            String::new(),
            None,
            true,
        );

        let pane = state.get_pane("pane-1").expect("pane should exist");
        assert_eq!(pane.id, "pane-1");
        assert_eq!(pane.pty_id, "pty-1");
        assert!(matches!(pane.pane_type, PaneType::Terminal));
    }

    #[test]
    fn find_workspace_by_pane_returns_correct_workspace() {
        let mut state = new_state();
        state.create_workspace(
            "WS1".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            "proj-1".to_string(),
            "/home/user/project".to_string(),
            Some("main".to_string()),
            true,
        );
        state.create_workspace(
            "WS2".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            "proj-1".to_string(),
            "/home/user/project-feat".to_string(),
            Some("feat".to_string()),
            false,
        );

        let found = state
            .find_workspace_by_pane("pane-2")
            .expect("should find workspace");
        assert_eq!(found.name, "WS2");
        assert_eq!(found.worktree_path, "/home/user/project-feat");

        assert!(state.find_workspace_by_pane("nonexistent").is_none());
    }

    #[test]
    fn close_workspace_removes_from_state() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
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
                    matches!(&children[0], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-1" && pty_id == "pty-1")
                );
                assert!(
                    matches!(&children[1], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-2" && pty_id == "pty-2")
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
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
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
    fn swap_panes_swaps_positions_in_layout() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        let workspace = state.swap_panes("pane-1", "pane-2").unwrap();
        match &workspace.surfaces[0].layout {
            LayoutNode::Split { children, .. } => {
                assert!(
                    matches!(&children[0], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-2" && pty_id == "pty-2")
                );
                assert!(
                    matches!(&children[1], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-1" && pty_id == "pty-1")
                );
            }
            _ => panic!("expected split layout"),
        }
    }

    #[test]
    fn swap_panes_across_workspaces_returns_error() {
        let mut state = new_state();
        state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state.swap_panes("pane-1", "pane-2").unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidSplit { .. }));
    }

    #[test]
    fn move_pane_to_bottom_relayouts_around_target() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        let workspace = state
            .move_pane("pane-1", "pane-2", PaneDropPosition::Bottom)
            .unwrap();

        match &workspace.surfaces[0].layout {
            LayoutNode::Split {
                direction,
                children,
                ..
            } => {
                assert!(matches!(direction, SplitDirection::Vertical));
                assert!(
                    matches!(&children[0], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-2" && pty_id == "pty-2")
                );
                assert!(
                    matches!(&children[1], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-1" && pty_id == "pty-1")
                );
            }
            _ => panic!("expected split layout"),
        }
    }

    #[test]
    fn move_pane_to_left_reorders_horizontally() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        let workspace = state
            .move_pane("pane-2", "pane-1", PaneDropPosition::Left)
            .unwrap();

        match &workspace.surfaces[0].layout {
            LayoutNode::Split {
                direction,
                children,
                ..
            } => {
                assert!(matches!(direction, SplitDirection::Horizontal));
                assert!(
                    matches!(&children[0], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-2" && pty_id == "pty-2")
                );
                assert!(
                    matches!(&children[1], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-1" && pty_id == "pty-1")
                );
            }
            _ => panic!("expected split layout"),
        }
    }

    #[test]
    fn move_pane_across_workspaces_returns_error() {
        let mut state = new_state();
        state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state
            .move_pane("pane-1", "pane-2", PaneDropPosition::Left)
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidSplit { .. }));
    }

    #[test]
    fn close_pane_removes_leaf() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
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
            LayoutNode::Leaf { pane_id, .. } => assert_eq!(pane_id, "pane-2"),
            _ => panic!("expected layout to collapse back to a leaf"),
        }
    }

    #[test]
    fn close_last_pane_in_only_workspace_returns_error() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state.close_pane("pane-1").unwrap_err();
        assert!(matches!(err, WorkspaceError::LastWorkspace));
        // Pane should still exist
        assert!(state.get_pane("pane-1").is_some());
    }

    #[test]
    fn close_last_pane_closes_workspace_when_others_exist() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state.close_pane("pane-1").unwrap();
        assert_eq!(result.pty_id, "pty-1");
        assert!(result.workspace_closed);
        assert!(state.get_workspace(&ws1.id).is_none());
        assert_eq!(state.list_workspaces().len(), 1);
    }

    #[test]
    fn close_last_pane_returns_closed_workspace_id() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "First".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state.close_pane("pane-1").unwrap();
        assert!(result.workspace_closed);
        assert_eq!(
            result.closed_workspace_id.as_deref(),
            Some(ws1.id.as_str()),
            "close_pane should return the ID of the closed workspace"
        );
    }

    #[test]
    fn close_pane_without_closing_workspace_has_no_closed_workspace_id() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
        assert!(!result.workspace_closed);
        assert_eq!(
            result.closed_workspace_id, None,
            "close_pane should not return a workspace ID when workspace is not closed"
        );
    }

    #[test]
    fn deeply_nested_split_then_close() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
            LayoutNode::Leaf { pane_id, .. } => assert_eq!(pane_id, "pane-4"),
            _ => panic!("expected single leaf after closing all but one pane"),
        }
    }

    #[test]
    fn open_browser_pane_creates_split_with_browser_type() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state
            .open_browser_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "https://example.com".to_string(),
            )
            .unwrap();

        // Should create a split layout
        match &result.workspace.surfaces[0].layout {
            LayoutNode::Split {
                direction,
                children,
                sizes,
            } => {
                assert!(matches!(direction, SplitDirection::Horizontal));
                // Original pane stays as-is
                assert!(
                    matches!(&children[0], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-1" && pty_id == "pty-1")
                );
                // Browser pane has empty pty_id
                assert!(
                    matches!(&children[1], LayoutNode::Leaf { pane_id, pty_id } if pane_id == "pane-2" && pty_id.is_empty())
                );
                assert_eq!(sizes, &[0.5, 0.5]);
            }
            _ => panic!("expected split layout"),
        }

        // The new pane should have Browser type
        let pane = state.get_pane("pane-2").expect("browser pane should exist");
        assert!(matches!(pane.pane_type, PaneType::Browser));
    }

    #[test]
    fn open_browser_pane_stores_url() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        state
            .open_browser_pane(
                "pane-1",
                SplitDirection::Vertical,
                "pane-2".to_string(),
                "https://example.com".to_string(),
            )
            .unwrap();

        let pane = state.get_pane("pane-2").expect("browser pane should exist");
        assert_eq!(pane.url, Some("https://example.com".to_string()));
        assert_eq!(pane.pty_id, "");
    }

    #[test]
    fn close_browser_pane_does_not_affect_ptys() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        state
            .open_browser_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "browser-1".to_string(),
                "https://example.com".to_string(),
            )
            .unwrap();

        let result = state.close_pane("browser-1").unwrap();

        // Browser pane returns empty pty_id (no PTY to kill)
        assert_eq!(result.pty_id, "");
        assert!(!result.workspace_closed);

        // Terminal pane should still exist
        let terminal_pane = state
            .get_pane("pane-1")
            .expect("terminal pane should still exist");
        assert_eq!(terminal_pane.pty_id, "pty-1");
    }

    #[test]
    fn workspace_with_mixed_panes_closes_correctly() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "Mixed".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        state
            .open_browser_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "browser-1".to_string(),
                "https://example.com".to_string(),
            )
            .unwrap();

        // Need a second workspace so we can close this one
        state.create_workspace(
            "Other".to_string(),
            "pane-3".to_string(),
            "pty-3".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let pty_ids = state.close_workspace(&ws1.id).unwrap();

        // Should only contain the terminal PTY, not the browser's empty pty_id
        // (close_workspace collects all pty_ids including empty ones,
        //  the command handler should filter empty ones)
        assert!(pty_ids.contains(&"pty-1".to_string()));
        assert!(pty_ids.contains(&String::new()));

        // Both panes should be cleaned up
        assert!(state.get_pane("pane-1").is_none());
        assert!(state.get_pane("browser-1").is_none());
    }

    #[test]
    fn open_browser_pane_on_nonexistent_pane_returns_error() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state
            .open_browser_pane(
                "nonexistent",
                SplitDirection::Horizontal,
                "browser-1".to_string(),
                "https://example.com".to_string(),
            )
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::PaneNotFound { id } if id == "nonexistent"));
    }

    #[test]
    fn open_browser_pane_rejects_javascript_url() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state
            .open_browser_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "browser-1".to_string(),
                "javascript:alert(1)".to_string(),
            )
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidUrl { .. }));
    }

    #[test]
    fn open_browser_pane_rejects_data_url() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state
            .open_browser_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "browser-1".to_string(),
                "data:text/html,<script>alert(1)</script>".to_string(),
            )
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidUrl { .. }));
    }

    #[test]
    fn open_browser_pane_rejects_file_url() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state
            .open_browser_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "browser-1".to_string(),
                "file:///etc/passwd".to_string(),
            )
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidUrl { .. }));
    }

    #[test]
    fn layout_tree_serialize_roundtrip() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            children: Box::new([
                LayoutNode::Leaf {
                    pane_id: "pane-1".to_string(),
                    pty_id: "pty-1".to_string(),
                },
                LayoutNode::Split {
                    direction: SplitDirection::Vertical,
                    children: Box::new([
                        LayoutNode::Leaf {
                            pane_id: "pane-2".to_string(),
                            pty_id: "pty-2".to_string(),
                        },
                        LayoutNode::Leaf {
                            pane_id: "pane-3".to_string(),
                            pty_id: "pty-3".to_string(),
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

        assert_eq!(layout, deserialized);
    }

    #[test]
    fn layout_leaf_serialize_format() {
        let layout = LayoutNode::Leaf {
            pane_id: "pane-1".to_string(),
            pty_id: "pty-1".to_string(),
        };
        let json = serde_json::to_value(&layout).unwrap();
        assert_eq!(json["type"], "leaf");
        assert_eq!(json["paneId"], "pane-1");
        assert_eq!(json["ptyId"], "pty-1");
    }

    #[test]
    fn layout_split_serialize_format() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            children: Box::new([
                LayoutNode::Leaf {
                    pane_id: "a".to_string(),
                    pty_id: "pty-a".to_string(),
                },
                LayoutNode::Leaf {
                    pane_id: "b".to_string(),
                    pty_id: "pty-b".to_string(),
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
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Other".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
            (
                WorkspaceError::InvalidUrl {
                    reason: "bad".to_string(),
                }
                .into(),
                "InvalidUrl",
            ),
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
            String::new(),
            String::new(),
            None,
            true,
        );
        let ws2 = state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
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
            String::new(),
            String::new(),
            None,
            true,
        );
        state.create_workspace(
            "Second".to_string(),
            "pane-2".to_string(),
            "pty-2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        state.close_workspace(&ws1.id).unwrap();

        // Pane from closed workspace should be removed
        assert!(state.get_pane("pane-1").is_none());
        // Pane from remaining workspace should still exist
        assert!(state.get_pane("pane-2").is_some());
    }

    #[test]
    fn update_pane_pty_updates_both_pane_info_and_layout() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-old".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        state.update_pane_pty("pane-1", "pty-new".to_string());

        // PaneInfo should be updated
        let pane = state.get_pane("pane-1").unwrap();
        assert_eq!(pane.pty_id, "pty-new");

        // Layout tree leaf should also be updated
        let ws = &state.list_workspaces()[0];
        match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pty_id, .. } => assert_eq!(pty_id, "pty-new"),
            _ => panic!("expected leaf layout"),
        }
    }

    #[test]
    fn update_pane_pty_updates_leaf_in_split_layout() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        state.update_pane_pty("pane-2", "pty-new".to_string());

        // Verify the split layout has the updated pty_id for pane-2
        let ws = &state.list_workspaces()[0];
        match &ws.surfaces[0].layout {
            LayoutNode::Split { children, .. } => {
                match &children[1] {
                    LayoutNode::Leaf { pane_id, pty_id } => {
                        assert_eq!(pane_id, "pane-2");
                        assert_eq!(pty_id, "pty-new");
                    }
                    _ => panic!("expected leaf"),
                }
                // pane-1 should still have original pty_id
                match &children[0] {
                    LayoutNode::Leaf { pane_id, pty_id } => {
                        assert_eq!(pane_id, "pane-1");
                        assert_eq!(pty_id, "pty-1");
                    }
                    _ => panic!("expected leaf"),
                }
            }
            _ => panic!("expected split layout"),
        }
    }

    #[test]
    fn focus_workspace_sets_active_id() {
        let mut state = WorkspaceState::new();
        let ws1 = state.create_workspace(
            "WS 1".to_string(),
            "p1".to_string(),
            "pty1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        let ws2 = state.create_workspace(
            "WS 2".to_string(),
            "p2".to_string(),
            "pty2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        // After creating ws2, active should be ws2
        assert_eq!(state.active_workspace_id(), Some(ws2.id.as_str()));

        // Focus ws1
        state.focus_workspace(&ws1.id).unwrap();
        assert_eq!(state.active_workspace_id(), Some(ws1.id.as_str()));
    }

    #[test]
    fn focus_workspace_nonexistent_returns_not_found() {
        let mut state = WorkspaceState::new();
        state.create_workspace(
            "WS 1".to_string(),
            "p1".to_string(),
            "pty1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state.focus_workspace("nonexistent-id");
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            WorkspaceError::NotFound { .. }
        ));
    }

    #[test]
    fn active_workspace_id_after_create_focus_close() {
        let mut state = WorkspaceState::new();

        // Initially no active workspace
        assert_eq!(state.active_workspace_id(), None);

        // Create ws1 → active = ws1
        let ws1 = state.create_workspace(
            "WS 1".to_string(),
            "p1".to_string(),
            "pty1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        assert_eq!(state.active_workspace_id(), Some(ws1.id.as_str()));

        // Create ws2 → active = ws2
        let ws2 = state.create_workspace(
            "WS 2".to_string(),
            "p2".to_string(),
            "pty2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        assert_eq!(state.active_workspace_id(), Some(ws2.id.as_str()));

        // Focus ws1 → active = ws1
        state.focus_workspace(&ws1.id).unwrap();
        assert_eq!(state.active_workspace_id(), Some(ws1.id.as_str()));

        // Close ws1 → active should change (close_workspace handles this)
        state.close_workspace(&ws1.id).unwrap();
        // After closing the active workspace, it should switch to another
        assert!(state.active_workspace_id().is_some());
        assert_eq!(state.active_workspace_id(), Some(ws2.id.as_str()));
    }

    #[test]
    fn rename_workspace_updates_name() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Original".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state
            .rename_workspace(&ws.id, "Renamed".to_string())
            .unwrap();

        assert_eq!(result.name, "Renamed");
        assert_eq!(state.get_workspace(&ws.id).unwrap().name, "Renamed");
    }

    #[test]
    fn rename_workspace_not_found() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state
            .rename_workspace("nonexistent", "New Name".to_string())
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::NotFound { id } if id == "nonexistent"));
    }

    #[test]
    fn rename_workspace_rejects_empty_name() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let err = state.rename_workspace(&ws.id, "".to_string()).unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidSplit { .. }));

        // Whitespace-only should also be rejected
        let err = state
            .rename_workspace(&ws.id, "   ".to_string())
            .unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidSplit { .. }));
    }

    #[test]
    fn rename_workspace_trims_whitespace() {
        let mut state = new_state();
        let ws = state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state
            .rename_workspace(&ws.id, "  Trimmed  ".to_string())
            .unwrap();
        assert_eq!(result.name, "Trimmed");
    }

    #[test]
    fn reorder_workspaces_rearranges_vec() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "A".to_string(),
            "p1".to_string(),
            "pty1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        let ws2 = state.create_workspace(
            "B".to_string(),
            "p2".to_string(),
            "pty2".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );
        let ws3 = state.create_workspace(
            "C".to_string(),
            "p3".to_string(),
            "pty3".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        state
            .reorder_workspaces(&[ws3.id.clone(), ws1.id.clone(), ws2.id.clone()])
            .unwrap();

        let list = state.list_workspaces();
        assert_eq!(list[0].name, "C");
        assert_eq!(list[1].name, "A");
        assert_eq!(list[2].name, "B");
    }

    #[test]
    fn reorder_workspaces_rejects_mismatched_length() {
        let mut state = new_state();
        let ws1 = state.create_workspace(
            "A".to_string(),
            "p1".to_string(),
            "pty1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state.reorder_workspaces(&[ws1.id.clone(), "extra".to_string()]);
        assert!(matches!(
            result.unwrap_err(),
            WorkspaceError::InvalidSplit { .. }
        ));
    }

    #[test]
    fn reorder_workspaces_rejects_unknown_id() {
        let mut state = new_state();
        state.create_workspace(
            "A".to_string(),
            "p1".to_string(),
            "pty1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state.reorder_workspaces(&["unknown-id".to_string()]);
        assert!(matches!(
            result.unwrap_err(),
            WorkspaceError::NotFound { .. }
        ));
    }

    #[test]
    fn reorder_workspaces_rejects_empty_when_workspaces_exist() {
        let mut state = new_state();
        state.create_workspace(
            "A".to_string(),
            "p1".to_string(),
            "pty1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state.reorder_workspaces(&[]);
        assert!(matches!(
            result.unwrap_err(),
            WorkspaceError::InvalidSplit { .. }
        ));
    }

    #[test]
    fn leaf_layout_carries_pty_id_through_split() {
        let mut state = new_state();
        state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            true,
        );

        let result = state
            .split_pane(
                "pane-1",
                SplitDirection::Horizontal,
                "pane-2".to_string(),
                "pty-2".to_string(),
            )
            .unwrap();

        // Both leaves in the split should carry their respective pty_ids
        match &result.workspace.surfaces[0].layout {
            LayoutNode::Split { children, .. } => {
                match &children[0] {
                    LayoutNode::Leaf { pane_id, pty_id } => {
                        assert_eq!(pane_id, "pane-1");
                        assert_eq!(pty_id, "pty-1");
                    }
                    _ => panic!("expected leaf"),
                }
                match &children[1] {
                    LayoutNode::Leaf { pane_id, pty_id } => {
                        assert_eq!(pane_id, "pane-2");
                        assert_eq!(pty_id, "pty-2");
                    }
                    _ => panic!("expected leaf"),
                }
            }
            _ => panic!("expected split layout"),
        }
    }

    #[test]
    fn create_workspace_stores_project_and_worktree_fields() {
        let mut state = WorkspaceState::new();
        let ws = state.create_workspace(
            "Test".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            "proj-1".to_string(),
            "/home/user/myproject".to_string(),
            Some("main".to_string()),
            true,
        );
        assert_eq!(ws.project_id, "proj-1");
        assert_eq!(ws.worktree_path, "/home/user/myproject");
        assert_eq!(ws.branch_name, Some("main".to_string()));
        assert!(ws.is_root_worktree);
    }
}
