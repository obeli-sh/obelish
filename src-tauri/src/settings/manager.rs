use std::sync::{Arc, RwLock};

use crate::error::PersistenceError;
use crate::persistence::PersistenceBackend;
use crate::settings::Settings;

const SETTINGS_KEY: &str = "settings";

pub struct SettingsManager {
    backend: Arc<dyn PersistenceBackend>,
    cache: RwLock<Settings>,
}

impl SettingsManager {
    pub fn new(backend: Arc<dyn PersistenceBackend>) -> Self {
        let cached = match backend.load(SETTINGS_KEY) {
            Ok(Some(data)) => serde_json::from_slice(&data).unwrap_or_default(),
            _ => Settings::default(),
        };
        Self {
            backend,
            cache: RwLock::new(cached),
        }
    }

    pub fn get(&self) -> Settings {
        self.cache
            .read()
            .expect("settings cache lock poisoned")
            .clone()
    }

    pub fn update(&self, key: &str, value: serde_json::Value) -> Result<(), PersistenceError> {
        let snapshot = {
            let mut settings = self.cache.write().expect("settings cache lock poisoned");
            apply_dotted_key(&mut settings, key, value)?;
            settings.clone()
        };
        self.persist(&snapshot)
    }

    pub fn reset(&self) -> Result<(), PersistenceError> {
        let snapshot = {
            let mut settings = self.cache.write().expect("settings cache lock poisoned");
            *settings = Settings::default();
            settings.clone()
        };
        self.persist(&snapshot)
    }

    fn persist(&self, settings: &Settings) -> Result<(), PersistenceError> {
        let data = serde_json::to_vec_pretty(settings)?;
        self.backend.save(SETTINGS_KEY, &data)?;
        Ok(())
    }
}

