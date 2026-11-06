import { ok, parseJson, route } from "@/lib/api";
import { clientIp } from "@/server/modules/audit/audit";
import { lookupOrderForTracking, trackLookupSchema } from "@/server/modules/orders/tracking";
import { enforceRateLimit } from "@/server/platform/rate-limit";

/** Order lookup by number + email/phone → read-only tracking link. Rate limited per IP and order. */
export const POST = route(async (req) => {
  await enforceRateLimit(`track:ip:${clientIp(req) ?? "unknown"}`, 10, 600);
  const input = await parseJson(req, trackLookupSchema, 4 * 1024);
  await enforceRateLimit(`track:order:${input.orderNumber}`, 10, 3600);
  const { orderNumber, token } = await lookupOrderForTracking(input);
  return ok({ url: `/track/${orderNumber}?k=${encodeURIComponent(token)}` });
});
