import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ReviewModeration } from "@/components/admin/review-moderation";
import { EmptyState } from "@/components/shared/empty-state";
import { MessageSquareText } from "lucide-react";
import { firstValues } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { requireAdminPage } from "@/server/modules/auth/session";
import { listReviewsForAdmin, reviewCounts } from "@/server/modules/catalog/reviews";

export const metadata: Metadata = { title: "Reviews" };

const TABS = [
  { status: "PENDING", label: "Waiting" },
  { status: "APPROVED", label: "Published" },
  { status: "REJECTED", label: "Rejected" },
] as const;

export default async function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requireAdminPage("CATALOG_MANAGE");
  const sp = firstValues(await searchParams);
  const status = TABS.find((t) => t.status === sp.status)?.status ?? "PENDING";
  const [reviews, counts] = await Promise.all([listReviewsForAdmin(status), reviewCounts()]);
  return (
    <>
      <AdminPageHeader
        title="Reviews"
        description="Customer reviews are published only after approval. Approving or rejecting updates the product's star rating."
      />
      <nav aria-label="Review status" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/admin/reviews?status=${t.status}`}
            aria-current={t.status === status ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm transition-colors",
              t.status === status
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-accent",
            )}
          >
            {t.label} ({counts[t.status] ?? 0})
          </Link>
        ))}
      </nav>
      {reviews.length === 0 ? (
        <Card className="p-10">
          <EmptyState
            icon={MessageSquareText}
            title={status === "PENDING" ? "No reviews waiting" : "Nothing here yet"}
            description={
              status === "PENDING"
                ? "New customer reviews will appear here for approval."
                : undefined
            }
          />
        </Card>
      ) : (
        <ReviewModeration
          reviews={reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
        />
      )}
    </>
  );
}
