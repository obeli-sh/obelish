# Phase 3: Session Persistence + Metadata

## Phase 3a: Layout Persistence

### 1. Objectives & Scope

Provide reliable session persistence so that users can close Obelisk and reopen it to find their workspace layout fully restored. This is the final component of the MVP (Phases 1-3a).

**In scope:**
- Save full workspace state (workspaces, surfaces, panes, layout trees, working directories) to JSON on disk
- Restore state on app launch
- Periodic autosave every 30 seconds
- Crash recovery (detect unclean shutdown, restore from last save)
- Atomic file writes to prevent corruption
- Graceful fallback to default state on corrupted data

**Out of scope (deferred to Phase 3b):**
- Scrollback serialization
- Git info display
- Port scanning display

### 2. Technical Architecture

#### Data Flow: Save
```
Structural mutation (split, close, create, etc.)
  -> Rust WorkspaceState updates
  -> Emit workspace-changed event to frontend
  -> Trigger debounced autosave (30s timer resets on each mutation)
  -> PersistenceBackend.save("workspace_state", serialized_json)
  -> Atomic write: temp file -> fsync -> rename
```

#### Data Flow: Restore
```
App startup
  -> Check for clean shutdown marker
  -> If unclean shutdown: log warning, proceed with restore anyway
  -> PersistenceBackend.load("workspace_state")
  -> If valid JSON: deserialize into WorkspaceState
  -> If corrupted/missing: fall back to default (one workspace, one terminal)
  -> For each pane in restored state: spawn PTY with saved cwd
  -> Emit initial workspace-changed events to frontend
  -> Frontend rebuilds layout from received state
```

#### Data Flow: Autosave
```
30-second timer (tokio::time::interval)
  -> If state has changed since last save (dirty flag)
  -> PersistenceBackend.save("workspace_state", serialized_json)
  -> Reset dirty flag
  -> On app close (tauri::RunEvent::ExitRequested): force save regardless of dirty flag
```

#### File Layout
```
{tauri_app_data_dir}/
├── workspace_state.json      # Current workspace state
├── workspace_state.json.bak  # Previous good save (kept as backup)
└── .shutdown_clean            # Marker file written on clean shutdown, deleted on start
```

### 3. Implementation Steps

1. **Define `PersistenceBackend` trait** with `save`, `load`, `delete` methods
2. **Implement `FsPersistence`** (real filesystem) with atomic writes
3. **Implement workspace state serialization** — add `Serialize`/`Deserialize` to all workspace types with `#[serde(rename_all = "camelCase")]`
4. **Implement save logic** — debounced save triggered by state changes + periodic 30s autosave
5. **Implement restore logic** — load JSON on startup, spawn PTYs for each restored pane
6. **Add crash recovery** — write/check `.shutdown_clean` marker, log unclean shutdown
7. **Add backup rotation** — copy current to `.bak` before overwriting
8. **Add `session_save` Tauri command** — manual save trigger from frontend
9. **Add `session_restore` Tauri command** — returns restored workspace state
10. **Wire up Tauri lifecycle** — save on `ExitRequested`, restore on app setup
11. **Frontend: restore flow** — on app mount, call `session_restore()`, populate `workspaceStore`

### 4. TDD Approach

#### Test-First Sequence (Rust)

**Step 1: Persistence trait + FsPersistence**
```
test: save_writes_file_to_disk
test: load_reads_file_from_disk
test: load_returns_none_for_missing_file
test: save_is_atomic_no_partial_writes
test: save_creates_backup_file
test: concurrent_save_load_no_corruption
-> implement FsPersistence
```

**Step 2: Workspace serialization**
```
test: workspace_state_serializes_to_json
test: workspace_state_deserializes_from_json
test: roundtrip_serialize_deserialize_identity
test: deserialize_corrupted_json_returns_error
test: deserialize_empty_json_returns_error
test: deserialize_missing_fields_returns_error
-> implement Serialize/Deserialize on workspace types
```

**Step 3: Save logic**
```
test: state_change_sets_dirty_flag
test: autosave_triggers_after_interval_when_dirty
test: autosave_skips_when_not_dirty
test: force_save_on_exit_requested
test: debounced_save_resets_timer_on_new_change
-> implement autosave logic
```

