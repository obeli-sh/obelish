import { test, expect, type Page } from '@playwright/test';

async function openApp(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await expect(page.getByRole('navigation')).toBeVisible();
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.waitForTimeout(1000);
    }
  }
}

test.describe('manual browser validation', () => {
  test('renders workspace shell and pane controls', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: /new workspace/i })).toBeVisible();
    await expect(page.getByLabel('Split vertical').first()).toBeVisible();
    await expect(page.getByLabel('Open browser').first()).toBeVisible();
  });

  test('opens a browser pane from terminal toolbar', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Open browser').first().click();

    await expect(page.getByTitle('Browser panel')).toBeVisible();
    await expect(page.getByLabel('URL').first()).toHaveValue('about:blank');
  });

  test('splits the active terminal pane', async ({ page }) => {
    await openApp(page);

    await page.getByLabel('Split vertical').first().click();

    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);
  });

  test('reorganizes layout by dragging a pane to target bottom drop zone', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    const before = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = await mockInvoke('workspace_list') as Array<Record<string, unknown>>;
      const workspace = list[0];
      const surface = (workspace.surfaces as Array<Record<string, unknown>>)[0];
      const layout = surface.layout as Record<string, unknown>;
      const children = layout.children as Array<Record<string, unknown>>;
      return {
        direction: layout.direction as string,
        sourcePaneId: children[0].paneId as string,
        targetPaneId: children[1].paneId as string,
      };
    });

    expect(before.direction).toBe('horizontal');

    await page.evaluate(({ sourcePaneId, targetPaneId }) => {
      const source = document.querySelector(`[data-testid="pane-wrapper"][data-pane-id="${sourcePaneId}"]`);
      const target = document.querySelector(`[data-testid="pane-wrapper"][data-pane-id="${targetPaneId}"]`);
      if (!source || !target) throw new Error('pane wrappers not found');

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('application/x-obelisk-pane-id', sourcePaneId);
      dataTransfer.setData('application/x-obelisk-drop-position', 'bottom');

      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    }, { sourcePaneId: before.sourcePaneId, targetPaneId: before.targetPaneId });

    const after = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = await mockInvoke('workspace_list') as Array<Record<string, unknown>>;
      const workspace = list[0];
      const surface = (workspace.surfaces as Array<Record<string, unknown>>)[0];
      const layout = surface.layout as Record<string, unknown>;
      const children = layout.children as Array<Record<string, unknown>>;
      return {
        direction: layout.direction as string,
        firstPaneId: children[0].paneId as string,
        secondPaneId: children[1].paneId as string,
      };
    });

    expect(after.direction).toBe('vertical');
    expect(after.firstPaneId).toBe(before.targetPaneId);
    expect(after.secondPaneId).toBe(before.sourcePaneId);
  });

  test('reorganizes layout via pointer drag to target bottom edge', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Split vertical').first().click();
    await expect(page.getByTestId('pane-wrapper')).toHaveCount(2);

    const before = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = await mockInvoke('workspace_list') as Array<Record<string, unknown>>;
      const workspace = list[0];
      const surface = (workspace.surfaces as Array<Record<string, unknown>>)[0];
      const layout = surface.layout as Record<string, unknown>;
      const children = layout.children as Array<Record<string, unknown>>;
      return {
        direction: layout.direction as string,
        sourcePaneId: children[0].paneId as string,
        targetPaneId: children[1].paneId as string,
      };
    });

    expect(before.direction).toBe('horizontal');

    const sourcePane = page.locator(
      `[data-testid="pane-wrapper"][data-pane-id="${before.sourcePaneId}"]`,
    );
    const targetPane = page.locator(
      `[data-testid="pane-wrapper"][data-pane-id="${before.targetPaneId}"]`,
    );
    await expect(sourcePane).toBeVisible();
    await expect(targetPane).toBeVisible();

    const targetBox = await targetPane.boundingBox();
    if (!targetBox) {
      throw new Error('target pane bounds not available');
    }

    await sourcePane.dragTo(targetPane, {
      sourcePosition: { x: 24, y: 16 },
      targetPosition: {
        x: targetBox.width / 2,
        y: Math.max(2, targetBox.height - 4),
      },
    });

    const after = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const list = await mockInvoke('workspace_list') as Array<Record<string, unknown>>;
      const workspace = list[0];
      const surface = (workspace.surfaces as Array<Record<string, unknown>>)[0];
      const layout = surface.layout as Record<string, unknown>;
      const children = layout.children as Array<Record<string, unknown>>;
      return {
        direction: layout.direction as string,
        firstPaneId: children[0].paneId as string,
        secondPaneId: children[1].paneId as string,
      };
    });

    expect(after.direction).toBe('vertical');
    expect(after.firstPaneId).toBe(before.targetPaneId);
    expect(after.secondPaneId).toBe(before.sourcePaneId);
  });

  test('rejects cross-workspace pane moves', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: /new workspace/i }).click();
    await expect(page.getByRole('listitem')).toHaveCount(2);

    const result = await page.evaluate(async () => {
      const { mockInvoke } = await import('/src/lib/browser-mock.ts');
      const before = await mockInvoke('workspace_list') as Array<Record<string, unknown>>;
      const firstPaneId = (((before[0].surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>).paneId as string;
      const secondPaneId = (((before[1].surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>).paneId as string;

      await mockInvoke('pane_move', {
        paneId: firstPaneId,
        targetPaneId: secondPaneId,
        position: 'left',
      });

      const after = await mockInvoke('workspace_list') as Array<Record<string, unknown>>;
      return {
        before: JSON.stringify(before),
        after: JSON.stringify(after),
      };
    });

    expect(result.after).toBe(result.before);
  });
});
