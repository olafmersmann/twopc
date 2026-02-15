import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["assets/__tests__/**/*.test.ts"],
    environment: "node",
    setupFiles: ["assets/__tests__/setup.ts"],
    testTimeout: 10000,
  },
});
