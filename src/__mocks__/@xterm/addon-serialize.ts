import { vi } from 'vitest';

export class SerializeAddon {
  serialize = vi.fn(() => '');
  activate = vi.fn();
  dispose = vi.fn();
}
