import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { db } from "@/server/platform/db";
import { emailSchema, trimmed } from "@/lib/validation/common";
import { clientIp } from "@/server/modules/audit/audit";
import { enforceRateLimit } from "@/server/platform/rate-limit";

const schema = z.object({
  name: trimmed(2, 80, "Name"),
  email: emailSchema,
  phone: z.string().trim().max(20).optional().nullable(),
  subject: trimmed(3, 120, "Subject"),
  message: trimmed(10, 4000, "Message"),
});

export const POST = route(async (req) => {
  await enforceRateLimit(`contact:${clientIp(req) ?? "unknown"}`, 5, 3600);
  const data = await parseJson(req, schema, 16 * 1024);
  await db.contactMessage.create({ data: { ...data, phone: data.phone || null } });
  return ok({ received: true }, 201);
});