**Step 4: Restore logic**
```
test: restore_loads_state_and_spawns_ptys
test: restore_with_corrupted_file_falls_back_to_default
test: restore_with_missing_file_creates_default_workspace
test: restore_with_invalid_cwd_uses_home_dir
test: restore_detects_unclean_shutdown
-> implement restore logic
```

#### Test-First Sequence (Frontend)

**Step 1: Restore flow**
```
test: app_calls_session_restore_on_mount
test: app_populates_workspace_store_from_restore_response
test: app_creates_default_workspace_if_restore_returns_empty
test: app_shows_error_toast_if_restore_fails
-> implement App restore logic
```

### 5. Unit Tests

#### Rust — `persistence.rs` (11 tests)
| Test | Description |
|------|-------------|
| `save_writes_file_to_disk` | FsPersistence.save creates file with correct contents |
| `load_reads_file_from_disk` | FsPersistence.load reads and returns correct bytes |
| `load_returns_none_for_missing_file` | FsPersistence.load returns None if file doesn't exist |
| `save_is_atomic` | Kill process mid-save (simulate via tmp file check) -> no corruption |
| `save_creates_backup` | After save, `.bak` file exists with previous content |
| `delete_removes_file` | FsPersistence.delete removes file |
| `save_handles_readonly_dir` | Save to readonly dir returns error |
| `save_handles_full_disk` | Save with no disk space returns error (simulated) |
| `concurrent_save_load` | Multiple threads saving/loading simultaneously -> no panic |
| `atomic_write_no_tmp_residue` | After successful save, no `.tmp` file remains |
| `atomic_write_tmp_remains_on_failure` | If rename fails, `.tmp` file is still present for recovery |

#### Rust — Workspace Serialization (8 tests)
| Test | Description |
|------|-------------|
| `serialize_single_workspace` | One workspace, one surface, one pane -> valid JSON |
| `serialize_complex_layout` | Nested splits -> correct layout tree JSON |
| `deserialize_single_workspace` | Valid JSON -> correct WorkspaceState |
| `roundtrip_identity` | serialize -> deserialize -> equals original |
| `deserialize_corrupted` | Garbage bytes -> PersistenceError::Corrupted |
| `deserialize_missing_field` | JSON missing required field -> error |
| `deserialize_extra_fields_ignored` | JSON with unknown fields -> still parses (forward compat) |
| `serialize_empty_workspaces` | Empty workspace list -> valid JSON (not null) |

#### Rust — Autosave Logic (7 tests)
| Test | Description |
|------|-------------|
| `dirty_flag_set_on_mutation` | Workspace mutation sets dirty flag |
| `autosave_fires_when_dirty` | After interval, save is called if dirty |
| `autosave_skips_when_clean` | After interval, save is NOT called if not dirty |
| `force_save_ignores_dirty` | session_save always saves regardless of dirty flag |
| `debounce_resets_timer` | Rapid mutations reset the 30s timer |
| `exit_triggers_save` | ExitRequested event triggers immediate save |
| `autosave_interval_configurable` | Different interval -> save triggers accordingly |

#### Rust — Restore Logic (7 tests)
| Test | Description |
|------|-------------|
| `restore_valid_state` | Valid JSON -> correct WorkspaceState restored |
| `restore_corrupted_falls_back` | Corrupted file -> default workspace created |
| `restore_missing_falls_back` | No file -> default workspace created |
| `restore_spawns_ptys` | Each pane in restored state gets a PTY spawned |
| `restore_invalid_cwd_fallback` | Pane with deleted cwd -> uses home directory |
| `restore_detects_unclean_shutdown` | Missing `.shutdown_clean` -> logs warning |
| `restore_writes_clean_marker` | On shutdown, `.shutdown_clean` is written |

#### Frontend (4 tests)
| Test | Description |
|------|-------------|
| `calls_session_restore_on_mount` | App component calls invoke('session_restore') on mount |
| `populates_store_from_restore` | Restore response populates workspaceStore |
| `creates_default_on_empty_restore` | Empty restore response triggers workspace_create |
| `shows_error_on_restore_failure` | Restore invoke error shows toast |

