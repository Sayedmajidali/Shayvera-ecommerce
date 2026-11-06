import { ok, parseJson, type RouteCtx } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { hasPermission } from "@/server/modules/auth/permissions";
import { receiveReturn, receiveReturnSchema } from "@/server/modules/orders/requests";

export const POST = adminRoute<RouteCtx<{ id: string }>>(
  "RETURNS_MANAGE",
  async (req, { params }, { admin, actor }) => {
    const input = await parseJson(req, receiveReturnSchema);
    // Putting items back into sellable stock is an inventory change.
    if (
      input.lines.some((l) => l.restockQuantity > 0) &&
      !hasPermission(admin.permissions, "INVENTORY_MANAGE")
    )
      throw new AppError("FORBIDDEN", "Restocking returned items needs inventory permission");
    await receiveReturn((await params).id, input, actor);
    return ok({ received: true });
  },
);
