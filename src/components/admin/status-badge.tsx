import { Badge } from "@/components/ui/badge";

type Variant =
  "default" | "secondary" | "outline" | "brand" | "success" | "warning" | "destructive";

const MAP: Record<string, Variant> = {
  ACTIVE: "success",
  DRAFT: "secondary",
  ARCHIVED: "outline",
  DISABLED: "destructive",
  PENDING: "warning",
  CONFIRMED: "brand",
  PROCESSING: "brand",
  SHIPPED: "default",
  DELIVERED: "success",
  CANCELLED: "destructive",
  REFUNDED: "outline",
  PAID: "success",
  FAILED: "destructive",
  PARTIALLY_REFUNDED: "warning",
  PROCESSED: "success",
  CUSTOMER: "secondary",
  ADMIN: "brand",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={MAP[status] ?? "secondary"} className={className}>
      {status
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}
