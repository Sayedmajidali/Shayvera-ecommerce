"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { authClient } from "@/lib/auth-client";
import { formatIndianMobile, toE164IndianMobile } from "@/lib/india";
import { safeRedirectPath } from "@/lib/safe-redirect";

const RESEND_SECONDS = 30;

// React Bits CodeSlots (uses Motion): downloaded only once a code has been requested.
const loadCodeSlots = () => import("@/components/react-bits/code-slots");
const CodeSlots = lazy(loadCodeSlots);

type AuthErr = { status?: number; code?: string; message?: string } | null | undefined;

function sendErrorMessage(error: AuthErr): string {
  if (!error) return "Could not send the code. Please try again.";
  if (error.status === 429) return error.message ?? "Too many requests. Please wait and try again.";
  if (error.status === 503) return error.message ?? "SMS sign-in is unavailable. Please use email.";
  if (error.code === "INVALID_PHONE_NUMBER") return "Enter a valid 10-digit Indian mobile number.";
  return "Could not send the code. Please try again.";
}

function verifyErrorMessage(error: AuthErr): string {
  if (!error) return "Could not verify the code.";
  switch (error.code) {
    case "OTP_EXPIRED":
      return "This code has expired. Request a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong attempts. Request a new code.";
    case "OTP_NOT_FOUND":
      return "No active code for this number. Request a new one.";
    case "INVALID_OTP":
      return "That code is incorrect. Check the SMS and try again.";
    case "PHONE_NUMBER_EXIST":
      return "This mobile number is already linked to another account.";
  }
  if (error.status === 403) return error.message ?? "This account cannot sign in with a code.";
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return error.message ?? "Could not verify the code.";
}

async function mergeGuestCart() {
  try {
    await fetch("/api/cart/merge", { method: "POST" });
  } catch {
    /* non-fatal */
  }
}

/**
 * Mobile number + one-time SMS code.
 * - `mode="signin"`: signs in, creating the customer account on first use; new customers are then
 *   asked for their name.
 * - `mode="link"`: adds a verified sign-in number to the signed-in account.
 */
export function PhoneOtpForm({
  mode = "signin",
  next,
  onLinked,
}: {
  mode?: "signin" | "link";
  next?: string;
  onLinked?: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code" | "name">("phone");
  const [phone, setPhone] = useState("");
  const [e164, setE164] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function sendCode(target: string) {
    void loadCodeSlots(); // start fetching the code input while the SMS is on its way
    setPending(true);
    setError(null);
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: target });
    setPending(false);
    if (error) {
      setError(sendErrorMessage(error));
      return false;
    }
    setCooldown(RESEND_SECONDS);
    return true;
  }

  async function finishSignIn() {
    await mergeGuestCart();
    router.push(safeRedirectPath(next, "/account"));
    router.refresh();
  }

  if (step === "phone") {
    return (
      <form
        className="grid gap-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const normalized = toE164IndianMobile(phone);
          if (!normalized) return setError("Enter a valid 10-digit Indian mobile number.");
          if (await sendCode(normalized)) {
            setE164(normalized);
            setCode("");
            setStep("code");
          }
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="otp-phone">Mobile number</Label>
          <div className="flex">
            <span className="border-input bg-muted text-muted-foreground inline-flex items-center rounded-l-md border border-r-0 px-3 text-sm">
              +91
            </span>
            <Input
              id="otp-phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98450 12345"
              className="rounded-l-none"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={!!error}
              aria-describedby="otp-phone-hint"
              required
            />
          </div>
          <p id="otp-phone-hint" className="text-muted-foreground text-xs">
            We’ll text you a 6-digit code. Standard SMS rates may apply.
          </p>
        </div>
        <FieldError message={error ?? undefined} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Send code
        </Button>
      </form>
    );
  }

  if (step === "code" && e164) {
    return (
      <form
        className="grid gap-5"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the SMS.");
          setPending(true);
          setError(null);
          const { data, error } = await authClient.phoneNumber.verify({
            phoneNumber: e164,
            code,
            ...(mode === "link" ? { updatePhoneNumber: true } : {}),
          });
          if (error) {
            setPending(false);
            setError(verifyErrorMessage(error));
            return;
          }
          if (mode === "link") {
            setPending(false);
            onLinked?.();
            router.refresh();
            return;
          }
          const user = data?.user as { name?: string; phoneNumber?: string } | undefined;
          if (user && user.name === user.phoneNumber) {
            setPending(false);
            setStep("name");
            return;
          }
          await finishSignIn();
        }}
      >
        <p className="text-muted-foreground text-sm">
          Enter the code sent to{" "}
          <span className="text-foreground font-medium">{formatIndianMobile(e164)}</span>.{" "}
          <button
            type="button"
            className="text-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
          >
            Change number
          </button>
        </p>
        <div className="grid gap-2">
          <p className="text-sm font-medium" aria-hidden>
            6-digit code
          </p>
          {/* React Bits CodeSlots (lazy); a plain one-time-code input until it has loaded. */}
          <Suspense
            fallback={
              <Input
                ref={codeRef}
                aria-label="6-digit code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="text-center font-mono text-lg tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-invalid={!!error}
                required
              />
            }
          >
            <CodeSlots
              length={6}
              value={code}
              onChange={(v) => {
                setCode(v);
                if (error) setError(null);
              }}
              status={error ? "error" : "idle"}
              autoFocus
              ariaLabel="6-digit code"
              // Brand palette: empty slots soft green, filled slots lotus green with white digits.
              accentColor="#0c764e"
              digitColor="#ffffff"
              slotColor="#eef2e4"
              inkColor="#0c764e"
              dangerColor="#c0362c"
              slotSize={48}
              gap={8}
              radius={12}
              className="justify-self-start"
            />
          </Suspense>
        </div>
        <FieldError message={error ?? undefined} />
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}{" "}
          {mode === "link" ? "Verify number" : "Verify & continue"}
        </Button>
        <p className="text-muted-foreground text-center text-sm">
          {cooldown > 0 ? (
            <>Resend code in {cooldown}s</>
          ) : (
            <button
              type="button"
              disabled={pending}
              className="text-foreground underline-offset-4 hover:underline disabled:opacity-50"
              onClick={() => void sendCode(e164)}
            >
              Resend code
            </button>
          )}
        </p>
      </form>
    );
  }

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed.length < 2) return setError("Please enter your name");
        setPending(true);
        setError(null);
        const { error } = await authClient.updateUser({ name: trimmed });
        if (error) {
          setPending(false);
          setError("Could not save your name. You can update it later in your account.");
          return;
        }
        await finishSignIn();
      }}
    >
      <p className="text-muted-foreground text-sm">Welcome to Shayvera! What should we call you?</p>
      <div className="grid gap-2">
        <Label htmlFor="otp-name">Full name</Label>
        <Input
          id="otp-name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error}
          required
        />
      </div>
      <FieldError message={error ?? undefined} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Continue
      </Button>
      <button
        type="button"
        className="text-muted-foreground text-sm underline-offset-4 hover:underline"
        onClick={() => void finishSignIn()}
      >
        Skip for now
      </button>
    </form>
  );
}
