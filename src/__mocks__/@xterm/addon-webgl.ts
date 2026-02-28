import { vi } from 'vitest';

export class WebglAddon {
  activate = vi.fn();
  dispose = vi.fn();
  onContextLoss = vi.fn(() => ({ dispose: vi.fn() }));
}
