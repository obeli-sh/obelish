import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    pool: "vmThreads",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./src/test-setup.ts"],
    alias: {
      "@tauri-apps/api/core": path.resolve(
        __dirname,
        "src/__mocks__/@tauri-apps/api/core.ts",
      ),
      "@tauri-apps/api/event": path.resolve(
        __dirname,
        "src/__mocks__/@tauri-apps/api/event.ts",
      ),
      "@xterm/xterm/css/xterm.css": path.resolve(
        __dirname,
        "src/__mocks__/xterm.css",
      ),
      "@xterm/xterm": path.resolve(
        __dirname,
        "src/__mocks__/@xterm/xterm.ts",
      ),
      "@xterm/addon-fit": path.resolve(
        __dirname,
        "src/__mocks__/@xterm/addon-fit.ts",
      ),
      "@xterm/addon-webgl": path.resolve(
        __dirname,
        "src/__mocks__/@xterm/addon-webgl.ts",
      ),
      "@xterm/addon-serialize": path.resolve(
        __dirname,
        "src/__mocks__/@xterm/addon-serialize.ts",
      ),
      "@tauri-apps/plugin-dialog": path.resolve(
        __dirname,
        "src/__mocks__/@tauri-apps/plugin-dialog/index.ts",
      ),
      "react-resizable-panels": path.resolve(
        __dirname,
        "src/__mocks__/react-resizable-panels.tsx",
      ),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/__mocks__/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/test-setup.ts",
        "src/lib/generated/**",
      ],
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 95,
        statements: 95,
      },
    },
  },
});
