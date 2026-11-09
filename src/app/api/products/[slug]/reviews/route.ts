import { ok, parseJson, route, type RouteCtx } from "@/lib/api";
import { requireUser } from "@/server/modules/auth/session";
import { reviewInputSchema, submitReview } from "@/server/modules/catalog/reviews";
import { enforceRateLimit } from "@/server/platform/rate-limit";

/** Customers write (or edit) their review of a product; it is published after staff approval. */
export const POST = route<RouteCtx<{ slug: string }>>(async (req, { params }) => {
  const user = await requireUser(req);
  await enforceRateLimit(`review:user:${user.id}`, 10, 3600);
  const input = await parseJson(req, reviewInputSchema);
  const review = await submitReview(user.id, (await params).slug, input);
  return ok(review, 201);
});
