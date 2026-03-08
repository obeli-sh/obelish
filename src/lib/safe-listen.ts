import { listen } from '@tauri-apps/api/event';
import { isTauri, mockListen } from './browser-mock';

export function safeListen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (typeof window !== 'undefined' && !isTauri()) {
    return mockListen(event, handler as (event: { payload: unknown }) => void);
  }
  try {
    return listen<T>(event, handler);
  } catch {
    return mockListen(event, handler as (event: { payload: unknown }) => void);
  }
}
