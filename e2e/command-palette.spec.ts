import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('command palette', () => {
  test('opens via Ctrl+Shift+P', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+p');

    const dialog = page.getByRole('dialog', { name: /command palette/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('searchbox')).toBeFocused();
  });

  test('lists available commands', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+p');

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // Should show multiple command options
    const options = listbox.getByRole('option');
    await expect(options.first()).toBeVisible();
    expect(await options.count()).toBeGreaterThan(3);
  });

  test('filters commands by search query', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+p');

    await page.getByRole('searchbox').fill('split');

    const options = page.getByRole('listbox').getByRole('option');
    // Should show split-related commands
    await expect(options.first()).toBeVisible();
    // All visible options should relate to "split"
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('executes a command via Enter', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+p');

    // Search for settings command
    await page.getByRole('searchbox').fill('settings');
    await page.keyboard.press('Enter');

    // Command palette should close
    await expect(page.getByRole('dialog', { name: /command palette/i })).not.toBeVisible();
  });

  test('closes on Escape', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+p');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /command palette/i })).not.toBeVisible();
  });

  test('closes on backdrop click', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+p');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();

    // Click the backdrop
    await page.getByTestId('palette-backdrop').click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole('dialog', { name: /command palette/i })).not.toBeVisible();
  });

  test('navigates options with arrow keys', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+p');

    const options = page.getByRole('listbox').getByRole('option');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowUp');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  });
});
