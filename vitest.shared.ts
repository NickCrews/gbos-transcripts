import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Shared config for every workspace package's vitest.config.ts.
// Keeps "node" environment + the workspace-root test-setup.ts in one place.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [join(ROOT, "test-setup.ts")],
  },
});
