import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

let provider: StorageProvider | undefined;

export function storage(): StorageProvider {
  if (provider) return provider;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      provider = new LocalStorageProvider(process.env.STORAGE_LOCAL_DIR ?? "./storage/uploads");
      return provider;
    default:
      throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
  }
}

export type { StorageProvider, StoredObject } from "./types";
