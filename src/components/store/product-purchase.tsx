"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddToCartButton } from "@/components/store/add-to-cart-button";
import { Price } from "@/components/store/price";
import { QuantityStepper } from "@/components/store/quantity-stepper";
import { WishlistButton } from "@/components/store/wishlist";
import { cn } from "@/lib/utils";

type Variant = {
  id: string;
  sku: string;
  name: string;
  options: Record<string, string>;
  pricePaise: number;
  compareAtPricePaise: number | null;
  stock: number;
};

const MAX_PER_LINE = 10;
const OPTION_ORDER = ["Weight", "Flavour", "Colour", "Color", "Material", "Size", "Pack"];

export function ProductPurchase({
  product,
  variants,
}: {
  product: { id: string; name: string };
  variants: Variant[];
}) {
  const router = useRouter();
  const optionNames = useMemo(() => {
    const names: string[] = [];
    for (const v of variants)
      for (const k of Object.keys(v.options)) if (!names.includes(k)) names.push(k);
    // jsonb does not preserve key order; present options in a conventional order.
    const rank = (n: string) => {
      const i = OPTION_ORDER.indexOf(n);
      return i === -1 ? OPTION_ORDER.length : i;
    };
    return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [variants]);

  const initial = variants.find((v) => v.stock > 0) ?? variants[0]!;
  const [selected, setSelected] = useState<Record<string, string>>(initial.options);
  const [qty, setQty] = useState(1);

  const variant =
    variants.find((v) => optionNames.every((n) => v.options[n] === selected[n])) ??
    (optionNames.length === 0 ? variants[0] : undefined);

  const valuesFor = (name: string) =>
    [...new Set(variants.map((v) => v.options[name]).filter(Boolean))] as string[];

  /** Whether choosing `value` for `name` (keeping other selections) yields an in-stock variant. */
  const available = (name: string, value: string) =>
    variants.some(
      (v) =>
        v.options[name] === value &&
        v.stock > 0 &&
        optionNames.every((n) => n === name || v.options[n] === selected[n]),
    );

  const maxQty = Math.min(MAX_PER_LINE, variant?.stock ?? 0);
  const soldOut = !variant || variant.stock <= 0;

  return (
    <div className="space-y-6">
      {variant && (
        <Price paise={variant.pricePaise} compareAtPaise={variant.compareAtPricePaise} size="lg" />
      )}
      <p className="text-muted-foreground -mt-4 text-xs">Inclusive of all taxes</p>

      {optionNames.map((name) => (
        <fieldset key={name}>
          <legend className="mb-2.5 text-sm">
            <span className="font-medium">{name}:</span>{" "}
            <span className="text-muted-foreground">{selected[name]}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {valuesFor(name).map((value) => {
              const isSelected = selected[name] === value;
              const ok = available(name, value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelected((s) => ({ ...s, [name]: value }));
                    setQty(1);
                  }}
                  className={cn(
                    "relative rounded-full border px-4 py-2 text-sm transition",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card hover:border-foreground/40",
                    !ok && !isSelected && "text-muted-foreground line-through decoration-1",
                  )}
                >
                  {value}
                  {!ok && <span className="sr-only"> (out of stock)</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="text-sm" aria-live="polite">
        {!variant ? (
          <p className="text-muted-foreground">This combination is not available.</p>
        ) : soldOut ? (
          <p className="text-destructive font-medium">Sold out</p>
        ) : variant.stock <= 5 ? (
          <p className="text-brand font-medium">Only {variant.stock} left in stock</p>
        ) : (
          <p className="text-success flex items-center gap-1.5">
            <Check className="size-4" /> In stock, ready to ship
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper
          value={qty}
          onChange={setQty}
          max={Math.max(1, maxQty)}
          disabled={soldOut}
        />
        <AddToCartButton
          variantId={variant && !soldOut ? variant.id : null}
          quantity={qty}
          disabled={soldOut}
          className="min-w-48 flex-1 sm:flex-none"
          label={soldOut ? "Sold out" : "Add to cart"}
        />
        {/* Buy now checks out only this item; the cart is left untouched. */}
        <Button
          type="button"
          size="lg"
          variant="brand"
          disabled={soldOut || !variant}
          className="min-w-36 flex-1 sm:flex-none"
          onClick={() =>
            variant && router.push(`/checkout?buy=${encodeURIComponent(variant.id)}&qty=${qty}`)
          }
        >
          <Zap /> Buy now
        </Button>
        <WishlistButton productId={product.id} productName={product.name} variant="full" />
      </div>
      {variant && <p className="text-muted-foreground text-xs">SKU: {variant.sku}</p>}
    </div>
  );
}
