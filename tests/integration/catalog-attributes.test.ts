import { describe, expect, it } from "vitest";
import { db } from "@/server/platform/db";
import * as productsRoute from "@/app/api/admin/products/route";
import * as productRoute from "@/app/api/admin/products/[id]/route";
import * as variantRoute from "@/app/api/admin/variants/[id]/route";
import * as settingsRoute from "@/app/api/admin/settings/route";
import { getProductBySlug } from "@/server/modules/catalog/queries";
import { apiRequest, createAdmin, params } from "../helpers/auth";
import { makeCategory } from "../helpers/fixtures";

const body = (categoryId: string, extra: Record<string, unknown> = {}) => ({
  name: "Cashews W320",
  description: "Whole cashews, hand graded.",
  categoryId,
  status: "ACTIVE",
  attributes: [
    { name: "Grade", value: "W320" },
    { name: "Pack type", value: "Zip pouch" },
  ],
  variants: [
    {
      sku: "CASHEW-250",
      name: "250 g",
      options: { Weight: "250 g" },
      pricePaise: 34_900,
      weightGrams: 290,
      lengthMm: 200,
      breadthMm: 140,
      heightMm: 50,
      initialStock: 5,
      isActive: true,
    },
  ],
  ...extra,
});

async function create(cookie: string, payload: unknown) {
  const res = await productsRoute.POST(
    apiRequest("/api/admin/products", { method: "POST", cookie, body: payload }),
    undefined,
  );
  return { res, json: await res.json() };
}

describe("product specifications and packages", () => {
  it("stores ordered attributes and variant package details, and shows them on the storefront", async () => {
    const { cookie } = await createAdmin();
    const cat = await makeCategory();
    const { res, json } = await create(cookie, body(cat.id));
    expect(res.status).toBe(201);
    const variant = await db.productVariant.findFirstOrThrow({
      where: { productId: json.data.id },
    });
    expect(variant).toMatchObject({
      weightGrams: 290,
      lengthMm: 200,
      breadthMm: 140,
      heightMm: 50,
    });

    const page = await getProductBySlug(json.data.slug);
    expect(page?.attributes).toEqual([
      { name: "Grade", value: "W320" },
      { name: "Pack type", value: "Zip pouch" },
    ]);

    // Updating attributes replaces the whole list in the given order.
    const upd = await productRoute.PATCH(
      apiRequest(`/api/admin/products/${json.data.id}`, {
        method: "PATCH",
        cookie,
        body: { attributes: [{ name: "Pack type", value: "Jar" }] },
      }),
      params({ id: json.data.id }),
    );
    expect(upd.status).toBe(200);
    expect(
      (await db.productAttribute.findMany({ where: { productId: json.data.id } })).map((a) => [
        a.name,
        a.value,
        a.sortOrder,
      ]),
    ).toEqual([["Pack type", "Jar", 0]]);

    // Omitting attributes in an update leaves them unchanged.
    await productRoute.PATCH(
      apiRequest(`/api/admin/products/${json.data.id}`, {
        method: "PATCH",
        cookie,
        body: { brand: "Shayvera" },
      }),
      params({ id: json.data.id }),
    );
    expect(await db.productAttribute.count({ where: { productId: json.data.id } })).toBe(1);
  });

  it("validates attributes and package dimensions", async () => {
    const { cookie } = await createAdmin();
    const cat = await makeCategory();
    const dupNames = await create(
      cookie,
      body(cat.id, {
        attributes: [
          { name: "Grade", value: "A" },
          { name: "grade", value: "B" },
        ],
      }),
    );
    expect(dupNames.res.status).toBe(400);

    const partialBox = body(cat.id);
    partialBox.variants[0] = {
      ...partialBox.variants[0]!,
      heightMm: undefined as unknown as number,
    };
    const partial = await create(cookie, partialBox);
    expect(partial.res.status).toBe(400);
    expect(partial.json.error.details["variants.0.lengthMm"]).toMatch(/all three/);

    const zero = body(cat.id);
    zero.variants[0] = { ...zero.variants[0]!, weightGrams: 0 };
    expect((await create(cookie, zero)).res.status).toBe(400);
  });

  it("variant updates keep or clear package details explicitly", async () => {
    const { cookie } = await createAdmin();
    const cat = await makeCategory();
    const { json } = await create(cookie, body(cat.id));
    const v = await db.productVariant.findFirstOrThrow({ where: { productId: json.data.id } });
    const res = await variantRoute.PUT(
      apiRequest(`/api/admin/variants/${v.id}`, {
        method: "PUT",
        cookie,
        body: {
          sku: v.sku,
          name: v.name,
          options: v.options,
          pricePaise: v.pricePaise,
          isActive: true,
          weightGrams: null,
          lengthMm: null,
          breadthMm: null,
          heightMm: null,
        },
      }),
      params({ id: v.id }),
    );
    expect(res.status).toBe(200);
    expect(await db.productVariant.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({
      weightGrams: null,
      lengthMm: null,
    });
  });

  it("the database rejects non-positive package values even outside the API", async () => {
    const cat = await makeCategory();
    const { cookie } = await createAdmin();
    const { json } = await create(cookie, body(cat.id));
    await expect(
      db.productVariant.updateMany({ where: { productId: json.data.id }, data: { heightMm: -1 } }),
    ).rejects.toThrow();
    await expect(
      db.storeSettings.update({ where: { id: "default" }, data: { defaultPackageWeightGrams: 0 } }),
    ).rejects.toThrow();
  });

  it("saves the store default package and keeps it when omitted", async () => {
    const { cookie } = await createAdmin();
    const current = (
      await (
        await settingsRoute.GET(apiRequest("/api/admin/settings", { cookie }), undefined)
      ).json()
    ).data;
    const put = (b: unknown) =>
      settingsRoute.PUT(
        apiRequest("/api/admin/settings", { method: "PUT", cookie, body: b }),
        undefined,
      );
    const withoutPackage = Object.fromEntries(
      Object.entries(current).filter(([k]) => !k.startsWith("defaultPackage")),
    );
    const res = await put({
      ...current,
      defaultPackageWeightGrams: 750,
      defaultPackageHeightMm: 120,
    });
    expect(res.status).toBe(200);
    expect((await put(withoutPackage)).status).toBe(200);
    expect(await db.storeSettings.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({
      defaultPackageWeightGrams: 750,
      defaultPackageHeightMm: 120,
    });
    expect((await put({ ...current, defaultPackageLengthMm: 0 })).status).toBe(400);
  });
});
