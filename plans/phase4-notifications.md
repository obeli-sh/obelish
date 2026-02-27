# Phase 4: Notifications

### 1. Objectives & Scope

Implement an OSC-based notification system that intercepts terminal escape sequences (OSC 9, 99, 777), routes them through a notification store, and displays them in the UI with visual indicators and optional OS-level toast notifications.

This enables AI coding agents (Claude Code, Codex, etc.) and other terminal tools to send structured notifications to the user through the terminal, which is the primary use case from the original cmux product.

**In scope:**
- Streaming OSC parser in the Rust PTY read loop
- OSC 9 (iTerm2 growl), OSC 99 (kitty notification), OSC 777 (rxvt notification) support
- Notification store in Rust with event emission
- Notification UI: blue ring on pane, sidebar badge, notification panel (Ctrl/Cmd+I)
- OS-level toast notifications via `tauri-plugin-notification`
- Notification read/unread state management
- Notification filtering by pane/workspace

**Out of scope:**
- Custom notification schemes beyond OSC 9/99/777
- Notification persistence across restarts (ephemeral for now)
- Notification sounds

### 2. Technical Architecture

#### OSC Parser Position in the Pipeline
```
PTY stdout
  -> Rust read thread reads raw bytes
  -> OscParser.feed(bytes) -> (forwarded_bytes, Vec<Notification>)
  -> Base64 encode forwarded_bytes -> emit pty-data-{id} event (ALL bytes forwarded)
  -> For each extracted notification:
     -> Add to NotificationStore
     -> Emit "notification" event to frontend
     -> Optionally trigger OS notification via tauri-plugin-notification
```

**Critical design point**: The OSC parser does NOT consume bytes. All bytes (including the OSC sequences themselves) are forwarded to xterm.js. The parser only *intercepts* notification data as a side effect. xterm.js handles OSC sequences for its own purposes (window title, etc.).

#### OSC Parser State Machine
```
Normal -> ESC -> OscStart -> OscCode -> OscPayload -> Complete
                                                   -> EscInPayload -> Complete (ST terminator)
```

States:
```rust
enum OscParserState {
    Normal,
    Esc,                           // Saw \x1b, waiting for ]
    OscCode(String),               // Accumulating code digits after \x1b]
    OscPayload {
        code: u32,
        payload: Vec<u8>,
    },                             // Accumulating payload after ;
    EscInPayload {
        code: u32,
        payload: Vec<u8>,
    },                             // Saw \x1b in payload, waiting for \ (ST)
}
```

Termination:
- BEL (\x07) terminates the sequence
- ST (\x1b\\) terminates the sequence
- Any other character after ESC in payload -> abort, return to Normal

#### Notification Data Model
```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: String,              // uuid
    pub pane_id: String,
    pub workspace_id: String,
    pub osc_type: u32,           // 9, 99, or 777
    pub title: String,
    pub body: Option<String>,
    pub timestamp: u64,          // unix ms
    pub read: bool,
}
```

#### OSC Format Specifications
```
OSC 9:   \x1b]9;<body>\x07          -- iTerm2 growl (body only, no title)
OSC 99:  \x1b]99;i=<id>;<body>\x07  -- kitty (optional id, body)
OSC 777: \x1b]777;notify;<title>;<body>\x07  -- rxvt (title + body)
```

#### Notification Store
```rust
pub struct NotificationStore {
    notifications: Vec<Notification>,
    max_count: usize,  // default 1000, ring buffer behavior
}
```

#### Frontend Notification Flow
```
Tauri "notification" event
  -> notificationStore.addNotification(payload)
  -> UI updates:
     1. Pane blue ring indicator (via PaneWrapper hasNotification prop)
     2. Sidebar unread badge count
     3. NotificationPanel list (if open)
  -> OS notification (if app is not focused or pane is not visible)
```

### 3. Implementation Steps

