import type { Dataset } from "../data/dataset.js";

export interface PipelineContext {
  root: string;
  dataset: Dataset;
  bag: Record<string, unknown>;
  config: Record<string, unknown>;
  env(key: string): string | undefined;
  upsert(type: string, id: string | undefined, data: Record<string, unknown>, scope?: string): Promise<{ _id: string }>;
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
