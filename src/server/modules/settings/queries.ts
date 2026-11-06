import { cache } from "react";
import type { StoreSettings } from "@prisma/client";
import { db, type Tx } from "@/server/platform/db";

/** Store settings singleton. Created with defaults on first access. */
export async function loadStoreSettings(client: Tx | typeof db = db): Promise<StoreSettings> {
  const existing = await client.storeSettings.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return client.storeSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

export const getStoreSettings = cache(() => loadStoreSettings());
