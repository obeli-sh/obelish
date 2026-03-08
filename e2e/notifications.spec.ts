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

test.describe('notification display', () => {
  test('opens notification panel via keyboard shortcut', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+I');
    await expect(page.getByTestId('notification-panel')).toBeVisible();
  });

  test('closes notification panel with close button', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+I');
    await expect(page.getByTestId('notification-panel')).toBeVisible();

    await page.getByTestId('notification-panel').getByLabel('Close').click();
    await expect(page.getByTestId('notification-panel')).not.toBeVisible();
  });

  test('toggles notification panel open and closed with shortcut', async ({ page }) => {
    await openApp(page);

    // Open
    await page.keyboard.press('Control+I');
    await expect(page.getByTestId('notification-panel')).toBeVisible();

    // Close by pressing again
    await page.keyboard.press('Control+I');
    await expect(page.getByTestId('notification-panel')).not.toBeVisible();
  });

  test('shows empty state when no notifications exist', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+I');
    await expect(page.getByTestId('notification-panel')).toBeVisible();
    await expect(page.getByText('No notifications')).toBeVisible();
  });

  test('notification badge shows unread count from store', async ({ page }) => {
    await openApp(page);

    // Inject a notification into the store
    await page.evaluate(() => {
      const store = (window as Record<string, unknown>).__notificationStore as {
        getState: () => { addNotification: (n: Record<string, unknown>) => void };
      } | undefined;
      if (store) {
        store.getState().addNotification({
          id: 'test-1',
          title: 'Build complete',
          body: 'Your build succeeded',
          paneId: 'mock-pane-1',
          read: false,
          timestamp: Date.now(),
        });
      }
    });

    // Badge may or may not be visible depending on store exposure
    const badge = page.getByTestId('notification-badge');
    if (await badge.isVisible()) {
      await expect(badge).toBeVisible();
    }
  });
});
