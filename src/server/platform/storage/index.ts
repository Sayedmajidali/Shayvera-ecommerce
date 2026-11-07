import "server-only";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

let provider: StorageProvider | undefined;

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return v;
}

/** Test hook. */
export function setStorageProvider(p: StorageProvider | undefined) {
  provider = p;
}

export function storage(): StorageProvider {
  if (provider) return provider;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      provider = new LocalStorageProvider(process.env.STORAGE_LOCAL_DIR ?? "./storage/uploads");
      return provider;
    case "s3":
      provider = new S3StorageProvider({
        endpoint: required("S3_ENDPOINT"),
        bucket: required("S3_BUCKET"),
        region: process.env.S3_REGION || "auto",
        accessKeyId: required("S3_ACCESS_KEY_ID"),
        secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      });
      return provider;
    default:
      throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
  }
}

export type { StorageProvider, StoredObject } from "./types";
