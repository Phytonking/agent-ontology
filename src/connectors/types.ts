import type { Dataset } from "../data/dataset.js";

/** Resumable cursor for incremental sync — persists between runs via the store. */
export interface Cursor {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface PipelineContext {
  root: string;
  dataset: Dataset;
  bag: Record<string, unknown>;
  config: Record<string, unknown>;
  /** Resumable cursor for incremental sync (persisted between runs). */
  cursor: Cursor;
  /** Read an env var (for secrets: tokens, keys, passwords). */
  env(key: string): string | undefined;
  /** Validated upsert. In dry-run mode, validates without persisting. */
  upsert(type: string, id: string | undefined, data: Record<string, unknown>, scope?: string): Promise<{ _id: string }>;
  /** True when running with --dry-run: validates but does not write. */
  dryRun: boolean;
}

export interface ConnectorDef {
  name: string;
  kind: string;
  module?: string;
  config?: Record<string, unknown>;
}

export interface ConnectorContext extends PipelineContext {
  def: ConnectorDef;
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

export interface Connector {
  sync(ctx: ConnectorContext): Promise<ConnectorResult>;
}

export type ConnectorFactory = (def: ConnectorDef) => Connector | Promise<Connector>;
export type Transform = (ctx: PipelineContext) => Promise<StepResult> | StepResult;
