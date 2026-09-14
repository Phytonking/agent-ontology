import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { paths } from "../paths.js";
import type { Store } from "./store.js";
import type { Blob } from "./blob.js";

export interface StoreConfig {
  kind: "sqlite" | "postgres";
  path?: string;   // sqlite only
  // postgres: URL comes from env ONTOLAYER_STORE_<NAME>_URL
}

export interface BlobConfig {
  kind: "fs" | "s3";
  path?: string;    // fs only
  bucket?: string;  // s3
  region?: string;
  endpoint?: string;
  public_url?: string;
  // s3 keys from env: ONTOLAYER_BLOB_<NAME>_ACCESS_KEY / SECRET_KEY
}

export interface OntologyStoreConfig {
  stores?: Record<string, StoreConfig>;
  blobs?: Record<string, BlobConfig>;
  defaults?: { store?: string; blob?: string };
}

function envKey(prefix: string, name: string, field: string): string {
  return `${prefix}_${name.toUpperCase()}_${field.toUpperCase()}`;
}

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function envOptional(key: string): string | undefined {
  return process.env[key];
}

/**
 * Load the backing-store config from ontology.config.yaml and open the named store.
 * Credentials are never in the YAML — they come from env by convention:
 *   Postgres: ONTOLAYER_STORE_<NAME>_URL
 *   S3/R2:    ONTOLAYER_BLOB_<NAME>_ACCESS_KEY / SECRET_KEY / BUCKET / ENDPOINT etc.
 */
export async function openNamedStore(root: string, storeName?: string): Promise<Store> {
  const cfg = readStoreConfig(root);
  const name = storeName ?? cfg.defaults?.store ?? "default";
  const storeConfig = cfg.stores?.[name];

  if (!storeConfig || storeConfig.kind === "sqlite") {
    const { TypedSqliteStore } = await import("./typed-sqlite-store.js");
    const { load } = await import("../loader.js");
    const { execFileSync } = await import("node:child_process");
    const model = load(root);
    let branch = "main";
    try { branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); } catch {}
    const safeBranch = branch.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dbPath = storeConfig?.path ?? path.join(root, ".ontology", `data-${safeBranch}.db`);
    return new TypedSqliteStore(dbPath, model.config.name, model.types);
  }

  if (storeConfig.kind === "postgres") {
    const { PostgresStore } = await import("../adapters/postgres-store.js");
    const url = env(envKey("ONTOLAYER_STORE", name, "URL"));
    const store = new PostgresStore(url, readOntologyName(root));
    await store.init();
    return store;
  }

  throw new Error(`Unknown store kind: ${(storeConfig as any).kind}`);
}

export async function openNamedBlob(root: string, blobName?: string): Promise<Blob> {
  const cfg = readStoreConfig(root);
  const name = blobName ?? cfg.defaults?.blob ?? "default";
  const blobConfig = cfg.blobs?.[name];

  if (!blobConfig || blobConfig.kind === "fs") {
    const { FsBlob } = await import("../adapters/blob-fs.js");
    const blobPath = blobConfig?.path ?? path.join(root, ".ontology", "blobs");
    return new FsBlob(blobPath);
  }

  if (blobConfig.kind === "s3") {
    const { S3Blob } = await import("../adapters/blob-s3.js");
    const prefix = `ONTOLAYER_BLOB_${name.toUpperCase()}`;
    return new S3Blob({
      bucket: blobConfig.bucket ?? env(`${prefix}_BUCKET`),
      region: blobConfig.region ?? envOptional(`${prefix}_REGION`) ?? "auto",
      endpoint: blobConfig.endpoint ?? envOptional(`${prefix}_ENDPOINT`),
      accessKeyId: env(`${prefix}_ACCESS_KEY`),
      secretAccessKey: env(`${prefix}_SECRET_KEY`),
      publicBaseUrl: blobConfig.public_url ?? envOptional(`${prefix}_PUBLIC_URL`),
    });
  }

  throw new Error(`Unknown blob kind: ${(blobConfig as any).kind}`);
}

function readStoreConfig(root: string): OntologyStoreConfig {
  const cfgPath = paths(root).config;
  if (!fs.existsSync(cfgPath)) return {};
  const raw = YAML.parse(fs.readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  return {
    stores: raw.stores as Record<string, StoreConfig> | undefined,
    blobs: raw.blobs as Record<string, BlobConfig> | undefined,
    defaults: raw.defaults as { store?: string; blob?: string } | undefined,
  };
}

function readOntologyName(root: string): string {
  const cfgPath = paths(root).config;
  if (!fs.existsSync(cfgPath)) return path.basename(path.resolve(root));
  const raw = YAML.parse(fs.readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  return typeof raw.name === "string" ? raw.name : path.basename(path.resolve(root));
}

/**
 * Quick connection test. Prints OK or an error per store/blob in the config.
 * Used by `ontology doctor`.
 */
export async function doctor(root: string): Promise<void> {
  const cfg = readStoreConfig(root);
  for (const [name, sc] of Object.entries(cfg.stores ?? {})) {
    try {
      const store = await openNamedStore(root, name);
      await store.headSeq();
      store.close();
      console.log(`store:${name} (${sc.kind}) OK`);
    } catch (e) {
      console.log(`store:${name} (${sc.kind}) FAIL — ${(e as Error).message}`);
    }
  }
  for (const [name, bc] of Object.entries(cfg.blobs ?? {})) {
    try {
      const blob = await openNamedBlob(root, name);
      await blob.get("__health__");
      console.log(`blob:${name} (${bc.kind}) OK`);
    } catch (e) {
      console.log(`blob:${name} (${bc.kind}) FAIL — ${(e as Error).message}`);
    }
  }
  if (!cfg.stores && !cfg.blobs) console.log("No stores/blobs configured. Add stores: and blobs: to ontology.config.yaml.");
}
