/**
 * Bridge Contract Tests
 *
 * Ensures that command names used in tauri-bridge.ts, browser-mock.ts handlers,
 * and #[tauri::command] functions in commands.rs all stay in sync.
 *
 * This catches drift like the #1 audit issue where list_directories was broken
 * but tests passed because mocks hid it.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Extract all command name strings passed to safeInvoke in tauri-bridge.ts
function extractBridgeCommands(): string[] {
  const bridgePath = path.resolve(__dirname, '..', 'tauri-bridge.ts');
  const source = fs.readFileSync(bridgePath, 'utf-8');
  const matches = source.matchAll(/safeInvoke[^(]*\(\s*'([^']+)'/g);
  return [...matches].map((m) => m[1]);
}

// Extract all handler keys registered in browser-mock.ts
function extractMockHandlers(): string[] {
  const mockPath = path.resolve(__dirname, '..', 'browser-mock.ts');
  const source = fs.readFileSync(mockPath, 'utf-8');
  const lines = source.split('\n');
  const commands: string[] = [];
  let inHandlers = false;
  for (const line of lines) {
    if (line.match(/^const handlers:\s*Record/)) {
      inHandlers = true;
      continue;
    }
    if (inHandlers && line.match(/^\};/)) {
      break;
    }
    if (inHandlers) {
      // Match top-level handler keys like `  session_restore: (args) =>`
      const m = line.match(/^\s{2}(\w+):\s*(?:\(|function)/);
      if (m) commands.push(m[1]);
    }
  }
  return commands;
}

// Extract all #[tauri::command] function names from commands.rs
function extractRustCommands(): string[] {
  const commandsPath = path.resolve(__dirname, '..', '..', '..', 'src-tauri', 'src', 'commands.rs');
  const source = fs.readFileSync(commandsPath, 'utf-8');
  const lines = source.split('\n');
  const commands: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('#[tauri::command]')) {
      // Scan forward for the `pub fn name(` or `pub async fn name(` line
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const fnMatch = lines[j].match(/pub\s+(?:async\s+)?fn\s+(\w+)\s*\(/);
        if (fnMatch) {
          commands.push(fnMatch[1]);
          break;
        }
      }
    }
  }
  return commands;
}

describe('Bridge Contract: command name sync', () => {
  const bridgeCommands = extractBridgeCommands();
  const mockHandlers = extractMockHandlers();
  const rustCommands = extractRustCommands();

  it('extracts at least one command from each source', () => {
    expect(bridgeCommands.length).toBeGreaterThan(0);
    expect(mockHandlers.length).toBeGreaterThan(0);
    expect(rustCommands.length).toBeGreaterThan(0);
  });

  it('every bridge command has a corresponding mock handler', () => {
    const mockSet = new Set(mockHandlers);
    const missing = bridgeCommands.filter((cmd) => !mockSet.has(cmd));
    expect(missing).toEqual([]);
  });

  it('every bridge command exists as a #[tauri::command] in Rust', () => {
    const rustSet = new Set(rustCommands);
    const missing = bridgeCommands.filter((cmd) => !rustSet.has(cmd));
    expect(missing).toEqual([]);
  });

  it('every mock handler corresponds to a bridge command', () => {
    const bridgeSet = new Set(bridgeCommands);
    const extra = mockHandlers.filter((cmd) => !bridgeSet.has(cmd));
    expect(extra).toEqual([]);
  });

  it('every Rust command is used by the bridge', () => {
    const bridgeSet = new Set(bridgeCommands);
    const unused = rustCommands.filter((cmd) => !bridgeSet.has(cmd));
    expect(unused).toEqual([]);
  });

  it('no duplicate command names in bridge', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const cmd of bridgeCommands) {
      if (seen.has(cmd)) dupes.push(cmd);
      seen.add(cmd);
    }
    expect(dupes).toEqual([]);
  });
});

/**
 * Layout Structural Validity Tests
 *
 * Verify that the browser-mock's layout operations (splitLayout, closePaneFromLayout)
 * produce structurally valid layout trees.
 */
import { mockInvoke, resetMockState } from '../browser-mock';
import type { LayoutNode } from '../workspace-types';

interface WorkspaceResult {
  id: string;
  surfaces: Array<{ layout: LayoutNode }>;
  activeSurfaceIndex: number;
}

function countLeaves(layout: LayoutNode): number {
  if (layout.type === 'leaf') return 1;
  return countLeaves(layout.children[0]) + countLeaves(layout.children[1]);
}

