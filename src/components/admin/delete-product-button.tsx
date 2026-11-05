"use client";

import { useRouter } from "next/navigation";
import { Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

export function DeleteProductButton({
  productId,
  hasOrders,
}: {
  productId: string;
  hasOrders: boolean;
}) {
  const router = useRouter();
  return (
    <ConfirmButton
      title={hasOrders ? "Archive this product?" : "Delete this product permanently?"}
      description={
        hasOrders
          ? "This product appears in past orders, so it will be archived (hidden from the store) to preserve order history."
          : "The product, its variants and images will be removed. This cannot be undone."
      }
      confirmLabel={hasOrders ? "Archive" : "Delete"}
      onConfirm={async () => {
        try {
          const r = await apiFetch<{ action: string }>(`/api/admin/products/${productId}`, {
            method: "DELETE",
          });
          toast.success(`Product ${r.action}`);
          router.push("/admin/products");
          router.refresh();
        } catch (err) {
          toast.error(err instanceof ApiClientError ? err.message : "Could not remove product");
        }
      }}
      trigger={
        <Button variant="outline" size="sm" className="text-destructive">
          {hasOrders ? <Archive /> : <Trash2 />} {hasOrders ? "Archive" : "Delete"}
        </Button>
      }
    />
  );
}
