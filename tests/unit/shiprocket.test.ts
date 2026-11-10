import { describe, expect, it, vi } from "vitest";
import { ShiprocketClient } from "@/server/modules/shipping/providers/shiprocket/client";
import {
  parseServiceability,
  ShiprocketProvider,
} from "@/server/modules/shipping/providers/shiprocket/provider";
import { MockShippingProvider } from "@/server/modules/shipping/providers/mock";
import { ShiprocketShipments } from "@/server/modules/shipping/providers/shiprocket/shipments";
import { HttpError } from "@/server/platform/http";

const BASE = "https://apiv2.shiprocket.in/v1/external";

/** Subset of the official "Check Courier Serviceability" example response. */
const officialExample = {
  currency: "INR",
  status: 200,
  data: {
    available_courier_companies: [
      {
        courier_company_id: 43,
        courier_name: "Delhivery Surface",
        rate: 54,
        cod: 1,
        estimated_delivery_days: "4",
        etd: "Jul 01, 2024",
        blocked: 0,
        freight_charge: 54,
      },
      {
        courier_company_id: 51,
        courier_name: "Xpressbees Air",
        rate: "96.5",
        cod: 0,
        estimated_delivery_days: "2",
        blocked: 0,
      },
      {
        courier_company_id: 99,
        courier_name: "Blocked Co",
        rate: 10,
        cod: 1,
        estimated_delivery_days: "1",
        blocked: 1,
      },
    ],
    recommended_courier_company_id: 43,
    is_recommendation_enabled: 1,
  },
};

const jwt = (expSecondsFromNow: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })).toString("base64url")}.sig-padding-xxxxxxxx`;

describe("Shiprocket serviceability parsing", () => {
  it("maps couriers, ignores blocked ones and picks the fastest estimate", () => {
    expect(parseServiceability(officialExample)).toEqual({
      kind: "serviceable",
      codAvailable: true,
      etaDays: 2,
      recommendedCourierId: "43",
      couriers: [
        { courierId: "43", name: "Delhivery Surface", ratePaise: 5400, cod: true, etaDays: 4 },
        { courierId: "51", name: "Xpressbees Air", ratePaise: 9650, cod: false, etaDays: 2 },
      ],
    });
  });

  it("treats an empty courier list as not serviceable", () => {
    expect(parseServiceability({ data: { available_courier_companies: [] } })).toEqual({
      kind: "not_serviceable",
    });
  });

  it("rejects unexpected shapes instead of guessing", () => {
    expect(() =>
      parseServiceability({ status: 404, message: "Delivery postcode not serviceable" }),
    ).toThrow();
    expect(() =>
      parseServiceability({
        data: { available_courier_companies: [{ courier_name: "X", courier_company_id: "" }] },
      }),
    ).toThrow();
  });
});

describe("Shiprocket client", () => {
  it("logs in once, reuses the token and sends the documented query", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u.replace(BASE, "")}`);
      if (u.endsWith("/auth/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({ email: "api@shop.in", password: "pw" });
        return Response.json({ token: jwt(10 * 86400) });
      }
      expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer h\./);
      return Response.json(officialExample);
    });
    const p = new ShiprocketProvider({
      baseUrl: BASE,
      email: "api@shop.in",
      password: "pw",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const q = {
      originPincode: "560001",
      destinationPincode: "110001",
      cod: false,
      weightGrams: 1571,
      lengthMm: 251,
      breadthMm: 120,
      heightMm: 95,
      declaredValuePaise: 49_950,
    };
    await p.checkServiceability(q, { timeoutMs: 3000 });
    await p.checkServiceability(q, { timeoutMs: 3000 });
    expect(calls.filter((c) => c.includes("/auth/login"))).toHaveLength(1);
    const query = new URL(BASE + calls[1]!.split(" ")[1]!).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      pickup_postcode: "560001",
      delivery_postcode: "110001",
      cod: "0",
      weight: "1.58",
      length: "26",
      breadth: "12",
      height: "10",
      declared_value: "500",
    });
  });

  it("re-authenticates once on 401 and shares a single login between concurrent calls", async () => {
    let logins = 0;
    let first = true;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/auth/login")) {
        logins++;
        await new Promise((r) => setTimeout(r, 10));
        return Response.json({ token: jwt(86400) });
      }
      if (first) {
        first = false;
        return new Response(JSON.stringify({ message: "Token expired" }), { status: 401 });
      }
      return Response.json({ ok: true });
    });
    const c = new ShiprocketClient({
      baseUrl: BASE,
      email: "a@b.in",
      password: "x",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await Promise.all([
      c.request({ path: "/x", operation: "t" }),
      c.request({ path: "/y", operation: "t" }),
    ]);
    expect(logins).toBe(2); // one shared initial login + one forced re-login after the 401
  });

  it("surfaces login failures without leaking credentials", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: "Invalid credentials" }), { status: 403 }),
    );
    const c = new ShiprocketClient({
      baseUrl: BASE,
      email: "a@b.in",
      password: "s3cret-pass",
      fetchImpl: fetchImpl as typeof fetch,
    });
    const err = (await c.request({ path: "/x", operation: "t" }).catch((e) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(403);
    expect(err.message).not.toContain("s3cret-pass");
  });
});

