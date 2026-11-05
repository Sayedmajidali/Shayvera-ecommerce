import { execSync } from "node:child_process";
import { loadTestEnv } from "./test-env";

/** Applies all migrations to the test database once per run. */
export default function setup() {
  loadTestEnv();
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}