1. **Implement `OscParser` struct** — streaming state machine that accepts byte chunks and returns (forwarded bytes, notifications)
2. **Integrate parser into PTY read thread** — feed bytes through parser before base64 encoding
3. **Implement `NotificationStore` in Rust** — add, list, mark read, clear
4. **Add notification event emission** — emit "notification" event on each extracted notification
5. **Add OS notification trigger** — use `tauri-plugin-notification` for system toast when app is not focused
6. **Add Tauri commands** — `notification_list`, `notification_mark_read`, `notification_clear`
7. **Frontend: `notificationStore`** — Zustand store for notification state
8. **Frontend: `NotificationPanel` component** — slide-out panel showing notification list
9. **Frontend: `NotificationBadge` component** — unread count badge on sidebar
10. **Frontend: pane blue ring** — `PaneWrapper` shows blue border when pane has unread notification
11. **Frontend: notification panel toggle** — Ctrl/Cmd+I keyboard shortcut
12. **Frontend: mark-as-read logic** — notifications for the focused pane are auto-marked as read

### 4. TDD Approach

The OSC parser is the highest-value TDD target in this phase. It is a pure function with well-defined input/output, making it ideal for test-first development.

#### OSC Parser TDD Sequence
```
RED:   test: empty_input_returns_empty
GREEN: impl: parser returns empty for empty input
REFACTOR: none needed

RED:   test: normal_text_forwarded_unchanged
GREEN: impl: parser forwards non-ESC bytes
REFACTOR: none needed

RED:   test: osc9_simple_notification
GREEN: impl: parser detects \x1b]9;body\x07 pattern
REFACTOR: extract state machine

RED:   test: osc9_with_bel_terminator
GREEN: impl: BEL terminates sequence
REFACTOR: none needed

RED:   test: osc9_with_st_terminator
GREEN: impl: ESC + \ terminates sequence
REFACTOR: extract terminator detection

RED:   test: osc99_notification
GREEN: impl: code 99 handling
REFACTOR: generalize code parsing

RED:   test: osc777_with_title_and_body
GREEN: impl: 777;notify;title;body parsing
REFACTOR: none needed

RED:   test: partial_sequence_across_reads
GREEN: impl: parser retains state between feed() calls
REFACTOR: ensure state machine is clean

RED:   test: mixed_data_and_osc
GREEN: impl: interleaved normal bytes and OSC
REFACTOR: none needed

RED:   test: incomplete_sequence_at_eof
GREEN: impl: discard incomplete on EOF
REFACTOR: add cleanup method

RED:   test: all_bytes_always_forwarded
GREEN: verify: forwarded.len() == input.len() for any input
REFACTOR: none needed

RED:   test: proptest_never_panics
GREEN: impl: handle all edge cases
REFACTOR: simplify state transitions
```

#### Notification Store TDD Sequence
```
test: starts_empty
test: add_notification_increases_count
test: list_returns_all_notifications
test: list_by_pane_filters_correctly
test: mark_read_updates_notification
test: mark_read_nonexistent_id_no_error
test: unread_count_correct
test: max_count_evicts_oldest
test: clear_removes_all
-> implement NotificationStore
```

#### Frontend TDD Sequence
```
test: notificationStore_starts_empty
test: notificationStore_addNotification
test: notificationStore_unreadCount
test: notificationStore_markAllRead
test: notificationStore_getByPane
test: NotificationPanel_renders_when_open
test: NotificationPanel_hidden_when_closed
test: NotificationPanel_shows_notification_list
test: NotificationPanel_shows_empty_state
test: NotificationBadge_shows_count
test: NotificationBadge_hidden_when_zero
test: PaneWrapper_shows_blue_ring_when_notification
test: PaneWrapper_no_ring_when_read
-> implement components and store
```

### 5. Unit Tests

