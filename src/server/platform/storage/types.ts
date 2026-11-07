export type StoredObject = {
  key: string;
  url: string;
  sizeBytes: number;
  contentType: string;
};

/**
 * Storage abstraction selected with STORAGE_DRIVER: `local` (development, single host) or `s3`
 * (any S3-compatible service — required for multi-instance production). Callers never change.
 */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
