import { db } from "@/server/platform/db";
import { AppError } from "@/lib/errors";

/**
 * PostgreSQL-backed fixed-window rate limiter (works across instances, no Redis).
 * A single atomic upsert either starts a new window or increments the current one.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  if (process.env.APP_RATE_LIMIT === "off") return { allowed: true, remaining: limit };
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds})
                     THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number) {
  const { allowed } = await consumeRateLimit(key, limit, windowSeconds);
  if (!allowed)
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
}
