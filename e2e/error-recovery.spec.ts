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

test.describe('error recovery flows', () => {
  test('closing all workspaces still renders the app without crashing', async ({ page }) => {
    await openApp(page);

    // Close the only workspace
    const closeBtn = page.getByRole('listitem').first().getByLabel(/close/i);
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      // Try closing via mock directly
      await page.evaluate(async () => {
        const { mockInvoke } = await import('/src/lib/browser-mock.ts');
        const list = (await mockInvoke('workspace_list')) as Array<{ id: string }>;
        if (list.length > 0) {
          await mockInvoke('workspace_close', { workspaceId: list[0].id });
        }
      });
    }

    // App should still be functional — navigation should remain
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('calling an unregistered command does not crash the app', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const res = await mockInvoke('nonexistent_command', { foo: 'bar' });
      return res;
    });

    expect(result).toBeUndefined();
    // App should still be functional
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('pane close on invalid pane ID does not crash', async ({ page }) => {
    await openApp(page);

    await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      await mockInvoke('pane_close', { paneId: 'nonexistent-pane-id' });
    });

    // App should still work
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('workspace rename with empty name is handled gracefully', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = (await mockInvoke('workspace_list')) as Array<{ id: string; name: string }>;
      const before = list[0].name;
      await mockInvoke('workspace_rename', { workspaceId: list[0].id, newName: '' });
      const after = (await mockInvoke('workspace_list')) as Array<{ id: string; name: string }>;
      return { before, after: after[0].name };
    });

    // Name should remain unchanged since empty string is rejected
    expect(result.after).toBe(result.before);
  });

  test('splitting with invalid pane ID does not crash', async ({ page }) => {
    await openApp(page);

    await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      await mockInvoke('pane_split', { paneId: 'nonexistent', direction: 'horizontal' });
    });

    // App should still be functional
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('app recovers from reload without losing basic functionality', async ({ page }) => {
    await openApp(page);

    // Make some changes
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Force reload — need full openApp treatment after reload
    await page.reload({ waitUntil: 'commit' });
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

    // Basic functionality should still work (mock resets on reload, so 1 pane)
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });
});
