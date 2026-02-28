import type { SplitDirection } from './workspace-types';

export function getAutoSplitDirection(width: number, height: number): SplitDirection {
  if (width <= 0 || height <= 0) return 'vertical';
  return width >= height ? 'vertical' : 'horizontal';
}
