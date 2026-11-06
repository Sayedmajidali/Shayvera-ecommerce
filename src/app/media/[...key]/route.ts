import { storage } from "@/server/platform/storage";

/** Serves uploaded media from the storage provider (local disk in development). */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const object = await storage().get(key.join("/"));
  if (!object || !object.contentType.startsWith("image/")) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(object.body), {
    headers: {
      "Content-Type": object.contentType,
      "Content-Length": String(object.body.length),
      // Keys are content-unique (random ids), so they can be cached aggressively.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
