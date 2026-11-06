/**
 * Builds the customer-facing specification rows for a product page from structured fields, so the
 * same table can grow with product attributes and package details without template changes.
 */
export type SpecRow = { label: string; value: string; kind?: "veg" | "mono" };

type SpecSource = {
  brand: string | null;
  category: { name: string };
  ingredients: string | null;
  shelfLife: string | null;
  storageInfo: string | null;
  countryOfOrigin: string;
  isVegetarian: boolean;
  variants: { name: string }[];
};

type StoreSource = { fssaiLicense: string | null; legalName: string | null; storeName: string };

export function productSpecifications(p: SpecSource, store: StoreSource): SpecRow[] {
  const rows: SpecRow[] = [];
  const add = (label: string, value: string | null | undefined, kind?: SpecRow["kind"]) => {
    if (value && value.trim()) rows.push({ label, value: value.trim(), ...(kind ? { kind } : {}) });
  };
  add("Brand", p.brand);
  add("Category", p.category.name);
  add("Net quantity", p.variants.map((v) => v.name).join(" · "));
  add("Ingredients", p.ingredients);
  add("Best before", p.shelfLife);
  add("Storage", p.storageInfo);
  add("Food type", p.isVegetarian ? "Vegetarian" : "Non-vegetarian", "veg");
  add("Country of origin", p.countryOfOrigin);
  add("FSSAI Lic. No.", store.fssaiLicense, "mono");
  add("Marketed by", store.legalName ?? store.storeName);
  return rows;
}
