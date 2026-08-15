import path from "node:path";
import { randomUUID } from "node:crypto";
import { load } from "../loader.js";
import { checkConstraints, checkPropertyConstraints } from "../validator.js";
import { checkTransition, transitiveClosure, symmetricTargets } from "../infer.js";
import type { Param, TypeDoc } from "../types.js";
import type { Rec } from "./record.js";
import { SqliteStore } from "./sqlite-store.js";

export interface InstanceProblem { field: string; message: string; }

function checkScalar(field: string, spec: Param, v: unknown, problems: InstanceProblem[]): void {
  switch (spec.type) {
    case "enum":
      if (!(spec.values ?? []).includes(String(v)))
        problems.push({ field, message: `not in enum [${(spec.values ?? []).join(", ")}]` });
      break;
    case "int":
    case "float":
    case "money":
      if (typeof v !== "number") { problems.push({ field, message: "expected number" }); break; }
      for (const e of checkPropertyConstraints(field, spec, v)) problems.push({ field, message: e.replace(`${field}: `, "") });
      break;
    case "bool":
      if (typeof v !== "boolean") problems.push({ field, message: "expected boolean" });
      break;
    case "json": break;
    default:
      if (typeof v !== "string") { problems.push({ field, message: `expected ${spec.type} (string)` }); break; }
      for (const e of checkPropertyConstraints(field, spec, v)) problems.push({ field, message: e.replace(`${field}: `, "") });
  }
}

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
      if (!Array.isArray(v)) { problems.push({ field: name, message: "expected array (many)" }); continue; }
      v.forEach((el, i) => checkScalar(`${name}[${i}]`, spec, el, problems));
    } else {
      checkScalar(name, spec, v, problems);
    }
  }
  return problems;
}

export function openStore(root: string): SqliteStore {
  const model = load(root);
  return new SqliteStore(path.join(root, ".ontology", "data.db"), model.config.name);
}

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
    const scope = input.scope ?? "shared";
    const props = type.frontmatter.properties ?? {};

    // --- shape validation ---
    const shapeProblem = validateInstance(type, input.data);
    if (shapeProblem.length) throw new Error(`invalid ${input.type}: ${shapeProblem.map((p) => `${p.field} ${p.message}`).join("; ")}`);

    // --- constraint checks ---
    const typeNames = new Set(load(this.root).types.keys());
    const constraintErrors = checkConstraints(type.frontmatter, input.data, typeNames);
    if (constraintErrors.length) throw new Error(`constraint violation on ${input.type}: ${constraintErrors.join("; ")}`);

    // --- identity ---
    const keys = type.frontmatter.keys ?? [];
    const uniqueProps = Object.entries(props).filter(([, s]) => s.unique).map(([n]) => n);
    let id = input.id;
    if (!id && keys.length && keys.every((k) => input.data[k] != null)) {
      const filter = Object.fromEntries(keys.map((k) => [k, input.data[k]]));
      const found = await this.store.query(input.type, filter, { scope });
      if (found.length) id = found[0]._id;
    }
    id = id ?? randomUUID();

    // --- state-machine transition check (existing record) ---
    const prev = await this.store.get(input.type, id, scope);
    if (prev) {
      for (const [pName, spec] of Object.entries(props)) {
        if (spec.type === "enum" && spec.transitions) {
          const err = checkTransition(pName, spec.transitions, prev.data[pName], input.data[pName]);
          if (err) throw new Error(err);
        }
      }
    }

    // --- uniqueness ---
    const checks: { label: string; filter: Record<string, unknown> }[] = [];
    if (keys.length && keys.every((k) => input.data[k] != null))
      checks.push({ label: `keys(${keys.join(",")})`, filter: Object.fromEntries(keys.map((k) => [k, input.data[k]])) });
    for (const up of uniqueProps)
      if (input.data[up] != null) checks.push({ label: up, filter: { [up]: input.data[up] } });
    for (const c of checks) {
      const hits = (await this.store.query(input.type, c.filter, { scope })).filter((r) => r._id !== id);
      if (hits.length) throw new Error(`unique conflict on ${c.label}: already used by ${input.type}/${hits[0]._id}`);
    }

    return this.store.upsert({ type: input.type, id, scope, data: input.data });
  }

  get(type: string, id: string, scope?: string): Promise<Rec | null> {
    this.typeDoc(type); return this.store.get(type, id, scope);
  }

  query(type: string, filter?: Record<string, unknown>, scope?: string): Promise<Rec[]> {
    this.typeDoc(type); return this.store.query(type, filter, { scope });
  }

  search(type: string, q: string, scope?: string): Promise<Rec[]> {
    this.typeDoc(type); return this.store.search(type, q, { scope });
  }

  async traverse(type: string, id: string, linkName: string, scope = "shared") {
    const t = this.typeDoc(type);
    const link = (t.frontmatter.links ?? {})[linkName];
    if (!link) throw new Error(`type '${type}' has no link '${linkName}'`);

    // N:M through join type
    if (link.through) {
      if (!link.through_from || !link.through_to)
        throw new Error(`link '${linkName}' uses 'through' but is missing through_from / through_to`);
      const joins = await this.store.query(link.through, { [link.through_from]: id }, { scope });
      const results: Rec[] = [];
      for (const j of joins) {
        const tid = j.data[link.through_to];
        const rec = tid != null ? await this.store.get(link.to, String(tid), scope) : null;
        if (rec) results.push(rec);
      }
      return { link: linkName, to: link.to, cardinality: "many", through: link.through, results };
    }

    const cardinality = link.cardinality ?? "one";
    let results: Rec[] = [];

    if (cardinality === "one") {
      if (!link.via) throw new Error(`link '${linkName}' has no 'via' field to traverse`);
      const rec = await this.store.get(type, id, scope);
      const targetId = rec?.data[link.via];
      const target = targetId != null ? await this.store.get(link.to, String(targetId), scope) : null;
      results = target ? [target] : [];
    } else {
      if (!link.via) throw new Error(`link '${linkName}' has no 'via' field to traverse`);
      results = await this.store.query(link.to, { [link.via]: id }, { scope });
    }

    // apply relationship characteristics
    if (link.transitive && results.length) {
      const seen = new Set(results.map((r) => r._id));
      seen.add(id);
      for (const r of [...results]) {
        const more = await transitiveClosure(this.store, link.to, r._id, link, scope, seen);
        results.push(...more);
      }
    }
    if (link.symmetric) {
      const back = await symmetricTargets(this.store, type, id, link, scope);
      const seen = new Set(results.map((r) => r._id));
      for (const r of back) if (!seen.has(r._id)) results.push(r);
    }

    return { link: linkName, to: link.to, cardinality, results };
  }

  close(): void { this.store.close(); }
}
