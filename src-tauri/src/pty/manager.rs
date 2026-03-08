use crate::error::PtyError;
use crate::pty::backend::{PtyBackend, SpawnedPty};
use crate::pty::emitter::EventEmitter;
use crate::pty::types::{PtyConfig, PtySize};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

struct PtySession {
    writer: Option<Box<dyn Write + Send>>,
    child: Box<dyn crate::pty::backend::ChildController>,
    resizer: Box<dyn crate::pty::backend::PtyResizer>,
    /// Held to keep the read thread alive; dropped (detached) on session cleanup.
    _read_thread: Option<std::thread::JoinHandle<()>>,
    size: PtySize,
}

struct PtyManagerInner {
    sessions: HashMap<String, PtySession>,
    terminated_ids: VecDeque<String>,
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
                terminated_ids: VecDeque::new(),
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
            _read_thread: Some(read_thread),
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

        if inner.terminated_ids.iter().any(|tid| tid == id) {
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

        if inner.terminated_ids.iter().any(|tid| tid == id) {
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

            if inner.terminated_ids.iter().any(|tid| tid == id) {
                return Err(PtyError::AlreadyTerminated { id: id.to_string() });
            }

            let session = inner
                .sessions
                .remove(id)
                .ok_or_else(|| PtyError::NotFound { id: id.to_string() })?;

            const MAX_TERMINATED_IDS: usize = 1000;
            inner.terminated_ids.push_back(id.to_string());
            if inner.terminated_ids.len() > MAX_TERMINATED_IDS {
                inner.terminated_ids.pop_front();
            }
            session
        }; // Lock released here — cleanup happens outside the lock

        if let Err(e) = session.child.kill() {
            tracing::warn!(id, error = %e, "failed to kill PTY child process");
        }
        session.writer.take(); // Drop writer to help close PTY pipe

        // Do NOT join the read thread — on Windows with ConPTY the pipe may not
        // close promptly, causing thread.join() to block indefinitely and
        // freezing the Tauri IPC command (which makes the UI unresponsive).
        // Dropping the JoinHandle detaches the thread; it will exit on its own
        // once the reader gets EOF or an error from the closed pipe.

        Ok(())
    }
}

