export type StoredObject = {
  key: string;
  url: string;
  sizeBytes: number;
  contentType: string;
};

/**
 * Storage abstraction. LocalStorageProvider is used in development; a Cloudinary/S3
 * implementation can be added and selected with STORAGE_DRIVER without touching callers.
 */
export interface StorageProvider {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
