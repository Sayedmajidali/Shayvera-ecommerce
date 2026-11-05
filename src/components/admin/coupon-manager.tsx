"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, TicketPercent, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { EmptyState } from "@/components/shared/empty-state";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { formatINR, paiseToRupeesString, percentFromBps, rupeesToPaise } from "@/lib/money";

export type AdminCoupon = {
  id: string;
  code: string;
  description: string | null;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
};

type Form = {
  code: string;
  description: string;
  type: "PERCENTAGE" | "FIXED";
  value: string;
  minOrder: string;
  maxDiscount: string;
  usageLimit: string;
  perUser: string;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
};

const toLocal = (iso: string | null) =>
  iso
    ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : "";
const optRupees = (s: string) => (s.trim() ? rupeesToPaise(s) : null);
const optInt = (s: string) => (s.trim() ? Number(s) : null);

function couponState(c: AdminCoupon): {
  label: string;
  variant: "success" | "secondary" | "destructive" | "warning";
} {
  const now = Date.now();
  if (!c.isActive) return { label: "Inactive", variant: "secondary" };
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= now)
    return { label: "Expired", variant: "destructive" };
  if (c.startsAt && new Date(c.startsAt).getTime() > now)
    return { label: "Scheduled", variant: "warning" };
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit)
    return { label: "Used up", variant: "warning" };
  return { label: "Active", variant: "success" };
}

