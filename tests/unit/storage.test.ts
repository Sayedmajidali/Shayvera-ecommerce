import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { encodeS3Path, sha256Hex, signS3Request } from "@/server/platform/storage/sigv4";
import { S3StorageProvider } from "@/server/platform/storage/s3";

// Official example credentials from the AWS Signature Version 4 documentation for S3.
const credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
};
const date = new Date("2013-05-24T00:00:00Z");
const sig = (auth: string | undefined) => auth?.split("Signature=")[1];

describe("AWS SigV4 (official S3 examples)", () => {
  it("GET Object with a Range header", () => {
    const h = signS3Request({
      method: "GET",
      path: "/test.txt",
      headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9" },
      payloadHash: sha256Hex(""),
      credentials,
      date,
    });
    expect(h["x-amz-date"]).toBe("20130524T000000Z");
    expect(h.authorization).toContain(
      "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date",
    );
    expect(sig(h.authorization)).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("PUT Object with a body and extra headers", () => {
    const body = "Welcome to Amazon S3.";
    expect(sha256Hex(body)).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    );
    const h = signS3Request({
      method: "PUT",
      path: `/${encodeS3Path("test$file.text")}`,
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      payloadHash: sha256Hex(body),
      credentials,
      date,
    });
    expect(sig(h.authorization)).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("encodes path segments the way S3 expects", () => {
    expect(encodeS3Path("products/a b/(1)*.webp")).toBe("products/a%20b/%281%29%2A.webp");
  });
});

describe("S3StorageProvider against a local fake S3", () => {
  it("puts, gets, deletes and treats missing objects as absent", async () => {
    const objects = new Map<string, { body: Buffer; type: string }>();
    const seen: { method: string; url: string; auth: string; sha: string }[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({
          method: req.method!,
          url: req.url!,
          auth: String(req.headers.authorization ?? ""),
          sha: String(req.headers["x-amz-content-sha256"] ?? ""),
        });
        const o = objects.get(req.url!);
        if (req.method === "PUT") {
          objects.set(req.url!, { body, type: String(req.headers["content-type"]) });
          return res.writeHead(200).end();
        }
        if (req.method === "DELETE") {
          objects.delete(req.url!);
          return res.writeHead(204).end();
        }
        if (!o) return res.writeHead(404).end();
        res.writeHead(200, { "content-type": o.type }).end(o.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const s3 = new S3StorageProvider({
        endpoint: `http://127.0.0.1:${port}`,
        bucket: "shop-media",
        ...credentials,
      });
      const put = await s3.put("products/x1.webp", Buffer.from("img"), "image/webp");
      expect(put).toEqual({
        key: "products/x1.webp",
        url: "/media/products/x1.webp",
        sizeBytes: 3,
        contentType: "image/webp",
      });
      expect(seen[0]).toMatchObject({
        method: "PUT",
        url: "/shop-media/products/x1.webp",
        sha: sha256Hex("img"),
      });
      expect(seen[0]!.auth).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
      const got = await s3.get("products/x1.webp");
      expect(got?.body.toString()).toBe("img");
      expect(got?.contentType).toBe("image/webp");
      expect(await s3.get("products/missing.webp")).toBeNull();
      expect(await s3.get("../etc/passwd")).toBeNull(); // unsafe keys never reach the network
      await s3.delete("products/x1.webp");
      expect(await s3.get("products/x1.webp")).toBeNull();
      await expect(s3.put("../escape", Buffer.from(""), "image/webp")).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});
