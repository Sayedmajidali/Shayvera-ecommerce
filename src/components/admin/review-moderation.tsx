"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RatingStars } from "@/components/store/rating-stars";
import { apiFetch, ApiClientError } from "@/lib/fetcher";

type Row = {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  verifiedPurchase: boolean;
  createdAt: string;
  user: { name: string };
  product: { name: string; slug: string };
};

export function ReviewModeration({ reviews }: { reviews: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (id: string, status: "APPROVED" | "REJECTED") => {
    setBusy(id);
    try {
      await apiFetch(`/api/admin/reviews/${id}`, { method: "PATCH", body: { status } });
      toast.success(status === "APPROVED" ? "Review published" : "Review rejected");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Could not update the review");
    } finally {
      setBusy(null);
    }
  };
  return (
    <ul className="grid gap-4">
      {reviews.map((r) => (
        <li key={r.id}>
          <Card className="p-5" data-testid="admin-review">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/product/${r.product.slug}`} className="font-medium hover:underline">
                  {r.product.name}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <RatingStars rating={r.rating} />
                  <span className="text-muted-foreground">
                    {r.user.name} · {new Date(r.createdAt).toLocaleDateString("en-IN")}
                  </span>
                  {r.verifiedPurchase && (
                    <span className="text-success inline-flex items-center gap-1 text-xs font-medium">
                      <BadgeCheck className="size-3.5" aria-hidden /> Verified purchase
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {r.status !== "APPROVED" && (
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => void decide(r.id, "APPROVED")}
                  >
                    {busy === r.id ? <Loader2 className="animate-spin" /> : <Check />} Approve
                  </Button>
                )}
                {r.status !== "REJECTED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => void decide(r.id, "REJECTED")}
                  >
                    <X /> Reject
                  </Button>
                )}
              </div>
            </div>
            {r.title && <p className="mt-3 font-medium">{r.title}</p>}
            <p className="text-muted-foreground mt-1 text-sm leading-6 whitespace-pre-line">
              {r.body}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
