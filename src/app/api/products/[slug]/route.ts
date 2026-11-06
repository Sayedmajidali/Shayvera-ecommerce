import { ok, route, type RouteCtx } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getProductBySlug } from "@/server/modules/catalog/queries";

export const GET = route<RouteCtx<{ slug: string }>>(
  async (_req, { params }) => {
    const product = await getProductBySlug((await params).slug);
    if (!product) throw new AppError("NOT_FOUND", "Product not found");
    return ok(product);
  },
  { csrf: false },
);
