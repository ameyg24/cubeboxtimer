import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Analytics tests are pure (no DOM) and stay on the node environment by
// default. Component/hook tests opt into jsdom per-file with a
// "// @vitest-environment jsdom" comment at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx,jsx}"],
    setupFiles: ["src/testSetup.js"],
  },
});
