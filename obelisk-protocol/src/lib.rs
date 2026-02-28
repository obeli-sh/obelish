use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
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
