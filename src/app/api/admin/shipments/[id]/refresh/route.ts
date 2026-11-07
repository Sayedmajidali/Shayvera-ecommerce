import { ok, type RouteCtx } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { db } from "@/server/platform/db";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { shippingProvider } from "@/server/modules/shipping/provider";
import { applyTrackingUpdate } from "@/server/modules/shipping/shipments";

/** Pulls the latest tracking from the courier now. */
export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "SHIPPING_MANAGE",
  async (_req, { params }) => {
    const s = await db.shipment.findUnique({ where: { id: (await params).id } });
    const ops = shippingProvider().shipments;
    if (!s || s.provider === "manual" || !ops)
      throw new AppError("NOT_FOUND", "Shipment not found");
    if (!s.trackingNumber) throw new AppError("INVALID_STATE", "The shipment has no AWB yet");
    let t;
    try {
      t = await ops.track(s.trackingNumber);
    } catch {
      throw new AppError("PAYMENT_ERROR", "The courier service is unavailable. Please try again.");
    }
    await applyTrackingUpdate(s.id, t, "POLL");
    return ok(
      await db.shipment.findUniqueOrThrow({
        where: { id: s.id },
        select: { status: true, providerStatus: true },
      }),
    );
  },
);
