import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('settings', () => {
  test('opens settings modal via Ctrl+comma', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');

    const dialog = page.getByRole('dialog', { name: /settings/i });
    await expect(dialog).toBeVisible();
    await expect(page.getByText('Preferences')).toBeVisible();
  });

  test('opens settings via sidebar preferences button', async ({ page }) => {
    await openApp(page);

    await page.getByRole('button', { name: 'Preferences' }).click();

    const dialog = page.getByRole('dialog', { name: /settings/i });
    await expect(dialog).toBeVisible();
  });

  test('settings modal has General, Hotkeys, and Theme tabs', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');

    await expect(page.getByRole('button', { name: 'General' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hotkeys' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Theme' })).toBeVisible();
  });

  test('switches between preference categories', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');

    // Default is General
    await expect(page.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true');

    // Switch to Hotkeys
    await page.getByRole('button', { name: 'Hotkeys' }).click();
    await expect(page.getByRole('button', { name: 'Hotkeys' })).toHaveAttribute('aria-pressed', 'true');

    // Switch to Theme
    await page.getByRole('button', { name: 'Theme' }).click();
    await expect(page.getByRole('button', { name: 'Theme' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Terminal Font Family')).toBeVisible();
  });

  test('closes settings via Escape', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /settings/i })).not.toBeVisible();
  });

  test('closes settings via backdrop click', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible();

    await page.getByTestId('settings-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('dialog', { name: /settings/i })).not.toBeVisible();
  });

  test('general tab shows workspace layout and shell selectors', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');

    await expect(page.getByLabel('Preferred New Workspace Layout')).toBeVisible();
    await expect(page.getByLabel('Show All Projects in Sidebar')).toBeVisible();
  });
});
