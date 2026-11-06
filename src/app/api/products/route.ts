import { ok, route } from "@/lib/api";
import { listProducts, productListParamsSchema } from "@/server/modules/catalog/queries";

/** Public catalog listing: ?q=&category=&minPrice=&maxPrice=&inStock=1&sort=&page= (prices in rupees). */
export const GET = route(
  async (req) => {
    const params = productListParamsSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return ok(await listProducts(params));
  },
  { csrf: false },
);
