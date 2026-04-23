import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/acceptance/setup.ts"],
    include: ["tests/acceptance/**/*.test.ts"],
    reporters: "default",
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 180000
  }
});
