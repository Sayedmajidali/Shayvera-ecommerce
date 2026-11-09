"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { authClient } from "@/lib/auth-client";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function ProfileForm({
  name,
  email,
  phone,
}: {
  name: string;
  /** Null for phone-only accounts (no real email on file). */
  email: string | null;
  phone: string | null;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setPending(true);
        setErrors({});
        try {
          await apiFetch("/api/account/profile", {
            method: "PATCH",
            body: { name: fd.get("name"), phone: fd.get("phone") },
          });
          toast.success("Profile updated");
          router.refresh();
        } catch (err) {
          if (err instanceof ApiClientError) setErrors(err.fields);
          toast.error(err instanceof ApiClientError ? err.message : "Could not save");
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={name}
            autoComplete="name"
            aria-invalid={!!errors.name}
          />
          <FieldError message={errors.name} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">Mobile number</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={phone ?? ""}
            placeholder="98xxxxxxxx"
            autoComplete="tel"
            aria-invalid={!!errors.phone}
          />
          <FieldError message={errors.phone} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          value={email ?? "Not added — you sign in with your mobile number"}
          disabled
          readOnly
        />
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const newPassword = String(fd.get("newPassword"));
        if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
          return setError("Use at least 8 characters with a letter and a number");
        }
        setPending(true);
        setError(null);
        const { error } = await authClient.changePassword({
          currentPassword: String(fd.get("currentPassword")),
          newPassword,
          revokeOtherSessions: true,
        });
        setPending(false);
        if (error)
          return setError(
            error.status === 400 || error.status === 401
              ? "Current password is incorrect"
              : (error.message ?? "Could not change password"),
          );
        form.reset();
        toast.success("Password changed. Other devices have been signed out.");
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
        {pending ? "Updating…" : "Change password"}
      </Button>
    </form>
  );
}
