"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";
import { INDIAN_STATES } from "@/lib/india";

export type PickupLocationValues = {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  line1: string;
  line2: string;
  city: string;
  stateCode: string;
  pincode: string;
};

const FIELDS: {
  key: Exclude<keyof PickupLocationValues, "stateCode">;
  label: string;
  hint?: string;
}[] = [
  {
    key: "name",
    label: "Pickup location name",
    hint: "Must match the pickup location nickname in Shiprocket exactly.",
  },
  { key: "contactName", label: "Contact person" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "line1", label: "Address line 1" },
  { key: "line2", label: "Address line 2 (optional)" },
  { key: "city", label: "City" },
  { key: "pincode", label: "PIN code" },
];

/** The warehouse the courier collects from. Saving also sets the store PIN used for delivery checks. */
export function PickupLocationForm({ initial }: { initial: PickupLocationValues | null }) {
  const router = useRouter();
  const [v, setV] = useState<PickupLocationValues>(
    initial ?? {
      name: "",
      contactName: "",
      phone: "",
      email: "",
      line1: "",
      line2: "",
      city: "",
      stateCode: "",
      pincode: "",
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      await apiFetch("/api/admin/pickup-location", { method: "PUT", body: v });
      toast.success("Pickup location saved");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) setErrors(err.fields);
      toast.error(err instanceof ApiClientError ? err.message : "Could not save");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate data-testid="pickup-location-form">
      <Card>
        <CardHeader>
          <CardTitle>Pickup location</CardTitle>
          <CardDescription>
            Where the courier collects parcels and where returns are sent. Needed before booking
            shipments.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid gap-2">
              <Label htmlFor={`pl-${f.key}`}>{f.label}</Label>
              <Input
                id={`pl-${f.key}`}
                value={v[f.key]}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
                aria-invalid={!!errors[f.key]}
              />
              {f.hint && <p className="text-muted-foreground text-xs">{f.hint}</p>}
              <FieldError message={errors[f.key]} />
            </div>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="pl-state">State</Label>
            <Select value={v.stateCode} onValueChange={(s) => setV({ ...v, stateCode: s })}>
              <SelectTrigger id="pl-state" aria-invalid={!!errors.stateCode}>
                <SelectValue placeholder="Choose state" />
              </SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={errors.stateCode} />
          </div>
          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Save pickup location
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
