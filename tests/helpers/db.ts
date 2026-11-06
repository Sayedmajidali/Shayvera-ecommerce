import { db } from "@/server/platform/db";
import { registerAllJobs } from "@/server/jobs";
import { runDueJobs } from "@/server/platform/jobs/runner";

/** Truncates every application table (keeps the migrations table). */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await db.storeSettings.create({ data: { id: "default" } });
}

/** Polls until `fn` returns true (for fire-and-forget side effects such as emails). */
export async function eventually(fn: () => Promise<boolean>, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/** Runs every due background job to completion (the worker is not running during tests). */
export async function drainJobs() {
  registerAllJobs();
  return runDueJobs();
}