function validateSplitNodes(layout: LayoutNode): boolean {
  if (layout.type === 'leaf') return true;
  if (layout.children.length !== 2) return false;
  return validateSplitNodes(layout.children[0]) && validateSplitNodes(layout.children[1]);
}

function validateLeafNodes(layout: LayoutNode): boolean {
  if (layout.type === 'leaf') {
    return typeof layout.paneId === 'string' && layout.paneId.length > 0
      && typeof layout.ptyId === 'string';
  }
  return validateLeafNodes(layout.children[0]) && validateLeafNodes(layout.children[1]);
}

function getLayout(workspace: WorkspaceResult): LayoutNode {
  return workspace.surfaces[workspace.activeSurfaceIndex].layout;
}

describe('Layout structural validity', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('initial workspace has a single leaf node', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    expect(workspaces.length).toBeGreaterThan(0);
    const layout = getLayout(workspaces[0]);
    expect(layout.type).toBe('leaf');
    expect(countLeaves(layout)).toBe(1);
  });

  it('after split: layout has exactly one more leaf than before', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layoutBefore = getLayout(ws);
    const leavesBefore = countLeaves(layoutBefore);

    // Get the paneId of the initial leaf
    expect(layoutBefore.type).toBe('leaf');
    const paneId = (layoutBefore as { paneId: string }).paneId;

    const result = (await mockInvoke('pane_split', {
      paneId,
      direction: 'horizontal',
    })) as WorkspaceResult;

    const layoutAfter = getLayout(result);
    const leavesAfter = countLeaves(layoutAfter);
    expect(leavesAfter).toBe(leavesBefore + 1);
  });

  it('after close: layout has exactly one fewer leaf (unless last pane)', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const initialLayout = getLayout(ws);
    const paneId = (initialLayout as { paneId: string }).paneId;

    // Split to get two panes
    const afterSplit = (await mockInvoke('pane_split', {
      paneId,
      direction: 'vertical',
    })) as WorkspaceResult;
    const layoutAfterSplit = getLayout(afterSplit);
    const leavesAfterSplit = countLeaves(layoutAfterSplit);
    expect(leavesAfterSplit).toBe(2);

    // Close the original pane
    const afterClose = (await mockInvoke('pane_close', { paneId })) as WorkspaceResult;
    const layoutAfterClose = getLayout(afterClose);
    const leavesAfterClose = countLeaves(layoutAfterClose);
    expect(leavesAfterClose).toBe(leavesAfterSplit - 1);
  });

  it('closing the last pane creates a fresh leaf (workspace stays alive)', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const initialLayout = getLayout(ws);
    const paneId = (initialLayout as { paneId: string }).paneId;

    // Close the only pane
    const afterClose = (await mockInvoke('pane_close', { paneId })) as WorkspaceResult;
    const layoutAfterClose = getLayout(afterClose);

    // Should still have a valid leaf (the mock replaces null with a new terminal leaf)
    expect(layoutAfterClose.type).toBe('leaf');
    expect(countLeaves(layoutAfterClose)).toBe(1);
  });

  it('every split node has exactly 2 children after multiple splits', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const initialLayout = getLayout(ws);
    const firstPaneId = (initialLayout as { paneId: string }).paneId;

    // Perform first split
    const after1 = (await mockInvoke('pane_split', {
      paneId: firstPaneId,
      direction: 'horizontal',
    })) as WorkspaceResult;
    expect(validateSplitNodes(getLayout(after1))).toBe(true);

    // Find second pane and split it too
    const layout1 = getLayout(after1);
    expect(layout1.type).toBe('split');
    const secondLeaf = (layout1 as { children: LayoutNode[] }).children[1];
    expect(secondLeaf.type).toBe('leaf');
    const secondPaneId = (secondLeaf as { paneId: string }).paneId;

    const after2 = (await mockInvoke('pane_split', {
      paneId: secondPaneId,
      direction: 'vertical',
    })) as WorkspaceResult;
    expect(validateSplitNodes(getLayout(after2))).toBe(true);
    expect(countLeaves(getLayout(after2))).toBe(3);
  });

  it('every leaf node has a paneId and ptyId', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const initialLayout = getLayout(ws);
    const firstPaneId = (initialLayout as { paneId: string }).paneId;

    // Split a couple of times to build a tree
    const after1 = (await mockInvoke('pane_split', {
      paneId: firstPaneId,
      direction: 'horizontal',
    })) as WorkspaceResult;

    const layout1 = getLayout(after1);
    const secondPaneId = ((layout1 as { children: LayoutNode[] }).children[1] as { paneId: string }).paneId;

    const after2 = (await mockInvoke('pane_split', {
      paneId: secondPaneId,
      direction: 'vertical',
    })) as WorkspaceResult;

    expect(validateLeafNodes(getLayout(after2))).toBe(true);
  });

  it('split and close are inverse operations (returns to single leaf)', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const initialLayout = getLayout(ws);
    const paneId = (initialLayout as { paneId: string }).paneId;

    // Split
    const afterSplit = (await mockInvoke('pane_split', {
      paneId,
      direction: 'horizontal',
    })) as WorkspaceResult;
    const splitLayout = getLayout(afterSplit);
    expect(splitLayout.type).toBe('split');

    // Find the new pane (the second child)
    const newPaneId = ((splitLayout as { children: LayoutNode[] }).children[1] as { paneId: string }).paneId;

    // Close the new pane - should collapse back to a single leaf
    const afterClose = (await mockInvoke('pane_close', { paneId: newPaneId })) as WorkspaceResult;
    const closedLayout = getLayout(afterClose);
    expect(closedLayout.type).toBe('leaf');
    expect(countLeaves(closedLayout)).toBe(1);
    expect((closedLayout as { paneId: string }).paneId).toBe(paneId);
  });
});

