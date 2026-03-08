# Browser Manual Validation (Playwright + DevTools MCP)

This repository now includes a browser validation flow that can be executed either:

- automatically with Playwright tests (`e2e/manual-validation.spec.ts`), or
- manually through MCP browser tooling (Playwright MCP / Chrome DevTools MCP).

## 1. Install Browser Runtime

```bash
bunx playwright install chromium
```

## 2. Run Automated Browser Validation

```bash
bun run test:e2e
# or
just test-e2e
```

The Playwright config (`playwright.config.ts`) starts Vite automatically on `http://127.0.0.1:4173` unless `PLAYWRIGHT_SKIP_WEBSERVER=1` is set.

## 3. MCP-Driven Manual Validation Checklist

Use either Playwright MCP or DevTools MCP against the running app URL.

Target URL:

```text
http://127.0.0.1:4173
```

Validation steps:

1. App shell loads:
   - `navigation` region is visible.
   - `New workspace` button is visible.
2. Terminal actions are reachable:
   - `Split vertical` button is visible.
   - `Open browser` button is visible.
3. Browser pane flow works:
   - Click `Open browser`.
   - Assert iframe with title `Browser panel` is visible.
   - Assert `URL` input value is `about:blank`.
4. Split flow works:
   - Reload app to a clean state.
   - Click `Split vertical`.
   - Assert there are 2 elements with `data-testid="pane-wrapper"`.

## 4. Notes

- Browser-mode mock commands are stateful in `src/lib/browser-mock.ts`, so manual browser validation can exercise split/open-browser paths without Tauri runtime.
- If using external dev server/start command, set `PLAYWRIGHT_SKIP_WEBSERVER=1` and `PLAYWRIGHT_BASE_URL`.
