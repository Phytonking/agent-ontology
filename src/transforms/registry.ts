import type { PipelineContext, StepResult, Transform } from "../connectors/types.js";

const registry = new Map<string, Transform>();

/** Register a reusable transform (data-management step) under a name. */
export function registerTransform(name: string, fn: Transform): void {
  registry.set(name, fn);
}

export function getTransform(name: string): Transform | undefined {
  return registry.get(name);
}

export function listTransformNames(): string[] {
  return [...registry.keys()];
}

/** Author a transform inline. */
export function defineTransform(fn: (ctx: PipelineContext) => Promise<StepResult> | StepResult): Transform {
  return fn;
}

export type { Transform, PipelineContext, StepResult };
