import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Bridge contract tests: verify that tauri-bridge.ts commands, browser-mock.ts
 * handlers, and Rust #[tauri::command] functions stay in sync.
 */

function extractBridgeCommands(): string[] {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../tauri-bridge.ts'),
    'utf-8',
  );
  // Match safeInvoke<...>('command_name') — use a simple pattern that skips
  // the generic type parameter (which may contain nested angle brackets).
  const matches = src.matchAll(/safeInvoke[^(]*\(\s*'([^']+)'/g);
  return [...matches].map((m) => m[1]);
}

function extractMockHandlerKeys(): string[] {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../browser-mock.ts'),
    'utf-8',
  );
  const startIdx = src.indexOf('const handlers:');
  if (startIdx === -1) throw new Error('Could not find handlers record in browser-mock.ts');
  const braceStart = src.indexOf('{', startIdx);
  // Find the matching closing `};` at column 0
  const endIdx = src.indexOf('\n};', braceStart);
  if (endIdx === -1) throw new Error('Could not find end of handlers record');
  const body = src.slice(braceStart + 1, endIdx);
  const keys: string[] = [];
  // Match top-level keys: exactly 2-space indented identifiers followed by : or (
  for (const m of body.matchAll(/^  (\w+)\s*[:(]/gm)) {
    keys.push(m[1]);
  }
  return keys;
}

function extractRustCommands(): string[] {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../src-tauri/src/commands.rs'),
    'utf-8',
  );
  const cmds: string[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('#[tauri::command]')) {
      // Scan forward for `pub fn <name>` or `pub async fn <name>`
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const fnMatch = lines[j].match(/pub\s+(?:async\s+)?fn\s+(\w+)/);
        if (fnMatch) {
          cmds.push(fnMatch[1]);
          break;
        }
      }
    }
  }
  return cmds;
}

describe('Bridge contract', () => {
  const bridgeCommands = extractBridgeCommands();
  const mockKeys = extractMockHandlerKeys();
  const rustCommands = extractRustCommands();

  const bridgeSet = new Set(bridgeCommands);
  const mockSet = new Set(mockKeys);
  const rustSet = new Set(rustCommands);

  it('extracts at least one command from each source', () => {
    expect(bridgeCommands.length).toBeGreaterThan(0);
    expect(mockKeys.length).toBeGreaterThan(0);
    expect(rustCommands.length).toBeGreaterThan(0);
  });

  it('every bridge command has a mock handler', () => {
    const missing = bridgeCommands.filter((cmd) => !mockSet.has(cmd));
    expect(missing, `Bridge commands missing mock handlers: ${missing.join(', ')}`).toEqual([]);
  });

  it('every bridge command exists as a Rust command', () => {
    const missing = bridgeCommands.filter((cmd) => !rustSet.has(cmd));
    expect(missing, `Bridge commands missing Rust implementations: ${missing.join(', ')}`).toEqual([]);
  });

  it('no orphan mock handlers (every mock key maps to a bridge command)', () => {
    const orphans = mockKeys.filter((key) => !bridgeSet.has(key));
    expect(orphans, `Orphan mock handlers: ${orphans.join(', ')}`).toEqual([]);
  });

  it('no orphan Rust commands (every Rust command maps to a bridge command)', () => {
    const orphans = rustCommands.filter((cmd) => !bridgeSet.has(cmd));
    expect(orphans, `Orphan Rust commands: ${orphans.join(', ')}`).toEqual([]);
  });

  it('no duplicate bridge command names', () => {
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
    for (const key of mockKeys) {
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
