"use client";

import { useState } from "react";
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
import { FieldError } from "@/components/shared/field-error";
import { INDIAN_STATES } from "@/lib/india";

export type AddressValues = {
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  stateCode: string;
  pincode: string;
  label?: string;
  isDefault?: boolean;
};

export const emptyAddress: AddressValues = {
  fullName: "",
  phone: "",
  line1: "",
  line2: "",
  landmark: "",
  city: "",
  stateCode: "",
  pincode: "",
  label: "",
  isDefault: false,
};

/** Controlled address fields; reused by account address book and checkout. */
export function AddressFields({
  value,
  onChange,
  errors = {},
  prefix = "addr",
  showDefault = false,
  errorPrefix = "",
}: {
  value: AddressValues;
  onChange: (v: AddressValues) => void;
  errors?: Record<string, string>;
  prefix?: string;
  showDefault?: boolean;
  errorPrefix?: string;
}) {
  const set = (k: keyof AddressValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const err = (k: string) => errors[`${errorPrefix}${k}`];
  const id = (k: string) => `${prefix}-${k}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor={id("fullName")}>Full name</Label>
        <Input
          id={id("fullName")}
          value={value.fullName}
          onChange={set("fullName")}
          autoComplete="name"
          aria-invalid={!!err("fullName")}
        />
        <FieldError message={err("fullName")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("phone")}>Mobile number</Label>
        <Input
          id={id("phone")}
          value={value.phone}
          onChange={set("phone")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="10-digit mobile"
          aria-invalid={!!err("phone")}
        />
        <FieldError message={err("phone")} />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor={id("line1")}>Flat, house no., building</Label>
        <Input
          id={id("line1")}
          value={value.line1}
          onChange={set("line1")}
          autoComplete="address-line1"
          aria-invalid={!!err("line1")}
        />
        <FieldError message={err("line1")} />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor={id("line2")}>Area, street, sector (optional)</Label>
        <Input
          id={id("line2")}
          value={value.line2}
          onChange={set("line2")}
          autoComplete="address-line2"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("landmark")}>Landmark (optional)</Label>
        <Input id={id("landmark")} value={value.landmark} onChange={set("landmark")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("city")}>City / Town</Label>
        <Input
          id={id("city")}
          value={value.city}
          onChange={set("city")}
          autoComplete="address-level2"
          aria-invalid={!!err("city")}
        />
        <FieldError message={err("city")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("stateCode")}>State</Label>
        <Select value={value.stateCode} onValueChange={(v) => onChange({ ...value, stateCode: v })}>
          <SelectTrigger id={id("stateCode")} aria-invalid={!!err("stateCode")}>
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {INDIAN_STATES.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={err("stateCode")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={id("pincode")}>PIN code</Label>
        <Input
          id={id("pincode")}
          value={value.pincode}
          onChange={set("pincode")}
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          aria-invalid={!!err("pincode")}
        />
        <FieldError message={err("pincode")} />
      </div>
      {showDefault && (
        <>
          <div className="grid gap-2">
            <Label htmlFor={id("label")}>Label (optional)</Label>
            <Input
              id={id("label")}
              value={value.label ?? ""}
              onChange={set("label")}
              placeholder="Home, Office…"
            />
          </div>
          <div className="flex items-center gap-2 self-end pb-2">
            <Checkbox
              id={id("isDefault")}
              checked={!!value.isDefault}
              onCheckedChange={(v) => onChange({ ...value, isDefault: v === true })}
            />
            <Label htmlFor={id("isDefault")} className="font-normal">
              Set as default address
            </Label>
          </div>
        </>
      )}
    </div>
  );
}

export function AddressFormActions({
  pending,
  onCancel,
  submitLabel = "Save address",
}: {
  pending: boolean;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="flex gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

export function useAddressState(initial: AddressValues = emptyAddress) {
  return useState<AddressValues>(initial);
}
