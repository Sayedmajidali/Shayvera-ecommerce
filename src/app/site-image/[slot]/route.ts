import { NextResponse } from "next/server";
import { SITE_IMAGE_SLOTS, isSiteImageSlot } from "@/lib/site-images";
import { getSiteImages } from "@/server/modules/settings/site-images";

/**
 * GET /site-image/:slot → redirects to the uploaded image for that slot, or to its built-in default.
 * Lets icons, link previews and client-rendered placeholders follow admin changes without a rebuild.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params;
  if (!isSiteImageSlot(slot)) return new NextResponse("Not found", { status: 404 });
  const uploaded = (await getSiteImages())[slot]?.url;
  const target = uploaded ?? SITE_IMAGE_SLOTS.find((s) => s.slot === slot)!.defaultUrl;
  if (!target) return new NextResponse("Not found", { status: 404 });
  // Relative Location: correct behind proxies/tunnels whatever host the request arrived on.
  // Short cache so a new upload shows up within a minute everywhere.
  return new Response(null, {
    status: 307,
    headers: {
      Location: target,
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
