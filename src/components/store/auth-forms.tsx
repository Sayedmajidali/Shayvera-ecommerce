"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { authClient } from "@/lib/auth-client";
import { safeRedirectPath } from "@/lib/safe-redirect";

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-10" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function passwordProblem(pw: string): string | undefined {
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use at least one letter and one number";
  return undefined;
}

async function mergeGuestCart() {
  try {
    await fetch("/api/cart/merge", { method: "POST" });
  } catch {
    /* non-fatal */
  }
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        const { data, error } = await authClient.signIn.email({
          email: String(fd.get("email")),
          password: String(fd.get("password")),
        });
        if (error) {
          setPending(false);
          setError(
            error.status === 429
              ? "Too many attempts. Please wait a minute and try again."
              : error.status === 403
                ? (error.message ?? "This account is disabled.")
                : "Incorrect email or password.",
          );
          return;
        }
        await mergeGuestCart();
        const role = (data?.user as { role?: string } | undefined)?.role;
        router.push(safeRedirectPath(next, role === "ADMIN" ? "/admin" : "/account"));
        router.refresh();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground text-xs underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>
      {error && (
        <p
          role="alert"
          className="bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Sign in
      </Button>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const name = String(fd.get("name") ?? "").trim();
        const email = String(fd.get("email") ?? "").trim();
        const password = String(fd.get("password") ?? "");
        const fieldErrors: Record<string, string> = {};
        if (name.length < 2) fieldErrors.name = "Please enter your name";
        if (!/^\S+@\S+\.\S+$/.test(email)) fieldErrors.email = "Enter a valid email address";
        const pwErr = passwordProblem(password);
        if (pwErr) fieldErrors.password = pwErr;
        setErrors(fieldErrors);
        if (Object.keys(fieldErrors).length) return;
        setPending(true);
        setError(null);
        const { error } = await authClient.signUp.email({ name, email, password });
        if (error) {
          setPending(false);
          setError(
            error.status === 422 ||
              error.code === "USER_ALREADY_EXISTS" ||
              /exist/i.test(error.message ?? "")
              ? "An account with this email already exists. Try signing in."
              : error.status === 429
                ? "Too many attempts. Please wait a minute."
                : (error.message ?? "Could not create your account."),
          );
          return;
        }
        await mergeGuestCart();
        router.push(safeRedirectPath(next, "/account"));
        router.refresh();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="name">Full name</Label>
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
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          aria-invalid={!!errors.password}
          aria-describedby="pw-hint"
        />
        {errors.password ? (
          <FieldError message={errors.password} />
        ) : (
          <p id="pw-hint" className="text-muted-foreground text-xs">
            At least 8 characters with a letter and a number.
          </p>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Create account
      </Button>
      <p className="text-muted-foreground text-xs">
        By creating an account you agree to our{" "}
        <Link href="/terms" className="underline">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (sent) {
    return (
      <div className="flex flex-col items-center text-center">
        <CheckCircle2 className="text-success size-10" />
        <p className="text-muted-foreground mt-4 text-sm">
          If an account exists for that email, a reset link is on its way. The link expires in 30
          minutes.
        </p>
      </div>
    );
  }
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setPending(true);
        const { error } = await authClient.requestPasswordReset({
          email: String(fd.get("email")),
          redirectTo: "/reset-password",
        });
        setPending(false);
        if (error && error.status === 429) setError("Too many requests. Please try again later.");
        else setSent(true);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!token) {
    return (
      <p className="text-destructive text-sm">
        This reset link is invalid or has expired.{" "}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </p>
    );
  }
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const password = String(fd.get("password"));
        if (password !== String(fd.get("confirm"))) return setError("Passwords do not match");
        const problem = passwordProblem(password);
        if (problem) return setError(problem);
        setPending(true);
        setError(null);
        const { error } = await authClient.resetPassword({ newPassword: password, token });
        setPending(false);
        if (error)
          return setError("This reset link is invalid or has expired. Please request a new one.");
        router.push("/login?reset=1");
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput id="password" name="password" autoComplete="new-password" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" required />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Update password
      </Button>
    </form>
  );
}
