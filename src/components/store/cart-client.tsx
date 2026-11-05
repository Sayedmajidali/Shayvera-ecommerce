"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Tag, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QuantityStepper } from "@/components/store/quantity-stepper";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { formatINR } from "@/lib/money";
import type { CartIssue, CartLineView } from "@/server/services/cart";

export function CartLines({ lines, issues }: { lines: CartLineView[]; issues: CartIssue[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const issueFor = (id: string) => issues.find((i) => i.itemId === id);

  const update = async (id: string, quantity: number) => {
    setBusy(id);
    try {
      await apiFetch(`/api/cart/items/${id}`, {
        method: quantity === 0 ? "DELETE" : "PATCH",
        body: quantity === 0 ? undefined : { quantity },
      });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not update cart");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="bg-card divide-y rounded-2xl border">
      {lines.map((l) => {
        const issue = issueFor(l.id);
        return (
          <li key={l.id} className="flex gap-4 p-4 sm:p-5" data-testid="cart-line">
            <Link
              href={`/product/${l.productSlug}`}
              className="bg-muted relative h-28 w-22 shrink-0 overflow-hidden rounded-lg sm:h-32 sm:w-26"
            >
              {l.imageUrl && (
                <Image
                  src={l.imageUrl}
                  alt={l.productName}
                  fill
                  sizes="104px"
                  className="object-cover"
                />
              )}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/product/${l.productSlug}`} className="font-medium hover:underline">
                    {l.productName}
                  </Link>
                  <p className="text-muted-foreground text-sm">{l.variantName}</p>
                  <p className="mt-1 text-sm tabular-nums">
                    {formatINR(l.unitPricePaise)}
                    {l.compareAtPaise && l.compareAtPaise > l.unitPricePaise && (
                      <span className="text-muted-foreground ml-2 text-xs line-through">
                        {formatINR(l.compareAtPaise)}
                      </span>
                    )}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{formatINR(l.lineTotalPaise)}</p>
              </div>
              {issue && (
                <p
                  className="text-destructive mt-2 flex items-center gap-1.5 text-xs font-medium"
                  role="alert"
                >
                  <AlertTriangle className="size-3.5" /> {issue.message}
                </p>
              )}
              <div className="mt-auto flex items-center justify-between pt-3">
                {l.purchasable ? (
                  <QuantityStepper
                    size="sm"
                    value={l.quantity}
                    max={Math.min(10, Math.max(l.available, l.quantity))}
                    disabled={busy === l.id}
                    onChange={(q) => update(l.id, q)}
                    label={`Quantity for ${l.productName}`}
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">Unavailable</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update(l.id, 0)}
                  disabled={busy === l.id}
                  aria-label={`Remove ${l.productName}`}
                >
                  {busy === l.id ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CouponForm({
  code,
  applied,
  message,
}: {
  code: string | null;
  applied: boolean;
  message: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (code && applied) {
    return (
      <div className="border-success/50 bg-success-soft flex items-center justify-between rounded-xl border border-dashed px-3 py-2.5 text-sm">
        <span className="text-success flex items-center gap-2 font-medium">
          <Tag className="size-4" /> {code} applied
        </span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Remove coupon"
          onClick={async () => {
            await apiFetch("/api/cart/coupon", { method: "DELETE" });
            router.refresh();
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          await apiFetch("/api/cart/coupon", { body: { code: value } });
          toast.success("Coupon applied");
          setValue("");
          router.refresh();
        } catch (err) {
          setError(
            err instanceof ApiClientError
              ? (err.fields.code ?? err.message)
              : "Could not apply coupon",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor="coupon" className="text-sm font-medium">
        Coupon code
      </label>
      <div className="flex gap-2">
        <Input
          id="coupon"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="e.g. WELCOME10"
          className="uppercase"
          aria-invalid={!!error}
        />
        <Button type="submit" variant="outline" disabled={pending || value.trim().length < 3}>
          {pending ? <Loader2 className="animate-spin" /> : "Apply"}
        </Button>
      </div>
      {(error ?? (code && !applied ? message : null)) && (
        <p role="alert" className="text-destructive text-xs">
          {error ?? message}
        </p>
      )}
    </form>
  );
}
