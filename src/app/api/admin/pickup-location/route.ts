import { ok, parseJson } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import {
  getDefaultPickupLocation,
  pickupLocationSchema,
  saveDefaultPickupLocation,
} from "@/server/modules/shipping/shipments";

export const GET = adminRoute("SETTINGS_MANAGE", async () => ok(await getDefaultPickupLocation()), {
  csrf: false,
});

/** Saves the warehouse address; its name must match the pickup location nickname in Shiprocket. */
export const PUT = adminRoute("SETTINGS_MANAGE", async (req, _ctx, { actor }) =>
  ok(await saveDefaultPickupLocation(await parseJson(req, pickupLocationSchema), actor)),
);
