import type { Dataset } from "../data/dataset.js";
import type { ConnectorFrontmatter } from "../types.js";

/** Base context shared by connectors and transforms (pipeline steps). */
export interface PipelineContext {
  root: string;
  /** The live dataset — writes go through validation + hooks + file write-back + oplog. */
  dataset: Dataset;
  /** Shared scratch state passed between steps of a pipeline. */
  bag: Record<string, unknown>;
  /** Non-secret config for this step. */
  config: Record<string, unknown>;
  /** Read an environment variable (for secrets). */
  env(key: string): string | undefined;
  /** Validated upsert into the ontology. Returns the stored record's id. */
  upsert(type: string, id: string | undefined, data: Record<string, unknown>, scope?: string): Promise<{ _id: string }>;
}

/** What a connector receives when it runs — a pipeline context plus its definition. */
export interface ConnectorContext extends PipelineContext {
  def: ConnectorFrontmatter;
}

export interface StepResult {
  step: string;
  kind: "connector" | "transform";
  processed: number;
  errors: string[];
  info?: Record<string, unknown>;
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

/** A transform: an arbitrary data-management step over the shared context. */
export type Transform = (ctx: PipelineContext) => Promise<StepResult> | StepResult;
