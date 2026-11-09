"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PhoneOtpForm } from "@/components/store/phone-otp-form";
import { formatIndianMobile } from "@/lib/india";

/** Shows the verified sign-in number, or lets an email account add one with an SMS code. */
export function SignInPhone({
  phoneNumber,
  phoneEnabled,
}: {
  phoneNumber: string | null;
  phoneEnabled: boolean;
}) {
  const [adding, setAdding] = useState(false);
  if (phoneNumber) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <CheckCircle2 className="text-success size-4" aria-hidden />
        <span className="font-medium">{formatIndianMobile(phoneNumber)}</span>
        <span className="text-muted-foreground">verified — you can sign in with an SMS code</span>
      </p>
    );
  }
  if (!phoneEnabled) {
    return (
      <p className="text-muted-foreground text-sm">Sign-in by SMS code is not available yet.</p>
    );
  }
  if (!adding) {
    return (
      <Button variant="outline" onClick={() => setAdding(true)}>
        Add mobile number
      </Button>
    );
  }
  return (
    <div className="max-w-sm">
      <PhoneOtpForm
        mode="link"
        onLinked={() => {
          toast.success("Mobile number verified. You can now sign in with an SMS code.");
          setAdding(false);
        }}
      />
    </div>
  );
}