describe("mock shipping provider", () => {
  const p = new MockShippingProvider();
  const q = (destinationPincode: string) => ({
    originPincode: "560001",
    destinationPincode,
    cod: false,
    weightGrams: 500,
    lengthMm: 200,
    breadthMm: 150,
    heightMm: 100,
    declaredValuePaise: 10_000,
  });

  it("follows its documented rules", async () => {
    expect(await p.checkServiceability(q("560034"))).toMatchObject({
      kind: "serviceable",
      etaDays: 2,
      codAvailable: true,
    });
    expect(await p.checkServiceability(q("500001"))).toMatchObject({ etaDays: 4 });
    expect(await p.checkServiceability(q("110001"))).toMatchObject({ etaDays: 6 });
    expect(await p.checkServiceability(q("791001"))).toMatchObject({
      kind: "serviceable",
      codAvailable: false,
    });
    expect(await p.checkServiceability(q("932001"))).toEqual({ kind: "not_serviceable" });
  });
});

describe("Shiprocket manifests", () => {
  /** Routes requests by path; records the bodies sent. */
  const harness = (routes: Record<string, () => Response>) => {
    const sent: { path: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname.replace("/v1/external", "");
      if (path === "/auth/login")
        return new Response(JSON.stringify({ token: jwt(3600) }), { status: 200 });
      sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const route = routes[path];
      if (!route) throw new Error(`unexpected ${path}`);
      return route();
    });
    const client = new ShiprocketClient({
      baseUrl: BASE,
      email: "a@b.in",
      password: "x",
      fetchImpl: fetchImpl as typeof fetch,
    });
    return { ops: new ShiprocketShipments(client), sent };
  };
  const json =
    (body: unknown, status = 200) =>
    () =>
      new Response(JSON.stringify(body), { status });

  it("returns the generated manifest URL", async () => {
    const { ops, sent } = harness({
      "/manifests/generate": json({ status: 1, manifest_url: "https://s3/m1.pdf" }),
    });
    expect(await ops.generateManifest("16090109", "348456385")).toEqual({
      manifestUrl: "https://s3/m1.pdf",
    });
    expect(sent).toEqual([{ path: "/manifests/generate", body: { shipment_id: [16090109] } }]);
  });

  it("re-downloads an already generated manifest with /manifests/print (official 400 example)", async () => {
    const { ops, sent } = harness({
      "/manifests/generate": json(
        {
          message:
            "Manifest already generated for some shipment_ids, Please try again after removin them",
          status_code: 400,
          already_manifested_shipment_ids: [16090109],
        },
        400,
      ),
      "/manifests/print": json({ manifest_url: "https://s3/print.pdf" }),
    });
    expect(await ops.generateManifest("16090109", "348456385")).toEqual({
      manifestUrl: "https://s3/print.pdf",
    });
    expect(sent.at(-1)).toEqual({ path: "/manifests/print", body: { order_ids: [348456385] } });
  });

  it("falls back to /manifests/print when generate returns an empty URL", async () => {
    const { ops } = harness({
      "/manifests/generate": json({ status: 1, manifest_url: "" }),
      "/manifests/print": json({ manifest_url: "https://s3/print.pdf" }),
    });
    expect((await ops.generateManifest("1", "2")).manifestUrl).toBe("https://s3/print.pdf");
  });

  it("still fails clearly without an order id or when print has nothing", async () => {
    const already = json({ message: "Manifest already generated", status_code: 400 }, 400);
    const a = harness({ "/manifests/generate": already });
    expect(await a.ops.generateManifest("1").catch((e) => e)).toBeInstanceOf(HttpError);
    const b = harness({
      "/manifests/generate": already,
      "/manifests/print": json({ manifest_url: "" }),
    });
    expect(await b.ops.generateManifest("1", "2").catch((e) => (e as Error).message)).toBe(
      "Manifest not available",
    );
  });
});

