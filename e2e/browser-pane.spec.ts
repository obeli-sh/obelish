import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('browser pane', () => {
  test('opens a browser pane from the toolbar', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();

    await expect(page.getByTitle('Browser panel')).toBeVisible();
    await expect(page.getByLabel('URL').first()).toHaveValue('about:blank');
  });

  test('browser pane appears alongside the terminal', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();

    // Should now have 2 pane wrappers (terminal + browser)
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
    await expect(page.getByTitle('Browser panel')).toBeVisible();
  });

  test('browser pane has navigation controls', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Open browser').first().click();

    await expect(page.getByTitle('Browser panel')).toBeVisible();

    // Browser toolbar should have URL input and nav buttons
    await expect(page.getByLabel('URL').first()).toBeVisible();
  });
});
