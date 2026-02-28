// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { getAutoSplitDirection } from '../auto-split';

describe('getAutoSplitDirection', () => {
  it('returns vertical for wide pane (split side-by-side)', () => {
    expect(getAutoSplitDirection(800, 400)).toBe('vertical');
  });

  it('returns horizontal for tall pane (split top/bottom)', () => {
    expect(getAutoSplitDirection(400, 800)).toBe('horizontal');
  });

  it('returns vertical for square pane (tie-break)', () => {
    expect(getAutoSplitDirection(500, 500)).toBe('vertical');
  });

  it('returns vertical for zero width', () => {
    expect(getAutoSplitDirection(0, 400)).toBe('vertical');
  });

  it('returns vertical for zero height', () => {
    expect(getAutoSplitDirection(800, 0)).toBe('vertical');
  });

  it('returns vertical for negative dimensions', () => {
    expect(getAutoSplitDirection(-100, 400)).toBe('vertical');
    expect(getAutoSplitDirection(400, -100)).toBe('vertical');
  });
});
