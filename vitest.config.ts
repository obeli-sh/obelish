import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
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
