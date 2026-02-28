pub use obelisk_protocol::{
    LayoutNode, PaneInfo, PaneType, SplitDirection, SurfaceInfo, WorkspaceInfo,
};

#[derive(Debug)]
pub struct PaneSplitResult {
    pub workspace: WorkspaceInfo,
    pub new_pane: PaneInfo,
}

#[derive(Debug)]
pub struct PaneCloseResult {
    pub pty_id: String,
    pub workspace_closed: bool,
    pub workspace: Option<WorkspaceInfo>,
}
