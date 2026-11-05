import { z } from "zod";
import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { cartIdentityFromRequest } from "@/server/cart/request";
import { MAX_QTY_PER_LINE, removeItem, updateItemQuantity } from "@/server/services/cart";

type Ctx = RouteCtx<{ id: string }>;
const schema = z.object({ quantity: z.coerce.number().int().min(0).max(MAX_QTY_PER_LINE) });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { identity } = await cartIdentityFromRequest(req);
  const { quantity } = await parseJson(req, schema);
  await updateItemQuantity(identity, (await params).id, quantity);
  return ok({ updated: true });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { identity } = await cartIdentityFromRequest(req);
  await removeItem(identity, (await params).id);
  return ok({ removed: true });
});
