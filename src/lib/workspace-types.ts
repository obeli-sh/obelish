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

export interface WorkspaceInfo {
  id: string;
  name: string;
  projectId: string;
  worktreePath: string;
  branchName: string | null;
  isRootWorktree: boolean;
  surfaces: SurfaceInfo[];
  activeSurfaceIndex: number;
  createdAt: number;
}

export interface SurfaceInfo {
  id: string;
  name: string;
  layout: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;

export interface LeafNode {
  type: 'leaf';
  paneId: string;
  ptyId: string;
}

export interface SplitNode {
  type: 'split';
  direction: SplitDirection;
  children: [LayoutNode, LayoutNode];
  sizes: [number, number];
}

export type SplitDirection = 'horizontal' | 'vertical';
export type PaneDropPosition = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface PaneInfo {
  id: string;
  ptyId: string;
  paneType: PaneType;
  cwd: string | null;
  url: string | null;
}

export type PaneType = 'terminal' | 'browser';

export interface PaneSplitResult {
  paneId: string;
  ptyId: string;
}

export interface WorkspaceChangedEvent {
  workspaceId: string;
  workspace: WorkspaceInfo;
}

export interface GitInfo {
  branch: string | null;
  isDirty: boolean;
  ahead: number;
  behind: number;
}

export interface PortInfo {
  port: number;
  protocol: string;
  pid: number | null;
  processName: string | null;
}

export interface Notification {
  id: string;
  paneId: string;
  workspaceId: string;
  oscType: number;
  title: string;
  body: string | null;
  timestamp: number;
  read: boolean;
}
