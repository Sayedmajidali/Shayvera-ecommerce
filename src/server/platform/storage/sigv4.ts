import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3-compatible object storage (AWS S3, Cloudflare R2, DigitalOcean
 * Spaces, MinIO). Implemented directly (≈ 60 lines) instead of pulling in the AWS SDK; verified
 * against the official AWS test vectors in tests/unit/storage.test.ts.
 */
export type SigV4Credentials = { accessKeyId: string; secretAccessKey: string; region: string };

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as S3 expects for path segments ("/" kept between segments). */
export function encodeS3Path(path: string) {
  return path
    .split("/")
    .map((s) =>
      encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");
}

/**
 * Returns the headers to send (the input headers plus `x-amz-date`, `x-amz-content-sha256` and
 * `Authorization`). `headers` keys must be lower-case and include `host`.
 */
export function signS3Request(p: {
  method: string;
  /** Canonical (already encoded) path, e.g. "/bucket/products/a.webp". */
  path: string;
  query?: string;
  headers: Record<string, string>;
  payloadHash: string;
  credentials: SigV4Credentials;
  date?: Date;
}): Record<string, string> {
  const amzDate = (p.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...p.headers,
    "x-amz-content-sha256": p.payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((h) => `${h}:${String(headers[h]).trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [p.method, p.path, p.query ?? "", canonicalHeaders, signedHeaders, p.payloadHash].join("\n");
  const scope = `${day}/${p.credentials.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${p.credentials.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, p.credentials.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${p.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export { sha256Hex };
