import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="container-page py-10"
      role="status"
      aria-busy="true"
      aria-label="Loading products"
    >
      {/* Keeps a page heading while results stream in (screen readers, axe page-has-heading-one). */}
      <h1 className="sr-only">Shop</h1>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-6 h-12 w-72" />
      <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <Skeleton className="aspect-[4/5] w-full rounded-xl" />
            <Skeleton className="mt-3 h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-3/4" />
            <Skeleton className="mt-2 h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
