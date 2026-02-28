use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PtyError {
    #[error("PTY not found: {id}")]
    NotFound { id: String },
    #[error("Failed to spawn PTY: {0}")]
    SpawnFailed(#[source] std::io::Error),
    #[error("Failed to write to PTY: {0}")]
    WriteFailed(#[source] std::io::Error),
    #[error("Failed to resize PTY: {0}")]
    ResizeFailed(String),
    #[error("PTY already terminated: {id}")]
    AlreadyTerminated { id: String },
}

#[derive(Debug, Error)]
pub enum BackendError {
    #[error(transparent)]
    Pty(#[from] PtyError),
}

impl Serialize for BackendError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("BackendError", 2)?;
        match self {
            BackendError::Pty(e) => {
                let kind = match e {
                    PtyError::NotFound { .. } => "NotFound",
                    PtyError::SpawnFailed(_) => "SpawnFailed",
                    PtyError::WriteFailed(_) => "WriteFailed",
                    PtyError::ResizeFailed(_) => "ResizeFailed",
                    PtyError::AlreadyTerminated { .. } => "AlreadyTerminated",
                };
                state.serialize_field("kind", kind)?;
                state.serialize_field("message", &e.to_string())?;
            }
        }
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_error_serializes_kind_and_message() {
        let cases: Vec<(BackendError, &str, &str)> = vec![
            (
                PtyError::NotFound {
                    id: "abc".to_string(),
                }
                .into(),
                "NotFound",
                "PTY not found: abc",
            ),
            (
                PtyError::SpawnFailed(std::io::Error::new(std::io::ErrorKind::Other, "boom"))
                    .into(),
                "SpawnFailed",
                "Failed to spawn PTY: boom",
            ),
            (
                PtyError::WriteFailed(std::io::Error::new(std::io::ErrorKind::Other, "oops"))
                    .into(),
                "WriteFailed",
                "Failed to write to PTY: oops",
            ),
            (
                PtyError::ResizeFailed("bad size".to_string()).into(),
                "ResizeFailed",
                "Failed to resize PTY: bad size",
            ),
            (
                PtyError::AlreadyTerminated {
                    id: "xyz".to_string(),
                }
                .into(),
                "AlreadyTerminated",
                "PTY already terminated: xyz",
            ),
        ];

        for (error, expected_kind, expected_message) in cases {
            let json = serde_json::to_value(&error).expect("serialize should succeed");
            assert_eq!(json["kind"], expected_kind);
            assert_eq!(json["message"], expected_message);
        }
    }

    #[test]
    fn pty_error_converts_to_backend_error() {
        let pty_err = PtyError::NotFound {
            id: "test".to_string(),
        };
        let backend_err: BackendError = pty_err.into();
        assert!(matches!(
            backend_err,
            BackendError::Pty(PtyError::NotFound { .. })
        ));
    }
}
