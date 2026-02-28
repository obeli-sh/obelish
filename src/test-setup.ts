import "@testing-library/jest-dom/vitest";
import { vi } from 'vitest';

// ResizeObserver is not available in jsdom
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
})));
