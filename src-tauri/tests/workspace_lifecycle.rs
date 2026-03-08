use obelisk_lib::workspace::state::{PaneDropPosition, WorkspaceState};
use obelisk_protocol::{LayoutNode, SplitDirection};

fn count_leaves(layout: &LayoutNode) -> usize {
    match layout {
        LayoutNode::Leaf { .. } => 1,
        LayoutNode::Split { children, .. } => {
            count_leaves(&children[0]) + count_leaves(&children[1])
        }
    }
}

fn collect_leaf_pane_ids(layout: &LayoutNode) -> Vec<String> {
    let mut ids = Vec::new();
    collect_leaf_pane_ids_inner(layout, &mut ids);
    ids
}

fn collect_leaf_pane_ids_inner(layout: &LayoutNode, ids: &mut Vec<String>) {
    match layout {
        LayoutNode::Leaf { pane_id, .. } => ids.push(pane_id.clone()),
        LayoutNode::Split { children, .. } => {
            collect_leaf_pane_ids_inner(&children[0], ids);
            collect_leaf_pane_ids_inner(&children[1], ids);
        }
    }
}

// Step 1: Create workspace → verify active and single-leaf layout
#[test]
fn lifecycle_create_workspace() {
    let mut state = WorkspaceState::new();
    let ws = state.create_workspace(
        "Main".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        "proj-1".to_string(),
        "/home/user/project".to_string(),
        Some("main".to_string()),
        true,
    );

    assert_eq!(ws.name, "Main");
    assert_eq!(state.active_workspace_id(), Some(ws.id.as_str()));
    assert_eq!(ws.surfaces.len(), 1);
    assert!(
        matches!(&ws.surfaces[0].layout, LayoutNode::Leaf { pane_id, .. } if pane_id == "pane-1")
    );
}

// Step 2: Split pane horizontally → verify 2 leaves
#[test]
fn lifecycle_split_horizontal_yields_two_leaves() {
    let mut state = WorkspaceState::new();
    state.create_workspace(
        "Main".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    let result = state
        .split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-2".to_string(),
            "pty-2".to_string(),
        )
        .unwrap();

    assert_eq!(count_leaves(&result.workspace.surfaces[0].layout), 2);
    assert_eq!(result.new_pane.id, "pane-2");
}

// Step 3: Split again vertically on new pane → verify 3 leaves
#[test]
fn lifecycle_second_split_vertical_yields_three_leaves() {
    let mut state = WorkspaceState::new();
    state.create_workspace(
        "Main".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    state
        .split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-2".to_string(),
            "pty-2".to_string(),
        )
        .unwrap();

    let result = state
        .split_pane(
            "pane-2",
            SplitDirection::Vertical,
            "pane-3".to_string(),
            "pty-3".to_string(),
        )
        .unwrap();

    assert_eq!(count_leaves(&result.workspace.surfaces[0].layout), 3);
}

// Step 4: Close one pane → verify back to 2 leaves
#[test]
fn lifecycle_close_pane_reduces_to_two_leaves() {
    let mut state = WorkspaceState::new();
    state.create_workspace(
        "Main".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    state
        .split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-2".to_string(),
            "pty-2".to_string(),
        )
        .unwrap();

    state
        .split_pane(
            "pane-2",
            SplitDirection::Vertical,
            "pane-3".to_string(),
            "pty-3".to_string(),
        )
        .unwrap();

    let close_result = state.close_pane("pane-3").unwrap();
    assert!(!close_result.workspace_closed);
    assert_eq!(close_result.pty_id, "pty-3");

    let ws = &state.list_workspaces()[0];
    assert_eq!(count_leaves(&ws.surfaces[0].layout), 2);
}

// Step 5: Swap remaining panes → verify both exist with swapped positions
#[test]
fn lifecycle_swap_panes_preserves_both() {
    let mut state = WorkspaceState::new();
    state.create_workspace(
        "Main".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    state
        .split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-2".to_string(),
            "pty-2".to_string(),
        )
        .unwrap();

    let ws_after_swap = state.swap_panes("pane-1", "pane-2").unwrap();
    let leaf_ids = collect_leaf_pane_ids(&ws_after_swap.surfaces[0].layout);
    assert!(leaf_ids.contains(&"pane-1".to_string()));
    assert!(leaf_ids.contains(&"pane-2".to_string()));

    // After swap, the first child should be pane-2 and second pane-1
    match &ws_after_swap.surfaces[0].layout {
        LayoutNode::Split { children, .. } => {
            assert!(
                matches!(&children[0], LayoutNode::Leaf { pane_id, .. } if pane_id == "pane-2")
            );
            assert!(
                matches!(&children[1], LayoutNode::Leaf { pane_id, .. } if pane_id == "pane-1")
            );
        }
        _ => panic!("expected split layout after swap"),
    }
}