describe("Shiprocket create-order errors", () => {
  it("names the accepted pickup locations when the nickname is wrong", async () => {
    const { parseCreateResponse } =
      await import("@/server/modules/shipping/providers/shiprocket/shipments");
    const wrong = {
      message: "Wrong Pickup location entered. Please choose one location from the data given",
      data: ["work"],
    };
    expect(() => parseCreateResponse(wrong)).toThrow(
      /Wrong Pickup location entered.*Shiprocket accepts: "work" — use one of these/,
    );
    expect(() => parseCreateResponse({ message: wrong.message })).toThrow(
      /matches an active pickup address nickname/,
    );
    expect(() => parseCreateResponse({ message: "Something else" })).toThrow(
      /^Unexpected create-order response: Something else$/,
    );
  });
});

describe("Shiprocket cancellation", () => {
  const setup = (orderCancel: () => Response) => {
    const sent: { path: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname.replace("/v1/external", "");
      if (path === "/auth/login")
        return new Response(JSON.stringify({ token: jwt(3600) }), { status: 200 });
      sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/orders/cancel/shipment/awbs")
        return new Response(
          JSON.stringify({ message: "Bulk Shipment cancellation is in progress" }),
        );
      if (path === "/orders/cancel") return orderCancel();
      throw new Error(`unexpected ${path}`);
    });
    const client = new ShiprocketClient({
      baseUrl: BASE,
      email: "a@b.in",
      password: "x",
      fetchImpl: fetchImpl as typeof fetch,
    });
    return { ops: new ShiprocketShipments(client), sent };
  };

  it("cancels the AWB and then the Shiprocket order, so nothing is left as NEW", async () => {
    const { ops, sent } = setup(() => new Response(null, { status: 204 }));
    await ops.cancelShipment({ awb: "SRSC9085553253", providerOrderId: "348456385" });
    expect(sent).toEqual([
      { path: "/orders/cancel/shipment/awbs", body: { awbs: ["SRSC9085553253"] } },
      { path: "/orders/cancel", body: { ids: [348456385] } },
    ]);
  });

  it("treats an already cancelled order as done but surfaces other failures", async () => {
    const done = setup(
      () =>
        new Response(JSON.stringify({ message: "Order is already cancelled" }), { status: 400 }),
    );
    await expect(done.ops.cancelShipment({ awb: "A1", providerOrderId: "1" })).resolves.toBe(
      undefined,
    );
    const broken = setup(
      () => new Response(JSON.stringify({ message: "Invalid order id" }), { status: 422 }),
    );
    expect(
      await broken.ops.cancelShipment({ awb: "A1", providerOrderId: "1" }).catch((e) => e),
    ).toBeInstanceOf(HttpError);
  });

  it("cancels just the order when no AWB was assigned yet", async () => {
    const { ops, sent } = setup(() => new Response(null, { status: 204 }));
    await ops.cancelShipment({ providerOrderId: "7" });
    expect(sent.map((s) => s.path)).toEqual(["/orders/cancel"]);
  });
});
