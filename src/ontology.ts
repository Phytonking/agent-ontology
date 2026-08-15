import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { paths } from "./paths.js";
import { renderType, renderAction } from "./serialize.js";
import { load } from "./loader.js";
import { validate as validateModel } from "./validator.js";
import { commit } from "./git.js";
import {
  ActionFrontmatter,
  ConstraintSchema,
  LinkSchema,
  ParamSchema,
  TypeFrontmatter,
  type Constraint,
  type Link,
  type Param,
  type Problem,
} from "./types.js";

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function ensureDirs(root: string) {
  const p = paths(root);
  fs.mkdirSync(p.typesDir, { recursive: true });
  fs.mkdirSync(p.actionsDir, { recursive: true });
}

/** Validate frontmatter shape, then write the type file. Throws on invalid shape. */
function writeTypeFile(root: string, fm: unknown, body: string): string {
  const parsed = TypeFrontmatter.parse(fm);
  const file = paths(root).typeFile(parsed.type);
  fs.writeFileSync(file, renderType(parsed, body));
  return file;
}

function readTypeFile(root: string, name: string): { fm: Record<string, unknown>; body: string; file: string } {
  const file = paths(root).typeFile(name);
  if (!fs.existsSync(file)) throw new Error(`type '${name}' not found`);
  const raw = matter(fs.readFileSync(file, "utf8"));
  return { fm: raw.data as Record<string, unknown>, body: raw.content, file };
}

// ---- read ----

export function listTypes(root: string) {
  const model = load(root);
  return [...model.types.values()].map((t) => ({
    name: t.name,
    properties: Object.keys(t.frontmatter.properties ?? {}),
    links: Object.keys(t.frontmatter.links ?? {}),
    constraints: (t.frontmatter.constraints ?? []).length,
  }));
}

export function readType(root: string, name: string) {
  const { fm, body, file } = readTypeFile(root, name);
  return { name, frontmatter: fm, body, file: path.relative(root, file) };
}

// ---- edit: types ----

export interface CreateTypeInput {
  name: string;
  description?: string;
  keys?: string[];
  properties?: Record<string, Param>;
  links?: Record<string, Link>;
  constraints?: Constraint[];
}

export function createType(root: string, input: CreateTypeInput) {
  if (!NAME_RE.test(input.name)) throw new Error(`invalid type name '${input.name}'`);
  ensureDirs(root);
  const file = paths(root).typeFile(input.name);
  if (fs.existsSync(file)) throw new Error(`type '${input.name}' already exists`);

  const fm = {
    type: input.name,
    ...(input.keys ? { keys: input.keys } : {}),
    ...(input.properties ? { properties: input.properties } : {}),
    ...(input.links ? { links: input.links } : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
  };
  const body = `# ${input.name}\n\n${input.description ?? "TODO: describe this type — what it means, examples, rules."}`;
  writeTypeFile(root, fm, body);
  const c = commit(root, [file], `create type ${input.name}`);
  return { created: input.name, file: path.relative(root, file), ...c };
}

export function addProperty(root: string, typeName: string, propName: string, spec: Param) {
  if (!NAME_RE.test(propName)) throw new Error(`invalid property name '${propName}'`);
  ParamSchema.parse(spec);
  const { fm, body, file } = readTypeFile(root, typeName);
  const properties = (fm.properties as Record<string, Param>) ?? {};
  if (properties[propName]) throw new Error(`property '${propName}' already exists on ${typeName}`);
  properties[propName] = spec;
  fm.properties = properties;
  writeTypeFile(root, fm, body);
  const c = commit(root, [file], `add property ${typeName}.${propName}`);
  return { type: typeName, property: propName, ...c };
}

export function addLink(root: string, typeName: string, linkName: string, spec: Link) {
  if (!NAME_RE.test(linkName)) throw new Error(`invalid link name '${linkName}'`);
  const parsed = LinkSchema.parse(spec);
  const { fm, body, file } = readTypeFile(root, typeName);
  const links = (fm.links as Record<string, Link>) ?? {};
  if (links[linkName]) throw new Error(`link '${linkName}' already exists on ${typeName}`);
  links[linkName] = parsed;
  fm.links = links;
  writeTypeFile(root, fm, body);
  const c = commit(root, [file], `add link ${typeName}.${linkName}`);
  return { type: typeName, link: linkName, ...c };
}

export function addConstraint(root: string, typeName: string, constraint: Constraint) {
  const parsed = ConstraintSchema.parse(constraint);
  const { fm, body, file } = readTypeFile(root, typeName);
  const constraints = (fm.constraints as Constraint[]) ?? [];
  constraints.push(parsed);
  fm.constraints = constraints;
  writeTypeFile(root, fm, body);
  const c = commit(root, [file], `add constraint on ${typeName}`);
  return { type: typeName, constraint: parsed, ...c };
}

export function updateTypeDoc(root: string, typeName: string, docBody: string) {
  const { fm, file } = readTypeFile(root, typeName);
  writeTypeFile(root, fm, docBody);
  const c = commit(root, [file], `update doc ${typeName}`);
  return { type: typeName, ...c };
}

// ---- read + edit: actions ----

export function listActions(root: string) {
  const model = load(root);
  return [...model.actions.values()].map((a) => ({
    name: a.name,
    description: a.frontmatter.description ?? "",
    inputs: Object.keys(a.frontmatter.inputs ?? {}),
  }));
}

export function readAction(root: string, name: string) {
  const file = paths(root).actionFile(name);
  if (!fs.existsSync(file)) throw new Error(`action '${name}' not found`);
  const raw = matter(fs.readFileSync(file, "utf8"));
  return { name, frontmatter: raw.data, body: raw.content, file: path.relative(root, file) };
}

export interface CreateActionInput {
  name: string;
  description?: string;
  inputs?: Record<string, Param>;
  preconditions?: string[];
  effects?: string[];
}

export function createAction(root: string, input: CreateActionInput) {
  if (!NAME_RE.test(input.name)) throw new Error(`invalid action name '${input.name}'`);
  ensureDirs(root);
  const file = paths(root).actionFile(input.name);
  if (fs.existsSync(file)) throw new Error(`action '${input.name}' already exists`);

  const fm = {
    action: input.name,
    ...(input.description ? { description: input.description } : {}),
    ...(input.inputs ? { inputs: input.inputs } : {}),
    ...(input.preconditions ? { preconditions: input.preconditions } : {}),
    ...(input.effects ? { effects: input.effects } : {}),
  };
  const parsed = ActionFrontmatter.parse(fm);
  const body = `# ${input.name}\n\n${input.description ?? "TODO: describe what this action does."}`;
  fs.writeFileSync(file, renderAction(parsed, body));
  const c = commit(root, [file], `create action ${input.name}`);
  return { created: input.name, file: path.relative(root, file), ...c };
}

// ---- validate ----

export function validate(root: string): { ok: boolean; problems: Problem[] } {
  const problems = validateModel(load(root));
  return { ok: !problems.some((p) => p.level === "error"), problems };
}
