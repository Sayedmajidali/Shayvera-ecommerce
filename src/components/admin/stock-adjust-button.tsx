"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function StockAdjustButton({
  variantId,
  sku,
  onHand,
  reserved = 0,
}: {
  variantId: string;
  sku: string;
  onHand: number;
  reserved?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("RESTOCK");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  // One key per adjustment: a retried request (lost response, double submit) is applied once.
  const [key, setKey] = useState(() => crypto.randomUUID());
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setKey(crypto.randomUUID());
          setOpen(true);
        }}
        aria-label={`Adjust stock for ${sku}`}
      >
        <Boxes /> Adjust
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock · {sku}</DialogTitle>
            <DialogDescription>
              On hand: {onHand}
              {reserved > 0
                ? ` (${reserved} reserved for open orders, so at most ${onHand - reserved} can be removed)`
                : ""}
              . Use a negative number to remove stock. Every change is recorded in the ledger.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              try {
                await apiFetch(`/api/admin/variants/${variantId}/stock`, {
                  body: { delta: Number(delta), reason, note, idempotencyKey: key },
                });
                toast.success("Stock updated");
                setKey(crypto.randomUUID());
                setOpen(false);
                setDelta("");
                setNote("");
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
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`d-${variantId}`}>Change (+/−)</Label>
                <Input
                  id={`d-${variantId}`}
                  type="number"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`r-${variantId}`}>Reason</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger id={`r-${variantId}`}>
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
              <Label htmlFor={`n-${variantId}`}>Note</Label>
              <Input id={`n-${variantId}`} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !delta}>
                Apply
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
