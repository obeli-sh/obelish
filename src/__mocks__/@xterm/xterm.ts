import { vi } from 'vitest';

export class Terminal {
  static instances: Terminal[] = [];

  options: unknown;
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  onResize = vi.fn(() => ({ dispose: vi.fn() }));
  onTitleChange = vi.fn(() => ({ dispose: vi.fn() }));
  open = vi.fn();
  write = vi.fn((_data: unknown, callback?: () => void) => callback?.());
  dispose = vi.fn();
  loadAddon = vi.fn();
  focus = vi.fn();
  clear = vi.fn();
  reset = vi.fn();
  constructor(options?: unknown) {
    this.options = options;
    Terminal.instances.push(this);
  }
}
