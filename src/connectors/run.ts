import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "../loader.js";
import { Dataset } from "../data/dataset.js";
import { getConnectorFactory } from "./registry.js";
import type { ConnectorFrontmatter } from "../types.js";
import type { Connector, ConnectorContext, ConnectorResult, PipelineContext } from "./types.js";

/**
 * Resolve a connector implementation:
 *   1. `module:` — dynamically imported (default-exports a Connector or factory).
 *   2. `kind` — looked up in the in-process registry.
 * Returns null if no implementation resolves.
 */
export async function resolveConnectorImpl(root: string, fm: ConnectorFrontmatter): Promise<Connector | null> {
  let connector: Connector | undefined;
  if (fm.module) {
    const abs = path.isAbsolute(fm.module) ? fm.module : path.join(root, fm.module);
    const mod = await import(pathToFileURL(abs).href);
    const exp = mod.default ?? mod.connector;
    connector = typeof exp === "function" ? await exp(fm) : exp;
  }
  if (!connector) {
    const factory = getConnectorFactory(fm.kind);
    if (factory) connector = await factory(fm);
  }
  return connector && typeof connector.sync === "function" ? connector : null;
}

/** Build a base pipeline context bound to a dataset (shared bag optional). */
export function makeContext(root: string, dataset: Dataset, config: Record<string, unknown>, bag: Record<string, unknown> = {}): PipelineContext {
  return {
    root,
    dataset,
    bag,
    config,
    env: (k) => process.env[k],
    upsert: async (type, id, data, scope) => {
      const rec = await dataset.put({ type, id, scope, data });
      return { _id: rec._id };
    },
  };
}

/**
 * Run a named connector. The connector writes through the Dataset, so every
 * ingested record is validated, hooked, written back to its data/ file, and
 * recorded in the oplog. Errors are reported, never thrown.
 */
export async function runConnector(
  root: string,
  name: string,
  dataset?: Dataset,
  bag: Record<string, unknown> = {}
): Promise<ConnectorResult> {
  const model = load(root);
  const def = model.connectors.get(name);
  if (!def) return { connector: name, ingested: 0, errors: [`connector '${name}' not found`] };
  const fm = def.frontmatter;

  const ds = dataset ?? new Dataset(root);
  const owned = !dataset;
  try {
    const connector = await resolveConnectorImpl(root, fm);
    if (!connector) {
      return {
        connector: name,
        ingested: 0,
        errors: [
          fm.module
            ? `module '${fm.module}' did not export a valid connector`
            : `no implementation registered for kind '${fm.kind}' — add a 'module:' path or call registerConnector('${fm.kind}', ...)`,
        ],
      };
    }
    const ctx: ConnectorContext = { ...makeContext(root, ds, (fm.config ?? {}) as Record<string, unknown>, bag), def: fm };
    return await connector.sync(ctx);
  } catch (e) {
    return { connector: name, ingested: 0, errors: [(e as Error).message] };
  } finally {
    if (owned) ds.close();
  }
}
