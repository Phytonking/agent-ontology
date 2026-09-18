import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { paths } from "./paths.js";
import { load } from "./loader.js";
import { validate as validateModel } from "./validator.js";
import { commit } from "./git.js";
import { ObjectFileSchema, type ObjectFileSchema as OFS, type ActionDef, type LinkDef, type PropertyDef, type Constraint, type Problem } from "./types.js";

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function writeObjectFile(root: string, obj: OFS, body: string): string {
  ObjectFileSchema.parse(obj);
  const file = paths(root).objectFile(obj.object);
  fs.writeFileSync(file, matter.stringify(`\n${body.trim()}\n`, obj as Record<string, unknown>));
  return file;
}

function loadRaw(root: string, name: string): { fm: Record<string, unknown>; body: string; file: string } {
  const file = paths(root).objectFile(name);
  if (!fs.existsSync(file)) throw new Error(`object '${name}' not found`);
  const raw = matter(fs.readFileSync(file, "utf8"));
  return { fm: raw.data as Record<string, unknown>, body: raw.content, file };
}

// ---- read ----

export function listObjects(root: string) {
  const model = load(root);
  return [...model.objects.values()].map((o) => ({
    name: o.name,
    properties: Object.keys(o.schema.properties ?? {}),
    links: Object.keys(o.schema.links ?? {}),
    actions: Object.keys(o.schema.actions ?? {}),
  }));
}

export function readObject(root: string, name: string) {
  const model = load(root);
  const obj = model.objects.get(name);
  if (!obj) throw new Error(`object '${name}' not found`);
  return { name, schema: obj.schema, body: obj.body, file: path.relative(root, obj.file) };
}

// ---- create ----

export interface CreateObjectInput {
  name: string;
  description?: string;
  keys?: string[];
  properties?: Record<string, PropertyDef>;
  links?: Record<string, LinkDef>;
  actions?: Record<string, ActionDef>;
  constraints?: Constraint[];
}

export function createObject(root: string, input: CreateObjectInput) {
  if (!NAME_RE.test(input.name)) throw new Error(`invalid object name '${input.name}'`);
  const file = paths(root).objectFile(input.name);
  if (fs.existsSync(file)) throw new Error(`object '${input.name}' already exists`);

  const obj: Record<string, unknown> = { object: input.name };
  if (input.keys?.length) obj.keys = input.keys;
  if (input.properties && Object.keys(input.properties).length) obj.properties = input.properties;
  if (input.links && Object.keys(input.links).length) obj.links = input.links;
  if (input.actions && Object.keys(input.actions).length) obj.actions = input.actions;
  if (input.constraints?.length) obj.constraints = input.constraints;

  const body = `# ${input.name}\n\n${input.description ?? "TODO: describe what this object means — context, rules, examples."}`;
  writeObjectFile(root, obj as OFS, body);
  const c = commit(root, [file], `create object ${input.name}`);
  return { created: input.name, file: path.relative(root, file), ...c };
}

// ---- edit ----

export function addProperty(root: string, objectName: string, propName: string, spec: PropertyDef) {
  if (!NAME_RE.test(propName)) throw new Error(`invalid property name '${propName}'`);
  const { fm, body, file } = loadRaw(root, objectName);
  const props = (fm.properties as Record<string, unknown>) ?? {};
  if (props[propName]) throw new Error(`property '${propName}' already exists on ${objectName}`);
  props[propName] = spec;
  fm.properties = props;
  writeObjectFile(root, fm as OFS, body);
  const c = commit(root, [file], `add property ${objectName}.${propName}`);
  return { object: objectName, property: propName, ...c };
}

export function addLink(root: string, objectName: string, linkName: string, spec: LinkDef) {
  if (!NAME_RE.test(linkName)) throw new Error(`invalid link name '${linkName}'`);
  const { fm, body, file } = loadRaw(root, objectName);
  const links = (fm.links as Record<string, unknown>) ?? {};
  if (links[linkName]) throw new Error(`link '${linkName}' already exists on ${objectName}`);
  links[linkName] = spec;
  fm.links = links;
  writeObjectFile(root, fm as OFS, body);
  const c = commit(root, [file], `add link ${objectName}.${linkName}`);
  return { object: objectName, link: linkName, ...c };
}

export function addAction(root: string, objectName: string, actionName: string, def: ActionDef) {
  if (!NAME_RE.test(actionName)) throw new Error(`invalid action name '${actionName}'`);
  const { fm, body, file } = loadRaw(root, objectName);
  const actions = (fm.actions as Record<string, unknown>) ?? {};
  if (actions[actionName]) throw new Error(`action '${actionName}' already exists on ${objectName}`);
  actions[actionName] = def;
  fm.actions = actions;
  writeObjectFile(root, fm as OFS, body);
  const c = commit(root, [file], `add action ${objectName}.${actionName}`);
  return { object: objectName, action: actionName, ...c };
}

export function addConstraint(root: string, objectName: string, constraint: Constraint) {
  const { fm, body, file } = loadRaw(root, objectName);
  const constraints = (fm.constraints as Constraint[]) ?? [];
  constraints.push(constraint);
  fm.constraints = constraints;
  writeObjectFile(root, fm as OFS, body);
  const c = commit(root, [file], `add constraint on ${objectName}`);
  return { object: objectName, constraint, ...c };
}

export function updateObjectDoc(root: string, objectName: string, newBody: string) {
  const { fm, file } = loadRaw(root, objectName);
  writeObjectFile(root, fm as OFS, newBody);
  const c = commit(root, [file], `update doc ${objectName}`);
  return { object: objectName, ...c };
}

// ---- validate ----

export function validate(root: string): { ok: boolean; problems: Problem[] } {
  const problems = validateModel(load(root));
  return { ok: !problems.some((p) => p.level === "error"), problems };
}
