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
      storeName: "Shayvera Food",
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
      legalName: "Shayvera Food Pvt Ltd",
      storeName: "Shayvera Food",
    });
    expect(rows.find((r) => r.label === "FSSAI Lic. No.")).toMatchObject({
      value: "12345678901234",
      kind: "mono",
    });
    expect(rows.at(-1)?.value).toBe("Shayvera Food Pvt Ltd");
  });
});

describe("productSpecifications with attributes", () => {
  it("places custom rows after the identity rows and lets them replace a built-in row", () => {
    const rows = productSpecifications(
      {
        ...base,
        attributes: [
          { name: "Grade", value: "W320" },
          { name: "country of origin", value: "India (Kerala)" },
          { name: "Empty", value: " " },
        ],
      },
      { fssaiLicense: null, legalName: null, storeName: "Shayvera Food" },
    );
    const labels = rows.map((r) => r.label);
    expect(labels.slice(0, 5)).toEqual([
      "Brand",
      "Category",
      "Net quantity",
      "Grade",
      "country of origin",
    ]);
    expect(labels).not.toContain("Country of origin");
    expect(labels).not.toContain("Empty");
  });
});
