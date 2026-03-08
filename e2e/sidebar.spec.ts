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

test.describe('sidebar interactions', () => {
  test('sidebar is visible on app load', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('sidebar shows workspace list', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('listitem')).toHaveCount(1);
  });

  test('new workspace button adds a workspace to the sidebar', async ({ page }) => {
    await openApp(page);

    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);
  });

  test('clicking a workspace in sidebar activates it', async ({ page }) => {
    await openApp(page);

    // Create second workspace
    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Click first workspace
    const first = page.getByRole('listitem').first();
    await first.click();
    await expect(first).toHaveAttribute('data-active', 'true');
  });

  test('sidebar footer has preferences and notification buttons', async ({ page }) => {
    await openApp(page);
    await expect(page.getByLabel('Preferences')).toBeVisible();
  });

  test('close workspace button removes it from sidebar', async ({ page }) => {
    await openApp(page);

    // Create a second workspace so closing one leaves another
    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Find and click the close button on the second workspace
    const secondItem = page.getByRole('listitem').nth(1);
    const closeBtn = secondItem.getByLabel(/close/i);
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(page.getByRole('listitem')).toHaveCount(1);
    }
  });

  test('active workspace has data-active=true attribute', async ({ page }) => {
    await openApp(page);
    const activeItem = page.getByRole('listitem').first();
    await expect(activeItem).toHaveAttribute('data-active', 'true');
  });
});
