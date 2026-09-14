import { load } from "../loader.js";
import { validateInstance, Dataset } from "./dataset.js";
import { checkTransition } from "../infer.js";
import type { Rec } from "./record.js";

export interface ActionResult {
  action: string;
  status: "ok" | "rejected";
  reason?: string;
  record?: Rec;
}

function parseEffect(effect: string): { field: string; value: string } | null {
  const m = effect.match(/^set\s+(\w+)\s*=\s*(.+)$/);
  if (!m) return null;
  return { field: m[1].trim(), value: m[2].trim() };
}

export async function runAction(
  root: string,
  name: string,
  args: Record<string, unknown>,
  scope = "shared",
  sharedDataset?: Dataset
): Promise<ActionResult> {
  const model = load(root);
  const actionDoc = model.actions.get(name);
  if (!actionDoc) return { action: name, status: "rejected", reason: `action '${name}' not found` };

  const def = actionDoc.def;
  const targetType = actionDoc.on;
  const dataset = sharedDataset ?? new Dataset(root);
  const ownsDataset = !sharedDataset;

  try {
    // validate inputs
    if (def.inputs) {
      const dummyType = { name, properties: def.inputs, links: {}, constraints: [], keys: [] };
      const problems = validateInstance(dummyType, args);
      if (problems.length)
        return { action: name, status: "rejected", reason: `invalid inputs: ${problems.map((p) => `${p.field} ${p.message}`).join("; ")}` };
    }

    // load target record
    const idField = def.inputs && Object.keys(def.inputs).find((k) => k.endsWith("_id") || k === "id");
    const targetId = idField ? String(args[idField] ?? "") : null;
    let record: Rec | null = null;
    if (targetType && targetId) {
      record = await dataset.store.get(targetType, targetId, scope);
      if (!record) return { action: name, status: "rejected", reason: `${targetType}/${targetId} not found` };
    }

    // check preconditions
    for (const pre of def.preconditions ?? []) {
      const inMatch = pre.match(/^(\w+)\s+in\s+\[([^\]]+)\]$/);
      if (inMatch && record) {
        const [, field, vals] = inMatch;
        const allowed = vals.split(",").map((v) => v.trim());
        if (!allowed.includes(String(record.data[field] ?? "")))
          return { action: name, status: "rejected", reason: `precondition failed: ${pre} (current: ${field}=${record.data[field]})` };
        continue;
      }
    }

    if (!record || !targetType)
      return { action: name, status: "rejected", reason: "action requires a target type and id input" };

    // apply effects
    const newData = { ...record.data };
    for (const effect of def.effects ?? []) {
      const parsed = parseEffect(effect);
      if (!parsed) continue;
      const type = model.types.get(targetType);
      const propSpec = type?.properties[parsed.field];
      if (propSpec?.type === "enum" && propSpec.transitions) {
        const err = checkTransition(parsed.field, propSpec.transitions, newData[parsed.field], parsed.value);
        if (err) return { action: name, status: "rejected", reason: err };
      }
      newData[parsed.field] = parsed.value;
    }

    const result = await dataset.put({ type: targetType, id: targetId ?? undefined, scope, data: newData });
    return { action: name, status: "ok", record: result };
  } finally {
    if (ownsDataset) dataset.close();
  }
}
