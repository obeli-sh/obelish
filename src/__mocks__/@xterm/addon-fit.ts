import { vi } from 'vitest';

export class FitAddon {
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  activate = vi.fn();
  dispose = vi.fn();
}
