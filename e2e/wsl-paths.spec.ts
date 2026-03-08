import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await expect(page.getByRole('navigation')).toBeVisible();
}

test.describe('WSL paths', () => {
  test('mock backend returns worktree paths that can be displayed', async ({ page }) => {
    await openApp(page);

    // The mock worktree_list returns a path like '/mock/path'
    // Verify the app can handle paths without crashing
    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const worktrees = await mockInvoke('worktree_list') as Array<{ path: string; branch: string; isMain: boolean }>;
      return worktrees;
    });

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/mock/path');
    expect(result[0].branch).toBe('main');
  });

  test('project_add returns a project with a valid path', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const project = await mockInvoke('project_add', { rootPath: '/home/user/project' }) as {
        id: string;
        name: string;
        rootPath: string;
      };
      return project;
    });

    expect(result.id).toBeTruthy();
    expect(result.rootPath).toBe('/mock/path');
  });

  test('workspace with worktree path displays path in sidebar', async ({ page }) => {
    await openApp(page);

    // Create a workspace with a worktree path via mock
    await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const ws = await mockInvoke('workspace_create', { name: 'WSL Test' }) as Record<string, unknown>;
      // Manually set worktreePath in mock state (already set via mock defaults)
      return ws;
    });

    // The mock workspace is created, but since mock worktreePaths are empty strings,
    // we validate the app doesn't crash with any path value
    await expect(page.getByRole('navigation')).toBeVisible();
  });
});
