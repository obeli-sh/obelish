import { test, expect, type Page } from '@playwright/test';

async function loadApp(page: Page) {
  await page.goto('/', { waitUntil: 'commit', timeout: 90_000 });
  // Wait for the app to finish loading
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 100;
  }, { timeout: 30_000 });
}

async function openApp(page: Page) {
  await loadApp(page);
  // Programmatically close the project picker and restore default keybindings
  await page.evaluate(async () => {
    const uiStore = await import('/src/stores/uiStore.ts');
    const settingsStore = await import('/src/stores/settingsStore.ts');
    uiStore.useUiStore.getState().setProjectPickerOpen(false);
    settingsStore.useSettingsStore.getState().resetAllKeybindings();
  });
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
}

test.describe('project open flow', () => {
  test('shows project picker on fresh app load', async ({ page }) => {
    await loadApp(page);
    await expect(page.getByText('Open a Project')).toBeVisible();
  });

  test('project picker shows path input for adding projects', async ({ page }) => {
    await loadApp(page);
    await expect(page.getByPlaceholder(/folder path/i)).toBeVisible();
    await expect(page.getByText('Open Folder')).toBeVisible();
  });

  test('closes project picker with Escape when workspaces exist', async ({ page }) => {
    await loadApp(page);
    await expect(page.getByText('Open a Project')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 10_000 });
  });

  test('opens project picker via keyboard shortcut Ctrl+Shift+O', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+O');
    await expect(page.getByText('Open a Project')).toBeVisible({ timeout: 10_000 });
  });

  test('opens project picker via Ctrl+N shortcut', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+N');
    await expect(page.getByText('Open a Project')).toBeVisible({ timeout: 10_000 });
  });
});
