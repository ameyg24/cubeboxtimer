import { defineConfig } from "vitest/config";

// Analytics is pure (no DOM), so the node environment is enough.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
