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
}

#[cfg(test)]
impl MockEventEmitter {
    pub fn new() -> Self {
        Self {
            events: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub fn events(&self) -> Vec<(String, serde_json::Value)> {
        self.events.lock().unwrap().clone()
    }
}

#[cfg(test)]
impl EventEmitter for MockEventEmitter {
    fn emit(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
        Ok(())
    }
}