### 6. Integration Tests

| Test | Description | Platform |
|------|-------------|----------|
| `save_restore_roundtrip` | Create workspace, split panes, save, clear state, restore -> layout matches | All |
| `crash_recovery_scenario` | Save state, DON'T write clean marker, restart -> restores from save | All |
| `corrupted_file_recovery` | Write garbage to state file, start app -> default workspace created | All |
| `concurrent_modifications_during_save` | Modify state while autosave is in progress -> no corruption | All |
| `path_separator_persistence` | Save workspace with platform path, restore -> paths correct | All |
| `large_state_save_performance` | 20 workspaces, 100 panes -> save completes in <50ms | Linux (bench) |

### 7. E2E Tests

| Test | Description |
|------|-------------|
| `close_and_reopen_restores_layout` | Create 2 workspaces, split panes, close app, reopen -> layout matches |
| `crash_and_reopen_restores` | Create workspace, force-kill app, reopen -> layout restored from autosave |
| `corrupted_state_starts_fresh` | Corrupt state file manually, open app -> default workspace shown |
| `multiple_sessions_no_conflict` | Open two app instances -> each has its own state file |

### 8. Acceptance Criteria

1. Closing the app and reopening restores the exact layout (workspaces, surfaces, panes, split directions and sizes)
2. Working directories are preserved per-pane (new PTY spawns in the same directory)
3. Autosave happens every 30 seconds when state has changed
4. Force-killing the app and reopening restores from the last autosave
5. Corrupted state file results in a fresh default workspace, not a crash
6. Save completes in <50ms for a typical workspace (10 panes)
7. All tests pass on Linux, macOS, and Windows
8. Coverage: 100% on `persistence.rs`, 100% on serialization code

### 9. Performance Budgets

| Metric | Target |
|--------|--------|
| Workspace state serialization | <1ms for 20-pane workspace |
| Atomic file write (including fsync) | <50ms |
| State restore (deserialize + PTY spawn) | <2s for 10 panes |
| Autosave overhead | <1% CPU during 30s interval |
| State file size | <100KB for typical workspace (10 panes) |

### 10. Dependencies on Prior Phases

- **Phase 1**: PTY spawn/kill (needed to respawn PTYs on restore)
- **Phase 2**: Workspace state model (the data structures being serialized), workspace-changed event (triggers autosave dirty flag)

---

## Phase 3b: Metadata + Scrollback

### 1. Objectives & Scope

Enhance the terminal multiplexer with contextual metadata (git info, port scanning) displayed in the sidebar, and scrollback persistence so terminal history survives restarts.

**In scope:**
- Scrollback serialization via xterm.js SerializeAddon -> stored per-pane by Rust
- Git branch, dirty status, ahead/behind detection per pane working directory
- Listening port detection per pane
- Sidebar metadata display (git info + ports below each workspace/pane entry)
- Git info polling every 3-5 seconds

**Out of scope:**
- Filesystem watching for git changes (polling is sufficient for now)
- Port-to-process name resolution on all platforms (best-effort)

### 2. Technical Architecture

#### Scrollback Data Flow
```
App close (or periodic save)
  -> Frontend: for each visible terminal, call SerializeAddon.serialize()
  -> Frontend: invoke('scrollback_save', { paneId, data: serializedBase64 })
  -> Rust: compress (zstd) and write to {app_data}/scrollback/{pane_id}.zst
  -> On restore: Rust reads + decompresses -> sends to frontend via event
  -> Frontend: terminal.write(deserializedData) to restore scrollback
```

#### Git Info Data Flow
```
Per workspace (tokio::spawn):
  -> Poll every 3-5 seconds
  -> For each pane's working directory:
    -> Run: git rev-parse --abbrev-ref HEAD
    -> Run: git status --porcelain
    -> Run: git rev-list --count HEAD..@{upstream} (ahead/behind)
  -> If result changed from previous poll:
    -> Emit git-info-{pane_id} event
  -> Frontend: useTauriEvent subscribes, updates sidebar
```

