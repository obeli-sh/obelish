use crate::error::PtyError;
use crate::pty::backend::{PtyBackend, SpawnedPty};
use crate::pty::emitter::EventEmitter;
use crate::pty::types::{PtyConfig, PtySize};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

struct PtySession {
    writer: Option<Box<dyn Write + Send>>,
    child: Box<dyn crate::pty::backend::ChildController>,
    resizer: Box<dyn crate::pty::backend::PtyResizer>,
    read_thread: Option<std::thread::JoinHandle<()>>,
    size: PtySize,
}

struct PtyManagerInner {
    sessions: HashMap<String, PtySession>,
    terminated_ids: HashSet<String>,
}

pub struct PtyManager {
    backend: Arc<dyn PtyBackend>,
    inner: Mutex<PtyManagerInner>,
}

impl PtyManager {
    pub fn new(backend: Arc<dyn PtyBackend>) -> Self {
        Self {
            backend,
            inner: Mutex::new(PtyManagerInner {
                sessions: HashMap::new(),
                terminated_ids: HashSet::new(),
            }),
        }
    }

    pub fn spawn(
        &self,
        config: PtyConfig,
        emitter: Arc<dyn EventEmitter>,
    ) -> Result<String, PtyError> {
        let spawned: SpawnedPty = self.backend.spawn(&config)?;

        let pty_id = uuid::Uuid::new_v4().to_string();
        let size = PtySize {
            rows: config.rows.unwrap_or(24),
            cols: config.cols.unwrap_or(80),
        };

        let reader = spawned.reader;
        let emitter_clone = emitter;
        let id_clone = pty_id.clone();
        let read_thread = std::thread::spawn(move || {
            pty_read_loop(reader, id_clone, emitter_clone);
        });

        let session = PtySession {
            writer: Some(spawned.writer),
            child: spawned.child,
            resizer: spawned.resizer,
            read_thread: Some(read_thread),
            size,
        };

        self.inner
            .lock()
            .expect("manager mutex poisoned")
            .sessions
            .insert(pty_id.clone(), session);

        Ok(pty_id)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), PtyError> {
        let mut inner = self.inner.lock().expect("manager mutex poisoned");

        if inner.terminated_ids.contains(id) {
            return Err(PtyError::AlreadyTerminated { id: id.to_string() });
        }

        let session = inner
            .sessions
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

        let bytes = BASE64.decode(data).map_err(|e| {
            PtyError::WriteFailed(std::io::Error::new(std::io::ErrorKind::InvalidData, e))
        })?;

        session
            .writer
            .as_mut()
            .expect("session in map should have writer")
            .write_all(&bytes)
            .map_err(PtyError::WriteFailed)?;

        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        if cols == 0 || rows == 0 {
            return Err(PtyError::ResizeFailed(
                "dimensions must be non-zero".to_string(),
            ));
        }

        let mut inner = self.inner.lock().expect("manager mutex poisoned");

        if inner.terminated_ids.contains(id) {
            return Err(PtyError::AlreadyTerminated { id: id.to_string() });
        }

        let session = inner
            .sessions
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

        session.resizer.resize(rows, cols)?;
        session.size = PtySize { rows, cols };

        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<(), PtyError> {
        let mut session = {
            let mut inner = self.inner.lock().expect("manager mutex poisoned");

            if inner.terminated_ids.contains(id) {
                return Err(PtyError::AlreadyTerminated { id: id.to_string() });
            }

            let session = inner
                .sessions
                .remove(id)
                .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

            inner.terminated_ids.insert(id.to_string());
            session
        }; // Lock released here — cleanup happens outside the lock

        let _ = session.child.kill();
        session.writer.take(); // Drop writer to help close PTY pipe
        if let Some(thread) = session.read_thread.take() {
            let _ = thread.join();
        }

        Ok(())
    }
}

fn pty_read_loop(mut reader: Box<dyn Read + Send>, pty_id: String, emitter: Arc<dyn EventEmitter>) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = BASE64.encode(&buf[..n]);
                let payload = serde_json::json!({ "data": data });
                let _ = emitter.emit(&format!("pty-data-{pty_id}"), payload);
            }
            Err(_) => break,
        }
    }
    let payload = serde_json::json!({ "exit_code": null, "signal": null });
    let _ = emitter.emit(&format!("pty-exit-{pty_id}"), payload);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::emitter::MockEventEmitter;
    use std::time::Duration;

    // --- Test doubles ---

    struct SinkWriter;

    impl Write for SinkWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct EmptyReader;

    impl Read for EmptyReader {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Ok(0) // EOF immediately
        }
    }

    struct FakeChild {
        killed: bool,
        #[cfg(unix)]
        _stream: Option<std::os::unix::net::UnixStream>,
    }

    impl FakeChild {
        fn new() -> Self {
            Self {
                killed: false,
                #[cfg(unix)]
                _stream: None,
            }
        }

        #[cfg(unix)]
        fn with_stream(stream: std::os::unix::net::UnixStream) -> Self {
            Self {
                killed: false,
                _stream: Some(stream),
            }
        }
    }

    impl crate::pty::backend::ChildController for FakeChild {
        fn kill(&mut self) -> Result<(), PtyError> {
            self.killed = true;
            #[cfg(unix)]
            {
                self._stream.take(); // Drop to trigger EOF on paired reader
            }
            Ok(())
        }

        fn is_alive(&mut self) -> Result<bool, PtyError> {
            Ok(!self.killed)
        }
    }

    struct FakeResizer;

    impl crate::pty::backend::PtyResizer for FakeResizer {
        fn resize(&self, _rows: u16, _cols: u16) -> Result<(), PtyError> {
            Ok(())
        }
    }

    struct FakePtyBackend {
        factory: Mutex<Box<dyn FnMut(&PtyConfig) -> Result<SpawnedPty, PtyError> + Send>>,
    }

    impl PtyBackend for FakePtyBackend {
        fn spawn(&self, config: &PtyConfig) -> Result<SpawnedPty, PtyError> {
            let mut factory = self.factory.lock().unwrap();
            (*factory)(config)
        }
    }

    // --- Helpers ---

    fn default_backend() -> Arc<dyn PtyBackend> {
        Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(|_config| {
                Ok(SpawnedPty {
                    writer: Box::new(SinkWriter),
                    reader: Box::new(EmptyReader),
                    child: Box::new(FakeChild::new()),
                    resizer: Box::new(FakeResizer),
                })
            })),
        })
    }

    fn failing_backend() -> Arc<dyn PtyBackend> {
        Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(|_config| {
                Err(PtyError::SpawnFailed(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "fake spawn failure",
                )))
            })),
        })
    }

    fn make_manager() -> (PtyManager, Arc<MockEventEmitter>) {
        let emitter = Arc::new(MockEventEmitter::new());
        let manager = PtyManager::new(default_backend());
        (manager, emitter)
    }

    fn default_config() -> PtyConfig {
        PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        }
    }

    // --- Tests ---

    #[test]
    fn spawn_returns_valid_pty_id() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();
        assert!(!id.is_empty());
        // Should be a valid UUID
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn spawn_with_invalid_shell_returns_error() {
        let emitter = Arc::new(MockEventEmitter::new());
        let manager = PtyManager::new(failing_backend());
        let result = manager.spawn(default_config(), emitter);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PtyError::SpawnFailed(_)));
    }

    #[test]
    fn spawn_starts_read_thread() {
        let emitter = Arc::new(MockEventEmitter::new());
        // Use a reader with data so the read thread emits events
        let backend = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(|_config| {
                let data = b"hello from pty";
                Ok(SpawnedPty {
                    writer: Box::new(SinkWriter),
                    reader: Box::new(std::io::Cursor::new(data.to_vec())),
                    child: Box::new(FakeChild::new()),
                    resizer: Box::new(FakeResizer),
                })
            })),
        });
        let manager = PtyManager::new(backend);
        let _id = manager.spawn(default_config(), emitter.clone()).unwrap();

        // Wait for read thread to process data and exit
        std::thread::sleep(Duration::from_millis(100));

        let events = emitter.events();
        // Should have at least one data event and one exit event
        assert!(events.iter().any(|(name, _)| name.starts_with("pty-data-")));
        assert!(events.iter().any(|(name, _)| name.starts_with("pty-exit-")));
    }

    #[test]
    fn write_to_valid_pty_succeeds() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();

        // base64 encode "hello\n"
        let data = BASE64.encode(b"hello\n");
        let result = manager.write(&id, &data);
        assert!(result.is_ok());
    }

    #[test]
    fn write_to_nonexistent_pty_returns_not_found() {
        let (manager, _emitter) = make_manager();
        let result = manager.write("nonexistent-id", "aGVsbG8=");
        assert!(matches!(result.unwrap_err(), PtyError::NotFound { .. }));
    }

    #[test]
    fn write_to_terminated_pty_returns_error() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();

        // Kill the PTY first
        manager.kill(&id).unwrap();

        // Now try to write
        let result = manager.write(&id, "aGVsbG8=");
        assert!(matches!(
            result.unwrap_err(),
            PtyError::AlreadyTerminated { .. }
        ));
    }

    #[test]
    fn resize_valid_pty() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();
        let result = manager.resize(&id, 120, 40);
        assert!(result.is_ok());
    }

    #[test]
    fn resize_nonexistent_returns_error() {
        let (manager, _emitter) = make_manager();
        let result = manager.resize("nonexistent-id", 80, 24);
        assert!(matches!(result.unwrap_err(), PtyError::NotFound { .. }));
    }

    #[test]
    fn resize_zero_dimensions_returns_error() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();

        let result = manager.resize(&id, 0, 24);
        assert!(matches!(result.unwrap_err(), PtyError::ResizeFailed(_)));

        let result = manager.resize(&id, 80, 0);
        assert!(matches!(result.unwrap_err(), PtyError::ResizeFailed(_)));
    }

    #[test]
    fn kill_valid_pty_cleans_up() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();

        let result = manager.kill(&id);
        assert!(result.is_ok());

        // Session should be gone from active sessions
        let inner = manager.inner.lock().unwrap();
        assert!(!inner.sessions.contains_key(&id));
        assert!(inner.terminated_ids.contains(&id));
    }

    #[test]
    fn kill_nonexistent_returns_error() {
        let (manager, _emitter) = make_manager();
        let result = manager.kill("nonexistent-id");
        assert!(matches!(result.unwrap_err(), PtyError::NotFound { .. }));
    }

    #[test]
    fn kill_already_terminated_returns_error() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();

        manager.kill(&id).unwrap();
        let result = manager.kill(&id);
        assert!(matches!(
            result.unwrap_err(),
            PtyError::AlreadyTerminated { .. }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn kill_stops_read_thread() {
        use std::os::unix::net::UnixStream;

        let emitter = Arc::new(MockEventEmitter::new());

        // Create streams inside the factory so no extra fds leak
        let backend = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(|_config| {
                let (reader_end, writer_end) = UnixStream::pair().expect("create socket pair");
                Ok(SpawnedPty {
                    writer: Box::new(SinkWriter),
                    reader: Box::new(reader_end),
                    child: Box::new(FakeChild::with_stream(writer_end)),
                    resizer: Box::new(FakeResizer),
                })
            })),
        });

        let manager = PtyManager::new(backend);
        let id = manager.spawn(default_config(), emitter.clone()).unwrap();

        // Give the read thread time to start blocking
        std::thread::sleep(Duration::from_millis(50));

        // Kill should close the writer end (via FakeChild), causing reader EOF.
        // Then join the read thread successfully.
        let result = manager.kill(&id);
        assert!(result.is_ok());

        // Verify exit event was emitted
        std::thread::sleep(Duration::from_millis(50));
        let events = emitter.events();
        assert!(events.iter().any(|(name, _)| name.starts_with("pty-exit-")));
    }

    #[test]
    fn concurrent_writes_to_same_pty() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();
        let manager = Arc::new(manager);

        let handles: Vec<_> = (0..10)
            .map(|i| {
                let m = manager.clone();
                let id = id.clone();
                std::thread::spawn(move || {
                    let data = BASE64.encode(format!("msg-{i}\n").as_bytes());
                    m.write(&id, &data)
                })
            })
            .collect();

        for handle in handles {
            let result = handle.join().expect("thread panicked");
            assert!(result.is_ok());
        }
    }

    #[test]
    fn spawn_multiple_ptys_simultaneously() {
        let emitter = Arc::new(MockEventEmitter::new());
        let manager = Arc::new(PtyManager::new(default_backend()));

        let handles: Vec<_> = (0..5)
            .map(|_| {
                let m = manager.clone();
                let e = emitter.clone();
                std::thread::spawn(move || m.spawn(default_config(), e))
            })
            .collect();

        let ids: Vec<String> = handles
            .into_iter()
            .map(|h| h.join().expect("thread panicked").expect("spawn failed"))
            .collect();

        // All IDs should be unique
        let unique: HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 5);
    }
}
