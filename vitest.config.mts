import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts"),
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/integration-global-setup.ts"],
          setupFiles: ["tests/helpers/integration-setup.ts"],
          // Tests share one database; run files sequentially for deterministic state.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
