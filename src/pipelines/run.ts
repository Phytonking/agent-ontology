import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "../loader.js";
import { Dataset } from "../data/dataset.js";
import { resolveConnectorImpl, makeContext, buildConnectorContext } from "../connectors/run.js";
import { getTransform } from "../transforms/registry.js";
import type { StepResult, Transform } from "../connectors/types.js";

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

/**
 * Run a pipeline: execute its steps in order, threading a shared `bag` so steps
 * hand off state. Each step (connector or transform) writes through the Dataset
 * (validation + hooks + file write-back + oplog). A failing step is recorded and
 * the pipeline continues; nothing throws.
 */
export async function runPipeline(root: string, name: string, dataset?: Dataset): Promise<PipelineResult> {
  const model = load(root);
  const def = model.pipelines.get(name);
  if (!def) return { pipeline: name, steps: [], errors: [`pipeline '${name}' not found`] };

  const ds = dataset ?? new Dataset(root);
  const owned = !dataset;
  const bag: Record<string, unknown> = {};
  const steps: StepResult[] = [];
  const errors: string[] = [];

  try {
    for (const step of def.frontmatter.steps) {
      const stepConfig = (step.config ?? {}) as Record<string, unknown>;

      if (step.connector) {
        const cdef = model.connectors.get(step.connector);
        if (!cdef) {
          steps.push({ step: step.connector, kind: "connector", processed: 0, errors: [`connector '${step.connector}' not found`] });
          continue;
        }
        const merged = { ...cdef.frontmatter, config: { ...(cdef.frontmatter.config ?? {}), ...stepConfig } };
        const impl = await resolveConnectorImpl(root, merged);
        if (!impl) {
          steps.push({ step: step.connector, kind: "connector", processed: 0, errors: [`no implementation for connector '${step.connector}'`] });
          continue;
        }
        const ctx = buildConnectorContext(root, ds, merged, bag);
        try {
          const r = await impl.sync(ctx);
          steps.push({ step: step.connector, kind: "connector", processed: r.ingested, errors: r.errors, info: r.info });
        } catch (e) {
          steps.push({ step: step.connector, kind: "connector", processed: 0, errors: [(e as Error).message] });
        }
        continue;
      }

      // transform step
      const tName = step.transform!;
      let transform: Transform | null | undefined = step.module ? await loadTransformModule(root, step.module) : getTransform(tName);
      if (!transform) {
        steps.push({ step: tName, kind: "transform", processed: 0, errors: [step.module ? `module '${step.module}' did not export a transform` : `transform '${tName}' not registered`] });
        continue;
      }
      const ctx = makeContext(root, ds, stepConfig, bag);
      try {
        const r = await transform(ctx);
        steps.push({ ...r, step: r.step ?? tName, kind: "transform" });
      } catch (e) {
        steps.push({ step: tName, kind: "transform", processed: 0, errors: [(e as Error).message] });
      }
    }
  } finally {
    if (owned) ds.close();
  }

  for (const s of steps) for (const e of s.errors) errors.push(`${s.step}: ${e}`);
  return { pipeline: name, steps, errors };
}
