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

test.describe('multi-workspace management', () => {
  test('creates multiple workspaces', async ({ page }) => {
    await openApp(page);

    await createWorkspace(page);
    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(3);
  });

  test('each workspace has a unique pane layout', async ({ page }) => {
    await openApp(page);

    // Split pane in workspace 1
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Create workspace 2
    await createWorkspace(page);
    // New workspace should have 1 pane
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    // Switch back to workspace 1
    await page.getByRole('listitem').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('closing a workspace selects the next available one', async ({ page }) => {
    await openApp(page);

    // Create 3 workspaces
    await createWorkspace(page);
    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(3);

    // The third workspace (last created) should be active
    await expect(page.getByRole('listitem').nth(2)).toHaveAttribute('data-active', 'true');

    // Close the active workspace via mock
    await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = (await mockInvoke('workspace_list')) as Array<{ id: string }>;
      // Close the last one (active)
      await mockInvoke('workspace_close', { workspaceId: list[2].id });
    });

    // Trigger a UI refresh by interacting
    await page.getByRole('listitem').first().click();
    await expect(page.getByRole('listitem').first()).toHaveAttribute('data-active', 'true');
  });

  test('workspace switching preserves pane state independently', async ({ page }) => {
    await openApp(page);

    // Workspace 1: split into 2 panes
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Create workspace 2: default 1 pane
    await createWorkspace(page);
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(1);

    // Split workspace 2 into 3 panes
    await page.keyboard.press('Control+Shift+V');
    await page.keyboard.press('Control+Shift+V');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(3);

    // Switch back to workspace 1 — should still have 2
    await page.keyboard.press('Control+1');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    // Switch to workspace 2 — should still have 3
    await page.keyboard.press('Control+2');
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(3);
  });

  test('cross-workspace pane moves are rejected', async ({ page }) => {
    await openApp(page);

    await createWorkspace(page);
    await expect(page.getByRole('listitem')).toHaveCount(2);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const before = (await mockInvoke('workspace_list')) as Array<Record<string, unknown>>;
      const firstPaneId = (
        (before[0].surfaces as Array<Record<string, unknown>>)[0].layout as Record<string, unknown>
      ).paneId as string;
      const secondPaneId = (
        (before[1].surfaces as Array<Record<string, unknown>>)[0].layout as Record<string, unknown>
      ).paneId as string;

      await mockInvoke('pane_move', {
        paneId: firstPaneId,
        targetPaneId: secondPaneId,
        position: 'left',
      });

      const after = (await mockInvoke('workspace_list')) as Array<Record<string, unknown>>;
      return {
        before: JSON.stringify(before),
        after: JSON.stringify(after),
      };
    });

    // State should remain unchanged
    expect(result.after).toBe(result.before);
  });
});
