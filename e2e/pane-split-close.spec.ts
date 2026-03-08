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

test.describe('pane split and close', () => {
  test('splits a pane vertically via toolbar button', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('splits a pane horizontally via toolbar button', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByLabel('Split horizontal').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('closes a pane via toolbar close button', async ({ page }) => {
    await openApp(page);

    // Split first to have two panes
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Close one pane
    await page.getByTestId('pane-wrapper').first().getByLabel('Close').click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('splits a pane via keyboard shortcut Ctrl+Shift+V', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByTestId('pane-wrapper').first().click();
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2, { timeout: 10_000 });
  });

  test('splits a pane via keyboard shortcut Ctrl+Shift+H', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByTestId('pane-wrapper').first().click();
    await page.keyboard.press('Control+Shift+H');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2, { timeout: 10_000 });
  });

  test('closes a pane via keyboard shortcut Ctrl+W', async ({ page }) => {
    await openApp(page);

    // Split first
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Focus the first pane, then close with shortcut
    await page.getByTestId('pane-wrapper').first().click();
    await page.keyboard.press('Control+W');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1, { timeout: 10_000 });
  });

  test('closing the last pane creates a fresh terminal pane', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    // Close the only pane
    await page.getByTestId('pane-wrapper').first().getByLabel('Close').click();

    // A new pane should be created to replace it
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('multiple splits create the correct number of panes', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(3);
  });
});
