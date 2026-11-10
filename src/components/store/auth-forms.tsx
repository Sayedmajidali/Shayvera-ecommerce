"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
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

type AuthErr = { status?: number; code?: string; message?: string } | null | undefined;

function codeErrorMessage(error: AuthErr): string {
  switch (error?.code) {
    case "OTP_EXPIRED":
      return "This code has expired. Send a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong attempts. Send a new code.";
    case "INVALID_OTP":
      return "That code is incorrect. Check the email and try again.";
  }
  if (error?.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return error?.message ?? "Could not verify the code.";
}

const RESEND_SECONDS = 30;

/** Six-digit code field (one-time-code autofill, numbers only). */
function CodeInput({ invalid }: { invalid?: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="code">6-digit code</Label>
      <Input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus
        required
        aria-invalid={invalid}
        className="h-12 text-center font-mono text-xl tracking-[0.5em]"
        onInput={(e) => {
          const el = e.currentTarget;
          el.value = el.value.replace(/\D/g, "").slice(0, 6);
        }}
      />
    </div>
  );
}

/** "Resend code" with a short cooldown. */
function ResendCode({ onResend }: { onResend: () => Promise<boolean> }) {
  const [wait, setWait] = useState(RESEND_SECONDS);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  return (
    <p className="text-muted-foreground text-center text-sm">
      {wait > 0 ? (
        <>Didn’t get it? You can resend in {wait}s</>
      ) : (
        <button
          type="button"
          disabled={busy}
          className="text-foreground underline-offset-4 hover:underline disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            if (await onResend()) setWait(RESEND_SECONDS);
            setBusy(false);
          }}
        >
          Resend code
        </button>
      )}
    </p>
  );
}

/**
 * Confirms a new account's email with the code we sent. Verifying signs the customer in
 * (autoSignInAfterVerification), so this finishes sign-up / sign-in.
 */
function VerifyEmailStep({
  email,
  next,
  onBack,
  fromSignUp = false,
}: {
  email: string;
  next?: string;
  onBack: () => void;
  fromSignUp?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const otp = String(new FormData(e.currentTarget).get("code") ?? "");
        if (!/^\d{6}$/.test(otp)) return setError("Enter the 6-digit code from the email.");
        setPending(true);
        setError(null);
        const { error } = await authClient.emailOtp.verifyEmail({ email, otp });
        if (error) {
          setPending(false);
          return setError(codeErrorMessage(error));
        }
        await mergeGuestCart();
        router.push(safeRedirectPath(next, "/account"));
        router.refresh();
      }}
    >
      <div className="bg-leaf-soft rounded-xl px-4 py-3 text-sm" role="status">
        We’ve emailed a 6-digit code to <span className="font-medium">{email}</span>. Enter it below
        to verify your email. Check your spam folder if you don’t see it.
      </div>
      <CodeInput invalid={!!error} />
      <FieldError message={error ?? undefined} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Verify &amp; continue
      </Button>
      <ResendCode
        onResend={async () => {
          const { error } = await authClient.emailOtp.sendVerificationOtp({
            email,
            type: "email-verification",
          });
          if (error) setError(codeErrorMessage(error));
          return !error;
        }}
      />
      {fromSignUp && (
        <p className="text-muted-foreground text-center text-xs">
          Already have an account with this email?{" "}
          <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>{" "}
          or{" "}
          <Link
            href="/forgot-password"
            className="text-foreground underline-offset-4 hover:underline"
          >
            reset your password
          </Link>
          .
        </p>
      )}
      <button
        type="button"
        onClick={onBack}
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        Use a different email
      </button>
    </form>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [unverified, setUnverified] = useState<string | null>(null);
  if (unverified)
    return <VerifyEmailStep email={unverified} next={next} onBack={() => setUnverified(null)} />;
  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        const email = String(fd.get("email")).trim();
        const { data, error } = await authClient.signIn.email({
          email,
          password: String(fd.get("password")),
        });
        if (error?.code === "EMAIL_NOT_VERIFIED") {
          // A fresh code was emailed (sendOnSignIn): confirm it to finish signing in.
          setPending(false);
          setUnverified(email.toLowerCase());
          return;
        }
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
  const [verifying, setVerifying] = useState<string | null>(null);
  if (verifying)
    return (
      <VerifyEmailStep email={verifying} next={next} onBack={() => setVerifying(null)} fromSignUp />
    );
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
        const { data, error } = await authClient.signUp.email({ name, email, password });
        if (!error && !data?.token) {
          // Email verification is required: a code has been sent; confirm it to finish.
          setPending(false);
          setVerifying(email.toLowerCase());
          return;
        }
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
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async (address: string) => {
    const { error } = await authClient.emailOtp.requestPasswordReset({ email: address });
    if (error?.status === 429) {
      setError("Too many requests. Please try again later.");
      return false;
    }
    if (error) {
      setError(error.message ?? "Could not send the code. Please try again.");
      return false;
    }
    return true;
  };

  if (!email) {
    return (
      <form
        className="grid gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const address = String(new FormData(e.currentTarget).get("email") ?? "")
            .trim()
            .toLowerCase();
          if (!/^\S+@\S+\.\S+$/.test(address)) return setError("Enter a valid email address");
          setPending(true);
          setError(null);
          const ok = await requestCode(address);
          setPending(false);
          if (ok) setEmail(address);
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
          {pending && <Loader2 className="animate-spin" />} Send code
        </Button>
      </form>
    );
  }

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const otp = String(fd.get("code") ?? "");
        const password = String(fd.get("password") ?? "");
        if (!/^\d{6}$/.test(otp)) return setError("Enter the 6-digit code from the email.");
        const problem = passwordProblem(password);
        if (problem) return setError(problem);
        if (password !== String(fd.get("confirm"))) return setError("Passwords do not match");
        setPending(true);
        setError(null);
        const { error } = await authClient.emailOtp.resetPassword({ email, otp, password });
        setPending(false);
        if (error) {
          return setError(
            error.code === "USER_NOT_FOUND"
              ? "That code is incorrect. Check the email and try again."
              : codeErrorMessage(error),
          );
        }
        router.push("/login?reset=1");
      }}
    >
      <div className="bg-leaf-soft rounded-xl px-4 py-3 text-sm" role="status">
        If an account exists for <span className="font-medium">{email}</span>, we’ve emailed it a
        6-digit code. It expires in 10 minutes.
      </div>
      <CodeInput invalid={!!error} />
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          aria-describedby="new-pw-hint"
        />
        <p id="new-pw-hint" className="text-muted-foreground text-xs">
          At least 8 characters with a letter and a number.
        </p>
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
        {pending && <Loader2 className="animate-spin" />} Reset password
      </Button>
      <ResendCode onResend={() => requestCode(email)} />
      <button
        type="button"
        onClick={() => {
          setEmail(null);
          setError(null);
        }}
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        Use a different email
      </button>
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
