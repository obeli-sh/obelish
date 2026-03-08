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

test.describe('browser pane navigation', () => {
  test('opens a browser pane from terminal toolbar', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();
    await expect(page.getByTitle('Browser panel')).toBeVisible();
  });

  test('browser pane shows URL input with about:blank', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();
    await expect(page.getByLabel('URL').first()).toHaveValue('about:blank');
  });

  test('opens browser pane via toolbar open-browser button', async ({ page }) => {
    await openApp(page);

    // Use toolbar button directly (Ctrl+Shift+B is intercepted by Firefox)
    await page.getByTestId('pane-wrapper').first().getByLabel('Open browser').click();
    await expect(page.getByTitle('Browser panel')).toBeVisible({ timeout: 10_000 });
  });

  test('typing a URL in the address bar updates the browser pane', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();
    await expect(page.getByTitle('Browser panel')).toBeVisible();

    const urlInput = page.getByLabel('URL').first();
    await urlInput.fill('https://example.com');
    await urlInput.press('Enter');

    // URL should be retained in input
    await expect(urlInput).toHaveValue('https://example.com');
  });

  test('back and forward buttons exist in browser toolbar', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();
    await expect(page.getByTitle('Browser panel')).toBeVisible();

    await expect(page.getByLabel('Go back')).toBeVisible();
    await expect(page.getByLabel('Go forward')).toBeVisible();
    await expect(page.getByLabel('Refresh page')).toBeVisible();
  });

  test('back and forward buttons are initially disabled', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();
    await expect(page.getByTitle('Browser panel')).toBeVisible();

    await expect(page.getByLabel('Go back')).toBeDisabled();
    await expect(page.getByLabel('Go forward')).toBeDisabled();
  });

  test('browser pane coexists with terminal pane after split', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Both terminal and browser should be visible
    await expect(page.getByTestId('terminal-container').first()).toBeVisible();
    await expect(page.getByTitle('Browser panel')).toBeVisible();
  });
});
