use thiserror::Error;

#[derive(Debug, Error)]
pub enum IpcError {
    #[error("failed to bind socket: {0}")]
    BindFailed(#[source] std::io::Error),
    #[error("server not running")]
    NotRunning,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
