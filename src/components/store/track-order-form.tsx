"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function TrackOrderForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        setFields({});
        try {
          const { url } = await apiFetch<{ url: string }>("/api/orders/track", {
            body: { orderNumber: fd.get("orderNumber"), contact: fd.get("contact") },
          });
          router.push(url);
        } catch (err) {
          setPending(false);
          if (err instanceof ApiClientError) {
            setFields(err.fields);
            setError(
              err.status === 429 ? "Too many attempts. Please try again later." : err.message,
            );
          } else setError("Something went wrong. Please try again.");
        }
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="orderNumber">Order number</Label>
        <Input
          id="orderNumber"
          name="orderNumber"
          placeholder="e.g. SHV00001234"
          autoComplete="off"
          className="uppercase"
          required
          aria-invalid={!!fields.orderNumber}
        />
        <FieldError message={fields.orderNumber} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="contact">Email or mobile number</Label>
        <Input
          id="contact"
          name="contact"
          autoComplete="email"
          required
          aria-invalid={!!fields.contact}
        />
        <FieldError message={fields.contact} />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Search />} Track order
      </Button>
    </form>
  );
}
