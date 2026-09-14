import path from "node:path";
import { pathToFileURL } from "node:url";
import { Dataset } from "../data/dataset.js";
import { getConnectorFactory } from "./registry.js";
import type { Connector, ConnectorContext, ConnectorDef, ConnectorResult, PipelineContext } from "./types.js";

export function makeContext(root: string, dataset: Dataset, config: Record<string, unknown>, bag: Record<string, unknown> = {}): PipelineContext {
  return {
    root, dataset, bag, config,
    env: (k) => process.env[k],
    upsert: async (type, id, data, scope) => {
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

export function buildConnectorContext(root: string, dataset: Dataset, def: ConnectorDef, bag: Record<string, unknown> = {}): ConnectorContext {
  return { ...makeContext(root, dataset, def.config ?? {}, bag), def };
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
