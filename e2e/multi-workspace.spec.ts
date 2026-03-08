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

test.describe('multi-workspace', () => {
  test('creates multiple workspaces', async ({ page }) => {
    await openApp(page);

    for (let i = 2; i <= 5; i++) {
      await createWorkspaceViaMock(page, `Workspace ${i}`);
    }

    await expect(page.getByRole('listitem')).toHaveCount(5);
  });

  test('each workspace has independent pane state', async ({ page }) => {
    await openApp(page);
    await createWorkspaceViaMock(page, 'Workspace 2');
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Split a pane in the second (active) workspace
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Switch to the first workspace
    await page.getByRole('listitem').first().getByRole('button').first().click();

    // First workspace should have only 1 pane
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    // Switch back to the second workspace
    await page.getByRole('listitem').nth(1).getByRole('button').first().click();

    // Should still have 2 panes
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('closing workspace N activates the next available workspace', async ({ page }) => {
    await openApp(page);
    await createWorkspaceViaMock(page, 'Workspace 2');
    await createWorkspaceViaMock(page, 'Workspace 3');
    await expect(page.getByRole('listitem')).toHaveCount(3);

    // Close the third (active) workspace
    const thirdItem = page.getByRole('listitem').nth(2);
    await thirdItem.hover();
    await thirdItem.getByRole('button', { name: /close/i }).click();

    await expect(page.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('pane-wrapper').first()).toBeVisible();
  });

  test('workspace switching preserves split layout', async ({ page }) => {
    await openApp(page);

    // Split the first workspace pane
    await page.getByLabel('Split vertical').first().click();
    await page.getByLabel('Split horizontal').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(3);

    // Create and switch to a second workspace
    await createWorkspaceViaMock(page, 'Workspace 2');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    // Switch back to first workspace
    await page.getByRole('listitem').first().getByRole('button').first().click();

    // Layout should be preserved (3 panes)
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(3);
  });
});
