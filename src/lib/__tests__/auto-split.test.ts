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

  it('returns vertical when both dimensions are zero', () => {
    expect(getAutoSplitDirection(0, 0)).toBe('vertical');
  });

  it('returns vertical when both dimensions are negative', () => {
    expect(getAutoSplitDirection(-10, -20)).toBe('vertical');
  });

  it('returns horizontal when height is strictly greater than width (positive)', () => {
    expect(getAutoSplitDirection(499, 500)).toBe('horizontal');
  });

  it('returns vertical when width is exactly one more than height', () => {
    expect(getAutoSplitDirection(501, 500)).toBe('vertical');
  });

  it('returns vertical for width=1 and height=0 (boundary: non-positive height)', () => {
    expect(getAutoSplitDirection(1, 0)).toBe('vertical');
  });

  it('returns vertical for width=0 and height=1 (boundary: non-positive width)', () => {
    expect(getAutoSplitDirection(0, 1)).toBe('vertical');
  });

  it('returns horizontal for width=1, height=2 (small positive values)', () => {
    expect(getAutoSplitDirection(1, 2)).toBe('horizontal');
  });

  it('returns vertical for width=2, height=1 (small positive values)', () => {
    expect(getAutoSplitDirection(2, 1)).toBe('vertical');
  });

  it('returns vertical for equal small positive dimensions', () => {
    expect(getAutoSplitDirection(1, 1)).toBe('vertical');
  });
});
