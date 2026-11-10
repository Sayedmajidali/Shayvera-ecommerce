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

const DOT: Record<Variant, string> = {
  default: "bg-foreground/70",
  secondary: "bg-muted-foreground/60",
  outline: "bg-muted-foreground/50",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-[oklch(0.72_0.15_75)]",
  destructive: "bg-destructive",
};

/** Soft, consistent status pill with a colour dot (the text always carries the meaning). */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = MAP[status] ?? "secondary";
  // Solid "default" pills read as louder than the rest: show them softly like the others.
  const soft = variant === "default" ? "secondary" : variant;
  return (
    <Badge variant={soft} className={className}>
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[variant]}`} />
      {status
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}
