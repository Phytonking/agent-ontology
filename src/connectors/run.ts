import path from "node:path";
import { pathToFileURL } from "node:url";
import { Dataset } from "../data/dataset.js";
import { getConnectorFactory } from "./registry.js";
import { validateInstance } from "../data/dataset.js";
import { load } from "../loader.js";
import type { Connector, ConnectorContext, ConnectorDef, ConnectorResult, Cursor, PipelineContext } from "./types.js";

function makeCursor(dataset: Dataset, connectorName: string): Cursor {
  return {
    async get(key) {
      const rec = await dataset.store.get("__cursor__", `${connectorName}:${key}`);
      return rec ? String(rec.data.value) : null;
    },
    async set(key, value) {
      await dataset.store.upsert({ type: "__cursor__", id: `${connectorName}:${key}`, data: { value } });
    },
  };
}

export function makeContext(
  root: string,
  dataset: Dataset,
  config: Record<string, unknown>,
  bag: Record<string, unknown> = {},
  dryRun = false,
  connectorName = "unknown"
): PipelineContext {
  return {
    root, dataset, bag, config, dryRun,
    cursor: makeCursor(dataset, connectorName),
    env: (k) => process.env[k],
    upsert: async (type, id, data, scope) => {
      if (dryRun) {
        const model = load(root);
        const t = model.types.get(type);
        if (t) {
          const problems = validateInstance(t, data);
          if (problems.length)
            throw new Error(`dry-run validation failed for ${type}: ${problems.map((p) => `${p.field} ${p.message}`).join("; ")}`);
        }
        return { _id: id ?? "dry-run" };
      }
      const rec = await dataset.put({ type, id, scope, data });
      return { _id: rec._id };
    },
  };
}

export async function resolveConnectorImpl(def: ConnectorDef, root: string): Promise<Connector | null> {
  let connector: Connector | undefined;
  if (def.module) {
    const abs = path.isAbsolute(def.module) ? def.module : path.join(root, def.module);
    const mod = await import(pathToFileURL(abs).href);
    const exp = mod.default ?? mod.connector;
    connector = typeof exp === "function" ? await exp(def) : exp;
  }
  if (!connector) {
    const factory = getConnectorFactory(def.kind);
    if (factory) connector = await factory(def);
  }
  return connector && typeof connector.sync === "function" ? connector : null;
}

export function buildConnectorContext(root: string, dataset: Dataset, def: ConnectorDef, bag: Record<string, unknown> = {}, dryRun = false): ConnectorContext {
  return { ...makeContext(root, dataset, def.config ?? {}, bag, dryRun, def.name), def };
}

export async function runConnector(
  root: string,
  name: string,
  dataset?: Dataset,
  bag: Record<string, unknown> = {},
  def?: ConnectorDef
): Promise<ConnectorResult> {
  const connDef = def ?? { name, kind: name };
  const ds = dataset ?? new Dataset(root);
  const owned = !dataset;
  try {
    const connector = await resolveConnectorImpl(connDef, root);
    if (!connector) {
      return {
        connector: name, ingested: 0,
        errors: [connDef.module
          ? `module '${connDef.module}' did not export a valid connector`
          : `no implementation registered for kind '${connDef.kind}'`],
      };
    }
    const ctx = buildConnectorContext(root, ds, connDef, bag);
    return await connector.sync(ctx);
  } catch (e) {
    return { connector: name, ingested: 0, errors: [(e as Error).message] };
  } finally {
    if (owned) ds.close();
  }
}
