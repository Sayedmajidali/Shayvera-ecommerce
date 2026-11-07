import { assertSafeKey } from "./local";
import { encodeS3Path, sha256Hex, signS3Request, type SigV4Credentials } from "./sigv4";
import type { StorageProvider, StoredObject } from "./types";

export type S3Config = SigV4Credentials & {
  /** e.g. https://s3.ap-south-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  timeoutMs?: number;
};

/**
 * S3-compatible object storage, path-style addressing (works with AWS S3, Cloudflare R2, DigitalOcean
 * Spaces and MinIO). The bucket can stay private: images are still served at `/media/<key>` by the
 * app (immutable cache headers — put a CDN in front), so URLs never change between storage drivers.
 */
export class S3StorageProvider implements StorageProvider {
  private readonly base: URL;
  constructor(private readonly cfg: S3Config) {
    this.base = new URL(cfg.endpoint);
  }

  private async send(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string) {
    assertSafeKey(key);
    const path = `/${encodeS3Path(this.cfg.bucket)}/${encodeS3Path(key)}`;
    const headers = signS3Request({
      method,
      path,
      headers: {
        host: this.base.host,
        ...(contentType ? { "content-type": contentType } : {}),
      },
      payloadHash: sha256Hex(body ?? ""),
      credentials: this.cfg,
    });
    delete (headers as Record<string, string>).host; // fetch sets Host itself
    return fetch(new URL(path, this.base), {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const res = await this.send("PUT", key, body, contentType);
    if (!res.ok) throw new Error(`Object storage upload failed with HTTP ${res.status}`);
    return { key, url: this.publicUrl(key), sizeBytes: body.length, contentType };
  }

  async get(key: string) {
    try {
      assertSafeKey(key);
    } catch {
      return null;
    }
    const res = await this.send("GET", key);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Object storage read failed with HTTP ${res.status}`);
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`Object storage delete failed with HTTP ${res.status}`);
  }

  publicUrl(key: string): string {
    return `/media/${key}`;
  }
}
