/**
 * Bridge Contract Tests
 *
 * Ensures that command names used in tauri-bridge.ts, browser-mock.ts handlers,
 * and #[tauri::command] functions in commands.rs all stay in sync.
 *
 * This catches drift like the #1 audit issue where list_directories was broken
 * but tests passed because mocks hid it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Extract all command name strings passed to safeInvoke in tauri-bridge.ts
function extractBridgeCommands(): string[] {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../tauri-bridge.ts'),
    'utf-8',
  );
  const matches = src.matchAll(/safeInvoke[^(]*\(\s*'([^']+)'/g);
  return [...matches].map((m) => m[1]);
}

// Extract all handler keys registered in browser-mock.ts
function extractMockHandlers(): string[] {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../browser-mock.ts'),
    'utf-8',
  );
  const startIdx = src.indexOf('const handlers:');
  if (startIdx === -1) throw new Error('Could not find handlers record in browser-mock.ts');
  const braceStart = src.indexOf('{', startIdx);
  const endIdx = src.indexOf('\n};', braceStart);
  if (endIdx === -1) throw new Error('Could not find end of handlers record');
  const body = src.slice(braceStart + 1, endIdx);
  const keys: string[] = [];
  for (const m of body.matchAll(/^  (\w+)\s*[:(]/gm)) {
    keys.push(m[1]);
  }
  return keys;
}

// Extract all #[tauri::command] function names from commands.rs
function extractRustCommands(): string[] {
  const commandsPath = path.resolve(__dirname, '..', '..', '..', 'src-tauri', 'src', 'commands.rs');
  const source = fs.readFileSync(commandsPath, 'utf-8');
  const lines = source.split('\n');
  const commands: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('#[tauri::command]')) {
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

  const bridgeSet = new Set(bridgeCommands);
  const mockSet = new Set(mockHandlers);
  const rustSet = new Set(rustCommands);

  it('extracts at least one command from each source', () => {
    expect(bridgeCommands.length).toBeGreaterThan(0);
    expect(mockHandlers.length).toBeGreaterThan(0);
    expect(rustCommands.length).toBeGreaterThan(0);
  });

  it('every bridge command has a corresponding mock handler', () => {
    const missing = bridgeCommands.filter((cmd) => !mockSet.has(cmd));
    expect(missing, `Bridge commands missing mock handlers: ${missing.join(', ')}`).toEqual([]);
  });

  it('every bridge command exists as a #[tauri::command] in Rust', () => {
    const missing = bridgeCommands.filter((cmd) => !rustSet.has(cmd));
    expect(missing, `Bridge commands missing Rust implementations: ${missing.join(', ')}`).toEqual([]);
  });

  it('every mock handler corresponds to a bridge command', () => {
    const extra = mockHandlers.filter((cmd) => !bridgeSet.has(cmd));
    expect(extra, `Orphan mock handlers: ${extra.join(', ')}`).toEqual([]);
  });

  it('every Rust command is used by the bridge', () => {
    const unused = rustCommands.filter((cmd) => !bridgeSet.has(cmd));
    expect(unused, `Orphan Rust commands: ${unused.join(', ')}`).toEqual([]);
  });

  it('no duplicate command names in bridge', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const cmd of bridgeCommands) {
      if (seen.has(cmd)) dupes.push(cmd);
      seen.add(cmd);
    }
    expect(dupes, `Duplicate bridge commands: ${dupes.join(', ')}`).toEqual([]);
  });

  it('no duplicate mock handler keys', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const key of mockHandlers) {
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes, `Duplicate mock handlers: ${dupes.join(', ')}`).toEqual([]);
  });

  it('no duplicate Rust command names', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const cmd of rustCommands) {
      if (seen.has(cmd)) dupes.push(cmd);
      seen.add(cmd);
    }
    expect(dupes, `Duplicate Rust commands: ${dupes.join(', ')}`).toEqual([]);
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

// ---------------------------------------------------------------------------
// Argument Shape Sync helpers
// ---------------------------------------------------------------------------

/** Convert camelCase to snake_case */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase());
}