#### Port Scanning Data Flow
```
Per workspace (tokio::spawn):
  -> Poll every 5 seconds
  -> Platform-specific:
    -> Linux: parse /proc/net/tcp
    -> macOS: lsof -iTCP -sTCP:LISTEN -nP
    -> Windows: netstat -ano
  -> If result changed from previous poll:
    -> Emit ports-changed-{pane_id} event
  -> Frontend: useTauriEvent subscribes, updates sidebar
```

### 3. Implementation Steps

1. **Add zstd compression** — `zstd` crate dependency for scrollback compression
2. **Add scrollback storage** — `scrollback_save` and `scrollback_load` Tauri commands
3. **Frontend: serialize scrollback on save** — call SerializeAddon in save flow
4. **Frontend: restore scrollback on load** — write deserialized data to terminal
5. **Implement `CommandRunner` trait** — abstraction for running external commands (git, lsof, netstat)
6. **Implement git info polling** — per-workspace async task with 3-5s interval
7. **Implement port scanning** — per-workspace async task with 5s interval, platform-specific
8. **Add git-info and ports-changed events** — emit on change only (diff previous result)
9. **Frontend: `useGitInfo` hook** — subscribes to git-info-{paneId} events
10. **Frontend: `usePortScanner` hook** — subscribes to ports-changed-{paneId} events
11. **Frontend: sidebar metadata display** — show branch/dirty badge + port list under each workspace item

### 4. TDD Approach

#### Scrollback Tests (Rust)
```
test: scrollback_save_creates_compressed_file
test: scrollback_load_decompresses_correctly
test: scrollback_roundtrip_identity
test: scrollback_load_missing_returns_none
test: scrollback_save_large_buffer (1MB)
test: scrollback_cleanup_on_pane_close
-> implement scrollback storage
```

#### Git Info Tests (Rust)
```
test: parse_git_branch_output
test: parse_git_status_porcelain
test: parse_git_rev_list_ahead_behind
test: git_info_in_non_git_dir_returns_none
test: git_info_emits_event_on_change
test: git_info_no_emit_when_unchanged
test: git_info_handles_detached_head
-> implement git polling
```

#### Port Scanning Tests (Rust)
```
test: parse_proc_net_tcp (Linux)
test: parse_lsof_output (macOS)
test: parse_netstat_output (Windows)
test: port_scan_emits_event_on_change
test: port_scan_no_emit_when_unchanged
test: port_scan_empty_result
-> implement port scanning
```

#### Frontend Hooks Tests
```
test: useGitInfo_subscribes_to_correct_event
test: useGitInfo_returns_null_initially
test: useGitInfo_returns_info_after_event
test: useGitInfo_cleans_up_listener_on_unmount
test: usePortScanner_subscribes_to_correct_event
test: usePortScanner_returns_empty_initially
test: usePortScanner_returns_ports_after_event
test: usePortScanner_cleans_up_listener_on_unmount
-> implement hooks
```

### 5. Unit Tests

#### Rust — Scrollback (7 tests)
| Test | Description |
|------|-------------|
| `save_creates_compressed_file` | Save data -> file exists at expected path |
| `load_decompresses_correctly` | Save then load -> data matches |
| `roundtrip_identity` | Arbitrary data survives save/load cycle |
| `load_missing_returns_none` | Load non-existent pane -> None |
| `save_large_buffer` | 1MB scrollback saves without error |
| `cleanup_on_pane_close` | Pane close deletes scrollback file |
| `save_handles_unicode` | CJK/emoji in scrollback preserves correctly |

#### Rust — Git Info (9 tests)
| Test | Description |
|------|-------------|
| `parse_branch_main` | `git rev-parse` output "main\n" -> branch: "main" |
| `parse_branch_feature` | Feature branch name parsed correctly |
| `parse_detached_head` | "HEAD" output -> branch: None |
| `parse_dirty_status` | Porcelain output with changes -> is_dirty: true |
| `parse_clean_status` | Empty porcelain -> is_dirty: false |
| `parse_ahead_behind` | Rev-list output -> correct ahead/behind counts |
| `non_git_dir_returns_none` | Running in /tmp -> None |
| `event_emitted_on_change` | Info changes -> event emitted |
| `no_event_when_unchanged` | Same info as last poll -> no event |

