"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CreditCard, Loader2, Lock, MapPinOff, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { AddressFields, emptyAddress, type AddressValues } from "@/components/store/address-form";
import { OrderSummaryRows } from "@/components/store/order-summary";
import { usePayment, type PaymentSession } from "@/components/store/use-payment";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { stateName } from "@/lib/india";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CartView } from "@/server/modules/cart/cart";

type SavedAddress = AddressValues & { id: string; isDefault: boolean };

type DeliveryState =
  | { status: "idle" | "checking" | "unverified" | "skipped" | "not_serviceable" }
  | { status: "serviceable"; codAvailable: boolean | null; etaDays: number | null };

type CheckoutResult = {
  orderNumber: string;
  accessToken: string;
  paymentMethod: "COD" | "RAZORPAY";
  payment: PaymentSession | null;
};

export function CheckoutForm({
  initialView,
  user,
  savedAddresses,
  codEnabled,
  onlineEnabled,
  codFeePaise,
  buyNow = null,
}: {
  /** Set for a "Buy now" checkout of a single item (the cart is not used). */
  buyNow?: { variantId: string; quantity: number } | null;
  initialView: CartView;
  user: { name: string; email: string; phone: string | null } | null;
  savedAddresses: SavedAddress[];
  codEnabled: boolean;
  onlineEnabled: boolean;
  codFeePaise: number;
}) {
  const router = useRouter();
  const { pay, dialog } = usePayment();
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const defaultSaved = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0];

  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [selectedSaved, setSelectedSaved] = useState<string>(defaultSaved?.id ?? "new");
  const [shipping, setShipping] = useState<AddressValues>(
    defaultSaved
      ? { ...defaultSaved }
      : { ...emptyAddress, fullName: user?.name ?? "", phone: user?.phone ?? "" },
  );
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState<AddressValues>(emptyAddress);
  const [chosenMethod, setMethod] = useState<"COD" | "RAZORPAY">(
    onlineEnabled ? "RAZORPAY" : "COD",
  );
  const [note, setNote] = useState("");
  const [saveAddress, setSaveAddress] = useState(Boolean(user) && savedAddresses.length === 0);
  const [view, setView] = useState<CartView>(initialView);
  // "Buy now" coupons live on this page (cart coupons are applied on the cart page).
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stateCode = shipping.stateCode;
  // Courier coverage for the shipping PIN (server-checked again when the order is placed).
  // Only responses are stored; "idle" and "checking" are derived from the current PIN.
  const [checked, setChecked] = useState<{ key: string; result: DeliveryState } | null>(null);
  const pincode = shipping.pincode;
  const validPin = /^[1-9]\d{5}$/.test(pincode);
  const deliveryKey = `${pincode}|${buyNow?.variantId ?? ""}|${buyNow?.quantity ?? ""}`;
  useEffect(() => {
    if (!validPin) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({
        pincode,
        ...(buyNow ? { buy: buyNow.variantId, qty: String(buyNow.quantity) } : {}),
      });
      fetch(`/api/shipping/serviceability?${qs}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { data?: DeliveryState } | null) =>
          setChecked({ key: deliveryKey, result: j?.data ?? { status: "unverified" } }),
        )
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name !== "AbortError")
            setChecked({ key: deliveryKey, result: { status: "unverified" } });
        });
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [validPin, pincode, buyNow, deliveryKey]);
  const delivery: DeliveryState = !validPin
    ? { status: "idle" }
    : checked?.key === deliveryKey
      ? checked.result
      : { status: "checking" };
  const undeliverable = delivery.status === "not_serviceable";
  const codAllowed =
    codEnabled &&
    view.codAvailable &&
    !(delivery.status === "serviceable" && delivery.codAvailable === false);
  // If COD becomes ineligible (e.g. order value), fall back to online payment.
  const method: "COD" | "RAZORPAY" =
    chosenMethod === "COD" && !codAllowed && onlineEnabled ? "RAZORPAY" : chosenMethod;
  // Re-price on the server whenever the shipping state or payment method changes.
  useEffect(() => {
    const ctrl = new AbortController();
    const qs = new URLSearchParams({
      payment: method,
      ...(stateCode ? { state: stateCode } : {}),
      ...(buyNow
        ? {
            buy: buyNow.variantId,
            qty: String(buyNow.quantity),
            ...(couponCode ? { coupon: couponCode } : {}),
          }
        : {}),
    });
    fetch(`/api/cart?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: CartView } | null) => {
        if (!j?.data) return;
        setView(j.data);
        if (couponCode && !j.data.coupon.applied) {
          setCouponError(j.data.coupon.message ?? "This coupon code is not valid");
          setCouponCode(null);
        }
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [stateCode, method, buyNow, couponCode]);

  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    setCouponError(null);
    setCouponCode(code || null);
  };

  const lines = useMemo(() => view.lines.filter((l) => l.purchasable), [view.lines]);

  const goToOrder = (r: CheckoutResult, extra = "") => {
    router.push(`/order/${r.orderNumber}?t=${encodeURIComponent(r.accessToken)}${extra}`);
    router.refresh(); // update the header cart badge
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const strip = (a: AddressValues) => ({
        fullName: a.fullName,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2,
        landmark: a.landmark,
        city: a.city,
        stateCode: a.stateCode,
        pincode: a.pincode,
      });
      const result = await apiFetch<CheckoutResult>("/api/checkout", {
        body: {
          idempotencyKey: idempotencyKey.current,
          email,
          phone,
          shippingAddress: strip(shipping),
          billingSameAsShipping: billingSame,
          billingAddress: billingSame ? null : strip(billing),
          paymentMethod: method,
          customerNote: note,
          saveAddress: selectedSaved === "new" && saveAddress,
          ...(buyNow ? { buyNow, couponCode } : {}),
        },
      });
      if (result.paymentMethod === "COD") return goToOrder(result, "&placed=1");
      if (!result.payment) {
        toast.error("We couldn’t open the payment window. You can retry from your order page.");
        return goToOrder(result);
      }
      const outcome = await pay(result.payment);
      goToOrder(result, outcome === "paid" ? "&placed=1" : `&payment=${outcome}`);
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setFormError(err.message);
        if (err.code === "OUT_OF_STOCK" || err.code === "COUPON_INVALID") router.refresh();
        // A new attempt after a business-rule failure must use a fresh key.
        idempotencyKey.current = crypto.randomUUID();
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-10 lg:grid-cols-[1fr_400px]">
      {dialog}
      <div className="grid gap-8">
        <section className="bg-card rounded-2xl border p-6">
          <h2 className="text-lg font-semibold">Contact</h2>
          {!user && (
            <p className="text-muted-foreground mt-1 text-sm">
              Have an account?{" "}
              <Link href="/login?next=/checkout" className="underline underline-offset-4">
                Sign in
              </Link>{" "}
              for faster checkout.
            </p>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!errors.email}
              />
              <FieldError message={errors.email} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="phone">Mobile number</Label>
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="For delivery updates"
                aria-invalid={!!errors.phone}
              />
              <FieldError message={errors.phone} />
            </div>
          </div>
        </section>

        <section className="bg-card rounded-2xl border p-6">
          <h2 className="text-lg font-semibold">Shipping address</h2>
          {savedAddresses.length > 0 && (
            <RadioGroup
              value={selectedSaved}
              onValueChange={(id) => {
                setSelectedSaved(id);
                const a = savedAddresses.find((s) => s.id === id);
                setShipping(a ? { ...a } : { ...emptyAddress, fullName: user?.name ?? "" });
              }}
              className="mt-5 grid gap-3 md:grid-cols-2"
            >
              {savedAddresses.map((a) => (
                <Label
                  key={a.id}
                  htmlFor={`addr-${a.id}`}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal",
                    selectedSaved === a.id && "border-primary ring-primary ring-1",
                  )}
                >
                  <RadioGroupItem id={`addr-${a.id}`} value={a.id} className="mt-0.5" />
                  <span className="text-sm leading-6">
                    <span className="font-medium">{a.fullName}</span>
                    <br />
                    <span className="text-muted-foreground">
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ""}, {a.city}, {stateName(a.stateCode)}{" "}
                      {a.pincode}
                    </span>
                  </span>
                </Label>
              ))}
              <Label
                htmlFor="addr-new"
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-4 font-normal",
                  selectedSaved === "new" && "border-primary ring-primary ring-1",
                )}
              >
                <RadioGroupItem id="addr-new" value="new" />{" "}
                <span className="text-sm font-medium">Use a new address</span>
              </Label>
            </RadioGroup>
          )}
          {(selectedSaved === "new" || savedAddresses.length === 0) && (
            <div className="mt-5 grid gap-4">
              <AddressFields
                value={shipping}
                onChange={setShipping}
                errors={errors}
                errorPrefix="shippingAddress."
                prefix="ship"
              />
              {user && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="saveAddress"
                    checked={saveAddress}
                    onCheckedChange={(v) => setSaveAddress(v === true)}
                  />
                  <Label htmlFor="saveAddress" className="font-normal">
                    Save this address to my account
                  </Label>
                </div>
              )}
            </div>
          )}
          <div className="mt-6 flex items-center gap-2">
            <Checkbox
              id="billingSame"
              checked={billingSame}
              onCheckedChange={(v) => setBillingSame(v === true)}
            />
            <Label htmlFor="billingSame" className="font-normal">
              Billing address is the same as shipping
            </Label>
          </div>
          <DeliveryNote delivery={delivery} pincode={pincode} />
          {!billingSame && (
            <div className="mt-5">
              <h3 className="mb-4 text-sm font-semibold">Billing address</h3>
              <AddressFields
                value={billing}
                onChange={setBilling}
                errors={errors}
                errorPrefix="billingAddress."
                prefix="bill"
              />
            </div>
          )}
        </section>

        <section className="bg-card rounded-2xl border p-6">
          <h2 className="text-lg font-semibold">Payment</h2>
          <RadioGroup
            value={method}
            onValueChange={(v) => setMethod(v as "COD" | "RAZORPAY")}
            className="mt-5 grid gap-3"
          >
            <Label
              htmlFor="pm-online"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal",
                method === "RAZORPAY" && "border-primary ring-primary ring-1",
                !onlineEnabled && "cursor-not-allowed opacity-50",
              )}
            >
              <RadioGroupItem
                id="pm-online"
                value="RAZORPAY"
                disabled={!onlineEnabled}
                className="mt-0.5"
              />
              <span className="flex-1 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <CreditCard className="size-4" /> Pay online
                </span>
                <span className="text-muted-foreground">
                  UPI, cards, netbanking & wallets via Razorpay{!onlineEnabled && " (unavailable)"}
                </span>
              </span>
            </Label>
            <Label
              htmlFor="pm-cod"
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-4 font-normal",
                method === "COD" && "border-primary ring-primary ring-1",
                !codAllowed && "cursor-not-allowed opacity-50",
              )}
            >
              <RadioGroupItem id="pm-cod" value="COD" disabled={!codAllowed} className="mt-0.5" />
              <span className="flex-1 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <Banknote className="size-4" /> Cash on Delivery
                </span>
                <span className="text-muted-foreground">
                  {codAllowed
                    ? `Pay when your order arrives${codFeePaise > 0 ? ` · ${formatINR(codFeePaise)} handling fee` : ""}`
                    : delivery.status === "serviceable" && delivery.codAvailable === false
                      ? "Not available for this PIN code"
                      : "Not available for this order"}
                </span>
              </span>
            </Label>
          </RadioGroup>
          <FieldError message={errors.paymentMethod} />
          <div className="mt-6 grid gap-2">
            <Label htmlFor="note">Order note (optional)</Label>
            <Textarea
              id="note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Delivery instructions, gift message…"
            />
          </div>
        </section>
      </div>

      <aside className="bg-card h-fit rounded-2xl border p-6 lg:sticky lg:top-24">
        <h2 className="text-lg font-semibold">Order summary</h2>
        <ul className="mt-5 grid gap-4">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-3">
              <div className="bg-muted relative h-16 w-13 shrink-0 overflow-hidden rounded-lg">
                {l.imageUrl && (
                  <Image src={l.imageUrl} alt="" fill sizes="52px" className="object-cover" />
                )}
                <span className="bg-primary text-primary-foreground absolute -top-0 -right-0 flex size-5 items-center justify-center rounded-bl-lg text-[10px]">
                  {l.quantity}
                </span>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium">{l.productName}</p>
                <p className="text-muted-foreground">{l.variantName}</p>
              </div>
              <p className="text-sm tabular-nums">{formatINR(l.lineTotalPaise)}</p>
            </li>
          ))}
        </ul>
        {buyNow && (
          <div className="mt-6 grid gap-2 border-t pt-5">
            <Label htmlFor="buy-now-coupon">Coupon code</Label>
            <div className="flex gap-2">
              <Input
                id="buy-now-coupon"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyCoupon();
                  }
                }}
                placeholder="e.g. WELCOME10"
                className="uppercase"
                maxLength={40}
                aria-invalid={!!couponError}
                aria-describedby={couponError ? "buy-now-coupon-error" : undefined}
              />
              {couponCode && view.coupon.applied ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCouponCode(null);
                    setCouponInput("");
                  }}
                >
                  Remove
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={applyCoupon}>
                  Apply
                </Button>
              )}
            </div>
            {couponError && (
              <p id="buy-now-coupon-error" className="text-destructive text-sm">
                {couponError}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Buying just this item — your cart is unchanged.
            </p>
          </div>
        )}
        <div className="mt-6 border-t pt-5">
          <OrderSummaryRows pricing={view.pricing} showTaxSplit />
        </div>
        {formError && (
          <p
            role="alert"
            className="bg-destructive-soft text-destructive mt-4 rounded-lg px-3 py-2 text-sm"
          >
            {formError}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="mt-6 w-full"
          disabled={submitting || lines.length === 0 || undeliverable}
          data-testid="place-order"
        >
          {submitting && <Loader2 className="animate-spin" />}
          {method === "COD" ? "Place order" : `Pay ${formatINR(view.pricing.totalPaise)}`}
        </Button>
        <p className="text-muted-foreground mt-3 flex items-center justify-center gap-1.5 text-xs">
          <Lock className="size-3.5" /> Payments are processed securely. We never store card
          details.
        </p>
      </aside>
    </form>
  );
}

