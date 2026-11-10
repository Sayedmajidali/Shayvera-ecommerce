import { Skeleton } from "@/components/ui/skeleton";

/** Shown instantly while an admin page loads its data. */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-8">
      <div className="grid gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}
