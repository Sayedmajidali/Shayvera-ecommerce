import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as stockRoute from "@/app/api/admin/variants/[id]/stock/route";
import * as payRoute from "@/app/api/orders/[orderNumber]/pay/route";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as cartRoute from "@/app/api/cart/route";
import { apiRequest, createAdmin, params, TEST_PASSWORD, registerCustomer } from "../helpers/auth";
import { makeProduct } from "../helpers/fixtures";

type Handler = (req: Request, ctx: unknown) => Promise<Response>;

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("CSRF: every state-changing API handler checks the request origin", () => {
  const routes = import.meta.glob<Record<string, unknown>>("/src/app/api/**/route.ts", {
    eager: true,
  });
  // Authenticated by signature/token instead of cookies; Better Auth checks origins itself.
  const exempt = ["/api/webhooks/", "/api/auth/"];

  it("rejects cross-origin and origin-less requests before doing anything", async () => {
    let checked = 0;
    for (const [file, mod] of Object.entries(routes)) {
      const path = file.replace("/src/app", "").replace("/route.ts", "");
      if (exempt.some((e) => path.startsWith(e))) continue;
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const h = mod[method] as Handler | undefined;
        if (!h) continue;
        const url = `http://localhost:3000${path.replace(/\[[^\]]+\]/g, "x")}`;
        const evil = await h(
          new Request(url, {
            method,
            headers: { origin: "https://evil.example", "content-type": "application/json" },
            body: "{}",
          }),
          params({ id: "x", orderNumber: "x", productId: "x" }),
        );
        expect(evil.status, `${method} ${path} cross-origin`).toBe(403);
        const none = await h(
          new Request(url, { method, headers: { "content-type": "application/json" }, body: "{}" }),
          params({ id: "x", orderNumber: "x", productId: "x" }),
        );
        expect(none.status, `${method} ${path} no origin`).toBe(403);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(69);
  });

  it("Better Auth refuses sign-in from an untrusted origin", async () => {
    await registerCustomer("csrf@test.local");
    const res = await (authRoute.POST as Handler)(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ email: "csrf@test.local", password: TEST_PASSWORD }),
      }),
      undefined,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("static guarantees", () => {
  it("every admin page authorizes itself with a named permission", () => {
    const pages = walk("src/app/admin").filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(20);
    for (const f of pages) {
      if (f.includes("no-access")) continue;
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/requireAdminPage\(\s*\[?\s*"[A-Z_]+"/);
    }
  });

  it("client components never import server code (types only) or read server env", () => {
    for (const f of walk("src").filter((x) => /\.(tsx?|jsx?)$/.test(x))) {
      const src = readFileSync(f, "utf8");
      if (!/^["']use client["']/m.test(src.slice(0, 200))) continue;
      for (const m of src.matchAll(
        /^import\s+(type\s+)?[^;]*from\s+"(@\/server\/[^"]+|@\/lib\/(auth|env))"/gm,
      ))
        expect(m[1], `${f} imports ${m[2]} at runtime`).toBe("type ");
      for (const m of src.matchAll(/process\.env\.([A-Z_]+)/g))
        expect(m[1]!.startsWith("NEXT_PUBLIC_"), `${f} reads ${m[1]}`).toBe(true);
    }
  });

  it("modules that read secrets are marked server-only", () => {
    const secret = /process\.env\.[A-Z_]*(SECRET|PASSWORD|TOKEN|_KEY)\b/;
    for (const f of walk("src").filter((x) => /\.tsx?$/.test(x))) {
      const src = readFileSync(f, "utf8");
      if (secret.test(src)) expect(src, `${f} reads a secret`).toMatch(/^import "server-only";/m);
    }
  });

  it("no raw SQL is built from strings", () => {
    for (const f of walk("src").filter((x) => /\.tsx?$/.test(x))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\$(query|execute)RawUnsafe|Prisma\.raw\(/);
    }
  });
});

describe("API responses", () => {
  it("are not cacheable by shared caches", async () => {
    const res = await (cartRoute.GET as Handler)(apiRequest("/api/cart"), undefined);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("rate limits on payment start", () => {
  it("caps attempts per order", async () => {
    const prev = process.env.APP_RATE_LIMIT;
    process.env.APP_RATE_LIMIT = "on";
    try {
      const call = () =>
        (payRoute.POST as Handler)(
          apiRequest("/api/orders/SHV-NOPE/pay", { method: "POST", body: {} }),
          params({ orderNumber: "SHV-NOPE" }),
        );
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await call()).status);
      expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
      expect(statuses[20]).toBe(429);
    } finally {
      process.env.APP_RATE_LIMIT = prev;
    }
  });
});

describe("stock adjustments are idempotent", () => {
  it("applies a retried or concurrent duplicate once and refuses a reused key", async () => {
    const { cookie } = await createAdmin();
    const p = await makeProduct({ stock: 5 });
    const v = p.variants[0]!;
    const idempotencyKey = crypto.randomUUID();
    const adjust = (delta: number, key = idempotencyKey) =>
      (stockRoute.POST as Handler)(
        apiRequest(`/api/admin/variants/${v.id}/stock`, {
          method: "POST",
          cookie,
          body: { delta, reason: "RESTOCK", idempotencyKey: key },
        }),
        params({ id: v.id }),
      );
    const [a, b] = await Promise.all([adjust(3), adjust(3)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const again = await adjust(3);
    expect((await again.json()).data).toMatchObject({ quantityOnHand: 8, replayed: true });
    expect(
      await db.inventoryTransaction.count({ where: { variantId: v.id, reason: "RESTOCK" } }),
    ).toBe(1);
    expect(
      (await db.inventory.findUniqueOrThrow({ where: { variantId: v.id } })).quantityOnHand,
    ).toBe(8);

    expect((await adjust(4)).status).toBe(409);
    const missing = await (stockRoute.POST as Handler)(
      apiRequest(`/api/admin/variants/${v.id}/stock`, {
        method: "POST",
        cookie,
        body: { delta: 1, reason: "RESTOCK" },
      }),
      params({ id: v.id }),
    );
    expect(missing.status).toBe(400);
  });
});
