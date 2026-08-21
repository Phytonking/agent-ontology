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

/**
 * Minimal effect grammar. Supported forms:
 *   set <field> = <literal>      e.g. "set status = refunded"
 *   set <field> = <field2>       (copy another field — not yet used)
 * All other effect strings are logged but not executed.
 */
function parseEffect(effect: string): { field: string; value: string } | null {
  const m = effect.match(/^set\s+(\w+)\s*=\s*(.+)$/);
  if (!m) return null;
  return { field: m[1].trim(), value: m[2].trim() };
}

/**
 * Execute a named action against a target record.
 *
 * @param root   - ontology root directory.
 * @param name   - action name (matches action file).
 * @param args   - runtime inputs (validated against inputs schema).
 * @param scope  - data scope (default: "shared").
 */
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

  const fm = actionDoc.frontmatter;
  const dataset = sharedDataset ?? new Dataset(root);
  const ownsDataset = !sharedDataset;

  try {
    // 1. Validate inputs
    if (fm.inputs) {
      const dummyType = { name: name, frontmatter: { type: name, properties: fm.inputs }, body: "", file: "" };
      const problems = validateInstance(dummyType as any, args);
      if (problems.length) {
        return { action: name, status: "rejected", reason: `invalid inputs: ${problems.map((p) => `${p.field} ${p.message}`).join("; ")}` };
      }
    }

    // 2. Load the target record (if action declares `on`)
    const targetType = fm.on;
    const targetIdField = fm.inputs && Object.keys(fm.inputs).find((k) => k.endsWith("_id") || k === "id");
    const targetId = targetIdField ? String(args[targetIdField] ?? "") : null;
    let record: Rec | null = null;
    if (targetType && targetId) {
      record = await dataset.store.get(targetType, targetId, scope);
      if (!record) {
        return { action: name, status: "rejected", reason: `${targetType}/${targetId} not found` };
      }
    }

    // 3. Check preconditions (simple string matching against current record state)
    for (const pre of fm.preconditions ?? []) {
      // form: "<field> in [v1, v2, ...]"
      const inMatch = pre.match(/^(\w+)\s+in\s+\[([^\]]+)\]$/);
      if (inMatch && record) {
        const [, field, vals] = inMatch;
        const allowed = vals.split(",").map((v) => v.trim());
        const cur = String(record.data[field] ?? "");
        if (!allowed.includes(cur)) {
          return { action: name, status: "rejected", reason: `precondition failed: ${pre} (current: ${field}=${cur})` };
        }
        continue;
      }
      // form: "<field> = <value>"
      const eqMatch = pre.match(/^(\w+)\s*=\s*(.+)$/);
      if (eqMatch && record) {
        const [, field, val] = eqMatch;
        if (String(record.data[field] ?? "") !== val.trim()) {
          return { action: name, status: "rejected", reason: `precondition failed: ${pre}` };
        }
        continue;
      }
    }

    // 4. Build the new data by applying effects
    if (!record || !targetType) {
      return { action: name, status: "rejected", reason: "action requires 'on' type and a target id input to apply effects" };
    }

    const newData = { ...record.data };
    for (const effect of fm.effects ?? []) {
      const parsed = parseEffect(effect);
      if (!parsed) continue;
      // Check state-machine transition before applying
      const targetTypeDoc = model.types.get(targetType);
      const propSpec = targetTypeDoc?.frontmatter.properties?.[parsed.field];
      if (propSpec?.type === "enum" && propSpec.transitions) {
        const err = checkTransition(parsed.field, propSpec.transitions, newData[parsed.field], parsed.value);
        if (err) return { action: name, status: "rejected", reason: err };
      }
      newData[parsed.field] = parsed.value;
    }

    // 5. Write (goes through full dataset.put validation)
    const result = await dataset.put({ type: targetType, id: targetId ?? undefined, scope, data: newData });
    return { action: name, status: "ok", record: result };
  } finally {
    if (ownsDataset) dataset.close();
  }
}
