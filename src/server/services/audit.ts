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

/**
 * Client IP for rate limiting and audit logs.
 * Behind N trusted reverse proxies (TRUSTED_PROXY_HOPS, default 1) each proxy appends the address it
 * saw, so the trustworthy entry is the Nth from the right — the left-most value is client-controlled.
 */
export function clientIp(req: Request): string | null {
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? "1") || 1);
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const ip = parts[Math.max(0, parts.length - hops)];
    if (ip) return ip.slice(0, 64);
  }
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? null;
}
