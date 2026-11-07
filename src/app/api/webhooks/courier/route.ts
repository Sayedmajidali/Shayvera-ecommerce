import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { logger } from "@/server/platform/logger";
import {
  courierWebhookAuthorized,
  receiveCourierWebhook,
} from "@/server/modules/shipping/shipments";

const MAX_BODY = 256 * 1024;

/**
 * Courier tracking webhook (Shiprocket → Settings → API → Webhooks). The URL deliberately avoids the
 * words Shiprocket forbids in webhook URLs (shiprocket, kartrocket, sr, kr). Authenticated with the
 * `x-api-key` security token; stored and acknowledged immediately, applied by a job.
 */
export const POST = route(
  async (req) => {
    if (!courierWebhookAuthorized(req.headers.get("x-api-key"))) {
      logger.warn("Rejected courier webhook: bad or missing token");
      throw new AppError("UNAUTHENTICATED", "Invalid webhook token");
    }
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_BODY) throw new AppError("PAYLOAD_TOO_LARGE", "Payload too large");
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw new AppError("PAYLOAD_TOO_LARGE", "Payload too large");
    const result = await receiveCourierWebhook(raw);
    return Response.json({ ok: true, duplicate: result.duplicate });
  },
  // Authenticated by signature/token, not cookies: no origin check. Errors map to 4xx/5xx as before
  // (5xx makes the provider retry transient failures).
  { csrf: false },
);
