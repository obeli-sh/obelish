import { vi } from 'vitest';

type EventHandler = (event: { payload: unknown }) => void;
const eventHandlers = new Map<string, EventHandler[]>();

export const listen = vi.fn((event: string, handler: EventHandler) => {
  const handlers = eventHandlers.get(event) || [];
  handlers.push(handler);
  eventHandlers.set(event, handlers);
  const unlisten = vi.fn(() => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  });
  return Promise.resolve(unlisten);
});

export function emitMockEvent(event: string, payload: unknown) {
  const handlers = eventHandlers.get(event) || [];
  handlers.forEach(h => h({ payload }));
}

export function clearEventMocks() {
  eventHandlers.clear();
  listen.mockClear();
}
