#[cfg(test)]
mod tests {
    use crate::persistence::session::SessionState;
    use crate::workspace::WorkspaceState;
    use obelisk_protocol::SplitDirection;
    use std::sync::{Arc, RwLock};
    use std::thread;

    #[test]
    fn concurrent_workspace_create() {
        // 10 threads each creating a workspace simultaneously
        let state = Arc::new(RwLock::new(WorkspaceState::new()));
        let handles: Vec<_> = (0..10)
            .map(|i| {
                let s = state.clone();
                thread::spawn(move || {
                    let mut st = s.write().unwrap();
                    st.create_workspace(
                        format!("WS-{i}"),
                        format!("pane-{i}"),
                        format!("pty-{i}"),
                        String::new(),
                        String::new(),
                        None,
                        false,
                    );
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let st = state.read().unwrap();
        assert_eq!(st.list_workspaces().len(), 10);
    }

    #[test]
    fn interleaved_split_and_close() {
        // Create workspace, then have threads split and close concurrently
        let state = Arc::new(RwLock::new(WorkspaceState::new()));
        {
            let mut st = state.write().unwrap();
            st.create_workspace(
                "Main".to_string(),
                "pane-0".to_string(),
                "pty-0".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
            // Pre-split to have enough panes to close
            for i in 1..=5 {
                st.split_pane(
                    "pane-0",
                    SplitDirection::Horizontal,
                    format!("pane-{i}"),
                    format!("pty-{i}"),
                )
                .unwrap();
            }
        }
        // Verify no panics under concurrent access
        let handles: Vec<_> = (0..5)
            .map(|i| {
                let s = state.clone();
                thread::spawn(move || {
                    // Alternately split and close
                    let mut st = s.write().unwrap();
                    let new_pane = format!("pane-new-{i}");
                    let _ = st.split_pane(
                        "pane-0",
                        SplitDirection::Vertical,
                        new_pane.clone(),
                        format!("pty-new-{i}"),
                    );
                    let _ = st.close_pane(&new_pane);
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn concurrent_focus() {
        // Multiple threads focusing different workspaces
        let state = Arc::new(RwLock::new(WorkspaceState::new()));
        let mut ids = Vec::new();
        {
            let mut st = state.write().unwrap();
            for i in 0..5 {
                let ws = st.create_workspace(
                    format!("WS-{i}"),
                    format!("pane-{i}"),
                    format!("pty-{i}"),
                    String::new(),
                    String::new(),
                    None,
                    false,
                );
                ids.push(ws.id);
            }
        }
        let handles: Vec<_> = ids
            .iter()
            .map(|id| {
                let s = state.clone();
                let id = id.clone();
                thread::spawn(move || {
                    let mut st = s.write().unwrap();
                    st.focus_workspace(&id).unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        // Should have exactly one active workspace
        let st = state.read().unwrap();
        assert!(st.active_workspace_id().is_some());
    }

    #[test]
    fn session_save_under_contention() {
        // Verify that to_session_state works while other threads are modifying
        let state = Arc::new(RwLock::new(WorkspaceState::new()));
        {
            let mut st = state.write().unwrap();
            for i in 0..3 {
                st.create_workspace(
                    format!("WS-{i}"),
                    format!("pane-{i}"),
                    format!("pty-{i}"),
                    String::new(),
                    String::new(),
                    None,
                    false,
                );
            }
        }
        let reader = state.clone();
        let writer = state.clone();
        let read_handle = thread::spawn(move || {
            for _ in 0..100 {
                let st = reader.read().unwrap();
                let _session: SessionState = st.to_session_state();
            }
        });
        let write_handle = thread::spawn(move || {
            for i in 0..50 {
                let mut st = writer.write().unwrap();
                let _ = st.split_pane(
                    "pane-0",
                    SplitDirection::Horizontal,
                    format!("stress-pane-{i}"),
                    format!("stress-pty-{i}"),
                );
            }
        });
        read_handle.join().unwrap();
        write_handle.join().unwrap();
    }
}
