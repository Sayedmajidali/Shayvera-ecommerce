import "server-only";
import { cached } from "@/server/platform/cache";
import { logger } from "@/server/platform/logger";
import { captureIntegrationFailure } from "@/server/platform/monitoring";
import type { Tx } from "@/server/platform/db";
import { db } from "@/server/platform/db";
import { loadStoreSettings } from "@/server/modules/settings/queries";
import { computeShipmentPackage, type PackageLine } from "./package";
import { shippingProvider } from "./provider";
import type { ServiceabilityResult } from "./types";

/**
 * Courier coverage check used by checkout (SHIPPING_INTEGRATION.md §6).
 *
 *   serviceable      → continue; COD only if a courier offers it
 *   not_serviceable  → checkout blocked with a clear message
 *   unverified       → provider slow (> 3 s), down or returned something unexpected: checkout continues
 *                      with store shipping fees and store COD rules; the order is marked for review
 *   skipped          → manual shipping, or no store PIN configured: no check possible
 *
 * Results are cached for 6 h (failures are never cached). Customer shipping charges stay
 * store-configured; courier rates are only for staff.
 */
export const CHECKOUT_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type DeliveryCheckResult =
  | { status: "serviceable"; codAvailable: boolean; etaDays: number | null }
  | { status: "not_serviceable" }
  | { status: "unverified"; reason: string }
  | { status: "skipped"; reason: string };

export type DeliveryItem = { variantId: string; quantity: number; unitPricePaise: number };

/** Loads packed weight/box per variant and builds the parcel estimate. */
export async function packageForItems(items: DeliveryItem[], client: Tx | typeof db = db) {
  const settings = await loadStoreSettings(client);
  const variants = await client.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) } },
    select: { id: true, weightGrams: true, lengthMm: true, breadthMm: true, heightMm: true },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const lines: PackageLine[] = items.map((i) => {
    const v = byId.get(i.variantId);
    return {
      quantity: i.quantity,
      weightGrams: v?.weightGrams ?? null,
      lengthMm: v?.lengthMm ?? null,
      breadthMm: v?.breadthMm ?? null,
      heightMm: v?.heightMm ?? null,
    };
  });
  const parcel = computeShipmentPackage(lines, {
    weightGrams: settings.defaultPackageWeightGrams,
    lengthMm: settings.defaultPackageLengthMm,
    breadthMm: settings.defaultPackageBreadthMm,
    heightMm: settings.defaultPackageHeightMm,
  });
  return { parcel, originPincode: settings.pincode };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDelivery(
  pincode: string,
  items: DeliveryItem[],
  opts: { timeoutMs?: number } = {},
): Promise<DeliveryCheckResult> {
  if (!/^[1-9]\d{5}$/.test(pincode)) return { status: "not_serviceable" };
  const provider = shippingProvider();
  if (!provider.supportsServiceability)
    return { status: "skipped", reason: "Shipping is arranged manually" };
  if (items.length === 0) return { status: "skipped", reason: "Nothing to ship" };

  const { parcel, originPincode } = await packageForItems(items);
  if (!originPincode) {
    logger.warn("Delivery check skipped: store PIN code is not set (Admin → Settings)");
    return { status: "skipped", reason: "Store PIN code is not configured" };
  }
  const declared = items.reduce((s, i) => s + i.unitPricePaise * i.quantity, 0);
  // Rates and coverage barely depend on value; bucket weight to 500 g so carts share cache entries.
  const weightBucket = Math.ceil(parcel.weightGrams / 500) * 500;
  const key = `svc:${provider.name}:${originPincode}:${pincode}:${weightBucket}`;
  const timeoutMs = opts.timeoutMs ?? CHECKOUT_TIMEOUT_MS;

  let result: ServiceabilityResult;
  try {
    result = await cached(key, CACHE_TTL_MS, () =>
      withTimeout(
        provider.checkServiceability(
          {
            originPincode,
            destinationPincode: pincode,
            cod: false,
            weightGrams: weightBucket,
            lengthMm: parcel.lengthMm,
            breadthMm: parcel.breadthMm,
            heightMm: parcel.heightMm,
            declaredValuePaise: declared,
          },
          { timeoutMs },
        ),
        timeoutMs,
      ),
    );
  } catch (error) {
    captureIntegrationFailure(provider.name, "serviceability", error, { pincode });
    return { status: "unverified", reason: "Courier check unavailable" };
  }
  if (result.kind === "not_serviceable") return { status: "not_serviceable" };
  return { status: "serviceable", codAvailable: result.codAvailable, etaDays: result.etaDays };
}