/**
 * Extract argument keys passed to safeInvoke for each command in tauri-bridge.ts.
 *
 * Handles three patterns:
 *   1. safeInvoke<T>('cmd', { key1, key2 })          — shorthand object
 *   2. safeInvoke<T>('cmd', args)                     — forwarded opaque arg (PtySpawnArgs)
 *   3. safeInvoke<T>('cmd', args as Record<...>)      — forwarded with cast
 *   4. safeInvoke<T>('cmd')                           — no args
 *
 * For pattern 1 we return the key names. For pattern 2/3 we resolve the
 * interface fields from the same file. For pattern 4 we return [].
 */
function extractBridgeArgsByCommand(): Map<string, string[]> {
  const bridgePath = path.resolve(__dirname, '..', 'tauri-bridge.ts');
  const source = fs.readFileSync(bridgePath, 'utf-8');

  const result = new Map<string, string[]>();

  // Match safeInvoke calls with their full argument portion
  const invocations = source.matchAll(
    /safeInvoke[^(]*\(\s*'([^']+)'(?:\s*,\s*([^)]+))?\)/g,
  );

  for (const m of invocations) {
    const cmdName = m[1];
    const argsExpr = m[2]?.trim();

    if (!argsExpr) {
      // No args passed (e.g. session_save, workspace_list)
      result.set(cmdName, []);
      continue;
    }

    // If the arg expression is an object literal: { key1, key2, ... }
    const objMatch = argsExpr.match(/^\{([^}]+)\}/);
    if (objMatch) {
      const keys = objMatch[1]
        .split(',')
        .map((k) => k.trim())
        .map((k) => {
          // Handle 'key: value' and shorthand 'key'
          const colonIdx = k.indexOf(':');
          return colonIdx >= 0 ? k.substring(0, colonIdx).trim() : k;
        })
        .filter((k) => k.length > 0);
      result.set(cmdName, keys);
      continue;
    }

    // If the arg is a forwarded variable (like `args` or `args as Record<...>`)
    // we need to find the interface. Look for PtySpawnArgs.
    if (argsExpr.startsWith('args')) {
      // Find the function that calls this command — look backwards from position
      // to find the parameter type. For pty_spawn, it's PtySpawnArgs.
      const interfaceMatch = source.match(
        /export interface PtySpawnArgs\s*\{([^}]+)\}/,
      );
      if (interfaceMatch && cmdName === 'pty_spawn') {
        const keys = interfaceMatch[1]
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('//'))
          .map((line) => {
            const match = line.match(/^(\w+)\??:/);
            return match ? match[1] : '';
          })
          .filter((k) => k.length > 0);
        result.set(cmdName, keys);
        continue;
      }

      // workspace_create also uses an inline `args` parameter
      // Look for the function parameter type
      const fnCallLine = source.substring(
        Math.max(0, (m.index ?? 0) - 200),
        m.index ?? 0,
      );
      const inlineObjMatch = fnCallLine.match(
        /\(args:\s*\{([^}]+)\}\)/,
      );
      if (inlineObjMatch) {
        const keys = inlineObjMatch[1]
          .split(';')
          .concat(inlineObjMatch[1].split(','))
          .map((s) => s.trim())
          .map((s) => {
            const match = s.match(/^(\w+)\??:/);
            return match ? match[1] : '';
          })
          .filter((k) => k.length > 0);
        // Deduplicate
        result.set(cmdName, [...new Set(keys)]);
        continue;
      }
    }

    // Fallback — record empty (should not happen for well-formed bridge)
    result.set(cmdName, []);
  }

  return result;
}

/**
 * Extract parameter names for each #[tauri::command] function in commands.rs,
 * excluding Tauri-injected params (State<...>, AppHandle).
 */
interface RustParamInfo {
  required: string[];
  optional: string[];
}

