use obelisk_lib::pty::emitter::EventEmitter;
use obelisk_lib::pty::manager::PtyManager;
use obelisk_lib::pty::types::PtyConfig;
use obelisk_lib::pty::RealPtyBackend;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// Collects emitted events for test assertions.
struct TestEventEmitter {
    events: Mutex<Vec<(String, serde_json::Value)>>,
}

impl TestEventEmitter {
    fn new() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
        }
    }

    fn data_events_for(&self, pty_id: &str) -> Vec<String> {
        let event_name = format!("pty-data-{pty_id}");
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(name, _)| name == &event_name)
            .filter_map(|(_, payload)| payload["data"].as_str().map(|s| s.to_string()))
            .collect()
    }

    fn decoded_output_for(&self, pty_id: &str) -> String {
        self.data_events_for(pty_id)
            .iter()
            .filter_map(|b64| BASE64.decode(b64).ok())
            .filter_map(|bytes| String::from_utf8(bytes).ok())
            .collect::<Vec<_>>()
            .join("")
    }

    fn has_exit_event_for(&self, pty_id: &str) -> bool {
        let event_name = format!("pty-exit-{pty_id}");
        self.events
            .lock()
            .unwrap()
            .iter()
            .any(|(name, _)| name == &event_name)
    }
}

impl EventEmitter for TestEventEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
        Ok(())
    }
}

fn make_manager() -> PtyManager {
    PtyManager::new(Arc::new(RealPtyBackend::new()))
}

fn default_config() -> PtyConfig {
    PtyConfig {
        shell: None,
        cwd: None,
        env: None,
        rows: Some(24),
        cols: Some(80),
    }
}

/// Poll until the condition returns true, or timeout.
fn poll_until(timeout: Duration, interval: Duration, condition: impl Fn() -> bool) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if condition() {
            return true;
        }
        std::thread::sleep(interval);
    }
    false
}

#[test]
fn spawn_real_shell_and_read_prompt() {
    let emitter = Arc::new(TestEventEmitter::new());
    let manager = make_manager();
    let id = manager.spawn(default_config(), emitter.clone()).unwrap();

    // Wait for some output (shell prompt or banner)
    let found = poll_until(Duration::from_secs(5), Duration::from_millis(100), || {
        !emitter.data_events_for(&id).is_empty()
    });

    assert!(found, "expected shell output within 5 seconds");
    manager.kill(&id).unwrap();
}

#[test]
fn write_echo_read_output() {
    let emitter = Arc::new(TestEventEmitter::new());
    let manager = make_manager();

    // Use sh explicitly for predictable behavior
    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        cwd: None,
        env: None,
        rows: Some(24),
        cols: Some(80),
    };

    let id = manager.spawn(config, emitter.clone()).unwrap();

    // Wait for shell to be ready
    std::thread::sleep(Duration::from_millis(500));

    // Write "echo hello" followed by newline
    let cmd = BASE64.encode(b"echo hello\n");
    manager.write(&id, &cmd).unwrap();

    // Wait for "hello" in output
    let found = poll_until(Duration::from_secs(5), Duration::from_millis(100), || {
        let output = emitter.decoded_output_for(&id);
        output.contains("hello")
    });

    assert!(found, "expected 'hello' in output");
    manager.kill(&id).unwrap();
}

#[test]
fn rapid_sequential_writes() {
    let emitter = Arc::new(TestEventEmitter::new());
    let manager = make_manager();

    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        cwd: None,
        env: None,
        rows: Some(24),
        cols: Some(80),
    };

    let id = manager.spawn(config, emitter.clone()).unwrap();
    std::thread::sleep(Duration::from_millis(500));

    // Rapid sequential writes
    for i in 0..10 {
        let cmd = BASE64.encode(format!("echo msg{i}\n").as_bytes());
        manager.write(&id, &cmd).unwrap();
    }

    // Wait for last message to appear in output
    let found = poll_until(Duration::from_secs(5), Duration::from_millis(100), || {
        let output = emitter.decoded_output_for(&id);
        output.contains("msg9")
    });

    assert!(found, "expected 'msg9' in output after rapid writes");
    manager.kill(&id).unwrap();
}

