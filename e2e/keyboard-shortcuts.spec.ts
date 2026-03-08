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

test.describe('keyboard shortcuts', () => {
  test('Ctrl+Shift+P opens command palette', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
  });

  test('Ctrl+N creates a new workspace', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('listitem')).toHaveCount(1);

    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);
  });

  test('Ctrl+Shift+V splits pane vertically', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('Ctrl+Shift+H splits pane horizontally', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    await page.keyboard.press('Control+Shift+H');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('Ctrl+W closes the active pane', async ({ page }) => {
    await openApp(page);

    // Create two panes
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    await page.getByTestId('pane-wrapper').first().click();
    await page.keyboard.press('Control+W');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);
  });

  test('open-browser toolbar button opens a browser pane', async ({ page }) => {
    await openApp(page);

    // Use toolbar button (Ctrl+Shift+B is intercepted by Firefox for bookmarks)
    await page.getByTestId('pane-wrapper').first().getByLabel('Open browser').click();
    await expect(page.getByTitle('Browser panel')).toBeVisible({ timeout: 10_000 });
  });

  test('Ctrl+I toggles notification panel', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+I');
    await expect(page.getByTestId('notification-panel')).toBeVisible();

    await page.keyboard.press('Control+I');
    await expect(page.getByTestId('notification-panel')).not.toBeVisible();
  });

  test('Ctrl+comma opens settings', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings-backdrop')).toBeVisible();
  });

  test('Ctrl+Shift+O opens project picker', async ({ page }) => {
    await openApp(page);

    await page.keyboard.press('Control+Shift+O');
    await expect(page.getByText('Open a Project')).toBeVisible({ timeout: 10_000 });
  });

  test('Ctrl+1 through Ctrl+9 switch workspaces', async ({ page }) => {
    await openApp(page);

    // Create two workspaces
    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    // Ctrl+1 switches to first
    await page.keyboard.press('Control+1');
    await expect(page.getByRole('listitem').first()).toHaveAttribute('data-active', 'true');

    // Ctrl+2 switches to second
    await page.keyboard.press('Control+2');
    await expect(page.getByRole('listitem').nth(1)).toHaveAttribute('data-active', 'true');
  });
});
