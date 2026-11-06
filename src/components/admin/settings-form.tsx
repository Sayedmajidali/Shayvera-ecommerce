"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2 } from "lucide-react";
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
import { INDIAN_STATES } from "@/lib/india";
import { paiseToRupeesString, rupeesToPaise } from "@/lib/money";

export type SettingsValues = {
  storeName: string;
  legalName: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateCode: string;
  pincode: string;
  gstEnabled: boolean;
  gstin: string;
  fssaiLicense: string;
  pricesIncludeTax: boolean;
  defaultTaxRateBps: number;
  shippingFlatPaise: number;
  freeShippingThresholdPaise: number | null;
  codEnabled: boolean;
  codFeePaise: number;
  codMinOrderPaise: number;
  codMaxOrderPaise: number | null;
  codBlockedPincodes: string[];
  minOrderPaise: number;
  orderPrefix: string;
  invoicePrefix: string;
  lowStockThreshold: number;
  defaultPackageWeightGrams: number;
  defaultPackageLengthMm: number;
  defaultPackageBreadthMm: number;
  defaultPackageHeightMm: number;
  returnWindowDays: number;
};

const r = (p: number | null) => (p === null ? "" : paiseToRupeesString(p));

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [money, setMoney] = useState({
    shipping: r(initial.shippingFlatPaise),
    freeThreshold: r(initial.freeShippingThresholdPaise),
    codFee: r(initial.codFeePaise),
    codMin: r(initial.codMinOrderPaise),
    codMax: r(initial.codMaxOrderPaise),
    minOrder: r(initial.minOrderPaise),
  });
  const [pins, setPins] = useState(initial.codBlockedPincodes.join(", "));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof SettingsValues>(k: K, val: SettingsValues[K]) =>
    setV((s) => ({ ...s, [k]: val }));
  const field = (
    id: keyof SettingsValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={`s-${id}`}>{label}</Label>
      <Input
        id={`s-${id}`}
        value={String(v[id] ?? "")}
        onChange={(e) => set(id, e.target.value as never)}
        aria-invalid={!!errors[id]}
        {...props}
      />
      <FieldError message={errors[id]} />
    </div>
  );
  const moneyField = (
    k: keyof typeof money,
    label: string,
    errKey: string,
    placeholder?: string,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={`m-${k}`}>{label}</Label>
      <Input
        id={`m-${k}`}
        inputMode="decimal"
        value={money[k]}
        placeholder={placeholder}
        onChange={(e) => setMoney({ ...money, [k]: e.target.value })}
        aria-invalid={!!errors[errKey]}
      />
      <FieldError message={errors[errKey]} />
    </div>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    let body: Record<string, unknown>;
    try {
      const opt = (s: string) => (s.trim() ? rupeesToPaise(s) : null);
      body = {
        ...v,
        shippingFlatPaise: rupeesToPaise(money.shipping || "0"),
        freeShippingThresholdPaise: opt(money.freeThreshold),
        codFeePaise: rupeesToPaise(money.codFee || "0"),
        codMinOrderPaise: rupeesToPaise(money.codMin || "0"),
        codMaxOrderPaise: opt(money.codMax),
        minOrderPaise: rupeesToPaise(money.minOrder || "0"),
        codBlockedPincodes: pins
          .split(/[\s,]+/)
          .map((p) => p.trim())
          .filter(Boolean),
      };
    } catch {
      toast.error("Enter amounts in rupees, e.g. 99 or 99.50");
      return;
    }
    setPending(true);
    try {
      await apiFetch("/api/admin/settings", { method: "PUT", body });
      toast.success("Settings saved");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save settings");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Store details</CardTitle>
          <CardDescription>Shown in the footer, contact page, emails and invoices.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center gap-4">
            <div className="bg-muted relative flex size-16 items-center justify-center overflow-hidden rounded-xl border">
              {v.logoUrl ? (
                <Image
                  src={v.logoUrl}
                  alt="Store logo"
                  fill
                  sizes="64px"
                  className="object-contain"
                />
              ) : (
                <span className="text-muted-foreground text-xs">Logo</span>
              )}
            </div>
            <label className="hover:bg-accent inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}{" "}
              Upload logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  const fd = new FormData();
                  fd.set("file", file);
                  fd.set("folder", "branding");
                  const res = await fetch("/api/admin/branding", { method: "POST", body: fd });
                  const json = await res.json().catch(() => null);
                  setUploading(false);
                  if (!res.ok) return toast.error(json?.error?.message ?? "Upload failed");
                  set("logoUrl", json.data.url);
                  toast.success("Logo uploaded — save settings to apply");
                }}
              />
            </label>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {field("storeName", "Store name")}
            {field("legalName", "Legal / business name")}
            {field("supportEmail", "Support email", { type: "email" })}
            {field("supportPhone", "Support phone")}
            {field("addressLine1", "Address line 1")}
            {field("addressLine2", "Address line 2")}
            {field("city", "City")}
            <div className="grid gap-2">
              <Label htmlFor="s-state">State (place of business)</Label>
              <Select value={v.stateCode} onValueChange={(val) => set("stateCode", val)}>
                <SelectTrigger id="s-state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {INDIAN_STATES.map((s) => (
                    <SelectItem key={s.code} value={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {field("pincode", "PIN code", { inputMode: "numeric", maxLength: 6 })}
            {field("fssaiLicense", "FSSAI licence / registration no.", {
              inputMode: "numeric",
              maxLength: 14,
              className: "font-mono",
            })}
            <div className="grid gap-2">
              <Label>Currency</Label>
              <Input value="INR (₹)" disabled />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipping</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          {moneyField("shipping", "Flat shipping fee (₹)", "shippingFlatPaise")}
          {moneyField(
            "freeThreshold",
            "Free shipping above (₹)",
            "freeShippingThresholdPaise",
            "Never free",
          )}
          {moneyField("minOrder", "Minimum order value (₹)", "minOrderPaise")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GST</CardTitle>
          <CardDescription>
            Do not enable unless the business is GST-registered. Review these settings with your
            accountant before launch.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center gap-3">
            <Switch
              id="s-gst"
              checked={v.gstEnabled}
              onCheckedChange={(val) => set("gstEnabled", val)}
            />
            <Label htmlFor="s-gst">Charge GST and issue tax invoices</Label>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {field("gstin", "GSTIN", { maxLength: 15, className: "uppercase font-mono" })}
            <div className="grid gap-2">
              <Label htmlFor="s-rate">Default GST rate</Label>
              <Select
                value={String(v.defaultTaxRateBps)}
                onValueChange={(val) => set("defaultTaxRateBps", Number(val))}
              >
                <SelectTrigger id="s-rate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 500, 1200, 1800, 2800].map((x) => (
                    <SelectItem key={x} value={String(x)}>
                      {x / 100}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 self-end pb-2">
              <Switch
                id="s-incl"
                checked={v.pricesIncludeTax}
                onCheckedChange={(val) => set("pricesIncludeTax", val)}
              />
              <Label htmlFor="s-incl">Prices include GST</Label>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Intra-state orders (shipping state = store state) are split into CGST + SGST;
            inter-state orders use IGST.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cash on Delivery</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center gap-3">
            <Switch
              id="s-cod"
              checked={v.codEnabled}
              onCheckedChange={(val) => set("codEnabled", val)}
            />
            <Label htmlFor="s-cod">Offer Cash on Delivery</Label>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {moneyField("codFee", "COD handling fee (₹)", "codFeePaise")}
            {moneyField("codMin", "Minimum order for COD (₹)", "codMinOrderPaise")}
            {moneyField("codMax", "Maximum order for COD (₹)", "codMaxOrderPaise", "No limit")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="s-pins">PIN codes without COD</Label>
            <Textarea
              id="s-pins"
              rows={2}
              value={pins}
              onChange={(e) => setPins(e.target.value)}
              placeholder="Comma or space separated, e.g. 110001, 400001"
              aria-invalid={Object.keys(errors).some((k) => k.startsWith("codBlockedPincodes"))}
            />
            <FieldError
              message={
                Object.entries(errors).find(([k]) => k.startsWith("codBlockedPincodes"))?.[1]
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default package</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5">
          <p className="text-muted-foreground text-sm">
            Used for courier rates and shipments when a product variant has no packed weight or box
            size of its own.
          </p>
          <div className="grid gap-5 sm:grid-cols-4">
            {field("defaultPackageWeightGrams", "Packed weight (g)", { type: "number", min: 1 })}
            {field("defaultPackageLengthMm", "Length (mm)", { type: "number", min: 1 })}
            {field("defaultPackageBreadthMm", "Breadth (mm)", { type: "number", min: 1 })}
            {field("defaultPackageHeightMm", "Height (mm)", { type: "number", min: 1 })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Numbering & alerts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          {field("orderPrefix", "Order number prefix", { maxLength: 6, className: "uppercase" })}
          {field("invoicePrefix", "Invoice prefix", { maxLength: 6, className: "uppercase" })}
          {field("lowStockThreshold", "Default low-stock alert", { type: "number", min: 0 })}
          {field("returnWindowDays", "Return window after delivery (days)", {
            type: "number",
            min: 0,
            max: 60,
          })}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save settings
        </Button>
      </div>
    </form>
  );
}
