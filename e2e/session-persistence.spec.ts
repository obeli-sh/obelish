import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'commit', timeout: 90_000 });
  // Wait for the app to finish loading (either shows picker or navigation)
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 100;
  }, { timeout: 30_000 });
  // Programmatically close the project picker and restore default keybindings
  await page.evaluate(async () => {
    const uiStore = await import('/src/stores/uiStore.ts');
    const settingsStore = await import('/src/stores/settingsStore.ts');
    uiStore.useUiStore.getState().setProjectPickerOpen(false);
    settingsStore.useSettingsStore.getState().resetAllKeybindings();
  });
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
}

test.describe('session persistence and restore', () => {
  test('restores session on app load with at least one workspace', async ({ page }) => {
    await openApp(page);

    // session_restore mock returns workspaces; verify one exists
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('session state reflects workspace changes after split', async ({ page }) => {
    await openApp(page);

    // Split to modify the layout
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Verify mock state has the updated layout
    const layoutDirection = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = (await mockInvoke('workspace_list')) as Array<Record<string, unknown>>;
      const surfaces = list[0].surfaces as Array<Record<string, unknown>>;
      const layout = surfaces[0].layout as Record<string, unknown>;
      return layout.direction;
    });

    expect(layoutDirection).toBe('horizontal');
  });

  test('session save can be triggered without error', async ({ page }) => {
    await openApp(page);

    // Trigger session_save through the mock — should not throw
    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      await mockInvoke('session_save');
      return 'ok';
    });

    expect(result).toBe('ok');
  });

  test('fresh reload restores to initial state', async ({ page }) => {
    await openApp(page);

    // Create extra workspace programmatically
    await page.evaluate(async () => {
      const bridge = await import('/src/lib/tauri-bridge.ts');
      const wsStore = await import('/src/stores/workspaceStore.ts');
      const ws = await bridge.tauriBridge.workspace.create({ projectId: '', worktreePath: '', name: undefined });
      wsStore.useWorkspaceStore.getState()._syncWorkspace(ws);
    });
    await expect(page.getByRole('listitem')).toHaveCount(2, { timeout: 5_000 });

    // Reload the page — mock resets, restoring fresh state
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return root && root.innerHTML.length > 100;
    }, { timeout: 30_000 });
    // Dismiss project picker after reload
    await page.evaluate(async () => {
      const uiStore = await import('/src/stores/uiStore.ts');
      uiStore.useUiStore.getState().setProjectPickerOpen(false);
    });
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('listitem')).toHaveCount(1);
  });
});
