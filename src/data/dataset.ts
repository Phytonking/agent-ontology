import path from "node:path";
import { randomUUID } from "node:crypto";
import { load } from "../loader.js";
import type { Param, TypeDoc } from "../types.js";
import type { Rec } from "./record.js";
import { SqliteStore } from "./sqlite-store.js";

export interface InstanceProblem {
  field: string;
  message: string;
}

function checkScalar(field: string, spec: Param, v: unknown, problems: InstanceProblem[]): void {
  switch (spec.type) {
    case "enum":
      if (!(spec.values ?? []).includes(String(v))) {
        problems.push({ field, message: `not in enum [${(spec.values ?? []).join(", ")}]` });
      }
      break;
    case "int":
    case "float":
    case "money":
      if (typeof v !== "number") problems.push({ field, message: "expected number" });
      break;
    case "bool":
      if (typeof v !== "boolean") problems.push({ field, message: "expected boolean" });
      break;
    case "json":
      break; // any shape allowed
    default:
      if (typeof v !== "string") problems.push({ field, message: `expected ${spec.type} (string)` });
  }
}

/** Validate an instance against its type's property schema ("pydantic at the door"). */
export function validateInstance(type: TypeDoc, data: Record<string, unknown>): InstanceProblem[] {
  const problems: InstanceProblem[] = [];
  const props = type.frontmatter.properties ?? {};
  for (const [name, spec] of Object.entries(props)) {
    const v = data[name];
    if (v === undefined || v === null) {
      if (spec.required) problems.push({ field: name, message: "required" });
      continue;
    }
    if (spec.many) {
      if (!Array.isArray(v)) {
        problems.push({ field: name, message: "expected array (many)" });
        continue;
      }
      v.forEach((el, i) => checkScalar(`${name}[${i}]`, spec, el, problems));
    } else {
      checkScalar(name, spec, v, problems);
    }
  }
  return problems;
}

/** Open the native store for an ontology folder. */
export function openStore(root: string): SqliteStore {
  const model = load(root);
  return new SqliteStore(path.join(root, ".ontology", "data.db"), model.config.name);
}

/**
 * High-level data API bound to one ontology folder: validated writes (with
 * natural-key upsert + uniqueness), reads, and link traversal across all
 * cardinalities. The ontology model is re-read per call so instance ops see
 * types the agent just created.
 */
export class Dataset {
  readonly root: string;
  readonly store: SqliteStore;

  constructor(root: string) {
    this.root = root;
    const model = load(root);
    this.store = new SqliteStore(path.join(root, ".ontology", "data.db"), model.config.name);
  }

  private typeDoc(name: string): TypeDoc {
    const t = load(this.root).types.get(name);
    if (!t) throw new Error(`unknown type '${name}'`);
    return t;
  }

  async put(input: { type: string; id?: string; scope?: string; data: Record<string, unknown> }): Promise<Rec> {
    const type = this.typeDoc(input.type);
    const problems = validateInstance(type, input.data);
    if (problems.length) {
      throw new Error(`invalid ${input.type}: ${problems.map((p) => `${p.field} ${p.message}`).join("; ")}`);
    }

    const scope = input.scope ?? "shared";
    const props = type.frontmatter.properties ?? {};
    const keys = type.frontmatter.keys ?? [];
    const uniqueProps = Object.entries(props)
      .filter(([, s]) => s.unique)
      .map(([n]) => n);

    // Identity: explicit id > natural-key match (upsert) > generated.
    let id = input.id;
    if (!id && keys.length && keys.every((k) => input.data[k] != null)) {
      const filter = Object.fromEntries(keys.map((k) => [k, input.data[k]]));
      const found = await this.store.query(input.type, filter, { scope });
      if (found.length) id = found[0]._id;
    }
    id = id ?? randomUUID();

    // Uniqueness: natural key + any unique property must not collide with a different id.
    const checks: { label: string; filter: Record<string, unknown> }[] = [];
    if (keys.length && keys.every((k) => input.data[k] != null)) {
      checks.push({ label: `keys(${keys.join(",")})`, filter: Object.fromEntries(keys.map((k) => [k, input.data[k]])) });
    }
    for (const up of uniqueProps) {
      if (input.data[up] != null) checks.push({ label: up, filter: { [up]: input.data[up] } });
    }
    for (const c of checks) {
      const hits = (await this.store.query(input.type, c.filter, { scope })).filter((r) => r._id !== id);
      if (hits.length) throw new Error(`unique conflict on ${c.label}: already used by ${input.type}/${hits[0]._id}`);
    }

    return this.store.upsert({ type: input.type, id, scope, data: input.data });
  }

  get(type: string, id: string, scope?: string): Promise<Rec | null> {
    this.typeDoc(type);
    return this.store.get(type, id, scope);
  }

  query(type: string, filter?: Record<string, unknown>, scope?: string): Promise<Rec[]> {
    this.typeDoc(type);
    return this.store.query(type, filter, { scope });
  }

  search(type: string, q: string, scope?: string): Promise<Rec[]> {
    this.typeDoc(type);
    return this.store.search(type, q, { scope });
  }

  /** Follow a link across any cardinality: one (self fk), many/1:N (target fk), many/N:M (through join). */
  async traverse(type: string, id: string, linkName: string, scope?: string) {
    const t = this.typeDoc(type);
    const link = (t.frontmatter.links ?? {})[linkName];
    if (!link) throw new Error(`type '${type}' has no link '${linkName}'`);

    // many-to-many via a join type
    if (link.through) {
      if (!link.through_from || !link.through_to) {
        throw new Error(`link '${linkName}' uses 'through' but is missing through_from / through_to`);
      }
      const joins = await this.store.query(link.through, { [link.through_from]: id }, { scope });
      const results: Rec[] = [];
      for (const j of joins) {
        const targetId = j.data[link.through_to];
        const rec = targetId != null ? await this.store.get(link.to, String(targetId), scope) : null;
        if (rec) results.push(rec);
      }
      return { link: linkName, to: link.to, cardinality: "many", through: link.through, results };
    }

    const cardinality = link.cardinality ?? "one";
    if (cardinality === "one") {
      if (!link.via) throw new Error(`link '${linkName}' has no 'via' field to traverse`);
      const rec = await this.store.get(type, id, scope);
      const targetId = rec?.data[link.via];
      const target = targetId != null ? await this.store.get(link.to, String(targetId), scope) : null;
      return { link: linkName, to: link.to, cardinality, results: target ? [target] : [] };
    }

    // one-to-many: the foreign key lives on the target
    if (!link.via) throw new Error(`link '${linkName}' has no 'via' field to traverse`);
    const results = await this.store.query(link.to, { [link.via]: id }, { scope });
    return { link: linkName, to: link.to, cardinality, results };
  }

  close(): void {
    this.store.close();
  }
}
