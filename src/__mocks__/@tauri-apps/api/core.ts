import { vi } from 'vitest';

const invokeHandlers = new Map<string, (...args: unknown[]) => unknown>();

export const invoke = vi.fn((cmd: string, args?: unknown) => {
  const handler = invokeHandlers.get(cmd);
  if (handler) return Promise.resolve(handler(args));
  throw new Error(`No mock handler for command: ${cmd}`);
});

export function mockInvoke(cmd: string, handler: (...args: unknown[]) => unknown) {
  invokeHandlers.set(cmd, handler);
}

export function clearInvokeMocks() {
  invokeHandlers.clear();
  invoke.mockClear();
}
