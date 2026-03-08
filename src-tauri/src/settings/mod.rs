pub mod manager;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyBinding {
    pub key: String,
    #[serde(rename = "mod")]
    pub mod_key: bool,
    pub shift: bool,
    pub alt: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub keybindings: HashMap<String, KeyBinding>,
    pub theme: String,
    pub terminal_font_family: String,
    pub terminal_font_size: u16,
    pub scrollback_lines: u32,
    #[serde(default)]
    pub default_shell: String,
}

impl Default for Settings {
    fn default() -> Self {
        let mut keybindings = HashMap::new();

        let bindings = [
            ("pane.splitHorizontal", "h", true, true, false),
            ("pane.splitVertical", "v", true, true, false),
            ("pane.close", "w", true, false, false),
            ("workspace.create", "n", true, false, false),
            ("app.commandPalette", "p", true, true, false),
            ("app.settings", ",", true, false, false),
            ("app.toggleNotifications", "i", true, false, false),
            ("app.toggleSidebar", "b", true, false, false),
            ("pane.openBrowser", "b", true, true, false),
            ("pane.focusUp", "ArrowUp", true, false, false),
            ("pane.focusDown", "ArrowDown", true, false, false),
            ("pane.focusLeft", "ArrowLeft", true, false, false),
            ("pane.focusRight", "ArrowRight", true, false, false),
        ];

        for (name, key, mod_key, shift, alt) in bindings {
            keybindings.insert(
                name.to_string(),
                KeyBinding {
                    key: key.to_string(),
                    mod_key,
                    shift,
                    alt,
                },
            );
        }

        for i in 1..=9 {
            keybindings.insert(
                format!("workspace.switch{i}"),
                KeyBinding {
                    key: i.to_string(),
                    mod_key: true,
                    shift: false,
                    alt: false,
                },
            );
        }

        Self {
            keybindings,
            theme: "dark".to_string(),
            terminal_font_family: "monospace".to_string(),
            terminal_font_size: 14,
            scrollback_lines: 10000,
            default_shell: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_has_all_keybindings() {
        let settings = Settings::default();
        // 13 named bindings + 9 workspace.switch = 22
        assert_eq!(settings.keybindings.len(), 22);
    }

    #[test]
    fn default_settings_has_expected_theme() {
        let settings = Settings::default();
        assert_eq!(settings.theme, "dark");
    }

    #[test]
    fn default_settings_has_expected_font() {
        let settings = Settings::default();
        assert_eq!(settings.terminal_font_family, "monospace");
        assert_eq!(settings.terminal_font_size, 14);
    }

    #[test]
    fn default_settings_has_expected_scrollback() {
        let settings = Settings::default();
        assert_eq!(settings.scrollback_lines, 10000);
    }

    #[test]
    fn default_settings_has_empty_default_shell() {
        let settings = Settings::default();
        assert_eq!(settings.default_shell, "");
    }

    #[test]
    fn default_keybinding_split_horizontal() {
        let settings = Settings::default();
        let kb = settings.keybindings.get("pane.splitHorizontal").unwrap();
        assert_eq!(kb.key, "h");
        assert!(kb.mod_key);
        assert!(kb.shift);
        assert!(!kb.alt);
    }

    #[test]
    fn default_keybinding_workspace_switch() {
        let settings = Settings::default();
        for i in 1..=9 {
            let kb = settings
                .keybindings
                .get(&format!("workspace.switch{i}"))
                .unwrap();
            assert_eq!(kb.key, i.to_string());
            assert!(kb.mod_key);
            assert!(!kb.shift);
            assert!(!kb.alt);
        }
    }

    #[test]
    fn settings_serialization_roundtrip() {
        let settings = Settings::default();
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(settings, deserialized);
    }

    #[test]
    fn keybinding_serialization_roundtrip() {
        let kb = KeyBinding {
            key: "h".to_string(),
            mod_key: true,
            shift: true,
            alt: false,
        };
        let json = serde_json::to_string(&kb).unwrap();
        let deserialized: KeyBinding = serde_json::from_str(&json).unwrap();
        assert_eq!(kb, deserialized);
    }

    #[test]
    fn keybinding_serializes_mod_key_as_mod() {
        let kb = KeyBinding {
            key: "h".to_string(),
            mod_key: true,
            shift: false,
            alt: false,
        };
        let json = serde_json::to_string(&kb).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("mod").is_some());
        assert!(parsed.get("mod_key").is_none());
        assert!(parsed.get("modKey").is_none());
    }

    #[test]
    fn settings_serializes_camel_case() {
        let settings = Settings::default();
        let json = serde_json::to_string(&settings).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("terminalFontFamily").is_some());
        assert!(parsed.get("terminalFontSize").is_some());
        assert!(parsed.get("scrollbackLines").is_some());
        assert!(parsed.get("defaultShell").is_some());
        assert!(parsed.get("terminal_font_family").is_none());
        assert!(parsed.get("default_shell").is_none());
    }
}
