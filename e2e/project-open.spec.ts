import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('project open', () => {
  test('app renders with a default workspace on load', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
    await expect(page.getByRole('listitem')).toHaveCount(1);
  });

  test('shows "no workspaces" message when all workspaces are closed', async ({ page }) => {
    await openApp(page);

    // Close the default workspace via the close button (hover to reveal)
    const workspaceItem = page.getByRole('listitem').first();
    await workspaceItem.hover();
    const closeBtn = workspaceItem.getByRole('button', { name: /close/i });
    await closeBtn.click();

    await expect(page.getByText(/no workspaces open/i)).toBeVisible();
  });

  test('project picker opens when triggered via Ctrl+Shift+O', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+o');

    // The project picker renders as a full-screen overlay
    await expect(page.getByText(/open a project/i)).toBeVisible();
  });
});
