pub trait EventEmitter: Send + Sync {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<(), String>;
}

pub struct TauriEventEmitter {
    app_handle: tauri::AppHandle,
}

impl TauriEventEmitter {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl EventEmitter for TauriEventEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        use tauri::Emitter;
        self.app_handle
            .emit(event, payload)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
pub struct MockEventEmitter {
    events: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
    condvar: std::sync::Condvar,
}

#[cfg(test)]
impl MockEventEmitter {
    pub fn new() -> Self {
        Self {
            events: std::sync::Mutex::new(Vec::new()),
            condvar: std::sync::Condvar::new(),
        }
    }

    pub fn events(&self) -> Vec<(String, serde_json::Value)> {
        self.events.lock().unwrap().clone()
    }

    /// Wait for an event whose name starts with `prefix`, with a timeout.
    /// Returns `true` if the event was found, `false` on timeout.
    pub fn wait_for_event(&self, prefix: &str, timeout: std::time::Duration) -> bool {
        let guard = self.events.lock().unwrap();
        let result = self
            .condvar
            .wait_timeout_while(guard, timeout, |events| {
                !events.iter().any(|(name, _)| name.starts_with(prefix))
            })
            .unwrap();
        !result.1.timed_out()
    }
}

#[cfg(test)]
impl EventEmitter for MockEventEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
        self.condvar.notify_all();
        Ok(())
    }
}
