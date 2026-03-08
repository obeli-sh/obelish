import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to fully render
    await page.waitForLoadState('networkidle');
  });

  test('main workspace', async ({ page }) => {
    await expect(page).toHaveScreenshot('main-workspace.png');
  });

  test('sidebar expanded', async ({ page }) => {
    // Ensure sidebar is visible/expanded
    const sidebar = page.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();
    await expect(page).toHaveScreenshot('sidebar-expanded.png');
  });

  test('sidebar collapsed', async ({ page }) => {
    // Toggle sidebar to collapsed state
    const toggleButton = page.locator('[data-testid="sidebar-toggle"]');
    if (await toggleButton.isVisible()) {
      await toggleButton.click();
    }
    await expect(page).toHaveScreenshot('sidebar-collapsed.png');
  });

  test('settings modal', async ({ page }) => {
    // Open settings via keyboard shortcut or button
    await page.keyboard.press('Control+,');
    const settingsModal = page.locator('[data-testid="settings-modal"], [role="dialog"]');
    await expect(settingsModal).toBeVisible();
    await expect(page).toHaveScreenshot('settings-modal.png');
  });

  test('command palette', async ({ page }) => {
    // Open command palette
    await page.keyboard.press('Control+k');
    const palette = page.locator('[data-testid="command-palette"], [role="combobox"]');
    await expect(palette).toBeVisible();
    await expect(page).toHaveScreenshot('command-palette.png');
  });

  test('notification panel', async ({ page }) => {
    // Open notification panel
    const notificationButton = page.locator('[data-testid="notification-toggle"], [data-testid="notifications"]');
    if (await notificationButton.isVisible()) {
      await notificationButton.click();
    }
    await expect(page).toHaveScreenshot('notification-panel.png');
  });
});