fn pty_read_loop(mut reader: Box<dyn Read + Send>, pty_id: String, emitter: Arc<dyn EventEmitter>) {
    let mut buf = [0u8; 4096];
    let mut parser = crate::notifications::osc_parser::OscParser::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let (forwarded, notifications, cwd) = parser.feed(&buf[..n]);
                let data = BASE64.encode(&forwarded);
                let payload = serde_json::json!({ "data": data });
                let _ = emitter.emit(&format!("pty-data-{pty_id}"), payload);
                for notif in notifications {
                    let payload = serde_json::json!({
                        "ptyId": pty_id,
                        "oscType": notif.osc_type,
                        "title": notif.title,
                        "body": notif.body,
                    });
                    let _ = emitter.emit("notification-raw", payload);
                }
                if let Some(cwd) = cwd {
                    let payload = serde_json::json!({ "cwd": cwd });
                    let _ = emitter.emit(&format!("cwd-changed-{pty_id}"), payload);
                }
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
    use std::collections::HashSet;
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

    struct FailingKillChild;

    impl crate::pty::backend::ChildController for FailingKillChild {
        fn kill(&mut self) -> Result<(), PtyError> {
            Err(PtyError::KillFailed(std::io::Error::new(
                std::io::ErrorKind::Other,
                "process already exited",
            )))
        }

        fn is_alive(&mut self) -> Result<bool, PtyError> {
            Ok(false)
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

        // Wait for read thread to process data and exit (Condvar-based, no sleep)
        assert!(
            emitter.wait_for_event("pty-data-", Duration::from_secs(5)),
            "expected pty-data event"
        );
        assert!(
            emitter.wait_for_event("pty-exit-", Duration::from_secs(5)),
            "expected pty-exit event"
        );
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
        assert!(inner.terminated_ids.iter().any(|tid| tid == &id));
    }

    #[test]
    fn kill_logs_warning_on_child_kill_failure() {
        let emitter = Arc::new(MockEventEmitter::new());
        let backend = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(|_config| {
                Ok(SpawnedPty {
                    writer: Box::new(SinkWriter),
                    reader: Box::new(EmptyReader),
                    child: Box::new(FailingKillChild),
                    resizer: Box::new(FakeResizer),
                })
            })),
        });
        let manager = PtyManager::new(backend);
        let id = manager.spawn(default_config(), emitter).unwrap();

        // kill() should still succeed even if child.kill() fails
        let result = manager.kill(&id);
        assert!(result.is_ok());

        // Session should still be cleaned up
        let inner = manager.inner.lock().unwrap();
        assert!(!inner.sessions.contains_key(&id));
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

        // Give the read thread time to start blocking on the socket
        std::thread::sleep(Duration::from_millis(50));

        // Kill should close the writer end (via FakeChild), causing reader EOF.
        let result = manager.kill(&id);
        assert!(result.is_ok());

        // Wait for exit event (Condvar-based, no sleep)
        assert!(
            emitter.wait_for_event("pty-exit-", Duration::from_secs(5)),
            "expected pty-exit event after kill"
        );
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

    struct CapturingWriter {
        data: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for CapturingWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.data.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn write_base64_decodes_before_write() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let captured_clone = captured.clone();
        let backend = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(move |_config| {
                Ok(SpawnedPty {
                    writer: Box::new(CapturingWriter {
                        data: captured_clone.clone(),
                    }),
                    reader: Box::new(EmptyReader),
                    child: Box::new(FakeChild::new()),
                    resizer: Box::new(FakeResizer),
                })
            })),
        });
        let emitter = Arc::new(MockEventEmitter::new());
        let manager = PtyManager::new(backend);
        let id = manager.spawn(default_config(), emitter).unwrap();

        let b64 = BASE64.encode(b"hello world");
        manager.write(&id, &b64).unwrap();

        let written = captured.lock().unwrap();
        assert_eq!(&*written, b"hello world");
    }

    #[test]
    fn terminated_ids_bounded_to_max_capacity() {
        let emitter = Arc::new(MockEventEmitter::new());
        let manager = PtyManager::new(default_backend());

        // Spawn and kill more than MAX_TERMINATED_IDS (1000) PTYs
        let mut first_id = String::new();
        for i in 0..1002 {
            let id = manager.spawn(default_config(), emitter.clone()).unwrap();
            if i == 0 {
                first_id = id.clone();
            }
            manager.kill(&id).unwrap();
        }

        // The VecDeque should be capped at 1000
        let inner = manager.inner.lock().unwrap();
        assert!(inner.terminated_ids.len() <= 1000);

        // The very first ID should have been evicted
        assert!(
            !inner.terminated_ids.iter().any(|tid| tid == &first_id),
            "oldest terminated ID should have been evicted"
        );
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

    #[test]
    fn read_loop_emits_notification_for_osc9() {
        let emitter = Arc::new(MockEventEmitter::new());
        // Reader that produces an OSC 9 notification sequence
        let osc_data = b"hello\x1b]9;Test notification\x07world";
        let backend = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(move |_config| {
                Ok(SpawnedPty {
                    writer: Box::new(SinkWriter),
                    reader: Box::new(std::io::Cursor::new(osc_data.to_vec())),
                    child: Box::new(FakeChild::new()),
                    resizer: Box::new(FakeResizer),
                })
            })),
        });
        let manager = PtyManager::new(backend);
        let _id = manager.spawn(default_config(), emitter.clone()).unwrap();

        // Wait for read thread to finish (Condvar-based, no sleep)
        assert!(
            emitter.wait_for_event("pty-exit-", Duration::from_secs(5)),
            "expected pty-exit event"
        );

        let events = emitter.events();

        // Should have pty-data event(s)
        assert!(events.iter().any(|(name, _)| name.starts_with("pty-data-")));

        // Should have notification-raw event
        let notif_events: Vec<_> = events
            .iter()
            .filter(|(name, _)| name == "notification-raw")
            .collect();
        assert_eq!(notif_events.len(), 1);

        let payload = &notif_events[0].1;
        assert_eq!(payload["oscType"], 9);
        assert_eq!(payload["title"], "Test notification");

        // Verify forwarded data has same length as input (all bytes forwarded)
        let data_events: Vec<_> = events
            .iter()
            .filter(|(name, _)| name.starts_with("pty-data-"))
            .collect();
        let total_forwarded_bytes: usize = data_events
            .iter()
            .map(|(_, payload)| {
                let b64 = payload["data"].as_str().unwrap();
                BASE64.decode(b64).unwrap().len()
            })
            .sum();
        assert_eq!(total_forwarded_bytes, osc_data.len());
    }

    #[test]
    fn kill_returns_quickly_even_with_slow_reader() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let reader_running = Arc::new(AtomicBool::new(false));
        let reader_running_clone = reader_running.clone();

        // Reader that blocks until the shared flag is set to false
        struct SlowReader {
            running: Arc<AtomicBool>,
        }

        impl Read for SlowReader {
            fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
                self.running.store(true, Ordering::SeqCst);
                // Block for a long time (simulating a stuck ConPTY pipe)
                std::thread::sleep(Duration::from_secs(30));
                Ok(0)
            }
        }

        let emitter = Arc::new(MockEventEmitter::new());
        let backend = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(move |_config| {
                Ok(SpawnedPty {
                    writer: Box::new(SinkWriter),
                    reader: Box::new(SlowReader {
                        running: reader_running_clone.clone(),
                    }),
                    child: Box::new(FakeChild::new()),
                    resizer: Box::new(FakeResizer),
                })
            })),
        });

        let manager = PtyManager::new(backend);
        let id = manager.spawn(default_config(), emitter).unwrap();

        // Wait for the read thread to start blocking
        for _ in 0..100 {
            if reader_running.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            reader_running.load(Ordering::SeqCst),
            "read thread should be running"
        );

        // kill() must return quickly (< 1 second) even though the reader is blocked
        let start = std::time::Instant::now();
        let result = manager.kill(&id);
        let elapsed = start.elapsed();

        assert!(result.is_ok());
        assert!(
            elapsed < Duration::from_secs(2),
            "kill() took {:?}, expected < 2s (should not block on thread.join)",
            elapsed
        );

        // Session should be cleaned up
        let inner = manager.inner.lock().unwrap();
        assert!(!inner.sessions.contains_key(&id));
    }

    #[test]
    fn read_loop_no_notification_for_normal_text() {
        let emitter = Arc::new(MockEventEmitter::new());
        let normal_data = b"just regular terminal output\n";
        let backend = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(move |_config| {
                Ok(SpawnedPty {
                    writer: Box::new(SinkWriter),
                    reader: Box::new(std::io::Cursor::new(normal_data.to_vec())),
                    child: Box::new(FakeChild::new()),
                    resizer: Box::new(FakeResizer),
                })
            })),
        });
        let manager = PtyManager::new(backend);
        let _id = manager.spawn(default_config(), emitter.clone()).unwrap();

        // Wait for read thread to finish (Condvar-based, no sleep)
        assert!(
            emitter.wait_for_event("pty-exit-", Duration::from_secs(5)),
            "expected pty-exit event"
        );

        let events = emitter.events();
        // Should have pty-data but no notification-raw
        assert!(events.iter().any(|(name, _)| name.starts_with("pty-data-")));
        assert!(!events.iter().any(|(name, _)| name == "notification-raw"));
    }

    #[test]
    fn write_invalid_base64_returns_error() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();
        let result = manager.write(&id, "not-valid-base64!!!");
        assert!(result.is_err());
    }

    // --- PTY read loop edge case tests ---

    /// A reader that delivers data in controlled chunks, with an optional
    /// delay between reads to simulate partial delivery.
    struct ChunkedReader {
        chunks: Vec<Vec<u8>>,
        index: usize,
    }

    impl ChunkedReader {
        fn new(chunks: Vec<Vec<u8>>) -> Self {
            Self { chunks, index: 0 }
        }
    }

    impl Read for ChunkedReader {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.index >= self.chunks.len() {
                return Ok(0); // EOF
            }
            let chunk = &self.chunks[self.index];
            let n = chunk.len().min(buf.len());
            buf[..n].copy_from_slice(&chunk[..n]);
            self.index += 1;
            Ok(n)
        }
    }

    /// A reader that returns an error on the first read.
    struct ErrorReader;

    impl Read for ErrorReader {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "pipe broken",
            ))
        }
    }

    #[test]
    fn read_loop_partial_osc_across_chunks() {
        // Split an OSC 9 notification sequence across two reads.
        // Full sequence: ESC ] 9 ; H e l l o BEL
        let full = b"\x1b]9;Hello\x07";
        // Split right in the middle of the payload
        let split = 5; // "\x1b]9;H" | "ello\x07"
        let chunk1 = full[..split].to_vec();
        let chunk2 = full[split..].to_vec();

        let emitter = Arc::new(MockEventEmitter::new());
        let reader = ChunkedReader::new(vec![chunk1, chunk2]);
        let pty_id = "test-partial-osc".to_string();

        pty_read_loop(Box::new(reader), pty_id.clone(), emitter.clone());

        let events = emitter.events();

        // Should have notification-raw event despite the split
        let notif_events: Vec<_> = events
            .iter()
            .filter(|(name, _)| name == "notification-raw")
            .collect();
        assert_eq!(
            notif_events.len(),
            1,
            "notification should be captured despite split across chunks"
        );
        assert_eq!(notif_events[0].1["title"], "Hello");
        assert_eq!(notif_events[0].1["oscType"], 9);

        // Should have pty-exit event
        assert!(events
            .iter()
            .any(|(name, _)| name == &format!("pty-exit-{pty_id}")));
    }

    #[test]
    fn read_loop_cwd_change_event() {
        // OSC 7 sequence: ESC ] 7 ; file://localhost/home/user BEL
        let osc7 = b"\x1b]7;file://localhost/home/user\x07";
        let emitter = Arc::new(MockEventEmitter::new());
        let reader = std::io::Cursor::new(osc7.to_vec());
        let pty_id = "test-cwd".to_string();

        pty_read_loop(Box::new(reader), pty_id.clone(), emitter.clone());

        let events = emitter.events();

        // Should have cwd-changed-{pty_id} event
        let cwd_events: Vec<_> = events
            .iter()
            .filter(|(name, _)| name == &format!("cwd-changed-{pty_id}"))
            .collect();
        assert_eq!(
            cwd_events.len(),
            1,
            "should emit exactly one cwd-changed event"
        );
        assert_eq!(cwd_events[0].1["cwd"], "/home/user");
    }

    #[test]
    fn read_loop_handles_reader_error_gracefully() {
        let emitter = Arc::new(MockEventEmitter::new());
        let pty_id = "test-error".to_string();

        // ErrorReader returns Err on first read
        pty_read_loop(Box::new(ErrorReader), pty_id.clone(), emitter.clone());

        let events = emitter.events();

        // Should still emit pty-exit event
        let exit_events: Vec<_> = events
            .iter()
            .filter(|(name, _)| name == &format!("pty-exit-{pty_id}"))
            .collect();
        assert_eq!(
            exit_events.len(),
            1,
            "should emit pty-exit even on reader error"
        );

        // Should NOT have any pty-data events (error on first read)
        let data_events: Vec<_> = events
            .iter()
            .filter(|(name, _)| name.starts_with("pty-data-"))
            .collect();
        assert!(
            data_events.is_empty(),
            "should not emit data events on immediate error"
        );
    }

    #[test]
    fn read_loop_partial_osc7_across_chunks() {
        // Split an OSC 7 CWD sequence across two chunks
        let full = b"\x1b]7;file:///tmp/mydir\x07";
        let split = 10; // "\x1b]7;file:/" | "/tmp/mydir\x07"
        let chunk1 = full[..split].to_vec();
        let chunk2 = full[split..].to_vec();

        let emitter = Arc::new(MockEventEmitter::new());
        let reader = ChunkedReader::new(vec![chunk1, chunk2]);
        let pty_id = "test-partial-osc7".to_string();

        pty_read_loop(Box::new(reader), pty_id.clone(), emitter.clone());

        let events = emitter.events();

        // Should have cwd-changed event despite the split
        let cwd_events: Vec<_> = events
            .iter()
            .filter(|(name, _)| name == &format!("cwd-changed-{pty_id}"))
            .collect();
        assert_eq!(
            cwd_events.len(),
            1,
            "CWD change should be captured despite split across chunks"
        );
        assert_eq!(cwd_events[0].1["cwd"], "/tmp/mydir");
    }

    #[test]
    fn write_empty_base64_succeeds() {
        let (manager, emitter) = make_manager();
        let id = manager.spawn(default_config(), emitter).unwrap();
        let result = manager.write(&id, "");
        // Empty base64 decodes to empty bytes, should succeed
        assert!(result.is_ok());
    }

    #[test]
    fn concurrent_spawn_with_failures() {
        use std::sync::atomic::{AtomicU32, Ordering};

        let call_count = Arc::new(AtomicU32::new(0));
        let cc = call_count.clone();
        let backend: Arc<dyn PtyBackend> = Arc::new(FakePtyBackend {
            factory: Mutex::new(Box::new(move |_config| {
                let count = cc.fetch_add(1, Ordering::SeqCst) + 1;
                if count % 2 == 0 {
                    Err(PtyError::SpawnFailed(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "injected failure",
                    )))
                } else {
                    Ok(SpawnedPty {
                        writer: Box::new(SinkWriter),
                        reader: Box::new(EmptyReader),
                        child: Box::new(FakeChild::new()),
                        resizer: Box::new(FakeResizer),
                    })
                }
            })),
        });
        let manager = Arc::new(PtyManager::new(backend));

        let handles: Vec<_> = (0..10)
            .map(|_| {
                let m = manager.clone();
                let e = Arc::new(MockEventEmitter::new());
                std::thread::spawn(move || m.spawn(default_config(), e))
            })
            .collect();

        let mut successes = 0;
        let mut failures = 0;
        for h in handles {
            match h.join().unwrap() {
                Ok(_) => successes += 1,
                Err(_) => failures += 1,
            }
        }
        assert!(successes > 0, "expected at least one successful spawn");
        assert!(failures > 0, "expected at least one failed spawn");
    }
}
