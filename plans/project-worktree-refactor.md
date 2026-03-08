# Project + Worktree Refactor Plan

## Overview

Refactor Obelisk so that **workspaces are tied to git worktrees** (or the repo root) within a **project** (a directory on disk). The app supports multiple projects simultaneously. On launch, a project picker is shown instead of immediately restoring a session.

## New UX Flow

```
App opens
  → ProjectPicker (shows saved projects + "Open folder" button)
    → User picks project
      → WorktreeDialog (shows: root branch, existing worktrees, "Create new worktree")
        → User picks worktree (or root)
          → Workspace created with PTY cwd = worktree path
            → Sidebar shows all workspaces for ALL open projects, grouped by project
```

Clicking "+ New Workspace" in sidebar → opens WorktreeDialog for the active project.

---

## Phase 1: Data Model Changes

### 1a. Protocol types (`obelisk-protocol/src/lib.rs`)

Add `ProjectInfo`:
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,          // derived from directory name, e.g. "obelisk"
    pub root_path: String,     // absolute path, e.g. "/home/user/projects/obelisk"
}
```

Add `WorktreeInfo`:
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorktreeInfo {
    pub path: String,          // absolute worktree path
    pub branch: Option<String>,
    pub is_main: bool,         // true = repo root, false = linked worktree
}
```

Extend `WorkspaceInfo`:
```rust
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub project_id: String,        // NEW: links to ProjectInfo
    pub worktree_path: String,     // NEW: directory this workspace operates in
    pub branch_name: Option<String>, // NEW: git branch name
    pub is_root_worktree: bool,    // NEW: true = repo root
    pub surfaces: Vec<SurfaceInfo>,
    pub active_surface_index: usize,
    pub created_at: u64,
}
```

Add to TS types (`src/lib/workspace-types.ts`) to match.

### 1b. Tests for serialization roundtrip

- Verify `ProjectInfo` serialize/deserialize
- Verify extended `WorkspaceInfo` with new fields
- Verify backward compat: old session JSON without new fields → graceful default or error

---

## Phase 2: Backend — Project Management

### 2a. New module: `src-tauri/src/project/mod.rs`

```rust
pub struct ProjectStore {
    projects: Vec<ProjectInfo>,
    backend: Arc<dyn PersistenceBackend>,
}

impl ProjectStore {
    pub fn new(backend: Arc<dyn PersistenceBackend>) -> Self;
    pub fn load(&mut self) -> Result<(), PersistenceError>;
    pub fn save(&self) -> Result<(), PersistenceError>;
    pub fn add(&mut self, root_path: String) -> Result<ProjectInfo, ProjectError>;
    pub fn remove(&mut self, project_id: &str) -> Result<(), ProjectError>;
    pub fn list(&self) -> &[ProjectInfo];
    pub fn get(&self, project_id: &str) -> Option<&ProjectInfo>;
}
```

Persistence key: `"projects"` → JSON array of `ProjectInfo`.

### 2b. Tests

- Add project → shows up in list
- Add duplicate path → returns existing project (idempotent)
- Remove project → gone from list
- Save + load roundtrip
- Name derived from path (last component)

---

## Phase 3: Backend — Git Worktree Operations

### 3a. Extend `src-tauri/src/metadata/git.rs`

Add functions (using `CommandRunner` trait for testability):

```rust
pub fn list_worktrees(runner: &dyn CommandRunner, root_path: &str) -> Vec<WorktreeInfo>;
pub fn create_worktree(
    runner: &dyn CommandRunner,
    root_path: &str,
    branch_name: &str,
    worktree_path: &str,
) -> Result<WorktreeInfo, GitError>;
```

Implementation:
- `list_worktrees`: runs `git worktree list --porcelain`, parses output
- `create_worktree`: runs `git worktree add -b <branch> <path>`, creates new branch

### 3b. Tests

- Parse `git worktree list --porcelain` output (mock runner)
- Handle repos with no worktrees (just root)
- Handle non-git directories (return empty or error)
- Create worktree success/failure paths

---

## Phase 4: Backend — Modified Workspace Creation

### 4a. Modify `workspace_create` command

Current signature:
```rust
fn workspace_create(state, app, name, shell, cwd) -> WorkspaceInfo
```

New signature:
```rust
fn workspace_create(
    state, app,
    project_id: String,
    worktree_path: String,
    name: Option<String>,
    shell: Option<String>,
) -> WorkspaceInfo
```

Changes:
- PTY spawned with `cwd = worktree_path`
- `project_id`, `worktree_path`, `branch_name` stored in `WorkspaceInfo`
- `branch_name` resolved via `git symbolic-ref --short HEAD` in `worktree_path`
- `is_root_worktree` determined by comparing `worktree_path` to project's `root_path`
- Default workspace name = branch name (or directory basename)

### 4b. Modify `WorkspaceState::create_workspace`

