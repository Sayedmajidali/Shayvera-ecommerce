import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = {
  "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only-stub.ts"),
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // `npm run test:coverage`: server and shared code exercised by unit + integration tests. UI
    // components and pages are covered by the Playwright suite instead (not instrumented here).
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/lib/**/*.ts", "src/app/api/**/*.ts"],
      exclude: ["**/*.d.ts", "src/server/jobs/loop.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      // Floors a little below the measured values (QA_REPORT.md): a drop fails `test:coverage`.
      thresholds: { lines: 80, statements: 78, functions: 78, branches: 68 },
    },
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
