"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function CustomerStatusToggle({
  id,
  status,
}: {
  id: string;
  status: "ACTIVE" | "DISABLED";
}) {
  const router = useRouter();
  const next = status === "ACTIVE" ? "DISABLED" : "ACTIVE";
  return (
    <ConfirmButton
      title={next === "DISABLED" ? "Disable this account?" : "Re-enable this account?"}
      description={
        next === "DISABLED"
          ? "The customer will be signed out everywhere and won’t be able to sign in. Their orders are kept."
          : "The customer will be able to sign in again."
      }
      confirmLabel={next === "DISABLED" ? "Disable" : "Enable"}
      destructive={next === "DISABLED"}
      onConfirm={async () => {
        try {
          await apiFetch(`/api/admin/customers/${id}`, { method: "PATCH", body: { status: next } });
          toast.success(next === "DISABLED" ? "Account disabled" : "Account enabled");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof ApiClientError ? err.message : "Could not update account");
        }
      }}
      trigger={
        <Button
          variant={next === "DISABLED" ? "outline" : "default"}
          size="sm"
          className={next === "DISABLED" ? "text-destructive" : ""}
        >
          {next === "DISABLED" ? "Disable account" : "Enable account"}
        </Button>
      }
    />
  );
}
