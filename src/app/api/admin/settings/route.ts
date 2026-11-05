import { ok, parseJson } from "@/lib/api";
import { adminRoute } from "@/server/auth/admin-route";
import { loadStoreSettings } from "@/server/queries/settings";
import { settingsSchema, updateSettings } from "@/server/services/admin-misc";

export const GET = adminRoute(async () => ok(await loadStoreSettings()), { csrf: false });

export const PUT = adminRoute(async (req, _ctx, { actor }) =>
  ok(await updateSettings(await parseJson(req, settingsSchema, 128 * 1024), actor)),
);
