import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@/server/platform/db";
import { storage } from "@/server/platform/storage";
import { createAdmin, params, registerCustomer } from "../helpers/auth";
import { makeCategory } from "../helpers/fixtures";
import * as slotRoute from "@/app/api/admin/site-images/[slot]/route";
import * as categoryImageRoute from "@/app/api/admin/categories/[id]/image/route";
import * as publicSlotRoute from "@/app/site-image/[slot]/route";

const BASE = "http://localhost:3000";

async function png(width = 600, height = 400, name = "photo.png") {
  const buf = await sharp({
    create: { width, height, channels: 4, background: { r: 12, g: 118, b: 78, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return new File([new Uint8Array(buf)], name, { type: "image/png" });
}

function multipart(url: string, cookie: string, file?: File, alt?: string) {
  const form = new FormData();
  if (file) form.set("file", file);
  if (alt) form.set("alt", alt);
  return new Request(`${BASE}${url}`, {
    method: "POST",
    headers: { origin: BASE, cookie },
    body: form,
  });
}

const del = (url: string, cookie: string) =>
  new Request(`${BASE}${url}`, { method: "DELETE", headers: { origin: BASE, cookie } });

const keyOf = (url: string) => url.replace(/^\/media\//, "");

describe("site images (Admin → Site images)", () => {
  it("uploads, replaces (deleting the old file) and resets a slot", async () => {
    const { cookie } = await createAdmin();
    const first = await slotRoute.POST(
      multipart("/api/admin/site-images/heroPrimary", cookie, await png(), "Bowl of makhana"),
      params({ slot: "heroPrimary" }),
    );
    expect(first.status).toBe(201);
    const a = (await first.json()).data;
    expect(a).toMatchObject({
      slot: "heroPrimary",
      alt: "Bowl of makhana",
      width: 600,
      height: 400,
    });
    expect(a.url).toMatch(/^\/media\/branding\/.+\.webp$/);
    expect(await storage().get(keyOf(a.url))).not.toBeNull();

    const second = await slotRoute.POST(
      multipart("/api/admin/site-images/heroPrimary", cookie, await png(800, 800)),
      params({ slot: "heroPrimary" }),
    );
    const b = (await second.json()).data;
    expect(b.url).not.toBe(a.url);
    expect(await storage().get(keyOf(a.url))).toBeNull(); // replaced file cleaned up
    expect(await db.siteImage.count()).toBe(1);

    const reset = await slotRoute.DELETE(
      del("/api/admin/site-images/heroPrimary", cookie),
      params({ slot: "heroPrimary" }),
    );
    expect((await reset.json()).data).toEqual({ slot: "heroPrimary", reset: true });
    expect(await db.siteImage.count()).toBe(0);
    expect(await storage().get(keyOf(b.url))).toBeNull();
    expect(await db.adminAuditLog.count({ where: { entityType: "SiteImage" } })).toBe(3);
  });

  it("accepts small logos but rejects non-images, unknown slots and too-small photos", async () => {
    const { cookie } = await createAdmin();
    const logo = await slotRoute.POST(
      multipart("/api/admin/site-images/logo", cookie, await png(400, 100, "logo.png")),
      params({ slot: "logo" }),
    );
    expect(logo.status).toBe(201);

    const fake = new File([new TextEncoder().encode("<svg onload=alert(1)>")], "x.png", {
      type: "image/png",
    });
    const bad = await slotRoute.POST(
      multipart("/api/admin/site-images/heroSecondary", cookie, fake),
      params({ slot: "heroSecondary" }),
    );
    expect(bad.status).toBe(415);

    const small = await slotRoute.POST(
      multipart("/api/admin/site-images/heroPrimary", cookie, await png(300, 300)),
      params({ slot: "heroPrimary" }),
    );
    expect(small.status).toBe(400);

    const unknown = await slotRoute.POST(
      multipart("/api/admin/site-images/evil", cookie, await png()),
      params({ slot: "evil" }),
    );
    expect(unknown.status).toBe(404);
  });

  it("requires the settings permission", async () => {
    const customer = await registerCustomer("img-cust@example.com");
    const asCustomer = await slotRoute.POST(
      multipart("/api/admin/site-images/logo", customer.cookie, await png()),
      params({ slot: "logo" }),
    );
    expect(asCustomer.status).toBe(403);
    const staff = await createAdmin("catalog-staff@test.local");
    await db.user.update({ where: { id: staff.user.id }, data: { adminRoleId: "role_catalog" } });
    const asCatalog = await slotRoute.POST(
      multipart("/api/admin/site-images/logo", staff.cookie, await png()),
      params({ slot: "logo" }),
    );
    expect(asCatalog.status).toBe(403);
  });

  it("public /site-image/:slot redirects to the upload or the default", async () => {
    const res = await publicSlotRoute.GET(new Request(`${BASE}/site-image/appIcon`), {
      params: Promise.resolve({ slot: "appIcon" }),
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/brand/icon.png");

    const none = await publicSlotRoute.GET(new Request(`${BASE}/site-image/heroPrimary`), {
      params: Promise.resolve({ slot: "heroPrimary" }),
    });
    expect(none.status).toBe(404);

    const { cookie } = await createAdmin();
    const up = await slotRoute.POST(
      multipart("/api/admin/site-images/shareImage", cookie, await png(1200, 630)),
      params({ slot: "shareImage" }),
    );
    const { url } = (await up.json()).data;
    const custom = await publicSlotRoute.GET(new Request(`${BASE}/site-image/shareImage`), {
      params: Promise.resolve({ slot: "shareImage" }),
    });
    expect(custom.headers.get("location")).toBe(url);
  });
});

describe("category images", () => {
  it("uploads, replaces and removes a category image", async () => {
    const { cookie } = await createAdmin();
    const cat = await makeCategory("Spices");
    const up = await categoryImageRoute.POST(
      multipart(`/api/admin/categories/${cat.id}/image`, cookie, await png(800, 1000)),
      params({ id: cat.id }),
    );
    expect(up.status).toBe(201);
    const first = (await up.json()).data.imageUrl as string;
    expect(first).toMatch(/^\/media\/categories\/.+\.webp$/);
    expect((await db.category.findUniqueOrThrow({ where: { id: cat.id } })).imageUrl).toBe(first);

    const again = await categoryImageRoute.POST(
      multipart(`/api/admin/categories/${cat.id}/image`, cookie, await png(800, 1000)),
      params({ id: cat.id }),
    );
    const second = (await again.json()).data.imageUrl as string;
    expect(await storage().get(keyOf(first))).toBeNull();

    const removed = await categoryImageRoute.DELETE(
      del(`/api/admin/categories/${cat.id}/image`, cookie),
      params({ id: cat.id }),
    );
    expect(removed.status).toBe(200);
    expect((await db.category.findUniqueOrThrow({ where: { id: cat.id } })).imageUrl).toBeNull();
    expect(await storage().get(keyOf(second))).toBeNull();
  });

  it("returns 404 for an unknown category and 400 without a file", async () => {
    const { cookie } = await createAdmin();
    const missing = await categoryImageRoute.POST(
      multipart(`/api/admin/categories/nope/image`, cookie, await png()),
      params({ id: "nope" }),
    );
    expect(missing.status).toBe(404);
    const cat = await makeCategory();
    const empty = await categoryImageRoute.POST(
      multipart(`/api/admin/categories/${cat.id}/image`, cookie),
      params({ id: cat.id }),
    );
    expect(empty.status).toBe(400);
  });
});
