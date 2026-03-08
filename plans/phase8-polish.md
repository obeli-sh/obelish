# Phase 8: Polish — Theming, Font Customization, and Packaging

Phase 8 is split into two sub-phases as agreed in Round 2 (PM) and confirmed in Round 3 (Tech Lead):
- **Phase 8a**: Theming + Font Customization (UI work)
- **Phase 8b**: Packaging + Distribution (DevOps/CI work)

---

# Phase 8a: Theming + Font Customization

## 1. Objectives & Scope

Phase 8a makes Obelisk visually configurable: users can switch between dark/light/system themes, customize terminal font family and size, and persist these preferences across sessions.

**In scope:**
- Dark theme (default), light theme, system-follow mode
- CSS variable-based theme switching
- Terminal font family selection (from system fonts + bundled monospace fonts)
- Terminal font size adjustment
- Settings persistence in Rust (via existing `PersistenceBackend`)
- Settings Tauri commands and events
- Settings modal UI (minimal — font picker, theme switcher, font size slider)

**Out of scope:**
- Custom color schemes / per-terminal themes
- Plugin-based themes
- Non-terminal font customization (UI font is fixed)
- Import/export of settings

**Key consensus decisions applied:**
- CSS Modules + CSS Variables for theming (Frontend Round 1)
- No Tailwind (Frontend Round 1, unanimous)
- Rust owns persistence (all rounds, unanimous)
- Settings go through invoke() like all mutations (Round 2, Rust source of truth)
- Semantic HTML from day 1 (Frontend Round 3)

## 2. Rust Module Architecture

### Settings Module

```
src-tauri/src/settings/
├── mod.rs              # Re-exports
├── types.rs            # Settings struct, Theme enum, FontConfig struct
└── persistence.rs      # Load/save settings using PersistenceBackend
```

### Structs

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: Theme,
    pub terminal_font: FontConfig,
    pub scrollback_lines: u32,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontConfig {
    pub family: String,     // e.g. "JetBrains Mono"
    pub size: f32,          // e.g. 14.0
    pub line_height: f32,   // e.g. 1.2
    pub ligatures: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyle {
    Block,
    Underline,
    Bar,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            terminal_font: FontConfig {
                family: "JetBrains Mono".into(),
                size: 14.0,
                line_height: 1.2,
                ligatures: true,
            },
            scrollback_lines: 5000,
            cursor_style: CursorStyle::Block,
            cursor_blink: false,
        }
    }
}
```

### Tauri Commands

```rust
#[tauri::command]
#[tracing::instrument(skip(state))]
async fn settings_get(
    state: State<'_, AppState>,
) -> Result<AppSettings, BackendError>

#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn settings_update(
    state: State<'_, AppState>,
    app: AppHandle,
    settings: AppSettings,
) -> Result<(), BackendError>
// Side effects: persists to disk, emits "settings-changed" event

