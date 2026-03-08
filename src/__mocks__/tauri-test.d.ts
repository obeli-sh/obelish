export {};

declare module '@tauri-apps/api/core' {
  export function mockInvoke(cmd: string, handler: (...args: unknown[]) => unknown): void;
  export function clearInvokeMocks(): void;
}

declare module '@tauri-apps/api/event' {
  export function emitMockEvent(event: string, payload: unknown): void;
  export function clearEventMocks(): void;
}
