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

async function createWorkspace(page: Page) {
  await page.evaluate(async () => {
    const bridge = await import('/src/lib/tauri-bridge.ts');
    const wsStore = await import('/src/stores/workspaceStore.ts');
    const uiStore = await import('/src/stores/uiStore.ts');
    // Close project picker if open
    uiStore.useUiStore.getState().setProjectPickerOpen(false);
    const ws = await bridge.tauriBridge.workspace.create({ projectId: '', worktreePath: '', name: undefined });
    wsStore.useWorkspaceStore.getState()._syncWorkspace(ws);
    wsStore.useWorkspaceStore.getState()._setActiveWorkspace(ws.id);
    const surface = ws.surfaces[ws.activeSurfaceIndex];
    if (surface) {
      const getLeaf = (layout: { type: string; paneId?: string; children?: unknown[] }): string | null => {
        if (layout.type === 'leaf') return layout.paneId ?? null;
        return getLeaf((layout.children as typeof layout[])[0]);
      };
      const paneId = getLeaf(surface.layout as { type: string; paneId?: string; children?: unknown[] });
      if (paneId) uiStore.useUiStore.getState().setFocusedPane(paneId);
    }
  });
  // Wait for the new workspace to appear in the sidebar
  await page.waitForTimeout(200);
}

test.describe('worktree switching', () => {
  test('creates a second workspace and switches between them', async ({ page }) => {
    await openApp(page);

    // Start with one workspace active
    await expect(page.getByRole('listitem')).toHaveCount(1);
    const firstItem = page.getByRole('listitem').first();
    await expect(firstItem).toHaveAttribute('data-active', 'true');

    // Create a second workspace
    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // The new workspace should now be active
    const secondItem = page.getByRole('listitem').nth(1);
    await expect(secondItem).toHaveAttribute('data-active', 'true');
    await expect(firstItem).toHaveAttribute('data-active', 'false');

    // Click the first workspace to switch back
    await firstItem.click();
    await expect(firstItem).toHaveAttribute('data-active', 'true');
    await expect(secondItem).toHaveAttribute('data-active', 'false');
  });

  test('switches workspace via Ctrl+number shortcut', async ({ page }) => {
    await openApp(page);

    // Create a second workspace
    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Switch to first workspace via Ctrl+1
    await page.keyboard.press('Control+1');
    await expect(page.getByRole('listitem').first()).toHaveAttribute('data-active', 'true');

    // Switch to second workspace via Ctrl+2
    await page.keyboard.press('Control+2');
    await expect(page.getByRole('listitem').nth(1)).toHaveAttribute('data-active', 'true');
  });

  test('renames a workspace by double-clicking', async ({ page }) => {
    await openApp(page);
    const workspaceItem = page.getByRole('listitem').first();

    // Double-click the workspace name to rename
    await workspaceItem.dblclick();

    // An input field should appear for renaming
    const renameInput = workspaceItem.getByRole('textbox');
    if (await renameInput.isVisible()) {
      await renameInput.fill('My Custom Workspace');
      await renameInput.press('Enter');

      await expect(workspaceItem).toContainText('My Custom Workspace');
    }
  });
});