#### Rust — Port Scanning (8 tests)
| Test | Description |
|------|-------------|
| `parse_proc_net_tcp` | Linux /proc/net/tcp format -> correct ports |
| `parse_lsof_output` | macOS lsof output -> correct ports |
| `parse_netstat_output` | Windows netstat output -> correct ports |
| `empty_result` | No listening ports -> empty vec |
| `event_emitted_on_change` | New port detected -> event emitted |
| `no_event_when_unchanged` | Same ports as last poll -> no event |
| `handles_command_failure` | Command not found or errors -> empty result, no crash |
| `filters_own_process_ports` | Obelisk's own ports excluded from results |

#### Frontend — Hooks (8 tests)
| Test | Description |
|------|-------------|
| `useGitInfo_subscribes_correctly` | Subscribes to git-info-{paneId} |
| `useGitInfo_returns_null_initially` | Before any event, returns null |
| `useGitInfo_returns_data_after_event` | After event, returns GitInfo |
| `useGitInfo_cleans_up` | Unmount -> unlisten called |
| `usePortScanner_subscribes_correctly` | Subscribes to ports-changed-{paneId} |
| `usePortScanner_returns_empty_initially` | Before any event, returns [] |
| `usePortScanner_returns_data_after_event` | After event, returns PortInfo[] |
| `usePortScanner_cleans_up` | Unmount -> unlisten called |

#### Frontend — Sidebar Metadata (6 tests)
| Test | Description |
|------|-------------|
| `sidebar_shows_git_branch` | When git info available, branch name shown |
| `sidebar_shows_dirty_indicator` | When dirty, shows modified indicator |
| `sidebar_shows_no_git_for_non_repo` | No git info -> nothing shown |
| `sidebar_shows_listening_ports` | Port list rendered below workspace |
| `sidebar_shows_no_ports_when_empty` | No ports -> section hidden |
| `sidebar_port_click_opens_browser` | Clicking port link triggers action (future: open browser pane) |

### 6. Integration Tests

| Test | Description | Platform |
|------|-------------|----------|
| `scrollback_save_restore_roundtrip` | Write to terminal, save scrollback, restore -> content matches | All |
| `git_info_polling_detects_branch_change` | Checkout different branch -> event emitted within 5s | Linux/macOS |
| `git_info_polling_detects_dirty` | Modify file -> dirty status updates within 5s | Linux/macOS |
| `port_scan_detects_new_listener` | Start HTTP server -> port appears within 10s | All |
| `port_scan_detects_stopped_listener` | Stop HTTP server -> port disappears within 10s | All |
| `large_scrollback_compression` | 5MB scrollback -> compressed file <1MB | All |

### 7. E2E Tests

| Test | Description |
|------|-------------|
| `scrollback_survives_restart` | Type many lines, close app, reopen -> scrollback visible |
| `git_branch_displayed_in_sidebar` | Open terminal in git repo -> sidebar shows branch name |
| `port_displayed_in_sidebar` | Run `python -m http.server 8080`, sidebar shows port 8080 |
| `metadata_updates_on_change` | Switch git branch -> sidebar updates |

### 8. Acceptance Criteria

1. Closing and reopening the app restores terminal scrollback history
2. Git branch name is displayed in the sidebar for panes in git repositories
3. Dirty status indicator shows when working tree has changes
4. Listening ports are detected and shown in the sidebar
5. Git info updates within 5 seconds of a change
6. Port scan updates within 10 seconds of a change
7. Scrollback compression achieves >70% size reduction
8. All tests pass on Linux, macOS; platform-specific port scanning tested on all 3 OSes

### 9. Performance Budgets

| Metric | Target |
|--------|--------|
| Scrollback serialization (5000 lines) | <100ms |
| Scrollback compression (1MB raw) | <50ms |
| Git poll cycle (per workspace) | <200ms |
| Port scan cycle | <500ms |
| Sidebar re-render on metadata change | <16ms (one frame) |
| Compressed scrollback file size | <30% of raw size |

### 10. Dependencies on Prior Phases

- **Phase 1**: PTY infrastructure, terminal rendering
- **Phase 2**: Workspace state model, sidebar component
- **Phase 3a**: Persistence infrastructure (`PersistenceBackend` trait, atomic writes, app data directory)
