import { vi } from 'vitest';

export class WebglAddon {
  static shouldThrow = false;

  activate = vi.fn();
  dispose = vi.fn();
  onContextLoss = vi.fn(() => ({ dispose: vi.fn() }));

  constructor() {
    if (WebglAddon.shouldThrow) {
      throw new Error('WebGL not supported');
    }
  }
}
