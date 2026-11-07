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
  PAYMENT_FAILED: "destructive",
  READY_TO_SHIP: "brand",
  OUT_FOR_DELIVERY: "default",
  CANCELLATION_REQUESTED: "warning",
  RETURN_REQUESTED: "warning",
  RETURNED: "outline",
  REFUND_PENDING: "warning",
  APPROVED: "brand",
  REJECTED: "destructive",
  COMPLETED: "success",
  WITHDRAWN: "outline",
  PAID: "success",
  FAILED: "destructive",
  PARTIALLY_REFUNDED: "warning",
  PROCESSED: "success",
  CAPTURED: "success",
  CREATED: "secondary",
  IN_TRANSIT: "default",
  CREATING: "secondary",
  AWB_ASSIGNED: "brand",
  PICKUP_SCHEDULED: "brand",
  PICKED_UP: "default",
  UNDELIVERED: "warning",
  RTO_INITIATED: "warning",
  RTO_DELIVERED: "outline",
  LOST: "destructive",
  DAMAGED: "destructive",
  QUEUED: "secondary",
  RUNNING: "brand",
  DEAD: "destructive",
  SUCCEEDED: "success",
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
