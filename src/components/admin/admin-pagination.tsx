import Link from "next/link";
import { Button } from "@/components/ui/button";

export function AdminPagination({
  page,
  pageCount,
  total,
  basePath,
  searchParams,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    return `${basePath}${sp.size ? `?${sp}` : ""}`;
  };
  return (
    <div className="text-muted-foreground flex items-center justify-between gap-4 border-t px-4 py-3 text-sm">
      <p>
        {total} result{total === 1 ? "" : "s"} · Page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page - 1)}>Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        {page < pageCount ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href(page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