#[tauri::command]
async fn settings_reset(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSettings, BackendError>
// Resets to default, persists, emits event, returns new (default) settings
```

### Event

```rust
/// Emitted when settings change.
/// Event name: "settings-changed"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChangedPayload {
    pub settings: AppSettings,
}
```

### Settings Error

```rust
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("failed to load settings: {0}")]
    LoadFailed(#[source] PersistenceError),
    #[error("failed to save settings: {0}")]
    SaveFailed(#[source] PersistenceError),
    #[error("invalid font size: {0} (must be 6-72)")]
    InvalidFontSize(f32),
    #[error("invalid scrollback: {0} (must be 100-100000)")]
    InvalidScrollback(u32),
}
```

## 3. Implementation Steps — TDD Order

### Step 1: Settings types + defaults (TDD)

1. **Test**: `AppSettings::default()` returns expected values
2. **Test**: `AppSettings` serializes to JSON with camelCase keys
3. **Test**: `AppSettings` deserializes from JSON
4. **Test**: Roundtrip: serialize -> deserialize = identity (proptest)
5. **Test**: `Theme` enum serializes as lowercase strings
6. **Test**: `FontConfig` with min/max font sizes
7. **Implement**: All structs with derives and Default impl

### Step 2: Settings persistence (TDD)

1. **Test**: Save settings to `PersistenceBackend`, load returns same settings
2. **Test**: Load with no saved settings returns default
3. **Test**: Load with corrupted data returns default (graceful degradation)
4. **Test**: Save validates font size (6.0 - 72.0)
5. **Test**: Save validates scrollback lines (100 - 100000)
6. **Implement**: Settings persistence using existing `PersistenceBackend` trait

### Step 3: Tauri commands (TDD)

1. **Test**: `settings_get` returns current settings
2. **Test**: `settings_update` persists and emits `settings-changed` event
3. **Test**: `settings_update` with invalid font size returns error
4. **Test**: `settings_reset` returns defaults and emits event
5. **Test**: Settings loaded on app startup
6. **Implement**: Tauri command handlers

### Step 4: Frontend settings store (TDD)

1. **Test**: `settingsStore` initializes by calling `settings_get`
2. **Test**: `settingsStore` updates on `settings-changed` event
3. **Test**: `updateSettings` calls `invoke('settings_update', ...)`
4. **Test**: `resetSettings` calls `invoke('settings_reset', ...)`
5. **Implement**: `settingsStore` (Zustand, same pattern as `workspaceStore`)

### Step 5: Theme switching (TDD)

1. **Test**: `useTheme` hook sets `data-theme` attribute on `<html>`
2. **Test**: Theme "system" follows `prefers-color-scheme` media query
3. **Test**: Theme change persists across settings update
4. **Test**: System theme responds to OS preference change
5. **Implement**: `useTheme` hook that reads from `settingsStore` and sets DOM attribute

### Step 6: Font configuration (TDD)

1. **Test**: Font family change updates xterm.js `fontFamily` option
2. **Test**: Font size change updates xterm.js `fontSize` option and triggers `FitAddon.fit()`
3. **Test**: Line height change updates xterm.js `lineHeight` option
4. **Test**: Font change applies to all existing terminals
5. **Implement**: Font configuration propagation through `useTerminal` hook

### Step 7: Settings modal UI (TDD)

1. **Test**: Settings modal renders when open
2. **Test**: Theme selector shows current theme
3. **Test**: Theme selector calls `updateSettings` on change
4. **Test**: Font family input shows current font
5. **Test**: Font size slider shows current size, has min/max
6. **Test**: Reset button calls `resetSettings`
7. **Test**: Modal closes on Escape key or close button
8. **Implement**: `SettingsModal` component

### Step 8: Settings keyboard shortcut

1. **Test**: `Cmd/Ctrl+,` opens settings modal
2. **Implement**: Add to keyboard shortcut map from Phase 2/6

## 4. TDD Approach — Per Module

### `settings/types.rs`
- **Write failing test**: `assert_eq!(AppSettings::default().theme, Theme::Dark)`
- **Implement**: Struct with Default
- **Green**: Pass
- **Add property test**: Arbitrary settings roundtrip through serde

### `settings/persistence.rs`
- **Write failing test**: Save then load returns same struct
- **Implement**: Serialize to JSON, save via PersistenceBackend, load + deserialize
- **Green**: Pass
- **Add edge cases**: Corrupted file fallback, validation

### Frontend `settingsStore`
- **Write failing test**: `getState().settings` equals defaults after init
- **Implement**: Store with init that calls `settings_get`
- **Green**: Pass
- **Add event sync test**: Emit `settings-changed`, verify store updates

### Frontend `SettingsModal`
- **Write failing test**: `render(<SettingsModal isOpen={true} />)`, assert theme selector visible
- **Implement**: Component with form elements
- **Green**: Pass

## 5. Unit Tests — Complete List

### Rust: `settings/types.rs` (target: 100%)

```
  test_default_settings
  test_default_theme_is_dark
  test_default_font_family
  test_default_font_size
  test_default_scrollback
  test_serialize_camel_case
  test_deserialize_camel_case
  test_theme_serializes_lowercase
  test_cursor_style_serializes_lowercase
  proptest_settings_roundtrip
```

### Rust: `settings/persistence.rs` (target: 100%)

```
  test_save_and_load_roundtrip
  test_load_missing_returns_default
  test_load_corrupted_returns_default
  test_save_validates_font_size_min
  test_save_validates_font_size_max
  test_save_validates_scrollback_min
  test_save_validates_scrollback_max
  test_save_valid_edge_font_size_6
  test_save_valid_edge_font_size_72
```

### Rust: Tauri commands (target: 100%)

```
  test_settings_get_returns_current
  test_settings_update_persists
  test_settings_update_emits_event
  test_settings_update_invalid_font_size
  test_settings_update_invalid_scrollback
  test_settings_reset_returns_defaults
  test_settings_reset_persists_defaults
  test_settings_reset_emits_event
  test_settings_loaded_on_startup
```

### Frontend: `settingsStore` (target: 100%)

```
  test_initial_state_calls_settings_get
  test_update_settings_calls_invoke
  test_reset_settings_calls_invoke
  test_syncs_on_settings_changed_event
  test_selector_theme
  test_selector_font_config
```

### Frontend: `useTheme` hook (target: 100%)

```
  test_sets_data_theme_attribute_dark
  test_sets_data_theme_attribute_light
  test_system_follows_prefers_color_scheme
  test_system_responds_to_media_query_change
  test_removes_listener_on_unmount
```

### Frontend: `SettingsModal` component (target: 90%)

```
  test_renders_when_open
  test_hidden_when_closed
  test_displays_current_theme
  test_theme_select_triggers_update
  test_displays_current_font_family
  test_font_size_slider_shows_current
  test_font_size_slider_change_triggers_update
  test_reset_button_triggers_reset
  test_close_button_calls_onclose
  test_escape_key_closes_modal
  test_ligatures_toggle
  test_cursor_style_selector
  test_scrollback_input
```

### Frontend: Font propagation (target: 100%)

```
  test_font_family_applied_to_xterm_options
  test_font_size_applied_to_xterm_options
  test_font_change_triggers_fit_addon
  test_line_height_applied_to_xterm_options
```

## 6. Integration Tests

```
Rust:
  test_settings_lifecycle       # Load defaults -> update theme -> restart -> verify persisted
  test_settings_migration       # Old format settings file -> loads with defaults for new fields

Frontend:
  test_theme_switch_updates_css # Switch theme, verify CSS variables change
  test_font_change_updates_all_terminals # Change font, verify all xterm instances updated
  test_settings_persist_across_sessions  # (mocked) Update settings, simulate restart, verify loaded
```

## 7. E2E Tests

```
tests/e2e/settings.spec.ts:
  test("opening settings modal via Cmd+,")
  test("switching theme changes app appearance")
  test("changing font size updates terminal text size")
  test("settings persist after app restart")
  test("reset button restores defaults")
```

## 8. Acceptance Criteria — Phase 8a

1. **Dark theme** is the default and renders correctly on all platforms
2. **Light theme** is selectable and all UI elements switch colors
3. **System theme** follows OS dark/light mode preference and responds to changes
4. **Font family** can be changed and all terminals update immediately
5. **Font size** can be changed (6-72pt) and all terminals update + re-fit
6. **Settings persist** across app restarts
7. **Settings modal** opens with `Cmd/Ctrl+,` and closes with Escape
8. **Reset to defaults** works and persists
9. **Invalid settings** (e.g., font size 0) are rejected with validation error
10. **No visual regression** on existing themes (Playwright screenshots)

---

# Phase 8b: Packaging + Distribution

## 1. Objectives & Scope

Phase 8b produces distributable binaries for all three platforms and sets up the auto-update infrastructure.

**In scope:**
- macOS: `.dmg` with drag-to-Applications and code signing
- Windows: `.msi` installer and portable `.exe`
- Linux: `.deb` package, `.AppImage`, and `.rpm`
- CLI binary distribution (standalone, not bundled with the app)
- Auto-updater via `tauri-plugin-updater`
- CI/CD release pipeline (GitHub Actions + GitHub Releases)
- App icon generation for all platforms

**Out of scope:**
- Flatpak/Snap packaging (deferred)
- Mac App Store / Microsoft Store distribution
- Custom installer UI

**Key consensus decisions applied:**
- Tauri built-in packaging tools (Tech Lead Round 1)
- `just` for orchestration (Tech Lead Round 1, Backend Round 2)
- Pin critical dependency versions (Tech Lead Round 2)

## 2. Rust Module Architecture

No new Rust modules. Phase 8b is configuration and CI/CD pipeline work.

### Configuration Files

```
src-tauri/
├── tauri.conf.json          # Updated: bundle config, updater endpoint, icons
├── Cargo.toml               # Updated: enable tauri-plugin-updater
├── icons/                   # Generated app icons (all sizes)
│   ├── 32x32.png
│   ├── 128x128.png
│   ├── 128x128@2x.png
│   ├── icon.icns            # macOS
│   ├── icon.ico             # Windows
│   └── icon.png             # Linux
└── build.rs                 # Unchanged

cli/
├── Cargo.toml               # Updated: release profile optimizations
└── ...
```

### `tauri.conf.json` Updates

```json
{
  "bundle": {
    "active": true,
    "identifier": "com.obelisk.app",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "targets": ["deb", "rpm", "appimage", "dmg", "msi", "nsis"],
    "macOS": {
      "minimumSystemVersion": "10.15",
      "signingIdentity": null,
      "entitlements": null
    },
    "windows": {
      "certificateThumbprint": null,
      "digestAlgorithm": "sha256"
    }
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://releases.obelisk.dev/{{target}}/{{arch}}/{{current_version}}"
      ],
      "pubkey": "<RSA_PUBLIC_KEY>"
    }
  }
}
```

### CLI Release Profile

```toml
# cli/Cargo.toml
[profile.release]
lto = true
codegen-units = 1
strip = true
opt-level = "z"    # Optimize for size
```

## 3. Implementation Steps — TDD Order

### Step 1: App icons

1. Create source icon (1024x1024 PNG)
2. Generate all sizes using `tauri icon` CLI command
3. Verify icons appear correctly in built app (manual + E2E screenshot)

### Step 2: Bundle configuration

1. **Test**: `bun tauri build` produces `.dmg` on macOS
2. **Test**: `bun tauri build` produces `.msi` on Windows
3. **Test**: `bun tauri build` produces `.deb` and `.AppImage` on Linux
4. Update `tauri.conf.json` with correct bundle identifiers and targets
5. Verify built app launches and functions (E2E smoke test on built artifact)

### Step 3: CLI binary packaging

1. **Test**: `cargo build --release -p cli` produces optimized binary
2. **Test**: CLI binary size < 5 MB
3. **Test**: CLI binary runs correctly on target platform (smoke test)
4. Configure CI to produce CLI binaries as separate artifacts

### Step 4: Auto-updater (TDD)

1. **Test**: App checks for updates on startup (mock endpoint)
2. **Test**: Update available notification shown to user
3. **Test**: Update downloads and applies correctly (integration test with local server)
4. **Test**: No update available — silent (no user notification)
5. **Test**: Update endpoint unreachable — silent failure (app continues normally)
6. Enable `tauri-plugin-updater` in Tauri config
7. Implement update check on startup and periodic check (every 24 hours)
8. Implement update notification UI (simple dialog: "Update available. Install now?")

### Step 5: CI release pipeline

1. Create GitHub Actions workflow for release builds
2. Trigger on git tag push (`v*`)
3. Build on all 3 platforms
4. Upload artifacts to GitHub Releases
5. Generate update manifest for auto-updater

### Step 6: Code signing (platform-specific)

1. macOS: Configure `codesign` identity and notarization
2. Windows: Configure Authenticode code signing certificate
3. Linux: GPG sign `.deb` packages

### Step 7: Smoke tests on built artifacts

1. **Test**: macOS `.dmg` mounts, app inside launches, terminal works
2. **Test**: Windows `.msi` installs, app launches, terminal works
3. **Test**: Linux `.AppImage` runs, terminal works
4. **Test**: Linux `.deb` installs via `dpkg -i`, app launches
5. **Test**: CLI binary launches, connects to running app

## 4. TDD Approach

Phase 8b is primarily CI/CD and configuration work. TDD applies to:

### Auto-updater logic
- **Write failing test**: Mock update endpoint returns new version, verify `check_for_update()` returns `Some(update)`
- **Implement**: HTTP check against endpoint
- **Green**: Pass
- **Add edge cases**: Endpoint down, invalid response, same version

### Update notification UI
- **Write failing test**: `render(<UpdateDialog version="2.0.0" />)` shows dialog
- **Implement**: Dialog component
- **Green**: Pass

### Smoke tests are E2E, not unit testable. They run in CI on built artifacts.

## 5. Unit Tests

### Rust: Auto-updater (if custom logic beyond plugin)

```
  test_parse_update_response_new_version
  test_parse_update_response_same_version
  test_parse_update_response_invalid_json
  test_update_check_interval_default_24h
