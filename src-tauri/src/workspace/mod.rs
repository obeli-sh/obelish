pub mod state;
pub mod types;

#[cfg(test)]
mod stress_tests;

pub use state::WorkspaceState;
pub use types::{PaneCloseResult, PaneSplitResult};
