import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "../loader.js";
import { Dataset } from "../data/dataset.js";
import { getConnectorFactory } from "./registry.js";
import type { Connector, ConnectorContext, ConnectorResult } from "./types.js";

/**
 * Run a named connector. Resolution order:
 *   1. `module:` in the connector file — dynamically imported (link a connector
 *      without touching core). The module default-exports a Connector or a factory.
 *   2. `kind` — looked up in the in-process registry (registerConnector).
 *
 * The connector writes through the Dataset, so every ingested record is validated,
 * written back to its data/ file, and recorded in the oplog.
 */
export async function runConnector(root: string, name: string, dataset?: Dataset): Promise<ConnectorResult> {
  const model = load(root);
  const def = model.connectors.get(name);
  if (!def) return { connector: name, ingested: 0, errors: [`connector '${name}' not found`] };
  const fm = def.frontmatter;

  const ds = dataset ?? new Dataset(root);
  const owned = !dataset;

  try {
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

    if (!connector || typeof connector.sync !== "function") {
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

    const ctx: ConnectorContext = {
      root,
      dataset: ds,
      def: fm,
      config: (fm.config ?? {}) as Record<string, unknown>,
      env: (k) => process.env[k],
      upsert: async (type, id, data, scope) => {
        const rec = await ds.put({ type, id, scope, data });
        return { _id: rec._id };
      },
    };

    return await connector.sync(ctx);
  } catch (e) {
    return { connector: name, ingested: 0, errors: [(e as Error).message] };
  } finally {
    if (owned) ds.close();
  }
}