fn apply_dotted_key(
    settings: &mut Settings,
    key: &str,
    value: serde_json::Value,
) -> Result<(), PersistenceError> {
    match key {
        "theme" => {
            settings.theme =
                serde_json::from_value(value).map_err(|e| PersistenceError::Corrupted {
                    reason: format!("invalid value for theme: {e}"),
                })?;
        }
        "terminalFontFamily" => {
            settings.terminal_font_family =
                serde_json::from_value(value).map_err(|e| PersistenceError::Corrupted {
                    reason: format!("invalid value for terminalFontFamily: {e}"),
                })?;
        }
        "terminalFontSize" => {
            settings.terminal_font_size =
                serde_json::from_value(value).map_err(|e| PersistenceError::Corrupted {
                    reason: format!("invalid value for terminalFontSize: {e}"),
                })?;
        }
        "scrollbackLines" => {
            settings.scrollback_lines =
                serde_json::from_value(value).map_err(|e| PersistenceError::Corrupted {
                    reason: format!("invalid value for scrollbackLines: {e}"),
                })?;
        }
        "defaultShell" => {
            settings.default_shell =
                serde_json::from_value(value).map_err(|e| PersistenceError::Corrupted {
                    reason: format!("invalid value for defaultShell: {e}"),
                })?;
        }
        _ if key.starts_with("keybindings.") => {
            let binding_name = &key["keybindings.".len()..];
            let kb = serde_json::from_value(value).map_err(|e| PersistenceError::Corrupted {
                reason: format!("invalid keybinding value for {binding_name}: {e}"),
            })?;
            settings.keybindings.insert(binding_name.to_string(), kb);
        }
        _ => {
            return Err(PersistenceError::Corrupted {
                reason: format!("unknown settings key: {key}"),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::fs::FsPersistence;
    use crate::settings::KeyBinding;
    use tempfile::TempDir;

    fn setup() -> (TempDir, SettingsManager) {
        let dir = TempDir::new().unwrap();
        let backend = Arc::new(FsPersistence::new(dir.path()).unwrap());
        let manager = SettingsManager::new(backend);
        (dir, manager)
    }

    #[test]
    fn get_returns_defaults_when_no_saved_file() {
        let (_dir, manager) = setup();
        let settings = manager.get();
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn update_persists_theme_change() {
        let (_dir, manager) = setup();
        manager.update("theme", serde_json::json!("dark")).unwrap();
        let settings = manager.get();
        assert_eq!(settings.theme, "dark");
    }

    #[test]
    fn update_persists_font_family() {
        let (_dir, manager) = setup();
        manager
            .update("terminalFontFamily", serde_json::json!("JetBrains Mono"))
            .unwrap();
        let settings = manager.get();
        assert_eq!(settings.terminal_font_family, "JetBrains Mono");
    }

    #[test]
    fn update_persists_font_size() {
        let (_dir, manager) = setup();
        manager
            .update("terminalFontSize", serde_json::json!(16))
            .unwrap();
        let settings = manager.get();
        assert_eq!(settings.terminal_font_size, 16);
    }

    #[test]
    fn update_persists_scrollback_lines() {
        let (_dir, manager) = setup();
        manager
            .update("scrollbackLines", serde_json::json!(5000))
            .unwrap();
        let settings = manager.get();
        assert_eq!(settings.scrollback_lines, 5000);
    }

    #[test]
    fn update_persists_keybinding_change() {
        let (_dir, manager) = setup();
        let new_kb = serde_json::json!({
            "key": "d",
            "mod": true,
            "shift": false,
            "alt": true,
        });
        manager
            .update("keybindings.pane.splitHorizontal", new_kb)
            .unwrap();
        let settings = manager.get();
        let kb = settings.keybindings.get("pane.splitHorizontal").unwrap();
        assert_eq!(kb.key, "d");
        assert!(kb.mod_key);
        assert!(!kb.shift);
        assert!(kb.alt);
    }

    #[test]
    fn update_with_dotted_key_path_works() {
        let (_dir, manager) = setup();
        let new_kb = serde_json::json!({
            "key": "x",
            "mod": false,
            "shift": true,
            "alt": false,
        });
        manager
            .update("keybindings.app.commandPalette", new_kb)
            .unwrap();
        let settings = manager.get();
        let kb = settings.keybindings.get("app.commandPalette").unwrap();
        assert_eq!(kb.key, "x");
        assert!(!kb.mod_key);
        assert!(kb.shift);
    }

    #[test]
    fn reset_restores_defaults() {
        let (_dir, manager) = setup();
        manager.update("theme", serde_json::json!("dark")).unwrap();
        assert_eq!(manager.get().theme, "dark");

        manager.reset().unwrap();
        assert_eq!(manager.get(), Settings::default());
    }

    #[test]
    fn get_after_update_returns_updated_value() {
        let (_dir, manager) = setup();
        manager.update("theme", serde_json::json!("light")).unwrap();
        let settings = manager.get();
        assert_eq!(settings.theme, "light");
    }

    #[test]
    fn full_lifecycle_defaults_update_get_reset_get() {
        let (_dir, manager) = setup();

        // Starts with defaults
        let defaults = manager.get();
        assert_eq!(defaults.theme, "dark");

        // Update theme
        manager.update("theme", serde_json::json!("dark")).unwrap();
        assert_eq!(manager.get().theme, "dark");

        // Update font size
        manager
            .update("terminalFontSize", serde_json::json!(18))
            .unwrap();
        assert_eq!(manager.get().terminal_font_size, 18);

        // Update a keybinding
        let new_kb = serde_json::json!({
            "key": "z",
            "mod": true,
            "shift": false,
            "alt": false,
        });
        manager.update("keybindings.pane.close", new_kb).unwrap();
        assert_eq!(
            manager.get().keybindings.get("pane.close").unwrap().key,
            "z"
        );

        // Reset restores everything
        manager.reset().unwrap();
        let restored = manager.get();
        assert_eq!(restored, Settings::default());
    }

    #[test]
    fn update_persists_to_disk_and_survives_reload() {
        let dir = TempDir::new().unwrap();
        let backend = Arc::new(FsPersistence::new(dir.path()).unwrap());

        // First manager instance: update settings
        {
            let manager = SettingsManager::new(backend.clone());
            manager.update("theme", serde_json::json!("dark")).unwrap();
        }

        // Second manager instance: should load persisted settings
        {
            let manager = SettingsManager::new(backend);
            assert_eq!(manager.get().theme, "dark");
        }
    }

    #[test]
    fn reset_persists_to_disk_and_survives_reload() {
        let dir = TempDir::new().unwrap();
        let backend = Arc::new(FsPersistence::new(dir.path()).unwrap());

        // First manager: update then reset
        {
            let manager = SettingsManager::new(backend.clone());
            manager.update("theme", serde_json::json!("dark")).unwrap();
            manager.reset().unwrap();
        }

        // Second manager: should load defaults
        {
            let manager = SettingsManager::new(backend);
            assert_eq!(manager.get(), Settings::default());
        }
    }

    #[test]
    fn update_unknown_key_returns_error() {
        let (_dir, manager) = setup();
        let result = manager.update("nonexistent.key", serde_json::json!("value"));
        assert!(result.is_err());
    }

    #[test]
    fn update_invalid_type_returns_error() {
        let (_dir, manager) = setup();
        // terminalFontSize expects u16, not string
        let result = manager.update("terminalFontSize", serde_json::json!("not a number"));
        assert!(result.is_err());
    }

    #[test]
    fn settings_serialization_roundtrip_via_backend() {
        let (_dir, manager) = setup();
        let original = manager.get();
        let json = serde_json::to_vec_pretty(&original).unwrap();
        let deserialized: Settings = serde_json::from_slice(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    // --- Fault injection tests ---

    #[test]
    fn update_theme_with_integer_returns_error() {
        let (_dir, manager) = setup();
        // theme expects a string, passing an integer should fail
        let result = manager.update("theme", serde_json::json!(42));
        assert!(result.is_err());
        // Verify the settings were NOT changed (still default)
        assert_eq!(manager.get().theme, Settings::default().theme);
    }

    #[test]
    fn update_theme_with_null_returns_error() {
        let (_dir, manager) = setup();
        let result = manager.update("theme", serde_json::json!(null));
        assert!(result.is_err());
        assert_eq!(manager.get().theme, Settings::default().theme);
    }

    #[test]
    fn update_unknown_dotted_key_returns_error() {
        let (_dir, manager) = setup();
        let result = manager.update("nonexistent.key", serde_json::json!("x"));
        assert!(result.is_err());
    }

    #[test]
    fn update_unknown_simple_key_returns_error() {
        let (_dir, manager) = setup();
        let result = manager.update("doesNotExist", serde_json::json!("value"));
        assert!(result.is_err());
    }

    #[test]
    fn reset_restores_all_changed_settings_to_defaults() {
        let (_dir, manager) = setup();
        let defaults = Settings::default();

        // Change multiple settings
        manager.update("theme", serde_json::json!("light")).unwrap();
        manager
            .update("terminalFontFamily", serde_json::json!("Fira Code"))
            .unwrap();
        manager
            .update("terminalFontSize", serde_json::json!(20))
            .unwrap();
        manager
            .update("scrollbackLines", serde_json::json!(5000))
            .unwrap();
        manager
            .update("defaultShell", serde_json::json!("/bin/zsh"))
            .unwrap();
        let kb = serde_json::json!({"key": "x", "mod": true, "shift": true, "alt": true});
        manager.update("keybindings.pane.close", kb).unwrap();

        // Verify everything changed
        let changed = manager.get();
        assert_ne!(changed.theme, defaults.theme);
        assert_ne!(changed.terminal_font_family, defaults.terminal_font_family);
        assert_ne!(changed.terminal_font_size, defaults.terminal_font_size);
        assert_ne!(changed.scrollback_lines, defaults.scrollback_lines);

        // Reset
        manager.reset().unwrap();

        // Verify ALL settings restored to defaults
        let restored = manager.get();
        assert_eq!(restored, defaults);
    }

    #[test]
    fn persistence_roundtrip_multiple_settings() {
        let dir = TempDir::new().unwrap();
        let backend = Arc::new(FsPersistence::new(dir.path()).unwrap());

        // First manager: change many settings
        {
            let manager = SettingsManager::new(backend.clone());
            manager.update("theme", serde_json::json!("light")).unwrap();
            manager
                .update("terminalFontFamily", serde_json::json!("Monospace"))
                .unwrap();
            manager
                .update("terminalFontSize", serde_json::json!(18))
                .unwrap();
            manager
                .update("scrollbackLines", serde_json::json!(8000))
                .unwrap();
        }

        // Second manager: verify all persisted settings loaded correctly
        {
            let manager = SettingsManager::new(backend);
            let settings = manager.get();
            assert_eq!(settings.theme, "light");
            assert_eq!(settings.terminal_font_family, "Monospace");
            assert_eq!(settings.terminal_font_size, 18);
            assert_eq!(settings.scrollback_lines, 8000);
        }
    }

    /// A mock backend that fails on save (simulates disk errors).
    struct FailingBackend;

    impl PersistenceBackend for FailingBackend {
        fn save(&self, _key: &str, _data: &[u8]) -> Result<(), crate::error::PersistenceError> {
            Err(crate::error::PersistenceError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "disk error",
            )))
        }
        fn load(&self, _key: &str) -> Result<Option<Vec<u8>>, crate::error::PersistenceError> {
            Ok(None)
        }
        fn delete(&self, _key: &str) -> Result<(), crate::error::PersistenceError> {
            Ok(())
        }
    }

    #[test]
    fn update_with_failing_backend_returns_error() {
        let backend = Arc::new(FailingBackend);
        let manager = SettingsManager::new(backend);

        let result = manager.update("theme", serde_json::json!("dark"));
        assert!(result.is_err());
    }

    #[test]
    fn reset_with_failing_backend_returns_error() {
        let backend = Arc::new(FailingBackend);
        let manager = SettingsManager::new(backend);

        let result = manager.reset();
        assert!(result.is_err());
    }

    #[test]
    fn keybinding_serialization_roundtrip_via_json() {
        let kb = KeyBinding {
            key: "p".to_string(),
            mod_key: true,
            shift: true,
            alt: false,
        };
        let json = serde_json::to_string(&kb).unwrap();
        let deserialized: KeyBinding = serde_json::from_str(&json).unwrap();
        assert_eq!(kb, deserialized);
    }
}