describe('Layout behavioral correctness', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('split direction preserved: horizontal split produces horizontal parent', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layout = getLayout(ws);
    const paneId = (layout as { paneId: string }).paneId;

    const result = (await mockInvoke('pane_split', {
      paneId,
      direction: 'horizontal',
    })) as WorkspaceResult;
    const splitLayout = getLayout(result);

    expect(splitLayout.type).toBe('split');
    expect((splitLayout as { direction: string }).direction).toBe('horizontal');
  });

  it('split direction preserved: vertical split produces vertical parent', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layout = getLayout(ws);
    const paneId = (layout as { paneId: string }).paneId;

    const result = (await mockInvoke('pane_split', {
      paneId,
      direction: 'vertical',
    })) as WorkspaceResult;
    const splitLayout = getLayout(result);

    expect(splitLayout.type).toBe('split');
    expect((splitLayout as { direction: string }).direction).toBe('vertical');
  });

  it('split position: original pane is first child, new pane is second child', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layout = getLayout(ws);
    const originalPaneId = (layout as { paneId: string }).paneId;

    const result = (await mockInvoke('pane_split', {
      paneId: originalPaneId,
      direction: 'horizontal',
    })) as WorkspaceResult;
    const splitLayout = getLayout(result);

    expect(splitLayout.type).toBe('split');
    const children = (splitLayout as { children: LayoutNode[] }).children;
    expect(children[0].type).toBe('leaf');
    expect(children[1].type).toBe('leaf');
    expect((children[0] as { paneId: string }).paneId).toBe(originalPaneId);
    expect((children[1] as { paneId: string }).paneId).not.toBe(originalPaneId);
  });

  it('close collapses split: closing one child returns sibling unwrapped', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layout = getLayout(ws);
    const paneA = (layout as { paneId: string }).paneId;

    // Split A into A+B
    const afterSplit = (await mockInvoke('pane_split', {
      paneId: paneA,
      direction: 'horizontal',
    })) as WorkspaceResult;
    const splitLayout = getLayout(afterSplit);
    const paneB = ((splitLayout as { children: LayoutNode[] }).children[1] as { paneId: string }).paneId;

    // Close B - should collapse to just A (a leaf, not a split wrapping A)
    const afterClose = (await mockInvoke('pane_close', { paneId: paneB })) as WorkspaceResult;
    const closedLayout = getLayout(afterClose);

    expect(closedLayout.type).toBe('leaf');
    expect((closedLayout as { paneId: string }).paneId).toBe(paneA);
  });

  it('swap preserves layout structure: only pane IDs change, tree shape stays identical', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layout = getLayout(ws);
    const paneA = (layout as { paneId: string }).paneId;

    // Split to get A+B
    const afterSplit = (await mockInvoke('pane_split', {
      paneId: paneA,
      direction: 'horizontal',
    })) as WorkspaceResult;
    const splitLayout = getLayout(afterSplit);
    const children = (splitLayout as { children: LayoutNode[] }).children;
    const paneB = (children[1] as { paneId: string }).paneId;

    // Capture structure before swap
    const directionBefore = (splitLayout as { direction: string }).direction;

    // Swap A and B
    const afterSwap = (await mockInvoke('pane_swap', {
      paneId: paneA,
      targetPaneId: paneB,
    })) as WorkspaceResult;
    const swappedLayout = getLayout(afterSwap);

    // Tree shape should be identical: split with same direction
    expect(swappedLayout.type).toBe('split');
    expect((swappedLayout as { direction: string }).direction).toBe(directionBefore);

    const swappedChildren = (swappedLayout as { children: LayoutNode[] }).children;
    expect(swappedChildren[0].type).toBe('leaf');
    expect(swappedChildren[1].type).toBe('leaf');

    // But pane IDs should be swapped: first child now has B, second has A
    expect((swappedChildren[0] as { paneId: string }).paneId).toBe(paneB);
    expect((swappedChildren[1] as { paneId: string }).paneId).toBe(paneA);
  });

  it('move to position: moving pane to right of target creates horizontal split', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layout = getLayout(ws);
    const paneA = (layout as { paneId: string }).paneId;

    // Split to get A+B
    const afterSplit = (await mockInvoke('pane_split', {
      paneId: paneA,
      direction: 'vertical',
    })) as WorkspaceResult;
    const splitLayout = getLayout(afterSplit);
    const paneB = ((splitLayout as { children: LayoutNode[] }).children[1] as { paneId: string }).paneId;

    // Move A to the right of B
    const afterMove = (await mockInvoke('pane_move', {
      paneId: paneA,
      targetPaneId: paneB,
      position: 'right',
    })) as WorkspaceResult;
    const movedLayout = getLayout(afterMove);

    // Result should be a horizontal split with B on the left and A on the right
    expect(movedLayout.type).toBe('split');
    expect((movedLayout as { direction: string }).direction).toBe('horizontal');
    const movedChildren = (movedLayout as { children: LayoutNode[] }).children;
    expect((movedChildren[0] as { paneId: string }).paneId).toBe(paneB);
    expect((movedChildren[1] as { paneId: string }).paneId).toBe(paneA);
  });

  it('double split symmetry: split A horizontally then split B vertically gives nested structure', async () => {
    const workspaces = (await mockInvoke('session_restore')) as WorkspaceResult[];
    const ws = workspaces[0];
    const layout = getLayout(ws);
    const paneA = (layout as { paneId: string }).paneId;

    // Split A horizontally → A + B
    const after1 = (await mockInvoke('pane_split', {
      paneId: paneA,
      direction: 'horizontal',
    })) as WorkspaceResult;
    const layout1 = getLayout(after1);
    expect(layout1.type).toBe('split');
    expect((layout1 as { direction: string }).direction).toBe('horizontal');
    const paneB = ((layout1 as { children: LayoutNode[] }).children[1] as { paneId: string }).paneId;

    // Split B vertically → B + C
    const after2 = (await mockInvoke('pane_split', {
      paneId: paneB,
      direction: 'vertical',
    })) as WorkspaceResult;
    const layout2 = getLayout(after2);

    // Top level: horizontal split with A on left, nested split on right
    expect(layout2.type).toBe('split');
    expect((layout2 as { direction: string }).direction).toBe('horizontal');
    const topChildren = (layout2 as { children: LayoutNode[] }).children;

    // Left child is A (leaf)
    expect(topChildren[0].type).toBe('leaf');
    expect((topChildren[0] as { paneId: string }).paneId).toBe(paneA);

    // Right child is a vertical split containing B + C
    expect(topChildren[1].type).toBe('split');
    expect((topChildren[1] as { direction: string }).direction).toBe('vertical');
    const nestedChildren = (topChildren[1] as { children: LayoutNode[] }).children;
    expect(nestedChildren[0].type).toBe('leaf');
    expect((nestedChildren[0] as { paneId: string }).paneId).toBe(paneB);
    expect(nestedChildren[1].type).toBe('leaf');
    // C is a new pane, just verify it exists and is different
    const paneC = (nestedChildren[1] as { paneId: string }).paneId;
    expect(paneC).not.toBe(paneA);
    expect(paneC).not.toBe(paneB);

    // Total leaves should be 3
    expect(countLeaves(layout2)).toBe(3);
  });
});
