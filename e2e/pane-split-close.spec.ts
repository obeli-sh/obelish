import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('pane split and close', () => {
  test('splits the pane vertically', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('splits the pane horizontally', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByLabel('Split horizontal').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('auto-splits the pane', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.getByLabel('Auto split').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('closes a pane from a split layout', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Close one pane
    await page.getByLabel('Close').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('closing the last pane keeps a workspace with a new terminal', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    // Close the only pane
    await page.getByLabel('Close').first().click();

    // The mock backend recreates a terminal leaf when closing the last pane
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('multiple splits create nested layout', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    await page.getByLabel('Split horizontal').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(3);
  });
});
