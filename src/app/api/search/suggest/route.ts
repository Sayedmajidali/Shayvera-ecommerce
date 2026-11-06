import { ok, route } from "@/lib/api";
import { searchSuggestions } from "@/server/modules/catalog/queries";

export const GET = route(
  async (req) => {
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
    return ok(await searchSuggestions(q), { headers: { "Cache-Control": "public, max-age=30" } });
  },
  { csrf: false },
);
