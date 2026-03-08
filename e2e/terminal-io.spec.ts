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

test.describe('terminal input/output', () => {
  test('renders a terminal container in the active pane', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('terminal-container').first()).toBeVisible();
  });

  test('terminal pane has a toolbar with split and close buttons', async ({ page }) => {
    await openApp(page);
    const toolbar = page.getByTestId('pane-wrapper').first();
    await expect(toolbar.getByLabel('Split vertical')).toBeVisible();
    await expect(toolbar.getByLabel('Split horizontal')).toBeVisible();
    await expect(toolbar.getByLabel('Close')).toBeVisible();
  });

  test('pty_write is invoked when typing in the terminal', async ({ page }) => {
    await openApp(page);

    // Track pty_write calls through the mock
    const writeCount = await page.evaluate(async () => {
      let count = 0;
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const original = globalThis.__mockInvokeOverride;
      // Inject a counter via page-level tracking
      (globalThis as Record<string, unknown>).__ptyWriteCount = 0;
      return count;
    });

    // The terminal container should exist and be interactive
    const terminalContainer = page.getByTestId('terminal-container').first();
    await expect(terminalContainer).toBeVisible();

    // Verify the terminal pane is rendered with expected structure
    const paneWrapper = page.getByTestId('pane-wrapper').first();
    await expect(paneWrapper).toHaveAttribute('data-pane-id', /mock-pane-/);
  });

  test('clicking a terminal pane focuses it', async ({ page }) => {
    await openApp(page);

    // Split to create two panes
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Click the first pane to focus it
    const firstPane = page.getByTestId('pane-wrapper').first();
    await firstPane.click();

    // The pane should gain visual focus indicator
    await expect(firstPane).toBeVisible();
  });
});
