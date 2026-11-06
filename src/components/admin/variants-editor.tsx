"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatOptions, parseOptions } from "@/components/admin/product-form";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { formatINR, paiseToRupeesString, rupeesToPaise } from "@/lib/money";

export type AdminVariant = {
  id: string;
  sku: string;
  name: string;
  options: Record<string, string>;
  pricePaise: number;
  compareAtPricePaise: number | null;
  isActive: boolean;
  stock: number;
  lowStockThreshold: number;
  weightGrams: number | null;
  lengthMm: number | null;
  breadthMm: number | null;
  heightMm: number | null;
};

const PACKAGE_FIELDS = [
  ["weightGrams", "Packed weight (g)"],
  ["lengthMm", "Length (mm)"],
  ["breadthMm", "Breadth (mm)"],
  ["heightMm", "Height (mm)"],
] as const;
type PackageKey = (typeof PACKAGE_FIELDS)[number][0];
const optInt = (s: string) => (s.trim() ? Number(s) : null);

type Form = {
  sku: string;
  name: string;
  options: string;
  price: string;
  compareAt: string;
  isActive: boolean;
  lowStockThreshold: string;
  initialStock: string;
} & Record<PackageKey, string>;

export function VariantsEditor({
  productId,
  variants,
}: {
  productId: string;
  variants: AdminVariant[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminVariant | "new" | null>(null);
  const [stockFor, setStockFor] = useState<AdminVariant | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [adj, setAdj] = useState({ delta: "", reason: "RESTOCK", note: "" });

  const open = (v: AdminVariant | "new") => {
    setEditing(v);
    setErrors({});
    setForm(
      v === "new"
        ? {
            sku: "",
            name: "",
            options: "",
            price: "",
            compareAt: "",
            isActive: true,
            lowStockThreshold: "5",
            initialStock: "0",
            weightGrams: "",
            lengthMm: "",
            breadthMm: "",
            heightMm: "",
          }
        : {
            sku: v.sku,
            name: v.name,
            options: formatOptions(v.options),
            price: paiseToRupeesString(v.pricePaise),
            compareAt: v.compareAtPricePaise ? paiseToRupeesString(v.compareAtPricePaise) : "",
            isActive: v.isActive,
            lowStockThreshold: String(v.lowStockThreshold),
            initialStock: "0",
            weightGrams: v.weightGrams?.toString() ?? "",
            lengthMm: v.lengthMm?.toString() ?? "",
            breadthMm: v.breadthMm?.toString() ?? "",
            heightMm: v.heightMm?.toString() ?? "",
          },
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    let pricePaise: number;
    let compareAtPricePaise: number | null = null;
    try {
      pricePaise = rupeesToPaise(form.price);
      if (form.compareAt.trim()) compareAtPricePaise = rupeesToPaise(form.compareAt);
    } catch {
      setErrors({ pricePaise: "Enter a valid amount in rupees" });
      return;
    }
    setPending(true);
    try {
      const isNew = editing === "new";
      await apiFetch(
        isNew
          ? `/api/admin/products/${productId}/variants`
          : `/api/admin/variants/${(editing as AdminVariant).id}`,
        {
          method: isNew ? "POST" : "PUT",
          body: {
            sku: form.sku,
            name: form.name,
            options: parseOptions(form.options),
            pricePaise,
            compareAtPricePaise,
            isActive: form.isActive,
            lowStockThreshold: Number(form.lowStockThreshold || 0),
            weightGrams: optInt(form.weightGrams),
            lengthMm: optInt(form.lengthMm),
            breadthMm: optInt(form.breadthMm),
            heightMm: optInt(form.heightMm),
            ...(isNew ? { initialStock: Number(form.initialStock || 0) } : {}),
          },
        },
      );
      toast.success("Variant saved");
      setEditing(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save variant");
    } finally {
      setPending(false);
    }
  };

  const adjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockFor) return;
    setPending(true);
    try {
      await apiFetch(`/api/admin/variants/${stockFor.id}/stock`, {
        body: { delta: Number(adj.delta), reason: adj.reason, note: adj.note },
      });
      toast.success("Stock updated");
      setStockFor(null);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? (Object.values(err.fields)[0] ?? err.message)
          : "Could not adjust stock",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle>Variants & stock</CardTitle>
          <CardDescription className="mt-1">
            Prices are GST-inclusive if your store is configured that way.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => open("new")}>
          <Plus /> Add variant
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Variant</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="pl-5">
                  <p className="font-medium">{v.name}</p>
                  <p className="text-muted-foreground text-xs">{formatOptions(v.options) || "—"}</p>
                </TableCell>
                <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatINR(v.pricePaise)}
                  {v.compareAtPricePaise && (
                    <span className="text-muted-foreground ml-1 text-xs line-through">
                      {formatINR(v.compareAtPricePaise)}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${v.stock === 0 ? "text-destructive" : v.stock <= v.lowStockThreshold ? "text-brand" : ""}`}
                >
                  {v.stock}
                </TableCell>
                <TableCell>
                  <StatusBadge status={v.isActive ? "ACTIVE" : "DRAFT"} />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setStockFor(v);
                        setAdj({ delta: "", reason: "RESTOCK", note: "" });
                      }}
                      aria-label={`Adjust stock for ${v.sku}`}
                    >
                      <Boxes />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => open(v)}
                      aria-label={`Edit ${v.sku}`}
                    >
                      <Pencil />
                    </Button>
                    <ConfirmButton
                      title={`Remove variant ${v.sku}?`}
                      description="Variants with past orders are deactivated instead of deleted."
                      confirmLabel="Remove"
                      onConfirm={async () => {
                        try {
                          const r = await apiFetch<{ action: string }>(
                            `/api/admin/variants/${v.id}`,
                            { method: "DELETE" },
                          );
                          toast.success(`Variant ${r.action}`);
                          router.refresh();
                        } catch (err) {
                          toast.error(
                            err instanceof ApiClientError
                              ? err.message
                              : "Could not remove variant",
                          );
                        }
                      }}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${v.sku}`}>
                          <Trash2 />
                        </Button>
                      }
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add variant" : "Edit variant"}</DialogTitle>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="grid gap-4" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ve-sku">SKU</Label>
                  <Input
                    id="ve-sku"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    aria-invalid={!!errors.sku}
                  />
                  <FieldError message={errors.sku} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ve-name">Name</Label>
                  <Input
                    id="ve-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    aria-invalid={!!errors.name}
                  />
                  <FieldError message={errors.name} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ve-options">Options</Label>
                <Input
                  id="ve-options"
                  value={form.options}
                  placeholder="Colour: Blue, Size: Large"
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="ve-price">Price (₹)</Label>
                  <Input
                    id="ve-price"
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    aria-invalid={!!errors.pricePaise}
                  />
                  <FieldError message={errors.pricePaise} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ve-compare">MRP / compare-at (₹)</Label>
                  <Input
                    id="ve-compare"
                    inputMode="decimal"
                    value={form.compareAt}
                    onChange={(e) => setForm({ ...form, compareAt: e.target.value })}
                    aria-invalid={!!errors.compareAtPricePaise}
                  />
                  <FieldError message={errors.compareAtPricePaise} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {editing === "new" && (
                  <div className="grid gap-2">
                    <Label htmlFor="ve-stock">Initial stock</Label>
                    <Input
                      id="ve-stock"
                      type="number"
                      min={0}
                      value={form.initialStock}
                      onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="ve-low">Low-stock alert at</Label>
                  <Input
                    id="ve-low"
                    type="number"
                    min={0}
                    value={form.lowStockThreshold}
                    onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2 self-end pb-2">
                  <Switch
                    id="ve-active"
                    checked={form.isActive}
                    onCheckedChange={(val) => setForm({ ...form, isActive: val })}
                  />
                  <Label htmlFor="ve-active">Active</Label>
                </div>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Shipping package</legend>
                <p className="text-muted-foreground text-xs">
                  Packed weight and box size for courier rates. Leave empty to use the store’s
                  default package (Settings).
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {PACKAGE_FIELDS.map(([key, label]) => (
                    <div key={key} className="grid gap-1.5">
                      <Label htmlFor={`ve-${key}`} className="text-xs">
                        {label}
                      </Label>
                      <Input
                        id={`ve-${key}`}
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        aria-invalid={!!errors[key]}
                      />
                      <FieldError message={errors[key]} />
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save variant"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={stockFor !== null} onOpenChange={(o) => !o && setStockFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock · {stockFor?.sku}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Current on hand: <span className="text-foreground font-medium">{stockFor?.stock}</span>.
            Use a negative number to remove stock.
          </p>
          <form onSubmit={adjust} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="adj-delta">Change (+/−)</Label>
                <Input
                  id="adj-delta"
                  type="number"
                  value={adj.delta}
                  onChange={(e) => setAdj({ ...adj, delta: e.target.value })}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="adj-reason">Reason</Label>
                <Select value={adj.reason} onValueChange={(val) => setAdj({ ...adj, reason: val })}>
                  <SelectTrigger id="adj-reason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RESTOCK">Restock</SelectItem>
                    <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                    <SelectItem value="DAMAGE">Damaged / lost</SelectItem>
                    <SelectItem value="RETURN">Customer return</SelectItem>
                    <SelectItem value="CORRECTION">Stock-take correction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adj-note">Note</Label>
              <Input
                id="adj-note"
                value={adj.note}
                onChange={(e) => setAdj({ ...adj, note: e.target.value })}
                placeholder="PO number, reason…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setStockFor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !adj.delta}>
                Apply
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
