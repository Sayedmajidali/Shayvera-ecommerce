/** Truncates every table in the E2E database. Refuses to run against non-E2E databases. */
import { rmSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/e2e/.test(new URL(url).pathname)) throw new Error("Refusing to reset a non-E2E database");
  const db = new PrismaClient();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
  await db.$disconnect();
  rmSync(process.env.STORAGE_LOCAL_DIR ?? "./storage/e2e-uploads", {
    recursive: true,
    force: true,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