/** Delivery estimate / coverage message under the shipping address. */
function DeliveryNote({ delivery, pincode }: { delivery: DeliveryState; pincode: string }) {
  if (delivery.status === "idle" || delivery.status === "skipped") return null;
  const base = "mt-5 flex items-start gap-2 rounded-xl px-4 py-3 text-sm";
  if (delivery.status === "checking")
    return (
      <p
        className={cn(base, "bg-muted text-muted-foreground")}
        aria-live="polite"
        data-testid="delivery-note"
      >
        <Loader2 className="mt-0.5 size-4 animate-spin" aria-hidden /> Checking delivery to{" "}
        {pincode}…
      </p>
    );
  if (delivery.status === "not_serviceable")
    return (
      <p
        role="alert"
        className={cn(base, "bg-destructive-soft text-destructive")}
        data-testid="delivery-note"
      >
        <MapPinOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        Sorry, we don’t deliver to {pincode} yet. Please use another address.
      </p>
    );
  if (delivery.status === "unverified")
    return (
      <p
        className={cn(base, "bg-muted text-muted-foreground")}
        aria-live="polite"
        data-testid="delivery-note"
      >
        <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
        We’ll confirm the delivery date after you order.
      </p>
    );
  if (delivery.status !== "serviceable") return null;
  return (
    <p className={cn(base, "bg-success-soft")} aria-live="polite" data-testid="delivery-note">
      <Truck className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        Delivers to {pincode}
        {delivery.etaDays
          ? ` in about ${delivery.etaDays} ${delivery.etaDays === 1 ? "day" : "days"} after dispatch`
          : ""}
        {delivery.codAvailable === false ? " · Cash on Delivery isn’t available here" : ""}.
      </span>
    </p>
  );
}
