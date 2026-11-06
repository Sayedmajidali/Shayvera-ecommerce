import { db } from "@/server/platform/db";
import { logger } from "@/server/platform/logger";

export const dynamic = "force-dynamic";

/** Liveness + database readiness probe. Does not expose versions or configuration. */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      {
        status: "ok",
        database: "up",
        latencyMs: Date.now() - started,
        time: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Health check failed", { error });
    return Response.json(
      { status: "degraded", database: "down", time: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
