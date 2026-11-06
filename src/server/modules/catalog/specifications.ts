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
  /** Admin-defined rows (ProductAttribute), already ordered. */
  attributes?: { name: string; value: string }[];
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
  // Custom rows follow the identity rows. A custom row named like a built-in one replaces it.
  const custom = (p.attributes ?? []).filter((a) => a.name.trim() && a.value.trim());
  const customNames = new Set(custom.map((a) => a.name.trim().toLowerCase()));
  for (const a of custom) add(a.name, a.value);
  const builtIn = (label: string, value: string | null | undefined, kind?: SpecRow["kind"]) => {
    if (!customNames.has(label.toLowerCase())) add(label, value, kind);
  };
  builtIn("Ingredients", p.ingredients);
  builtIn("Best before", p.shelfLife);
  builtIn("Storage", p.storageInfo);
  builtIn("Food type", p.isVegetarian ? "Vegetarian" : "Non-vegetarian", "veg");
  builtIn("Country of origin", p.countryOfOrigin);
  add("FSSAI Lic. No.", store.fssaiLicense, "mono");
  add("Marketed by", store.legalName ?? store.storeName);
  return rows;
}
