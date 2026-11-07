import { shippingProviderName } from "@/lib/env";

/** Development stand-in for courier labels/manifests when SHIPPING_PROVIDER=mock. */
export async function GET(req: Request) {
  if (shippingProviderName() !== "mock") return new Response("Not found", { status: 404 });
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") === "manifest" ? "MANIFEST" : "SHIPPING LABEL";
  const id = (u.searchParams.get("id") ?? "").replace(/[^\w-]/g, "").slice(0, 40);
  return new Response(`${kind} (mock courier — not a real document)\nShipment ${id}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
