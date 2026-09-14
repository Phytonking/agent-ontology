import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { paths } from "../paths.js";
import { load } from "../loader.js";
import { hashData } from "./record.js";
import { validateInstance } from "./dataset.js";
import type { Store } from "./store.js";

export interface MaterializeResult {
  ingested: number;
  skipped: number;
  errors: { file: string; error: string }[];
}

export type WriteMode = "bidirectional" | "index_only";

/** Read write_mode from ontology.config.yaml. Default: bidirectional. */
export function getWriteMode(root: string): WriteMode {
  const cfgPath = paths(root).config;
  if (!fs.existsSync(cfgPath)) return "bidirectional";
  try {
    const raw = YAML.parse(fs.readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    if (raw.write_mode === "index_only") return "index_only";
  } catch {}
  return "bidirectional";
}

/**
 * Write an instance record back to its canonical YAML file.
 * Only called when write_mode is "bidirectional" (the default).
 */
export function writeInstanceFile(
  root: string,
  type: string,
  id: string,
  data: Record<string, unknown>,
  scope = "shared"
): string {
  const p = paths(root);
  fs.mkdirSync(p.instanceDir(type), { recursive: true });
  const filePath = p.instanceFile(type, id);
  const content: Record<string, unknown> = { _id: id };
  if (scope !== "shared") content._scope = scope;
  Object.assign(content, data);
  fs.writeFileSync(filePath, YAML.stringify(content));
  return filePath;
}

/**
 * Scan `data/` folder and upsert every instance YAML into the store.
 * Hash-aware: skips files whose content hash matches the stored record.
 */
export async function materialize(root: string, store: Store): Promise<MaterializeResult> {
  const model = load(root);
  const p = paths(root);
  const result: MaterializeResult = { ingested: 0, skipped: 0, errors: [] };

  if (!fs.existsSync(p.dataDir)) return result;

  const typeDirs = fs.readdirSync(p.dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const typeName of typeDirs) {
    const typeDoc = model.types.get(typeName);
    const dir = p.instanceDir(typeName);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
        if (!raw || typeof raw !== "object") {
          result.errors.push({ file: filePath, error: "empty or non-object YAML" });
          continue;
        }

        const { _id, _scope, ...data } = raw;
        const id = typeof _id === "string" ? _id : path.basename(file, path.extname(file));
        const scope = typeof _scope === "string" ? _scope : "shared";

        // hash-skip: don't re-upsert if the content hasn't changed
        const hash = hashData(data);
        const existing = await store.get(typeName, id, scope);
        if (existing && existing._hash === hash) {
          result.skipped++;
          continue;
        }

        if (typeDoc) {
          const problems = validateInstance(typeDoc, data);
          if (problems.length) {
            result.errors.push({ file: filePath, error: problems.map((p) => `${p.field}: ${p.message}`).join("; ") });
            continue;
          }
        }

        await store.upsert({ type: typeName, id, scope, data, source: `file:${path.relative(root, filePath)}` });
        result.ingested++;
      } catch (e) {
        result.errors.push({ file: filePath, error: (e as Error).message });
      }
    }
  }

  return result;
}

/**
 * Full re-index: wipe all typed tables and rebuild from YAML files.
 * Use when the DB is out of sync or after a schema change.
 */
export async function reindex(root: string, store: Store): Promise<MaterializeResult> {
  const model = load(root);
  // delete all existing records per type
  for (const typeName of model.types.keys()) {
    const all = await store.query(typeName, {});
    for (const rec of all) await store.remove(typeName, rec._id, rec._scope);
  }
  return materialize(root, store);
}

/** Watch `data/` for changes and re-materialize on edit. Returns an unsubscribe fn. */
export function watchAndMaterialize(root: string, store: Store, onResult?: (r: MaterializeResult) => void): () => void {
  const dataDir = paths(root).dataDir;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watcher = fs.watch(dataDir, { recursive: true }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const r = await materialize(root, store);
      onResult?.(r);
    }, 250);
  });

  return () => watcher.close();
}
