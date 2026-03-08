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

test.describe('error recovery', () => {
  test('app recovers from closing all workspaces', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('listitem')).toHaveCount(1);

    // Close the only workspace
    const item = page.getByRole('listitem').first();
    await item.hover();
    await item.getByRole('button', { name: /close/i }).click();

    // Should show empty state
    await expect(page.getByText(/no workspaces open/i)).toBeVisible();

    // Can open project picker to recover
    await page.keyboard.press('Control+Shift+o');
    await expect(page.getByText(/open a project/i)).toBeVisible();
  });

  test('closing and recreating workspaces does not break pane rendering', async ({ page }) => {
    await openApp(page);

    // Create extra workspaces
    await createWorkspaceViaMock(page, 'Workspace 2');
    await createWorkspaceViaMock(page, 'Workspace 3');
    await expect(page.getByRole('listitem')).toHaveCount(3);

    // Close workspaces one by one from the end
    for (let i = 3; i > 1; i--) {
      const lastItem = page.getByRole('listitem').last();
      await lastItem.hover();
      await lastItem.getByRole('button', { name: /close/i }).click();
      await expect(page.getByRole('listitem')).toHaveCount(i - 1);
    }

    // Remaining workspace should still render panes
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('multiple rapid splits do not crash', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    await page.getByLabel('Split horizontal').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(3);

    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(4);

    // Verify all panes are visible
    for (let i = 0; i < 4; i++) {
      await expect(page.getByTestId('pane-wrapper').nth(i)).toBeVisible();
    }
  });
});
