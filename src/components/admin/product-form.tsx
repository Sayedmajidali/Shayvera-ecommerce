"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { percentFromBps, rupeesToPaise } from "@/lib/money";

export const GST_OPTIONS = [0, 500, 1200, 1800, 2800];

export type ProductFormValues = {
  name: string;
  slug: string;
  shortDescription: string;
  description: string;
  brand: string;
  categoryId: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isFeatured: boolean;
  taxRateBps: string; // "" = store default
  hsnCode: string;
  ingredients: string;
  shelfLife: string;
  storageInfo: string;
  countryOfOrigin: string;
  isVegetarian: boolean;
  seoTitle: string;
  seoDescription: string;
  /** Specification rows shown on the product page, in order. */
  attributes: { name: string; value: string }[];
};

type VariantRow = {
  sku: string;
  name: string;
  options: string;
  price: string;
  compareAt: string;
  stock: string;
};

/** "Colour: Blue, Size: L" → { Colour: "Blue", Size: "L" } */
export function parseOptions(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(",")) {
    const [k, ...rest] = part.split(":");
    const key = k?.trim();
    const value = rest.join(":").trim();
    if (key && value) out[key] = value;
  }
  return out;
}

export function formatOptions(o: Record<string, string>): string {
  return Object.entries(o)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

function toPaise(v: string): number | null {
  if (!v.trim()) return null;
  try {
    return rupeesToPaise(v);
  } catch {
    return NaN;
  }
}

export function ProductForm({
  mode,
  productId,
  initial,
  categories,
}: {
  mode: "create" | "edit";
  productId?: string;
  initial: ProductFormValues;
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<ProductFormValues>(initial);
  const [rows, setRows] = useState<VariantRow[]>([
    { sku: "", name: "Default", options: "", price: "", compareAt: "", stock: "0" },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof ProductFormValues>(k: K, val: ProductFormValues[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    const body: Record<string, unknown> = {
      name: v.name,
      slug: v.slug || undefined,
      shortDescription: v.shortDescription,
      description: v.description,
      brand: v.brand,
      categoryId: v.categoryId,
      status: v.status,
      isFeatured: v.isFeatured,
      taxRateBps: v.taxRateBps === "" ? null : Number(v.taxRateBps),
      hsnCode: v.hsnCode,
      ingredients: v.ingredients,
      shelfLife: v.shelfLife,
      storageInfo: v.storageInfo,
      countryOfOrigin: v.countryOfOrigin,
      isVegetarian: v.isVegetarian,
      seoTitle: v.seoTitle,
      seoDescription: v.seoDescription,
      // Blank rows are dropped; the server validates names/values and duplicates.
      attributes: v.attributes
        .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
        .filter((a) => a.name || a.value),
    };
    if (mode === "create") {
      const variants = rows.map((r) => ({
        sku: r.sku,
        name: r.name,
        options: parseOptions(r.options),
        pricePaise: toPaise(r.price),
        compareAtPricePaise: toPaise(r.compareAt),
        initialStock: Number(r.stock || 0),
        isActive: true,
      }));
      if (
        variants.some(
          (x) =>
            x.pricePaise === null ||
            Number.isNaN(x.pricePaise) ||
            Number.isNaN(x.compareAtPricePaise),
        )
      ) {
        setErrors({ variants: "Enter valid prices in rupees for every variant" });
        return;
      }
      body.variants = variants;
    }
    setPending(true);
    try {
      const result = await apiFetch<{ id: string }>(
        mode === "create" ? "/api/admin/products" : `/api/admin/products/${productId}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          body,
        },
      );
      toast.success(mode === "create" ? "Product created — now add images" : "Product saved");
      if (mode === "create") router.push(`/admin/products/${result.id}`);
      else router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save product");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={v.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!errors.name}
              />
              <FieldError message={errors.name} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-slug">URL slug</Label>
              <Input
                id="p-slug"
                value={v.slug}
                placeholder="auto-generated from name"
                onChange={(e) => set("slug", e.target.value)}
                aria-invalid={!!errors.slug}
              />
              <FieldError message={errors.slug} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-short">Short description</Label>
            <Input
              id="p-short"
              maxLength={200}
              value={v.shortDescription}
              onChange={(e) => set("shortDescription", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea
              id="p-desc"
              rows={7}
              value={v.description}
              onChange={(e) => set("description", e.target.value)}
              aria-invalid={!!errors.description}
            />
            <FieldError message={errors.description} />
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="p-category">Category</Label>
              <Select value={v.categoryId} onValueChange={(val) => set("categoryId", val)}>
                <SelectTrigger id="p-category" aria-invalid={!!errors.categoryId}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.categoryId} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-brand">Brand</Label>
              <Input id="p-brand" value={v.brand} onChange={(e) => set("brand", e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-status">Status</Label>
              <Select
                value={v.status}
                onValueChange={(val) => set("status", val as ProductFormValues["status"])}
              >
                <SelectTrigger id="p-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft (hidden)</SelectItem>
                  <SelectItem value="ACTIVE">Active (visible)</SelectItem>
                  <SelectItem value="ARCHIVED">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="p-gst">GST rate</Label>
              <Select
                value={v.taxRateBps === "" ? "default" : v.taxRateBps}
                onValueChange={(val) => set("taxRateBps", val === "default" ? "" : val)}
              >
                <SelectTrigger id="p-gst">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Store default</SelectItem>
                  {GST_OPTIONS.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {percentFromBps(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-hsn">HSN code</Label>
              <Input
                id="p-hsn"
                inputMode="numeric"
                maxLength={8}
                value={v.hsnCode}
                onChange={(e) => set("hsnCode", e.target.value)}
                aria-invalid={!!errors.hsnCode}
              />
              <FieldError message={errors.hsnCode} />
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
              <Switch
                id="p-featured"
                checked={v.isFeatured}
                onCheckedChange={(val) => set("isFeatured", val)}
              />
              <Label htmlFor="p-featured">Featured on homepage</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>Variants</CardTitle>
            <CardDescription>
              Every product needs at least one variant. Options use “Name: Value, Name: Value”.
              Prices in ₹.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_1.4fr_0.8fr_0.8fr_0.6fr_auto]"
              >
                {(["sku", "name", "options", "price", "compareAt", "stock"] as const).map((k) => (
                  <div key={k} className="grid gap-1">
                    <Label htmlFor={`v-${i}-${k}`} className="text-muted-foreground text-xs">
                      {
                        {
                          sku: "SKU",
                          name: "Variant name",
                          options: "Options",
                          price: "Price ₹",
                          compareAt: "MRP ₹ (optional)",
                          stock: "Stock",
                        }[k]
                      }
                    </Label>
                    <Input
                      id={`v-${i}-${k}`}
                      value={r[k]}
                      inputMode={
                        k === "price" || k === "compareAt" || k === "stock" ? "decimal" : undefined
                      }
                      placeholder={k === "options" ? "Colour: Blue" : undefined}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                        )
                      }
                      className="h-9"
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="self-end"
                  disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  aria-label="Remove variant"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {Object.entries(errors)
              .filter(([k]) => k.startsWith("variants"))
              .map(([k, m]) => (
                <FieldError key={k} message={`${k.replace(/^variants\.?/, "Variant ")}: ${m}`} />
              ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { sku: "", name: "", options: "", price: "", compareAt: "", stock: "0" },
                ])
              }
            >
              <Plus /> Add variant
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Product information (food labelling)</CardTitle>
          <CardDescription>
            Shown on the product page. Net quantity comes from each variant (e.g. 250 g).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="p-ingredients">Ingredients</Label>
            <Textarea
              id="p-ingredients"
              rows={2}
              value={v.ingredients}
              onChange={(e) => set("ingredients", e.target.value)}
              placeholder="e.g. Fox nuts (makhana), rice bran oil, Himalayan pink salt, black pepper"
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="p-shelf">Shelf life</Label>
              <Input
                id="p-shelf"
                value={v.shelfLife}
                onChange={(e) => set("shelfLife", e.target.value)}
                placeholder="e.g. 6 months from packing"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-origin">Country of origin</Label>
              <Input
                id="p-origin"
                value={v.countryOfOrigin}
                onChange={(e) => set("countryOfOrigin", e.target.value)}
                aria-invalid={!!errors.countryOfOrigin}
              />
              <FieldError message={errors.countryOfOrigin} />
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
              <Switch
                id="p-veg"
                checked={v.isVegetarian}
                onCheckedChange={(val) => set("isVegetarian", val)}
              />
              <Label htmlFor="p-veg">Vegetarian (green dot)</Label>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-storage">Storage instructions</Label>
            <Input
              id="p-storage"
              value={v.storageInfo}
              onChange={(e) => set("storageInfo", e.target.value)}
              placeholder="e.g. Store in a cool, dry place. Keep airtight after opening."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specifications</CardTitle>
          <CardDescription>
            Extra rows for the product page table, e.g. “Grade: W320” or “Pack type: Zip pouch”.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3" data-testid="attributes-editor">
          {v.attributes.map((a, i) => {
            const update = (patch: Partial<{ name: string; value: string }>) =>
              set(
                "attributes",
                v.attributes.map((x, j) => (j === i ? { ...x, ...patch } : x)),
              );
            const move = (to: number) => {
              const next = [...v.attributes];
              const [row] = next.splice(i, 1);
              next.splice(to, 0, row!);
              set("attributes", next);
            };
            return (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input
                  aria-label={`Specification ${i + 1} name`}
                  placeholder="Name"
                  maxLength={60}
                  value={a.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
                <Input
                  aria-label={`Specification ${i + 1} value`}
                  placeholder="Value"
                  maxLength={300}
                  value={a.value}
                  onChange={(e) => update({ value: e.target.value })}
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === 0}
                    onClick={() => move(i - 1)}
                    aria-label={`Move specification ${i + 1} up`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={i === v.attributes.length - 1}
                    onClick={() => move(i + 1)}
                    aria-label={`Move specification ${i + 1} down`}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      set(
                        "attributes",
                        v.attributes.filter((_, j) => j !== i),
                      )
                    }
                    aria-label={`Remove specification ${i + 1}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })}
          <FieldError message={errors.attributes} />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={v.attributes.length >= 30}
              onClick={() => set("attributes", [...v.attributes, { name: "", value: "" }])}
            >
              <Plus /> Add specification
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search engine listing</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="p-seo-title">SEO title</Label>
            <Input
              id="p-seo-title"
              maxLength={70}
              value={v.seoTitle}
              onChange={(e) => set("seoTitle", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-seo-desc">SEO description</Label>
            <Textarea
              id="p-seo-desc"
              maxLength={160}
              rows={2}
              value={v.seoDescription}
              onChange={(e) => set("seoDescription", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/products")}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