#### Rust — `osc_parser.rs` (23 tests + proptest)
| Test | Description |
|------|-------------|
| `empty_input` | Empty bytes -> empty forwarded, no notifications |
| `normal_text_forwarded` | Plain text -> forwarded unchanged, no notifications |
| `osc9_bel_terminator` | `\x1b]9;hello\x07` -> notification with body "hello" |
| `osc9_st_terminator` | `\x1b]9;hello\x1b\\` -> notification with body "hello" |
| `osc9_empty_body` | `\x1b]9;\x07` -> notification with empty body |
| `osc9_unicode_body` | OSC 9 with UTF-8 body -> correct unicode |
| `osc99_simple` | `\x1b]99;;body\x07` -> notification |
| `osc99_with_id` | `\x1b]99;i=123;body\x07` -> notification (id ignored for now) |
| `osc777_title_and_body` | `\x1b]777;notify;title;body\x07` -> title + body |
| `osc777_title_only` | `\x1b]777;notify;title\x07` -> title, no body |
| `unknown_osc_code` | `\x1b]1234;data\x07` -> forwarded, no notification |
| `partial_sequence_across_reads` | Split at various points -> same result |
| `multiple_notifications_single_read` | Two OSC in one chunk -> two notifications |
| `interleaved_text_and_osc` | `hello\x1b]9;msg\x07world` -> notification + forwarded all |
| `esc_not_followed_by_bracket` | `\x1b[32m` (ANSI color) -> forwarded, no notification |
| `nested_esc_in_payload` | `\x1b]9;has\x1bcolor\x07` -> handle gracefully |
| `very_long_payload` | 10KB payload -> notification extracted, no truncation |
| `eof_with_partial_sequence` | Partial OSC at end -> discarded, all prior bytes forwarded |
| `all_bytes_forwarded_osc9` | OSC 9 sequence -> all bytes in forwarded output |
| `all_bytes_forwarded_normal` | Normal text -> all bytes in forwarded output |
| `rapid_sequential_notifications` | 100 OSC 9 in sequence -> 100 notifications |
| `binary_data_in_normal_mode` | Random binary bytes -> forwarded, no crash |
| `reset_after_complete_sequence` | Parser state resets after complete sequence |
| **proptest: never_panics** | Arbitrary bytes (0-10KB) -> no panic |
| **proptest: always_forwards_all_bytes** | Any input -> forwarded.len() == input.len() |
| **proptest: extracts_known_osc9** | Generated OSC 9 -> correctly extracted |
| **proptest: split_boundary_equivalence** | Any split point -> same notifications as whole input |

#### Rust — `NotificationStore` (9 tests)
| Test | Description |
|------|-------------|
| `starts_empty` | New store has 0 notifications, 0 unread |
| `add_increments_count` | Add notification -> count is 1 |
| `list_returns_all` | Add 3 -> list returns 3 in order |
| `list_by_pane` | Add for 2 panes -> filter returns correct subset |
| `mark_read` | Mark notification as read -> read: true, unread count decreases |
| `mark_read_nonexistent` | Mark unknown ID -> no error |
| `unread_count` | Add 3, read 1 -> unread count is 2 |
| `max_count_eviction` | Add 1001 with max 1000 -> oldest evicted |
| `clear_removes_all` | Clear -> count is 0 |

#### Rust — OS Notification (3 tests)
| Test | Description |
|------|-------------|
| `sends_os_notification_when_unfocused` | App not focused -> tauri-plugin-notification called |
| `skips_os_notification_when_focused` | App focused + pane visible -> no OS notification |
| `respects_notification_permission` | If OS permission denied -> silently skip |

#### Frontend — `notificationStore` (8 tests)
| Test | Description |
|------|-------------|
| `starts_empty` | Initial state has empty list, 0 unread |
| `addNotification` | Add -> notification in list, unread count incremented |
| `getByPane` | Filter by pane_id returns correct subset |
| `markAllRead` | Mark all read -> unread count is 0, all notifications read: true |
| `clearAll` | Clear -> empty list |
| `unreadCount` | Add 3, mark 1 read -> unread count is 2 |
| `orders_by_timestamp` | Notifications ordered newest-first |
| `duplicate_id_ignored` | Adding same ID twice -> only one entry |

#### Frontend — `NotificationPanel` (6 tests)
| Test | Description |
|------|-------------|
| `renders_when_open` | isOpen=true -> panel visible |
| `hidden_when_closed` | isOpen=false -> panel not in DOM |
| `shows_notification_list` | Store has notifications -> renders items |
| `shows_empty_state` | Store empty -> shows "No notifications" message |
| `close_button_calls_onClose` | Click close -> onClose called |
| `notification_item_shows_title_body` | Each item renders title, body, timestamp |

