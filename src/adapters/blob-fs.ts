import fs from "node:fs";
import path from "node:path";
import type { Blob } from "../data/blob.js";

/** Local filesystem blob store — the zero-config default. */
export class FsBlob implements Blob {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<string> {
    const dest = path.join(this.dir, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    return `file://${dest}`;
  }

  async get(key: string): Promise<Buffer | null> {
    const dest = path.join(this.dir, key);
    if (!fs.existsSync(dest)) return null;
    return fs.readFileSync(dest);
  }

  url(key: string): string {
    return `file://${path.join(this.dir, key)}`;
  }

  async remove(key: string): Promise<void> {
    const dest = path.join(this.dir, key);
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
}
