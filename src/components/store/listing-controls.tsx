"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Category = { name: string; slug: string };

function useParamUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    startTransition(() =>
      router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }),
    );
  };
  return { params, update, pending };
}

export function SortSelect({ options }: { options: Record<string, string> }) {
  const { params, update } = useParamUpdater();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="sort" className="text-muted-foreground hidden text-sm sm:block">
        Sort by
      </Label>
      <Select
        value={params.get("sort") ?? "featured"}
        onValueChange={(v) => update({ sort: v === "featured" ? null : v })}
      >
        <SelectTrigger id="sort" className="h-9 w-44 rounded-full" aria-label="Sort products">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {Object.entries(options).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function FilterFields({
  categories,
  showCategories,
  onApplied,
}: {
  categories: Category[];
  showCategories: boolean;
  onApplied?: () => void;
}) {
  const { params, update, pending } = useParamUpdater();
  const [min, setMin] = useState(params.get("minPrice") ?? "");
  const [max, setMax] = useState(params.get("maxPrice") ?? "");
  const activeCategory = params.get("category");
  const inStock = params.get("inStock") === "1";

  return (
    <div className="space-y-8" aria-busy={pending}>
      {showCategories && (
        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Category</legend>
          <ul className="space-y-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  update({ category: null });
                  onApplied?.();
                }}
                className={`hover:bg-accent w-full rounded-lg px-2 py-1.5 text-left text-sm ${!activeCategory ? "font-medium" : "text-muted-foreground"}`}
              >
                All categories
              </button>
            </li>
            {categories.map((c) => (
              <li key={c.slug}>
                <button
                  type="button"
                  aria-pressed={activeCategory === c.slug}
                  onClick={() => {
                    update({ category: c.slug });
                    onApplied?.();
                  }}
                  className={`hover:bg-accent w-full rounded-lg px-2 py-1.5 text-left text-sm ${activeCategory === c.slug ? "bg-accent font-medium" : "text-muted-foreground"}`}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Price (₹)</legend>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update({
              minPrice: min.replace(/\D/g, "") || null,
              maxPrice: max.replace(/\D/g, "") || null,
            });
            onApplied?.();
          }}
        >
          <Label htmlFor="minPrice" className="sr-only">
            Minimum price
          </Label>
          <Input
            id="minPrice"
            inputMode="numeric"
            placeholder="Min"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            className="h-9"
          />
          <span className="text-muted-foreground">–</span>
          <Label htmlFor="maxPrice" className="sr-only">
            Maximum price
          </Label>
          <Input
            id="maxPrice"
            inputMode="numeric"
            placeholder="Max"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            className="h-9"
          />
          <Button type="submit" size="sm" variant="outline">
            Go
          </Button>
        </form>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">Availability</legend>
        <div className="flex items-center gap-2">
          <Checkbox
            id="inStock"
            checked={inStock}
            onCheckedChange={(v) => {
              update({ inStock: v ? "1" : null });
              onApplied?.();
            }}
          />
          <Label htmlFor="inStock" className="font-normal">
            In stock only
          </Label>
        </div>
      </fieldset>
    </div>
  );
}

export function FilterSidebar({
  categories,
  showCategories = true,
}: {
  categories: Category[];
  showCategories?: boolean;
}) {
  return (
    <aside className="hidden w-56 shrink-0 lg:block" aria-label="Filters">
      <FilterFields categories={categories} showCategories={showCategories} />
    </aside>
  );
}

export function MobileFilters({
  categories,
  showCategories = true,
}: {
  categories: Category[];
  showCategories?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="lg:hidden">
          <SlidersHorizontal /> Filters
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="px-5 pb-8">
          <FilterFields
            categories={categories}
            showCategories={showCategories}
            onApplied={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ActiveFilters({ categories }: { categories: Category[] }) {
  const { params, update } = useParamUpdater();
  const chips: { key: string; label: string; clear: Record<string, null> }[] = [];
  const cat = params.get("category");
  if (cat)
    chips.push({
      key: "category",
      label: categories.find((c) => c.slug === cat)?.name ?? cat,
      clear: { category: null },
    });
  const min = params.get("minPrice");
  const max = params.get("maxPrice");
  if (min || max)
    chips.push({
      key: "price",
      label: `₹${min || 0} – ${max ? `₹${max}` : "any"}`,
      clear: { minPrice: null, maxPrice: null },
    });
  if (params.get("inStock"))
    chips.push({ key: "stock", label: "In stock", clear: { inStock: null } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => update(c.clear)}
          className="bg-card hover:bg-accent inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs"
          aria-label={`Remove filter ${c.label}`}
        >
          {c.label} <X className="size-3" />
        </button>
      ))}
    </div>
  );
}
