import { ok, parseJson } from "@/lib/api";
import { adminRoute } from "@/server/modules/auth/admin-route";
import { loadStoreSettings } from "@/server/modules/settings/queries";
import { settingsSchema, updateSettings } from "@/server/modules/settings/settings-admin";

export const GET = adminRoute("SETTINGS_MANAGE", async () => ok(await loadStoreSettings()), {
  csrf: false,
});

export const PUT = adminRoute("SETTINGS_MANAGE", async (req, _ctx, { actor }) =>
  ok(await updateSettings(await parseJson(req, settingsSchema, 128 * 1024), actor)),
);
