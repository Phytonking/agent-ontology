import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Blob } from "../data/blob.js";

export interface S3BlobConfig {
  bucket: string;
  region?: string;
  endpoint?: string;  // set for Cloudflare R2: https://<account>.r2.cloudflarestorage.com
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string; // optional CDN/public URL prefix for url()
}

/**
 * S3 + Cloudflare R2 blob adapter.
 *
 * R2 config:
 *   endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
 *   region: auto
 *   accessKeyId: R2 Access Key ID
 *   secretAccessKey: R2 Secret Access Key
 *
 * Env binding (via resolver):
 *   ONTOLAYER_BLOB_<NAME>_BUCKET
 *   ONTOLAYER_BLOB_<NAME>_REGION
 *   ONTOLAYER_BLOB_<NAME>_ENDPOINT
 *   ONTOLAYER_BLOB_<NAME>_ACCESS_KEY
 *   ONTOLAYER_BLOB_<NAME>_SECRET_KEY
 *   ONTOLAYER_BLOB_<NAME>_PUBLIC_URL
 */
export class S3Blob implements Blob {
  private client: S3Client;
  private bucket: string;
  private publicBaseUrl?: string;

  constructor(cfg: S3BlobConfig) {
    this.bucket = cfg.bucket;
    this.publicBaseUrl = cfg.publicBaseUrl;
    this.client = new S3Client({
      region: cfg.region ?? "auto",
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // R2 requires path-style URLs
      forcePathStyle: !!cfg.endpoint,
    });
  }

  async put(key: string, data: Buffer, contentType = "application/octet-stream"): Promise<string> {
    const up = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: data, ContentType: contentType },
    });
    await up.done();
    return this.url(key);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch (e: any) {
      if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  url(key: string): string {
    if (this.publicBaseUrl) return `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    // fall back to path-style URL (unsigned — only useful for public buckets)
    const base = this.client.config.endpoint
      ? String(this.client.config.endpoint)
      : `https://${this.bucket}.s3.amazonaws.com`;
    return `${base}/${key}`;
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
