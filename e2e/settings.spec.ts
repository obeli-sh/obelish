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

test.describe('settings modification', () => {
  test('opens settings modal with Ctrl+comma', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings-backdrop')).toBeVisible();
  });

  test('opens settings via preferences button in sidebar footer', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Preferences').click();
    await expect(page.getByTestId('settings-backdrop')).toBeVisible();
  });

  test('closes settings modal by toggling again', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings-backdrop')).toBeVisible();

    // Toggle settings closed via store (Escape is intercepted by keyboard handler)
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings-backdrop')).not.toBeVisible();
  });

  test('closes settings modal by clicking backdrop', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings-backdrop')).toBeVisible();

    await page.getByTestId('settings-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('settings-backdrop')).not.toBeVisible();
  });

  test('switches between settings categories', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings-backdrop')).toBeVisible();

    // General should be selected by default
    const generalBtn = page.getByRole('button', { name: 'General' });
    await expect(generalBtn).toHaveAttribute('aria-pressed', 'true');

    // Switch to Hotkeys
    await page.getByRole('button', { name: 'Hotkeys' }).click();
    await expect(page.getByRole('button', { name: 'Hotkeys' })).toHaveAttribute('aria-pressed', 'true');
    await expect(generalBtn).toHaveAttribute('aria-pressed', 'false');

    // Switch to Theme
    await page.getByRole('button', { name: 'Theme' }).click();
    await expect(page.getByRole('button', { name: 'Theme' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('changes preferred workspace layout preference', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    const dropdown = page.getByLabel('Preferred New Workspace Layout');
    await expect(dropdown).toBeVisible();

    await dropdown.selectOption('side-by-side');
    await expect(dropdown).toHaveValue('side-by-side');
  });

  test('toggles show all projects checkbox', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    const checkbox = page.getByLabel('Show All Projects in Sidebar');
    if (await checkbox.isVisible()) {
      const wasChecked = await checkbox.isChecked();
      await checkbox.click();
      if (wasChecked) {
        await expect(checkbox).not.toBeChecked();
      } else {
        await expect(checkbox).toBeChecked();
      }
    }
  });
});