export function CouponManager({ coupons }: { coupons: AdminCoupon[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminCoupon | "new" | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const open = (c: AdminCoupon | "new") => {
    setEditing(c);
    setErrors({});
    setF(
      c === "new"
        ? {
            code: "",
            description: "",
            type: "PERCENTAGE",
            value: "",
            minOrder: "0",
            maxDiscount: "",
            usageLimit: "",
            perUser: "",
            startsAt: "",
            expiresAt: "",
            isActive: true,
          }
        : {
            code: c.code,
            description: c.description ?? "",
            type: c.type,
            value: c.type === "PERCENTAGE" ? String(c.value / 100) : paiseToRupeesString(c.value),
            minOrder: paiseToRupeesString(c.minOrderPaise),
            maxDiscount: c.maxDiscountPaise ? paiseToRupeesString(c.maxDiscountPaise) : "",
            usageLimit: c.usageLimit?.toString() ?? "",
            perUser: c.usageLimitPerUser?.toString() ?? "",
            startsAt: toLocal(c.startsAt),
            expiresAt: toLocal(c.expiresAt),
            isActive: c.isActive,
          },
    );
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f) return;
    let body: Record<string, unknown>;
    try {
      body = {
        code: f.code,
        description: f.description,
        type: f.type,
        value: f.type === "PERCENTAGE" ? Math.round(Number(f.value) * 100) : rupeesToPaise(f.value),
        minOrderPaise: optRupees(f.minOrder) ?? 0,
        maxDiscountPaise: optRupees(f.maxDiscount),
        usageLimit: optInt(f.usageLimit),
        usageLimitPerUser: optInt(f.perUser),
        startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null,
        expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
        isActive: f.isActive,
      };
    } catch {
      setErrors({ value: "Enter valid amounts" });
      return;
    }
    setPending(true);
    try {
      const isNew = editing === "new";
      await apiFetch(
        isNew ? "/api/admin/coupons" : `/api/admin/coupons/${(editing as AdminCoupon).id}`,
        { method: isNew ? "POST" : "PUT", body },
      );
      toast.success("Coupon saved");
      setEditing(null);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save coupon");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => open("new")}>
          <Plus /> New coupon
        </Button>
      </div>
      <Card className="gap-0 py-0">
        {coupons.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={TicketPercent} title="No coupons yet" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Min order</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.map((c) => {
                const st = couponState(c);
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-mono font-medium">{c.code}</p>
                      <p className="text-muted-foreground max-w-56 truncate text-xs">
                        {c.description}
                      </p>
                    </TableCell>
                    <TableCell>
                      {c.type === "PERCENTAGE"
                        ? `${percentFromBps(c.value)}${c.maxDiscountPaise ? ` (max ${formatINR(c.maxDiscountPaise)})` : ""}`
                        : formatINR(c.value)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {c.minOrderPaise ? formatINR(c.minOrderPaise) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {c.usedCount}
                      {c.usageLimit ? ` / ${c.usageLimit}` : ""}
                      {c.usageLimitPerUser ? ` · ${c.usageLimitPerUser}/customer` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.expiresAt
                        ? new Date(c.expiresAt).toLocaleDateString("en-IN")
                        : "No expiry"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => open(c)}
                          aria-label={`Edit ${c.code}`}
                        >
                          <Pencil />
                        </Button>
                        <ConfirmButton
                          title={`Remove ${c.code}?`}
                          description="Coupons that have been used are deactivated instead of deleted."
                          confirmLabel="Remove"
                          onConfirm={async () => {
                            const r = await apiFetch<{ action: string }>(
                              `/api/admin/coupons/${c.id}`,
                              { method: "DELETE" },
                            );
                            toast.success(`Coupon ${r.action}`);
                            router.refresh();
                          }}
                          trigger={
                            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${c.code}`}>
                              <Trash2 />
                            </Button>
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New coupon" : "Edit coupon"}</DialogTitle>
          </DialogHeader>
          {f && (
            <form onSubmit={save} noValidate className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cp-code">Code</Label>
                  <Input
                    id="cp-code"
                    className="font-mono uppercase"
                    value={f.code}
                    onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
                    aria-invalid={!!errors.code}
                  />
                  <FieldError message={errors.code} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cp-type">Type</Label>
                  <Select
                    value={f.type}
                    onValueChange={(v) => setF({ ...f, type: v as Form["type"] })}
                  >
                    <SelectTrigger id="cp-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PERCENTAGE">Percentage off</SelectItem>
                      <SelectItem value="FIXED">Fixed amount off</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cp-desc">Description</Label>
                <Input
                  id="cp-desc"
                  value={f.description}
                  onChange={(e) => setF({ ...f, description: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="cp-value">
                    {f.type === "PERCENTAGE" ? "Percent (%)" : "Amount (₹)"}
                  </Label>
                  <Input
                    id="cp-value"
                    inputMode="decimal"
                    value={f.value}
                    onChange={(e) => setF({ ...f, value: e.target.value })}
                    aria-invalid={!!errors.value}
                  />
                  <FieldError message={errors.value} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cp-min">Min order (₹)</Label>
                  <Input
                    id="cp-min"
                    inputMode="decimal"
                    value={f.minOrder}
                    onChange={(e) => setF({ ...f, minOrder: e.target.value })}
                  />
                </div>
                {f.type === "PERCENTAGE" && (
                  <div className="grid gap-2">
                    <Label htmlFor="cp-max">Max discount (₹)</Label>
                    <Input
                      id="cp-max"
                      inputMode="decimal"
                      value={f.maxDiscount}
                      onChange={(e) => setF({ ...f, maxDiscount: e.target.value })}
                      placeholder="No cap"
                    />
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cp-limit">Total uses</Label>
                  <Input
                    id="cp-limit"
                    type="number"
                    min={1}
                    value={f.usageLimit}
                    onChange={(e) => setF({ ...f, usageLimit: e.target.value })}
                    placeholder="Unlimited"
                    aria-invalid={!!errors.usageLimit}
                  />
                  <FieldError message={errors.usageLimit} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cp-per">Uses per customer</Label>
                  <Input
                    id="cp-per"
                    type="number"
                    min={1}
                    value={f.perUser}
                    onChange={(e) => setF({ ...f, perUser: e.target.value })}
                    placeholder="Unlimited"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cp-start">Starts</Label>
                  <Input
                    id="cp-start"
                    type="datetime-local"
                    value={f.startsAt}
                    onChange={(e) => setF({ ...f, startsAt: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cp-end">Expires</Label>
                  <Input
                    id="cp-end"
                    type="datetime-local"
                    value={f.expiresAt}
                    onChange={(e) => setF({ ...f, expiresAt: e.target.value })}
                    aria-invalid={!!errors.expiresAt}
                  />
                  <FieldError message={errors.expiresAt} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="cp-active"
                  checked={f.isActive}
                  onCheckedChange={(v) => setF({ ...f, isActive: v })}
                />
                <Label htmlFor="cp-active">Active</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save coupon"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