// Step 6: Move pane with drag-drop position → verify layout changes
#[test]
fn lifecycle_move_pane_changes_layout() {
    let mut state = WorkspaceState::new();
    state.create_workspace(
        "Main".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    state
        .split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-2".to_string(),
            "pty-2".to_string(),
        )
        .unwrap();

    // Move pane-1 to the bottom of pane-2
    let ws = state
        .move_pane("pane-1", "pane-2", PaneDropPosition::Bottom)
        .unwrap();

    // Layout should now be vertical (since Bottom creates a vertical split)
    match &ws.surfaces[0].layout {
        LayoutNode::Split {
            direction,
            children,
            ..
        } => {
            assert!(matches!(direction, SplitDirection::Vertical));
            // pane-2 on top, pane-1 on bottom
            assert!(
                matches!(&children[0], LayoutNode::Leaf { pane_id, .. } if pane_id == "pane-2")
            );
            assert!(
                matches!(&children[1], LayoutNode::Leaf { pane_id, .. } if pane_id == "pane-1")
            );
        }
        _ => panic!("expected split layout after move"),
    }
}

// Step 7: Rename workspace → verify name changes
#[test]
fn lifecycle_rename_workspace() {
    let mut state = WorkspaceState::new();
    let ws = state.create_workspace(
        "Original".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    let renamed = state
        .rename_workspace(&ws.id, "Renamed WS".to_string())
        .unwrap();
    assert_eq!(renamed.name, "Renamed WS");
    assert_eq!(state.get_workspace(&ws.id).unwrap().name, "Renamed WS");
}

// Step 8: Create second workspace → verify it becomes active, first still exists
#[test]
fn lifecycle_second_workspace_becomes_active() {
    let mut state = WorkspaceState::new();
    let ws1 = state.create_workspace(
        "First".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );
    let ws2 = state.create_workspace(
        "Second".to_string(),
        "pane-2".to_string(),
        "pty-2".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    assert_eq!(state.active_workspace_id(), Some(ws2.id.as_str()));
    assert!(state.get_workspace(&ws1.id).is_some());
    assert!(state.get_workspace(&ws2.id).is_some());
    assert_eq!(state.list_workspaces().len(), 2);
}

// Step 9: Reorder workspaces → verify order changed
#[test]
fn lifecycle_reorder_workspaces() {
    let mut state = WorkspaceState::new();
    let ws1 = state.create_workspace(
        "Alpha".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );
    let ws2 = state.create_workspace(
        "Beta".to_string(),
        "pane-2".to_string(),
        "pty-2".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );
    let ws3 = state.create_workspace(
        "Gamma".to_string(),
        "pane-3".to_string(),
        "pty-3".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    // Reverse the order
    state
        .reorder_workspaces(&[ws3.id.clone(), ws2.id.clone(), ws1.id.clone()])
        .unwrap();

    let list = state.list_workspaces();
    assert_eq!(list[0].name, "Gamma");
    assert_eq!(list[1].name, "Beta");
    assert_eq!(list[2].name, "Alpha");
}

// Step 10: Close workspace → verify removed, other becomes active
#[test]
fn lifecycle_close_workspace_activates_remaining() {
    let mut state = WorkspaceState::new();
    let ws1 = state.create_workspace(
        "First".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );
    let ws2 = state.create_workspace(
        "Second".to_string(),
        "pane-2".to_string(),
        "pty-2".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    // Active is ws2 (last created)
    assert_eq!(state.active_workspace_id(), Some(ws2.id.as_str()));

    // Close ws2 — ws1 should become active
    state.close_workspace(&ws2.id).unwrap();
    assert_eq!(state.list_workspaces().len(), 1);
    assert!(state.get_workspace(&ws2.id).is_none());
    assert_eq!(state.active_workspace_id(), Some(ws1.id.as_str()));
}

// Step 11: Session state roundtrip
#[test]
fn lifecycle_session_state_roundtrip() {
    let mut state = WorkspaceState::new();
    let ws1 = state.create_workspace(
        "WS-A".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        "proj-1".to_string(),
        "/path/a".to_string(),
        Some("main".to_string()),
        true,
    );
    state.create_workspace(
        "WS-B".to_string(),
        "pane-2".to_string(),
        "pty-2".to_string(),
        "proj-2".to_string(),
        "/path/b".to_string(),
        Some("feature".to_string()),
        false,
    );

    // Split a pane so the layout is non-trivial
    state
        .split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-3".to_string(),
            "pty-3".to_string(),
        )
        .unwrap();

    // Focus ws1
    state.focus_workspace(&ws1.id).unwrap();

    // Roundtrip
    let session = state.to_session_state();
    let restored = WorkspaceState::from_session_state(session);

    // Verify identical
    assert_eq!(restored.list_workspaces().len(), 2);
    assert_eq!(restored.active_workspace_id(), Some(ws1.id.as_str()));

    let restored_ws1 = restored.get_workspace(&ws1.id).unwrap();
    assert_eq!(restored_ws1.name, "WS-A");
    assert_eq!(restored_ws1.project_id, "proj-1");
    assert_eq!(restored_ws1.worktree_path, "/path/a");
    assert_eq!(restored_ws1.branch_name, Some("main".to_string()));
    assert!(restored_ws1.is_root_worktree);

    // Verify the split layout survived
    assert_eq!(count_leaves(&restored_ws1.surfaces[0].layout), 2);

    // Verify panes survived
    assert!(restored.get_pane("pane-1").is_some());
    assert!(restored.get_pane("pane-2").is_some());
    assert!(restored.get_pane("pane-3").is_some());
}

// Step 12: Surface management (active_surface_index)
#[test]
fn lifecycle_surface_management() {
    let mut state = WorkspaceState::new();
    let ws = state.create_workspace(
        "Surfaces".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        String::new(),
        String::new(),
        None,
        false,
    );

    // Workspace starts with 1 surface and active_surface_index=0
    assert_eq!(ws.surfaces.len(), 1);
    assert_eq!(ws.active_surface_index, 0);

    // The surface has a name and a layout
    assert!(!ws.surfaces[0].id.is_empty());
    assert!(!ws.surfaces[0].name.is_empty());

    // Verify the single surface contains our pane
    let leaf_ids = collect_leaf_pane_ids(&ws.surfaces[0].layout);
    assert_eq!(leaf_ids, vec!["pane-1".to_string()]);
}

// Full end-to-end lifecycle: all steps sequentially
#[test]
fn full_workspace_lifecycle_end_to_end() {
    let mut state = WorkspaceState::new();

    // 1. Create workspace
    let ws1 = state.create_workspace(
        "Workspace 1".to_string(),
        "pane-1".to_string(),
        "pty-1".to_string(),
        "proj-1".to_string(),
        "/home/user/project".to_string(),
        Some("main".to_string()),
        true,
    );
    assert_eq!(state.active_workspace_id(), Some(ws1.id.as_str()));
    assert_eq!(count_leaves(&ws1.surfaces[0].layout), 1);

    // 2. Split horizontally
    let split1 = state
        .split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-2".to_string(),
            "pty-2".to_string(),
        )
        .unwrap();
    assert_eq!(count_leaves(&split1.workspace.surfaces[0].layout), 2);

    // 3. Split vertically on new pane
    let split2 = state
        .split_pane(
            "pane-2",
            SplitDirection::Vertical,
            "pane-3".to_string(),
            "pty-3".to_string(),
        )
        .unwrap();
    assert_eq!(count_leaves(&split2.workspace.surfaces[0].layout), 3);

    // 4. Close one pane
    let close_result = state.close_pane("pane-3").unwrap();
    assert!(!close_result.workspace_closed);
    let ws_after_close = state.get_workspace(&ws1.id).unwrap();
    assert_eq!(count_leaves(&ws_after_close.surfaces[0].layout), 2);

    // 5. Swap remaining panes
    let ws_after_swap = state.swap_panes("pane-1", "pane-2").unwrap();
    let leaf_ids = collect_leaf_pane_ids(&ws_after_swap.surfaces[0].layout);
    assert!(leaf_ids.contains(&"pane-1".to_string()));
    assert!(leaf_ids.contains(&"pane-2".to_string()));

    // 6. Move pane with drag-drop
    let ws_after_move = state
        .move_pane("pane-2", "pane-1", PaneDropPosition::Right)
        .unwrap();
    let leaf_ids_after_move = collect_leaf_pane_ids(&ws_after_move.surfaces[0].layout);
    assert_eq!(leaf_ids_after_move.len(), 2);

    // 7. Rename workspace
    let renamed = state
        .rename_workspace(&ws1.id, "Renamed WS".to_string())
        .unwrap();
    assert_eq!(renamed.name, "Renamed WS");

    // 8. Create second workspace
    let ws2 = state.create_workspace(
        "Workspace 2".to_string(),
        "pane-4".to_string(),
        "pty-4".to_string(),
        "proj-2".to_string(),
        "/home/user/other".to_string(),
        None,
        false,
    );
    assert_eq!(state.active_workspace_id(), Some(ws2.id.as_str()));
    assert!(state.get_workspace(&ws1.id).is_some());

    // 9. Reorder workspaces
    state
        .reorder_workspaces(&[ws2.id.clone(), ws1.id.clone()])
        .unwrap();
    assert_eq!(state.list_workspaces()[0].name, "Workspace 2");
    assert_eq!(state.list_workspaces()[1].name, "Renamed WS");

    // 10. Close workspace
    state.close_workspace(&ws2.id).unwrap();
    assert_eq!(state.list_workspaces().len(), 1);
    assert_eq!(state.active_workspace_id(), Some(ws1.id.as_str()));

    // 11. Session state roundtrip
    let session = state.to_session_state();
    let restored = WorkspaceState::from_session_state(session);
    assert_eq!(restored.list_workspaces().len(), 1);
    assert_eq!(restored.active_workspace_id(), Some(ws1.id.as_str()));
    assert_eq!(restored.list_workspaces()[0].name, "Renamed WS");
    assert!(restored.get_pane("pane-1").is_some());
    assert!(restored.get_pane("pane-2").is_some());

    // 12. Surface management
    let ws_final = restored.get_workspace(&ws1.id).unwrap();
    assert_eq!(ws_final.surfaces.len(), 1);
    assert_eq!(ws_final.active_surface_index, 0);
}
