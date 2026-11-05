import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { db } from "@/lib/db";
import { emailSchema } from "@/lib/validation/common";
import { clientIp } from "@/server/services/audit";
import { enforceRateLimit } from "@/server/services/rate-limit";

export const POST = route(async (req) => {
  await enforceRateLimit(`newsletter:${clientIp(req) ?? "unknown"}`, 5, 600);
  const { email } = await parseJson(req, z.object({ email: emailSchema }), 2048);
  // Idempotent and non-enumerating: same response whether or not already subscribed.
  await db.newsletterSubscriber.upsert({ where: { email }, update: {}, create: { email } });
  return ok({ subscribed: true });
});
