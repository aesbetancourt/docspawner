import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // main.ts and config loading at startup are covered by running the worker, not by unit tests.
      exclude: ["src/main.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});
