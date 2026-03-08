import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('keyboard shortcuts', () => {
  test('Ctrl+Shift+P opens command palette', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+p');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
  });

  test('Ctrl+, opens settings', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible();
  });

  test('Ctrl+I toggles notification panel', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+i');
    await expect(page.getByTestId('notification-panel')).toBeVisible();

    await page.keyboard.press('Control+i');
    await expect(page.getByTestId('notification-panel')).not.toBeVisible();
  });

  test('Ctrl+Shift+O opens project picker', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+o');
    await expect(page.getByText(/open a project/i)).toBeVisible();
  });

  test('Ctrl+Shift+H splits pane horizontally', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    // Click a pane first to ensure it's focused
    await page.getByTestId('pane-wrapper').first().click();
    await page.keyboard.press('Control+Shift+h');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('Ctrl+Shift+V splits pane vertically', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByTestId('pane-wrapper').first().click();
    await page.keyboard.press('Control+Shift+v');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('Ctrl+W closes the active pane', async ({ page }) => {
    await openApp(page);

    // Split first so we can close one
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    await page.getByTestId('pane-wrapper').first().click();
    await page.keyboard.press('Control+w');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });
});
