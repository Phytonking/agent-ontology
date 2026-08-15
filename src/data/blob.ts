/** Blob storage contract — put/get/url/delete. Adapters: fs (default), s3, r2. */
export interface Blob {
  put(key: string, data: Buffer, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer | null>;
  url(key: string): string;
  remove(key: string): Promise<void>;
}
