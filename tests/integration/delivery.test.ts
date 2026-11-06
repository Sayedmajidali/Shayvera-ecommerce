import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/platform/db";
import * as svcRoute from "@/app/api/shipping/serviceability/route";
import * as ordersRoute from "@/app/api/admin/orders/route";
import { setShippingProvider } from "@/server/modules/shipping/provider";
import { MockShippingProvider } from "@/server/modules/shipping/providers/mock";
import { ManualShippingProvider } from "@/server/modules/shipping/providers/manual";
import { checkDelivery } from "@/server/modules/shipping/serviceability";
import type { ShippingProvider } from "@/server/modules/shipping/types";
import { apiRequest, createAdmin } from "../helpers/auth";
import { address, cartWith, checkout, checkoutBody } from "../helpers/checkout";
import { makeProduct } from "../helpers/fixtures";

const withPin = (pincode: string, extra: Record<string, unknown> = {}) =>
  checkoutBody({ shippingAddress: { ...address, pincode }, ...extra });

beforeEach(async () => {
  setShippingProvider(new MockShippingProvider());
  await db.storeSettings.update({ where: { id: "default" }, data: { pincode: "560001" } });
});
afterEach(() => setShippingProvider(null));

describe("delivery check at checkout", () => {
  it("records a confirmed check and the courier estimate on the order", async () => {
    const p = await makeProduct({ stock: 5 });
    const { res, json } = await checkout(await cartWith(p.variants[0]!.id), withPin("560034"));
    expect(res.status).toBe(201);
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: json.data.orderNumber },
    });
    expect(order).toMatchObject({ deliveryCheck: "SERVICEABLE", deliveryEtaDays: 2 });
  });

  it("blocks PIN codes no courier serves, with a field error and no order or stock hold", async () => {
    const p = await makeProduct({ stock: 5 });
    const { res, json } = await checkout(await cartWith(p.variants[0]!.id), withPin("932001"));
    expect(res.status).toBe(422);
    expect(json.error.details["shippingAddress.pincode"]).toMatch(/don’t deliver/);
    expect(await db.order.count()).toBe(0);
    expect(await db.inventoryReservation.count()).toBe(0);
  });

  it("refuses COD where couriers only take prepaid parcels but allows online payment", async () => {
    const p = await makeProduct({ stock: 5 });
    const cod = await checkout(await cartWith(p.variants[0]!.id), withPin("791001"));
    expect(cod.res.status).toBe(422);
    expect(cod.json.error.details.paymentMethod).toMatch(/COD is not available/);
    const online = await checkout(
      await cartWith(p.variants[0]!.id),
      withPin("791001", { paymentMethod: "RAZORPAY" }),
    );
    expect(online.res.status).toBe(201);
  });

  it("continues when the courier check is down or slow, and flags the order for review", async () => {
    const down: ShippingProvider = {
      name: "shiprocket",
      supportsServiceability: true,
      checkServiceability: vi.fn(async () => {
        throw new Error("503 from provider");
      }),
    };
    setShippingProvider(down);
    const p = await makeProduct({ stock: 5 });
    const { res, json } = await checkout(await cartWith(p.variants[0]!.id), withPin("411001"));
    expect(res.status).toBe(201); // COD still allowed per store rules
    const order = await db.order.findUniqueOrThrow({
      where: { orderNumber: json.data.orderNumber },
    });
    expect(order).toMatchObject({ deliveryCheck: "UNVERIFIED", deliveryEtaDays: null });

    const { cookie } = await createAdmin();
    const list = await ordersRoute.GET(
      apiRequest("/api/admin/orders?attention=1", { cookie }),
      undefined,
    );
    const rows = (await list.json()).data.orders as { orderNumber: string }[];
    expect(rows.map((r) => r.orderNumber)).toContain(order.orderNumber);

    const slow: ShippingProvider = {
      name: "shiprocket",
      supportsServiceability: true,
      checkServiceability: () =>
        new Promise((r) => setTimeout(() => r({ kind: "not_serviceable" }), 500)),
    };
    setShippingProvider(slow);
    const started = Date.now();
    const r = await checkDelivery(
      "411002",
      [{ variantId: p.variants[0]!.id, quantity: 1, unitPricePaise: 100 }],
      {
        timeoutMs: 100,
      },
    );
    expect(r).toEqual({ status: "unverified", reason: "Courier check unavailable" });
    expect(Date.now() - started).toBeLessThan(400);
  });

  it("caches answers for repeat checks but never caches failures", async () => {
    const p = await makeProduct({ stock: 5 });
    const items = [{ variantId: p.variants[0]!.id, quantity: 1, unitPricePaise: 100 }];
    const flaky = {
      name: "shiprocket" as const,
      supportsServiceability: true,
      checkServiceability: vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({
        kind: "serviceable",
        codAvailable: true,
        etaDays: 3,
        couriers: [],
        recommendedCourierId: null,
      }),
    };
    setShippingProvider(flaky);
    expect((await checkDelivery("600001", items)).status).toBe("unverified");
    expect((await checkDelivery("600001", items)).status).toBe("serviceable");
    expect((await checkDelivery("600001", items)).status).toBe("serviceable");
    expect(flaky.checkServiceability).toHaveBeenCalledTimes(2);
  });

  it("skips the check for manual shipping or when the store PIN is not set", async () => {
    const p = await makeProduct({ stock: 5 });
    const items = [{ variantId: p.variants[0]!.id, quantity: 1, unitPricePaise: 100 }];
    setShippingProvider(new ManualShippingProvider());
    expect((await checkDelivery("560034", items)).status).toBe("skipped");
    setShippingProvider(new MockShippingProvider());
    await db.storeSettings.update({ where: { id: "default" }, data: { pincode: null } });
    expect((await checkDelivery("560034", items)).status).toBe("skipped");
    const { res, json } = await checkout(await cartWith(p.variants[0]!.id), withPin("932001"));
    expect(res.status).toBe(201); // no check possible → not blocked
    expect(
      (await db.order.findUniqueOrThrow({ where: { orderNumber: json.data.orderNumber } }))
        .deliveryCheck,
    ).toBe("SKIPPED");
  });
});

describe("delivery check endpoint", () => {
  it("answers for the cart or a Buy now item without exposing courier rates", async () => {
    const p = await makeProduct({ stock: 5 });
    const cookie = await cartWith(p.variants[0]!.id);
    const res = await svcRoute.GET(
      apiRequest("/api/shipping/serviceability?pincode=560034", { cookie }),
      undefined,
    );
    const body = await res.json();
    expect(body.data).toEqual({ status: "serviceable", codAvailable: true, etaDays: 2 });
    expect(JSON.stringify(body)).not.toMatch(/rate|courier/i);

    const buy = await svcRoute.GET(
      apiRequest(`/api/shipping/serviceability?pincode=791001&buy=${p.variants[0]!.id}&qty=2`),
      undefined,
    );
    expect((await buy.json()).data).toEqual({
      status: "serviceable",
      codAvailable: false,
      etaDays: 6,
    });

    const bad = await svcRoute.GET(
      apiRequest("/api/shipping/serviceability?pincode=12345"),
      undefined,
    );
    expect(bad.status).toBe(400);
  });
});
