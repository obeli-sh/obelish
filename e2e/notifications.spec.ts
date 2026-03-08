import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('notifications', () => {
  test('notification panel opens and shows empty state', async ({ page }) => {
    await openApp(page);

    // The notification badge is in the sidebar footer
    // Click it to toggle the notification panel
    const badge = page.getByRole('navigation').locator('[data-testid="notification-badge"], button').filter({ hasText: /0|notification/i });

    // Use keyboard shortcut instead if badge isn't directly clickable
    await page.keyboard.press('Control+i');

    await expect(page.getByTestId('notification-panel')).toBeVisible();
    await expect(page.getByText('No notifications')).toBeVisible();
  });

  test('notification panel closes when toggle is pressed again', async ({ page }) => {
    await openApp(page);

    // Open
    await page.keyboard.press('Control+i');
    await expect(page.getByTestId('notification-panel')).toBeVisible();

    // Close
    await page.keyboard.press('Control+i');
    await expect(page.getByTestId('notification-panel')).not.toBeVisible();
  });

  test('notification panel close button works', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+i');
    await expect(page.getByTestId('notification-panel')).toBeVisible();

    // Click the close button inside the panel
    await page.getByTestId('notification-panel').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('notification-panel')).not.toBeVisible();
  });
});