Add params: `project_id`, `worktree_path`, `branch_name`, `is_root_worktree`.

### 4c. New Tauri commands

```rust
#[tauri::command]
fn project_list(state) -> Vec<ProjectInfo>;

#[tauri::command]
fn project_add(state, root_path: String) -> ProjectInfo;

#[tauri::command]
fn project_remove(state, project_id: String) -> ();

#[tauri::command]
fn worktree_list(state, project_id: String) -> Vec<WorktreeInfo>;

#[tauri::command]
fn worktree_create(state, project_id: String, branch_name: String) -> WorktreeInfo;
```

### 4d. Add `ProjectStore` to `AppState`

```rust
pub struct AppState {
    // ... existing fields ...
    pub project_store: Arc<RwLock<ProjectStore>>,
}
```

### 4e. Register new commands in `lib.rs`

### 4f. Tests

- `workspace_create` with project_id and worktree_path
- PTY spawns with correct cwd
- Branch name resolved
- project commands CRUD

---

## Phase 5: Backend — Persistence Updates

### 5a. Update `SessionState`

```rust
pub struct SessionState {
    pub workspaces: Vec<WorkspaceInfo>,  // now includes project_id, worktree fields
    pub active_workspace_id: Option<String>,
    pub panes: HashMap<String, PaneInfo>,
}
```

No structural change needed — `WorkspaceInfo` already part of it, just has new fields.

### 5b. Session restore changes

