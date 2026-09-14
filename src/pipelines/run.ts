import path from "node:path";
import { pathToFileURL } from "node:url";
import { Dataset } from "../data/dataset.js";
import { resolveConnectorImpl, makeContext, buildConnectorContext } from "../connectors/run.js";
import { getTransform } from "../transforms/registry.js";
import type { StepResult, Transform, ConnectorDef } from "../connectors/types.js";

export interface PipelineStepDef {
  connector?: string;
  transform?: string;
  module?: string;
  config?: Record<string, unknown>;
  connectorDef?: ConnectorDef;
}

export interface PipelineResult {
  pipeline: string;
  steps: StepResult[];
  errors: string[];
}

async function loadTransformModule(root: string, modulePath: string): Promise<Transform | null> {
  const abs = path.isAbsolute(modulePath) ? modulePath : path.join(root, modulePath);
  const mod = await import(pathToFileURL(abs).href);
  const exp = mod.default ?? mod.transform;
  return typeof exp === "function" ? (exp as Transform) : null;
}

export async function runPipeline(
  root: string,
  name: string,
  steps: PipelineStepDef[],
  dataset?: Dataset
): Promise<PipelineResult> {
  const ds = dataset ?? new Dataset(root);
  const owned = !dataset;
  const bag: Record<string, unknown> = {};
  const results: StepResult[] = [];
  const errors: string[] = [];

  try {
    for (const step of steps) {
      const stepConfig = step.config ?? {};

      if (step.connector) {
        const def = step.connectorDef ?? { name: step.connector, kind: step.connector, module: step.module, config: stepConfig };
        const impl = await resolveConnectorImpl(def, root);
        if (!impl) { results.push({ step: step.connector, kind: "connector", processed: 0, errors: [`no implementation for '${step.connector}'`] }); continue; }
        const ctx = buildConnectorContext(root, ds, def, bag);
        try {
          const r = await impl.sync(ctx);
          results.push({ step: step.connector, kind: "connector", processed: r.ingested, errors: r.errors });
        } catch (e) { results.push({ step: step.connector, kind: "connector", processed: 0, errors: [(e as Error).message] }); }
        continue;
      }

      const tName = step.transform!;
      const transform: Transform | null | undefined = step.module ? await loadTransformModule(root, step.module) : getTransform(tName);
      if (!transform) { results.push({ step: tName, kind: "transform", processed: 0, errors: [step.module ? `module did not export a transform` : `transform '${tName}' not registered`] }); continue; }
      const ctx = makeContext(root, ds, stepConfig, bag);
      try { results.push(await transform(ctx)); } catch (e) { results.push({ step: tName, kind: "transform", processed: 0, errors: [(e as Error).message] }); }
    }
  } finally { if (owned) ds.close(); }

  for (const s of results) for (const e of s.errors) errors.push(`${s.step}: ${e}`);
  return { pipeline: name, steps: results, errors };
}