```

### Frontend: Update dialog

```
  test_update_dialog_shows_version
  test_update_dialog_install_button
  test_update_dialog_dismiss_button
  test_update_dialog_not_shown_when_no_update
```

## 6. Integration Tests

```
  test_build_produces_artifacts_linux    # CI only
  test_build_produces_artifacts_macos    # CI only
  test_build_produces_artifacts_windows  # CI only
  test_cli_binary_connects_to_built_app # Built app + built CLI communicate
```

## 7. E2E Tests

```
tests/e2e/packaging.spec.ts:
  test("built app launches and shows terminal")
  test("built app persists settings across restart")
  test("built app theme matches system preference")

tests/e2e/update.spec.ts:
  test("update dialog appears when update is available")  # mock endpoint
  test("no dialog when already on latest version")
```

## 8. Acceptance Criteria — Phase 8b

1. **macOS**: `.dmg` produced, drag-to-Applications works, app launches, terminal functional
2. **Windows**: `.msi` produced, installer runs, app appears in Start menu, launches, terminal functional
3. **Linux**: `.deb` installs via apt/dpkg, `.AppImage` runs without install, both produce working terminal
4. **CLI binary**: Standalone executable produced for each platform, runs independently, connects to app
5. **Auto-updater**: App checks for updates on launch, shows dialog when update available, downloads and applies update
6. **CI release pipeline**: Tag push triggers build on all 3 platforms, artifacts uploaded to GitHub Releases
7. **Binary sizes**: App installer < 30 MB, CLI binary < 5 MB
8. **No regressions**: Full E2E suite passes on all built artifacts
9. **Code signing**: macOS app passes Gatekeeper, Windows app has valid signature

## 9. Cross-Platform Verification — Phase 8b

### macOS
- `.dmg` mounts and shows drag-to-Applications layout
- App passes Gatekeeper (`spctl --assess --type exec`)
- App icon appears correctly in Dock and Finder
- Retina display (@2x) icons render correctly
- First launch shows "downloaded from internet" dialog only if unsigned

### Windows
- `.msi` installer completes without admin privileges (per-user install) or with admin (machine-wide)
- App appears in Add/Remove Programs
- Start menu shortcut created
- Taskbar icon renders correctly
- SmartScreen warning suppressed with valid code signing certificate
- Uninstaller removes all files

### Linux
- `.deb` installs with `dpkg -i obelisk.deb` and satisfies dependencies
- `.AppImage` runs on Ubuntu 20.04+ without install
- Desktop entry (`.desktop` file) appears in application launcher
- App icon appears in system tray / taskbar
- CLI binary runs from `/usr/local/bin/obelisk` after deb install

### All Platforms
- App icon renders at all sizes without artifacts
- Built app connects to built CLI binary over IPC
- Session persistence works in installed app (not just dev mode)
- Settings persist in platform-appropriate app data directory

## 10. Dependencies on Prior Phases

| Dependency | Phase | What's Needed |
|-----------|-------|---------------|
| All features functional | Phases 1-7 | Every feature must work before packaging |
| IPC server + CLI | Phase 7 | CLI binary is packaged alongside the app |
| Settings persistence | Phase 8a | Settings must persist in installed app context |
| Theming | Phase 8a | Theme must work correctly in packaged app |
| CI pipeline | Phase 1 | Existing CI extended with release jobs |

## 11. CI Release Pipeline Specification

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  build-tauri:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun tauri build --target ${{ matrix.target }}
      - uses: actions/upload-artifact@v4
        with:
          name: obelisk-${{ matrix.target }}
          path: |
            src-tauri/target/${{ matrix.target }}/release/bundle/**

  build-cli:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}
      - run: cargo build --release --target ${{ matrix.target }} -p cli
      - uses: actions/upload-artifact@v4
        with:
          name: obelisk-cli-${{ matrix.target }}
          path: cli/target/${{ matrix.target }}/release/obelisk*

  smoke-test:
    needs: [build-tauri, build-cli]
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/download-artifact@v4
      - name: Smoke test built app
        run: |
          # Platform-specific: launch app, verify it starts, run basic E2E
          bun run test:e2e:smoke

  publish:
    needs: [smoke-test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            obelisk-*/**
            obelisk-cli-*/**
          generate_release_notes: true

  update-manifest:
    needs: [publish]
    runs-on: ubuntu-latest
    steps:
      - name: Generate update manifest
        run: |
          # Generate JSON manifest for tauri-plugin-updater
          # Upload to releases.obelisk.dev
```

### Justfile Targets (Phase 8b additions)

```just
# Build release artifacts for current platform
release:
    bun tauri build

# Build CLI binary
release-cli:
    cargo build --release -p cli

# Run smoke tests on built artifacts
smoke-test:
    bun run test:e2e:smoke

# Generate app icons from source
icons:
    bun tauri icon src-tauri/icons/app-icon.png

# Check binary sizes
check-sizes:
    @echo "App bundle:" && du -sh src-tauri/target/release/bundle/
    @echo "CLI binary:" && du -sh cli/target/release/obelisk
```