- On restore, verify `worktree_path` still exists
- If worktree was deleted, skip or warn (don't crash)
- PTY spawn uses stored `worktree_path` as cwd

### 5c. Tests

- Roundtrip with new fields
- Graceful handling of missing worktree paths on restore

---

## Phase 6: Frontend — Bridge + Types

### 6a. Update `src/lib/workspace-types.ts`

Add:
```ts
export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}
```

Extend `WorkspaceInfo`:
```ts
export interface WorkspaceInfo {
  // ... existing fields ...
  projectId: string;
  worktreePath: string;
  branchName: string | null;
  isRootWorktree: boolean;
}
```

### 6b. Update `src/lib/tauri-bridge.ts`

Add:
```ts
project: {
  list: () => safeInvoke<ProjectInfo[]>('project_list'),
  add: (rootPath: string) => safeInvoke<ProjectInfo>('project_add', { rootPath }),
  remove: (projectId: string) => safeInvoke<void>('project_remove', { projectId }),
},
worktree: {
  list: (projectId: string) => safeInvoke<WorktreeInfo[]>('worktree_list', { projectId }),
  create: (projectId: string, branchName: string) =>
    safeInvoke<WorktreeInfo>('worktree_create', { projectId, branchName }),
},
```

Modify `workspace.create`:
```ts
create: (args: { projectId: string; worktreePath: string; name?: string }) =>
  safeInvoke<WorkspaceInfo>('workspace_create', args),
```

### 6c. Tests

- Bridge mock tests for new commands

---

## Phase 7: Frontend — Project Store

### 7a. New store: `src/stores/projectStore.ts`

```ts
interface ProjectStoreState {
  projects: Record<string, ProjectInfo>;
  activeProjectId: string | null;
  setActiveProject: (id: string) => void;
  _syncProjects: (projects: ProjectInfo[]) => void;
  _addProject: (project: ProjectInfo) => void;
  _removeProject: (id: string) => void;
}
```

### 7b. Tests

- CRUD operations on store
- Active project selection

---

## Phase 8: Frontend — ProjectPicker Component

### 8a. `src/components/project/ProjectPicker.tsx`

Shown when no project is selected (initial launch or all projects closed).

UI:
```
┌─────────────────────────────┐
│       Open a Project        │
│                             │
│  📁 obelisk    ~/projects/  │
│  📁 gap        ~/projects/  │
│  📁 myapp      ~/projects/  │
│                             │
│  [ Open Folder... ]         │
└─────────────────────────────┘
```

Behavior:
- Lists projects from `projectStore`
- "Open Folder" uses Tauri's `dialog.open` to pick a directory
- Clicking a project → calls `project_add` (idempotent) → shows WorktreeDialog
- Project list loads on mount via `tauriBridge.project.list()`

### 8b. Tests

- Renders project list
- "Open Folder" triggers dialog
- Click project → navigates to worktree selection

---

## Phase 9: Frontend — WorktreeDialog Component

### 9a. `src/components/project/WorktreeDialog.tsx`

Modal dialog shown after project selection or when clicking "+ New Workspace".

UI:
```
┌──────────────────────────────────┐
│  obelisk — Select Worktree      │
│                                  │
│  ● main (root)                   │
│  ○ feature/auth                  │
│  ○ fix/bug-123                   │
│                                  │
│  ─────────────────────────────── │
│  Branch name: [____________]     │
│  [ Create New Worktree ]         │
└──────────────────────────────────┘
```

Behavior:
- Lists worktrees via `tauriBridge.worktree.list(projectId)`
- Clicking existing worktree → creates workspace with that worktree path
- "Create New Worktree" → calls `tauriBridge.worktree.create(projectId, branchName)` then creates workspace
- After workspace creation, dialog closes, sidebar shows new workspace

### 9b. Tests

- Renders worktree list
- Create new worktree flow
- Select existing worktree → workspace created

---

## Phase 10: Frontend — Sidebar Redesign

### 10a. Modify `src/components/sidebar/Sidebar.tsx`

Current: flat list of workspace names.

New: grouped by project, each item shows:
```
┌─────────────────────────────┐
│ obelisk                     │  ← project header
│ ┌─────────────────────────┐ │
│ │ main                    │ │  ← branch name (title)
│ │ $ npm run dev           │ │  ← terminal preview (last line)
│ │ ~/projects/obelisk      │ │  ← worktree directory
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ feature/auth            │ │
│ │ $ cargo test            │ │
│ │ .worktrees/feature-auth │ │
│ └─────────────────────────┘ │
│                             │
│ gap                         │  ← another project
│ ┌─────────────────────────┐ │
│ │ main                    │ │
│ │ ...                     │ │
│ └─────────────────────────┘ │
│                             │
│ [ + New Workspace ]         │
└─────────────────────────────┘
```

### 10b. Terminal preview

Need to capture last line(s) of PTY output per pane. Options:
1. Store last N bytes in PTY manager (Rust side) → new command `pty_last_output(ptyId)`
2. Store in frontend via xterm serialize

Recommended: **Option 1** — add a small ring buffer per PTY session in `PtyManager` that stores the last ~200 bytes of output. Add a Tauri command to retrieve it.

Add to `PtySession`:
```rust
last_output: VecDeque<u8>,  // ring buffer, max 256 bytes
```

In `pty_read_loop`, forward last chunk to a shared buffer (via `Arc<Mutex<>>`).

New command:
```rust
#[tauri::command]
fn pty_last_output(state, pty_id: String) -> String;  // last line of terminal
```

### 10c. Sidebar props update

```ts
interface SidebarProps {
  projects: ProjectInfo[];
  workspaces: WorkspaceInfo[];      // all workspaces across all projects
  activeWorkspaceId: string;
  onWorkspaceSelect: (id: string) => void;
  onNewWorkspace: (projectId: string) => void;  // opens WorktreeDialog
  onWorkspaceClose: (id: string) => void;
  onProjectClose: (projectId: string) => void;
  // ... existing drag/reorder props
}
```

### 10d. Tests

- Workspaces grouped by project
- Terminal preview renders
- Click workspace → selects it
- "+ New Workspace" → triggers dialog

---

## Phase 11: Frontend — AppLayout Integration

### 11a. Modify `src/components/AppLayout.tsx`

Add state:
```ts
const [showProjectPicker, setShowProjectPicker] = useState(true);
const [worktreeDialogProjectId, setWorktreeDialogProjectId] = useState<string | null>(null);
```

Flow:
1. On mount, load projects. If projects exist with persisted workspaces → restore and hide picker.
2. If no projects → show `ProjectPicker`.
3. After project selected → show `WorktreeDialog`.
4. After worktree selected → create workspace, show main layout.
5. "+ New Workspace" in sidebar → set `worktreeDialogProjectId`, show dialog.

### 11b. Tests

- Initial render shows ProjectPicker when no projects
- After project + worktree selection → shows main layout
- Restore from session → skips picker

---

## Implementation Order

1. **Phase 1** — Protocol types (Rust + TS) + serialization tests
2. **Phase 2** — ProjectStore backend + tests
3. **Phase 3** — Git worktree operations + tests
4. **Phase 4** — Modified workspace creation + new commands + tests
5. **Phase 5** — Persistence updates + tests
6. **Phase 6** — Frontend bridge + types
7. **Phase 7** — Project store (frontend) + tests
8. **Phase 8** — ProjectPicker component + tests
9. **Phase 9** — WorktreeDialog component + tests
10. **Phase 10** — Sidebar redesign + terminal preview + tests
11. **Phase 11** — AppLayout integration + tests

Each phase should be a separate commit. Phases 1-5 are backend, 6-11 are frontend. Within each phase, TDD applies: write tests first.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking existing session persistence | Add `#[serde(default)]` to new WorkspaceInfo fields for backward compat |
| Git worktree not available (non-git dirs) | Allow non-git projects — workspace just uses root_path, no worktree features |
| Terminal preview performance | Ring buffer is O(1), command only called on sidebar render |
| Multi-project state complexity | Keep projects independent — each has its own worktree namespace |
| Worktree path deleted between sessions | Validate on restore, skip with warning |

---

## Out of Scope (for now)

- Project settings per-project (shell, theme, etc.)
- Worktree deletion from UI
- Branch switching within a workspace
- Remote project support
- Project search/filter in picker