function extractRustParamsByCommand(): Map<string, RustParamInfo> {
  const commandsPath = path.resolve(
    __dirname, '..', '..', '..', 'src-tauri', 'src', 'commands.rs',
  );
  const source = fs.readFileSync(commandsPath, 'utf-8');
  const lines = source.split('\n');
  const result = new Map<string, RustParamInfo>();

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('#[tauri::command]')) continue;

    // Find the fn signature
    let fnName = '';
    let sigStart = -1;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const fnMatch = lines[j].match(/pub\s+(?:async\s+)?fn\s+(\w+)\s*\(/);
      if (fnMatch) {
        fnName = fnMatch[1];
        sigStart = j;
        break;
      }
    }
    if (!fnName || sigStart < 0) continue;

    // Collect lines until we find the closing `)` of the fn signature
    let sigText = '';
    for (let j = sigStart; j < lines.length; j++) {
      sigText += lines[j] + '\n';
      if (lines[j].includes(')')) break;
    }

    // Extract parameters — split by commas, but be careful of generic types
    // Remove the fn header and trailing return type
    const paramsSection = sigText
      .replace(/pub\s+(?:async\s+)?fn\s+\w+\s*\(/, '')
      .replace(/\)\s*->[\s\S]*/, '')
      .replace(/\)\s*\{[\s\S]*/, '')
      .trim();

    if (!paramsSection || paramsSection === ')') {
      result.set(fnName, { required: [], optional: [] });
      continue;
    }

    // Split params — each param is "name: Type"
    // Handle multi-line by normalizing
    const normalized = paramsSection.replace(/\n/g, ' ').replace(/\s+/g, ' ');

    const params: string[] = [];
    // Split on commas that are not inside angle brackets
    let depth = 0;
    let current = '';
    for (const ch of normalized) {
      if (ch === '<') depth++;
      else if (ch === '>') depth--;
      else if (ch === ',' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) params.push(trimmed);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) params.push(current.trim());

    // Extract param names and whether they're Option<T>, skipping Tauri-injected ones
    const required: string[] = [];
    const optional: string[] = [];
    for (const param of params) {
      const nameMatch = param.match(/^\s*(\w+)\s*:/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      // Skip Tauri-injected parameters
      if (name === 'state' || name === 'app') continue;
      if (param.includes('Option<')) {
        optional.push(name);
      } else {
        required.push(name);
      }
    }

    result.set(fnName, { required, optional });
  }

  return result;
}

