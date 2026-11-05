import { execSync } from "node:child_process";
import { e2eEnv } from "../../playwright.config";

/**
 * Prepares the isolated E2E database: apply migrations, truncate all data, seed the catalog and
 * provision an administrator. Never touches the development database.
 */
export default async function globalSetup() {
  const env = { ...process.env, ...e2eEnv };
  if (!/e2e/.test(env.DATABASE_URL))
    throw new Error("Refusing to reset a database whose name does not contain 'e2e'");
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx tests/e2e/reset-db.ts", { env, stdio: "pipe" });
  execSync("npx tsx --conditions=react-server prisma/seed.ts", { env, stdio: "pipe" });
  execSync(
    'npx tsx --conditions=react-server scripts/create-admin.ts --email admin@e2e.test --name "E2E Admin"',
    {
      env: { ...env, ADMIN_PASSWORD: "AdminE2E123!" },
      stdio: "pipe",
    },
  );
}
