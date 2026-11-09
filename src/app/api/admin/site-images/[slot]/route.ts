import { ok, type RouteCtx } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { isSiteImageSlot } from "@/lib/site-images";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { resetSiteImage, setSiteImage } from "@/server/modules/settings/site-images";
import { readImageForm } from "@/server/modules/settings/upload-form";
import { enforceRateLimit } from "@/server/platform/rate-limit";

type Ctx = RouteCtx<{ slot: string }>;

async function slotOf(params: Ctx["params"]) {
  const { slot } = await params;
  if (!isSiteImageSlot(slot)) throw new AppError("NOT_FOUND", "Unknown image slot");
  return slot;
}

/** Replace a storefront image (multipart: file, alt?). */
export const POST = adminRoute<Ctx>("SETTINGS_MANAGE", async (req, { params }, { actor }) => {
  const slot = await slotOf(params);
  await enforceRateLimit(`upload:${actor.id}`, 60, 600);
  const { file, alt } = await readImageForm(req);
  return ok(await setSiteImage(slot, file, alt, actor), 201);
});

/** Go back to the built-in default image. */
export const DELETE = adminRoute<Ctx>("SETTINGS_MANAGE", async (_req, { params }, { actor }) =>
  ok(await resetSiteImage(await slotOf(params), actor)),
);
