import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/acceptance/**/*.test.ts"],
    reporters: "default",
    fileParallelism: false
  }
});
