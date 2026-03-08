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

test.describe('command palette actions', () => {
  test('opens command palette with Ctrl+Shift+P', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await expect(page.getByRole('searchbox')).toBeFocused();
  });

  test('closes command palette with Escape', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /command palette/i })).not.toBeVisible();
  });

  test('closes command palette by clicking backdrop', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();

    await page.getByTestId('palette-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('dialog', { name: /command palette/i })).not.toBeVisible();
  });

  test('lists available commands in the palette', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+P');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    const options = listbox.getByRole('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('filters commands by typing in the search box', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+P');
    const listbox = page.getByRole('listbox');
    const initialCount = await listbox.getByRole('option').count();

    await page.getByRole('searchbox').fill('split');
    const filteredCount = await listbox.getByRole('option').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('navigates commands with arrow keys', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('listbox')).toBeVisible();

    // First item should be selected by default
    const firstOption = page.getByRole('option').first();
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');

    // Arrow down moves selection
    await page.keyboard.press('ArrowDown');
    const secondOption = page.getByRole('option').nth(1);
    await expect(secondOption).toHaveAttribute('aria-selected', 'true');
    await expect(firstOption).toHaveAttribute('aria-selected', 'false');
  });

  test('executes a command with Enter (e.g., New Workspace opens picker)', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+P');
    await page.getByRole('searchbox').fill('New Workspace');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');

    // Palette should close and project picker should open
    await expect(page.getByRole('dialog', { name: /command palette/i })).not.toBeVisible();
    await expect(page.getByText('Open a Project')).toBeVisible({ timeout: 10_000 });
  });
});
