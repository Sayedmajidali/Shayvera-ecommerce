import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
};

/** Records an admin action. Pass `tx` to make the log part of the business transaction. */
export async function audit(entry: AuditEntry, tx?: Tx): Promise<void> {
  const client = tx ?? db;
  try {
    await client.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    if (tx) throw error;
    logger.error("Failed to write audit log", { action: entry.action, error });
  }
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? null;
}
