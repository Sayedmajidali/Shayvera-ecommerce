import type { Tx } from "@/server/platform/db";

/** Atomically increments and returns a named counter (safe under concurrency). */
export async function nextSequence(tx: Tx, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("key", "value", "updatedAt") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  return Number(rows[0]!.value);
}

/** Indian financial year label for a date, e.g. 2026-11-05 → "2026-27", 2027-02-01 → "2026-27". */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export async function nextOrderNumber(tx: Tx, prefix: string, now = new Date()): Promise<string> {
  const n = await nextSequence(tx, "order");
  const yy = String(now.getUTCFullYear()).slice(2);
  return `${prefix}${yy}${String(n).padStart(6, "0")}`;
}
