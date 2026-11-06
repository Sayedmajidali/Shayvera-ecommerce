import { describe, expect, it } from "vitest";
import { productSpecifications } from "@/server/modules/catalog/specifications";

const base = {
  brand: "Shayvera",
  category: { name: "Spices" },
  ingredients: "Turmeric",
  shelfLife: "",
  storageInfo: null,
  countryOfOrigin: "India",
  isVegetarian: true,
  variants: [{ name: "100 g" }, { name: "200 g" }],
};

describe("productSpecifications", () => {
  it("lists filled fields in order and skips empty ones", () => {
    const rows = productSpecifications(base, {
      fssaiLicense: null,
      legalName: null,
      storeName: "Shayvera Foods",
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Brand",
      "Category",
      "Net quantity",
      "Ingredients",
      "Food type",
      "Country of origin",
      "Marketed by",
    ]);
    expect(rows.find((r) => r.label === "Net quantity")?.value).toBe("100 g · 200 g");
    expect(rows.find((r) => r.label === "Food type")).toMatchObject({
      value: "Vegetarian",
      kind: "veg",
    });
  });

  it("shows the FSSAI licence and legal name when configured", () => {
    const rows = productSpecifications(base, {
      fssaiLicense: "12345678901234",
      legalName: "Shayvera Foods Pvt Ltd",
      storeName: "Shayvera Foods",
    });
    expect(rows.find((r) => r.label === "FSSAI Lic. No.")).toMatchObject({
      value: "12345678901234",
      kind: "mono",
    });
    expect(rows.at(-1)?.value).toBe("Shayvera Foods Pvt Ltd");
  });
});
