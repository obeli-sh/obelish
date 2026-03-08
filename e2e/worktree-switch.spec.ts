import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

/** Create a workspace via mock backend and sync the UI */
async function createWorkspaceViaMock(page: Page, name?: string) {
  await page.evaluate(async (n) => {
    const { mockInvoke } = await import('/src/lib/browser-mock.ts');
    const ws = await mockInvoke('workspace_create', n ? { name: n } : {});
    // Trigger UI sync via session_restore
    const { useWorkspaceStore } = await import('/src/stores/workspaceStore.ts');
    useWorkspaceStore.getState()._syncWorkspace(ws as never);
    useWorkspaceStore.getState()._setActiveWorkspace((ws as { id: string }).id);
  }, name);
}

test.describe('worktree switch', () => {
  test('creates a second workspace and switches between them', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('listitem')).toHaveCount(1);

    await createWorkspaceViaMock(page, 'Workspace 2');
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // The second workspace should be active
    await expect(page.getByRole('listitem').nth(1)).toHaveAttribute('data-active', 'true');

    // Click the first workspace to switch back
    await page.getByRole('listitem').nth(0).getByRole('button').first().click();
    await expect(page.getByRole('listitem').nth(0)).toHaveAttribute('data-active', 'true');
  });

  test('closing a workspace falls back to the remaining one', async ({ page }) => {
    await openApp(page);
    await createWorkspaceViaMock(page, 'Workspace 2');
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Close the second workspace
    const secondItem = page.getByRole('listitem').nth(1);
    await secondItem.hover();
    await secondItem.getByRole('button', { name: /close/i }).click();

    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });
});
