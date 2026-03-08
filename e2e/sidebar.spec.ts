import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

async function createWorkspaceViaMock(page: Page, name?: string) {
  await page.evaluate(async (n) => {
    const { mockInvoke } = await import('/src/lib/browser-mock.ts');
    const ws = await mockInvoke('workspace_create', n ? { name: n } : {});
    const { useWorkspaceStore } = await import('/src/stores/workspaceStore.ts');
    useWorkspaceStore.getState()._syncWorkspace(ws as never);
    useWorkspaceStore.getState()._setActiveWorkspace((ws as { id: string }).id);
  }, name);
}

test.describe('sidebar', () => {
  test('sidebar is visible on app load', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('sidebar lists workspace items', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('listitem')).toHaveCount(1);
  });

  test('creating workspaces adds items to the sidebar list', async ({ page }) => {
    await openApp(page);

    await createWorkspaceViaMock(page, 'Second');
    await expect(page.getByRole('listitem')).toHaveCount(2);

    await createWorkspaceViaMock(page, 'Third');
    await expect(page.getByRole('listitem')).toHaveCount(3);
  });

  test('active workspace is highlighted', async ({ page }) => {
    await openApp(page);
    await createWorkspaceViaMock(page, 'Second');
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // The second (newest) workspace should be active
    await expect(page.getByRole('listitem').nth(1)).toHaveAttribute('data-active', 'true');
    await expect(page.getByRole('listitem').nth(0)).toHaveAttribute('data-active', 'false');

    // Click the first workspace
    await page.getByRole('listitem').nth(0).getByRole('button').first().click();
    await expect(page.getByRole('listitem').nth(0)).toHaveAttribute('data-active', 'true');
    await expect(page.getByRole('listitem').nth(1)).toHaveAttribute('data-active', 'false');
  });

  test('workspace rename via double-click', async ({ page }) => {
    await openApp(page);

    // Double-click the workspace name to enter edit mode
    const nameButton = page.getByRole('listitem').first().getByRole('button').first();
    await nameButton.dblclick();

    // An input should appear
    const input = page.getByRole('listitem').first().locator('input');
    await expect(input).toBeVisible();

    // Clear and type new name
    await input.fill('My Custom Workspace');
    await input.press('Enter');

    // The name should be updated
    await expect(page.getByRole('listitem').first()).toContainText('My Custom Workspace');
  });

  test('sidebar has preferences button', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: 'Preferences' })).toBeVisible();
  });

  test('close workspace via hover close button', async ({ page }) => {
    await openApp(page);
    await createWorkspaceViaMock(page, 'To Close');
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Hover and close the second workspace
    const secondItem = page.getByRole('listitem').nth(1);
    await secondItem.hover();
    await secondItem.getByRole('button', { name: /close/i }).click();

    await expect(page.getByRole('listitem')).toHaveCount(1);
  });
});
