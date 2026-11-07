"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function RetryEventButton({
  eventId,
  url,
  label = "Retry",
}: {
  eventId?: string;
  /** Endpoint to POST to; defaults to retrying a payment webhook event. */
  url?: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiFetch(url ?? `/api/admin/payments/events/${eventId}/retry`, { body: {} });
          toast.success("Queued for processing");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof ApiClientError ? err.message : "Could not retry");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} {label}
    </Button>
  );
}
