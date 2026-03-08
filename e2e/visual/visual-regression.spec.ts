import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'commit', timeout: 90_000 });
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 100;
  }, { timeout: 30_000 });
  await page.evaluate(async () => {
    const uiStore = await import('/src/stores/uiStore.ts');
    const settingsStore = await import('/src/stores/settingsStore.ts');
    uiStore.useUiStore.getState().setProjectPickerOpen(false);
    settingsStore.useSettingsStore.getState().resetAllKeybindings();
  });
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
}

test.describe('visual regression', () => {
  test('main workspace view', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page).toHaveScreenshot('workspace-main.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('sidebar expanded', async ({ page }) => {
    await openApp(page);
    const sidebar = page.getByRole('navigation');
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveScreenshot('sidebar-expanded.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('sidebar collapsed', async ({ page }) => {
    await openApp(page);
    const collapseButton = page.getByLabel(/collapse/i).or(
      page.getByLabel(/toggle sidebar/i),
    );
    if (await collapseButton.isVisible()) {
      await collapseButton.click();
    }
    await expect(page).toHaveScreenshot('sidebar-collapsed.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('settings modal', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+,');
    const modal = page.getByTestId('settings-backdrop');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveScreenshot('settings-modal.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('command palette', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByRole('dialog', { name: /command palette/i });
    await expect(palette).toBeVisible();
    await expect(palette).toHaveScreenshot('command-palette.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('notification panel', async ({ page }) => {
    await openApp(page);
    const notifButton = page.getByLabel(/notification/i).or(
      page.getByRole('button', { name: /notification/i }),
    );
    if (await notifButton.isVisible()) {
      await notifButton.click();
    }
    const panel = page.locator('[data-testid="notification-panel"]').or(
      page.getByRole('complementary'),
    );
    if (await panel.isVisible()) {
      await expect(panel).toHaveScreenshot('notification-panel.png', {
        maxDiffPixelRatio: 0.01,
      });
    }
  });
});