#### Frontend — `NotificationBadge` (3 tests)
| Test | Description |
|------|-------------|
| `shows_unread_count` | 3 unread -> badge shows "3" |
| `hidden_when_zero` | 0 unread -> badge not rendered |
| `shows_9_plus` | 10+ unread -> shows "9+" |

#### Frontend — PaneWrapper notification ring (3 tests)
| Test | Description |
|------|-------------|
| `shows_blue_ring` | hasNotification=true -> blue border applied |
| `no_ring_when_no_notification` | hasNotification=false -> no special border |
| `ring_disappears_on_focus` | When pane becomes active -> notification auto-marked read |

### 6. Integration Tests

| Test | Description | Platform |
|------|-------------|----------|
| `pty_osc9_to_notification_event` | Write OSC 9 to PTY -> notification event emitted to frontend | All |
| `pty_osc777_to_notification_event` | Write OSC 777 to PTY -> notification event with title + body | All |
| `pty_mixed_output_and_osc` | Terminal output interleaved with OSC -> both terminal data and notification events correct | All |
| `notification_store_integration` | Add notifications via events -> query via Tauri commands -> correct results | All |
| `os_notification_fires` | App unfocused + OSC received -> OS notification triggered (mock plugin) | All |
| `osc_across_pty_read_boundaries` | OSC sequence split across two PTY reads -> notification still extracted | All |
| `high_frequency_notifications` | 100 OSC per second -> all captured, no dropped notifications | All |

### 7. E2E Tests

| Test | Description |
|------|-------------|
| `osc9_shows_notification` | Run `printf '\e]9;Hello from agent\a'` -> blue ring on pane, badge in sidebar, notification in panel |
| `osc777_shows_titled_notification` | Run `printf '\e]777;notify;Build;Complete\a'` -> notification shows "Build: Complete" |
| `notification_panel_toggle` | Press Ctrl+I -> panel opens. Press again -> closes |
| `notification_read_on_focus` | Notification arrives on unfocused pane -> focus pane -> notification marked read, ring disappears |
| `multiple_pane_notifications` | Notifications from different panes -> each pane shows its own badge/ring |
| `notification_panel_shows_all` | Multiple notifications from multiple panes -> panel shows all, grouped or chronological |

### 8. Acceptance Criteria

1. Running `printf '\e]9;Hello from agent\a'` in a terminal pane shows a notification
2. Blue ring appears around the pane with the notification
3. Sidebar shows an unread notification badge with correct count
4. Ctrl/Cmd+I opens the notification panel showing all notifications
5. Focusing a pane with unread notifications marks them as read (ring disappears)
6. OS toast notification appears when the app is not focused or the pane is not visible
7. OSC 9, 99, and 777 formats are all supported
8. Normal terminal output is not affected by the parser (no dropped or corrupted bytes)
9. Parser handles split sequences across PTY read boundaries correctly
10. Property-based tests confirm parser never panics on arbitrary input
11. All tests pass on Linux, macOS, and Windows

### 9. Performance Budgets

| Metric | Target |
|--------|--------|
| OSC parser throughput | >200 MB/s (must not bottleneck PTY read path) |
| Parser overhead per byte (no OSC present) | <1 ns |
| Notification event emission latency | <1ms from detection to event |
| Notification panel render (100 notifications) | <16ms (one frame) |
| Memory per notification | <1KB |
| Max notification store size | 1000 (ring buffer, oldest evicted) |
| OS notification delivery | <500ms from detection (platform dependent) |

### 10. Dependencies on Prior Phases

- **Phase 1**: PTY read thread (parser integrates into the read loop), base64 event pipeline
- **Phase 2**: Workspace state model (notification needs pane_id and workspace_id), sidebar component (badge display), PaneWrapper (blue ring), uiStore (notification panel toggle)
- **Phase 3a**: Not strictly required, but notifications should persist if Phase 3b scrollback persistence is implemented (notifications embedded in scrollback are re-detected on replay — but this is an edge case we can ignore for now)