describe('Bridge Contract: argument shape sync', () => {
  const bridgeArgs = extractBridgeArgsByCommand();
  const rustParams = extractRustParamsByCommand();

  it('extracts argument info from both sources', () => {
    expect(bridgeArgs.size).toBeGreaterThan(0);
    expect(rustParams.size).toBeGreaterThan(0);
  });

  it('every bridge arg key maps to a valid Rust parameter (camelCase → snake_case)', () => {
    const mismatches: string[] = [];

    for (const [cmd, tsKeys] of bridgeArgs) {
      const rustInfo = rustParams.get(cmd);
      if (!rustInfo) continue; // existence checked by other describe block
      if (tsKeys.length === 0) continue;

      const allRustParams = new Set([...rustInfo.required, ...rustInfo.optional]);
      const tsAsSnake = tsKeys.map(camelToSnake);

      for (const snakeKey of tsAsSnake) {
        if (!allRustParams.has(snakeKey)) {
          mismatches.push(
            `${cmd}: bridge key "${snakeKey}" not found in Rust params [${[...allRustParams].join(', ')}]`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('every required Rust parameter is passed by the bridge', () => {
    const missing: string[] = [];

    for (const [cmd, tsKeys] of bridgeArgs) {
      const rustInfo = rustParams.get(cmd);
      if (!rustInfo) continue;

      const tsSnakeSet = new Set(tsKeys.map(camelToSnake));

      for (const req of rustInfo.required) {
        if (!tsSnakeSet.has(req)) {
          missing.push(
            `${cmd}: required Rust param "${req}" not passed by bridge (bridge passes [${tsKeys.join(', ')}])`,
          );
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('bridge commands with no args correspond to Rust commands with no required params', () => {
    const unexpected: string[] = [];

    for (const [cmd, tsKeys] of bridgeArgs) {
      if (tsKeys.length > 0) continue;
      const rustInfo = rustParams.get(cmd);
      if (!rustInfo) continue;
      if (rustInfo.required.length > 0) {
        unexpected.push(
          `${cmd}: bridge passes no args but Rust requires [${rustInfo.required.join(', ')}]`,
        );
      }
    }

    expect(unexpected).toEqual([]);
  });

  it('Rust commands with required params have corresponding bridge args', () => {
    const missing: string[] = [];

    for (const [cmd, rustInfo] of rustParams) {
      if (rustInfo.required.length === 0) continue;
      const tsKeys = bridgeArgs.get(cmd);
      if (!tsKeys) continue; // existence checked elsewhere
      if (tsKeys.length === 0) {
        missing.push(
          `${cmd}: Rust requires [${rustInfo.required.join(', ')}] but bridge passes no args`,
        );
      }
    }

    expect(missing).toEqual([]);
  });

  it('camelToSnake utility works correctly', () => {
    expect(camelToSnake('paneId')).toBe('pane_id');
    expect(camelToSnake('targetPaneId')).toBe('target_pane_id');
    expect(camelToSnake('workspaceId')).toBe('workspace_id');
    expect(camelToSnake('newName')).toBe('new_name');
    expect(camelToSnake('partialPath')).toBe('partial_path');
    expect(camelToSnake('branchName')).toBe('branch_name');
    expect(camelToSnake('direction')).toBe('direction');
    expect(camelToSnake('data')).toBe('data');
  });

  it('bridge arg count is between required and total Rust param count', () => {
    const countMismatches: string[] = [];

    for (const [cmd, tsKeys] of bridgeArgs) {
      const rustInfo = rustParams.get(cmd);
      if (!rustInfo) continue;
      const minParams = rustInfo.required.length;
      const maxParams = rustInfo.required.length + rustInfo.optional.length;
      if (tsKeys.length < minParams || tsKeys.length > maxParams) {
        countMismatches.push(
          `${cmd}: bridge has ${tsKeys.length} args, Rust has ${minParams} required + ${rustInfo.optional.length} optional`,
        );
      }
    }

    expect(countMismatches).toEqual([]);
  });

  it('specific critical commands have expected argument shapes', () => {
    // Verify a selection of important commands have the exact args we expect
    const expectations: [string, string[]][] = [
      ['pty_write', ['ptyId', 'data']],
      ['pty_resize', ['ptyId', 'cols', 'rows']],
      ['pty_kill', ['ptyId']],
      ['pane_split', ['paneId', 'direction', 'shell']],
      ['pane_close', ['paneId']],
      ['pane_swap', ['paneId', 'targetPaneId']],
      ['pane_move', ['paneId', 'targetPaneId', 'position']],
      ['workspace_close', ['workspaceId']],
      ['workspace_rename', ['workspaceId', 'newName']],
      ['settings_update', ['key', 'value']],
      ['scrollback_save', ['paneId', 'data']],
      ['scrollback_load', ['paneId']],
    ];

    for (const [cmd, expectedKeys] of expectations) {
      const actual = bridgeArgs.get(cmd);
      expect(actual).toBeDefined();
      expect(actual?.sort()).toEqual([...expectedKeys].sort());
    }
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

    // Split A horizontally -> A + B
    const after1 = (await mockInvoke('pane_split', {
      paneId: paneA,
      direction: 'horizontal',
    })) as WorkspaceResult;
    const layout1 = getLayout(after1);
    expect(layout1.type).toBe('split');
    expect((layout1 as { direction: string }).direction).toBe('horizontal');
    const paneB = ((layout1 as { children: LayoutNode[] }).children[1] as { paneId: string }).paneId;

    // Split B vertically -> B + C
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