#[test]
fn resize_changes_columns() {
    let emitter = Arc::new(TestEventEmitter::new());
    let manager = make_manager();

    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        cwd: None,
        env: None,
        rows: Some(24),
        cols: Some(80),
    };

    let id = manager.spawn(config, emitter.clone()).unwrap();
    std::thread::sleep(Duration::from_millis(500));

    // Resize to 132 columns
    manager.resize(&id, 132, 40).unwrap();

    // Small delay for resize to take effect
    std::thread::sleep(Duration::from_millis(100));

    // Query terminal columns
    let cmd = BASE64.encode(b"tput cols\n");
    manager.write(&id, &cmd).unwrap();

    // Wait for "132" in output
    let found = poll_until(Duration::from_secs(5), Duration::from_millis(100), || {
        let output = emitter.decoded_output_for(&id);
        output.contains("132")
    });

    assert!(found, "expected '132' in output after resize");
    manager.kill(&id).unwrap();
}

#[test]
fn kill_during_running_process() {
    let emitter = Arc::new(TestEventEmitter::new());
    let manager = make_manager();

    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        cwd: None,
        env: None,
        rows: Some(24),
        cols: Some(80),
    };

    let id = manager.spawn(config, emitter.clone()).unwrap();
    std::thread::sleep(Duration::from_millis(500));

    // Start a long-running process
    let cmd = BASE64.encode(b"sleep 60\n");
    manager.write(&id, &cmd).unwrap();
    std::thread::sleep(Duration::from_millis(200));

    // Kill should succeed and clean up
    let result = manager.kill(&id);
    assert!(result.is_ok());

    // Verify exit event
    let found = poll_until(Duration::from_secs(3), Duration::from_millis(100), || {
        emitter.has_exit_event_for(&id)
    });
    assert!(found, "expected exit event after kill");
}

#[test]
fn shell_exit_triggers_cleanup() {
    let emitter = Arc::new(TestEventEmitter::new());
    let manager = make_manager();

    let config = PtyConfig {
        shell: Some("/bin/sh".to_string()),
        cwd: None,
        env: None,
        rows: Some(24),
        cols: Some(80),
    };

    let id = manager.spawn(config, emitter.clone()).unwrap();
    std::thread::sleep(Duration::from_millis(500));

    // Send exit command
    let cmd = BASE64.encode(b"exit\n");
    manager.write(&id, &cmd).unwrap();

    // Wait for exit event
    let found = poll_until(Duration::from_secs(5), Duration::from_millis(100), || {
        emitter.has_exit_event_for(&id)
    });

    assert!(found, "expected exit event after 'exit' command");
}

#[test]
fn concurrent_ptys_independent() {
    let emitter = Arc::new(TestEventEmitter::new());
    let manager = Arc::new(make_manager());

    // Spawn 5 PTYs
    let ids: Vec<String> = (0..5)
        .map(|_| {
            let config = PtyConfig {
                shell: Some("/bin/sh".to_string()),
                cwd: None,
                env: None,
                rows: Some(24),
                cols: Some(80),
            };
            manager.spawn(config, emitter.clone()).unwrap()
        })
        .collect();

    std::thread::sleep(Duration::from_millis(500));

    // Write unique data to each PTY
    for (i, id) in ids.iter().enumerate() {
        let cmd = BASE64.encode(format!("echo unique_{i}\n").as_bytes());
        manager.write(id, &cmd).unwrap();
    }

    // Verify each PTY received its unique output
    for (i, id) in ids.iter().enumerate() {
        let marker = format!("unique_{i}");
        let found = poll_until(Duration::from_secs(5), Duration::from_millis(100), || {
            let output = emitter.decoded_output_for(id);
            output.contains(&marker)
        });
        assert!(found, "PTY {i} should have received '{marker}'");
    }

    // Kill all PTYs
    for id in &ids {
        manager.kill(id).unwrap();
    }
}
