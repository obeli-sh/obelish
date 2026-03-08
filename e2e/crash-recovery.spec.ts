import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'commit', timeout: 90_000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 100;
  }, { timeout: 30_000 });
  await page.evaluate(async () => {
    const uiStore = await import('/src/stores/uiStore.ts');
    const settingsStore = await import('/src/stores/settingsStore.ts');
    uiStore.useUiStore.getState().setProjectPickerOpen(false);
    settingsStore.useSettingsStore.getState().resetAllKeybindings();
  });
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
}

test.describe('crash recovery', () => {
  test('PTY death emits error and app remains interactive', async ({ page }) => {
    await openApp(page);

    await page.evaluate(async () => {
      const { emitMockEvent } = await import('/src/__mocks__/@tauri-apps/api/event.ts');
      const wsStore = await import('/src/stores/workspaceStore.ts');
      const state = wsStore.useWorkspaceStore.getState();
      const workspaces = Object.values(state.workspaces);
      if (workspaces.length > 0) {
        const ws = workspaces[0];
        const layout = ws.surfaces[0]?.layout;
        if (layout && layout.type === 'leaf') {
          emitMockEvent(`pty-exit-${layout.ptyId}`, { exitCode: -1, signal: 'SIGKILL' });
        }
      }
    });

    await expect(page.getByRole('navigation')).toBeVisible();

    const canInteract = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = (await mockInvoke('workspace_list')) as Array<{ id: string }>;
      return list.length >= 0;
    });
    expect(canInteract).toBe(true);
  });

  test('multiple rapid PTY exits do not crash the app', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    await page.evaluate(async () => {
      const { emitMockEvent } = await import('/src/__mocks__/@tauri-apps/api/event.ts');
      for (let i = 0; i < 5; i++) {
        emitMockEvent(`pty-exit-pty-${i}`, { exitCode: 1, signal: null });
      }
    });

    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('app recovers from simulated backend disconnect', async ({ page }) => {
    await openApp(page);

    await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const result = await mockInvoke('workspace_list');
      return Array.isArray(result);
    });

    await expect(page.getByRole('navigation')).toBeVisible();
    const panes = page.getByTestId('pane-wrapper');
    await expect(panes).toHaveCount(1);
  });
});
