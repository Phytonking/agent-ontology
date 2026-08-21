import type { Dataset } from "../data/dataset.js";
import type { ConnectorFrontmatter } from "../types.js";

/** What a connector receives when it runs. */
export interface ConnectorContext {
  root: string;
  /** The live dataset — writes go through full validation + file write-back + oplog. */
  dataset: Dataset;
  /** The connector's own frontmatter definition. */
  def: ConnectorFrontmatter;
  /** Non-secret config from the connector file. */
  config: Record<string, unknown>;
  /** Read an environment variable (for secrets). */
  env(key: string): string | undefined;
  /**
   * Convenience: validated upsert into the ontology. Returns the stored record.
   * Equivalent to dataset.put but scoped to the connector for logging.
   */
  upsert(type: string, id: string | undefined, data: Record<string, unknown>, scope?: string): Promise<{ _id: string }>;
}

export interface ConnectorResult {
  connector: string;
  ingested: number;
  errors: string[];
  info?: Record<string, unknown>;
}

/** The connector contract. Implementations pull from a source and upsert records. */
export interface Connector {
  sync(ctx: ConnectorContext): Promise<ConnectorResult>;
}

/** A factory that builds a Connector from its definition (for parameterized connectors). */
export type ConnectorFactory = (def: ConnectorFrontmatter) => Connector | Promise<Connector>;
