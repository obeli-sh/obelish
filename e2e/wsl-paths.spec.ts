import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  await page.goto('/', { waitUntil: 'commit', timeout: 90_000 });
  // Wait for the app to finish loading (either shows picker or navigation)
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root && root.innerHTML.length > 100;
  }, { timeout: 30_000 });
  // Programmatically close the project picker and restore default keybindings
  await page.evaluate(async () => {
    const uiStore = await import('/src/stores/uiStore.ts');
    const settingsStore = await import('/src/stores/settingsStore.ts');
    uiStore.useUiStore.getState().setProjectPickerOpen(false);
    settingsStore.useSettingsStore.getState().resetAllKeybindings();
  });
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
}

test.describe('WSL path handling', () => {
  test('list_directories mock returns empty array', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      return await mockInvoke('list_directories', { partialPath: '/home' });
    });

    expect(result).toEqual([]);
  });

  test('list_directories with wsl flag returns empty array', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      return await mockInvoke('list_directories', { partialPath: '\\\\wsl$', wsl: true });
    });

    expect(result).toEqual([]);
  });

  test('project_add returns a valid project with mock path', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      return await mockInvoke('project_add', { rootPath: '/mnt/c/Users/test/project' });
    });

    expect(result).toEqual({
      id: 'mock-project-1',
      name: 'mock-project',
      rootPath: '/mock/path',
    });
  });

  test('worktree_list returns worktrees with path info', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      return await mockInvoke('worktree_list', { projectId: 'mock-project-1' });
    });

    expect(result).toEqual([
      { path: '/mock/path', branch: 'main', isMain: true },
    ]);
  });

  test('worktree_create returns a new worktree with branch', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      return await mockInvoke('worktree_create', {
        projectId: 'mock-project-1',
        branchName: 'feature/wsl-support',
      });
    });

    expect(result).toEqual({
      path: '/mock/path/worktree',
      branch: 'new-branch',
      isMain: false,
    });
  });

  test('workspace with worktree path renders correctly in sidebar', async ({ page }) => {
    await openApp(page);

    const workspaceItem = page.getByRole('listitem').first();
    await expect(workspaceItem).toBeVisible();
    await expect(workspaceItem).toHaveAttribute('data-active', 'true');
  });

  test('app handles mixed path separators without crashing', async ({ page }) => {
    await openApp(page);

    const results = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const r1 = await mockInvoke('list_directories', { partialPath: 'C:\\Users\\test' });
      const r2 = await mockInvoke('list_directories', { partialPath: '/mnt/c/Users/test' });
      const r3 = await mockInvoke('list_directories', { partialPath: '\\\\wsl.localhost\\Ubuntu' });
      return { r1, r2, r3 };
    });

    expect(results.r1).toEqual([]);
    expect(results.r2).toEqual([]);
    expect(results.r3).toEqual([]);

    await expect(page.getByRole('navigation')).toBeVisible();
  });
});
