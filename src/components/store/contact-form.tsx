"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function ContactForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="bg-card flex flex-col items-center rounded-2xl border p-10 text-center">
        <CheckCircle2 className="text-success size-10" />
        <h2 className="mt-4 text-xl font-semibold">Message received</h2>
        <p className="text-muted-foreground mt-2">
          Thanks for writing in. We reply within one business day.
        </p>
      </div>
    );
  }

  return (
    <form
      className="bg-card grid gap-5 rounded-2xl border p-6 sm:p-8"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setPending(true);
        setErrors({});
        setFormError(null);
        try {
          await apiFetch("/api/contact", { body: Object.fromEntries(fd.entries()) });
          setSent(true);
        } catch (err) {
          if (err instanceof ApiClientError) {
            setErrors(err.fields);
            if (!Object.keys(err.fields).length) setFormError(err.message);
          } else setFormError("Could not send your message. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required aria-invalid={!!errors.name} />
          <FieldError message={errors.name} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={!!errors.email}
          />
          <FieldError message={errors.email} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" required aria-invalid={!!errors.subject} />
        <FieldError message={errors.subject} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" name="message" rows={6} required aria-invalid={!!errors.message} />
        <FieldError message={errors.message} />
      </div>
      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending} className="justify-self-start">
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
