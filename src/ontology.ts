import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { paths } from "./paths.js";
import { renderType, renderAction, renderConnector, renderConnection, renderPipeline } from "./serialize.js";
import { load } from "./loader.js";
import { validate as validateModel } from "./validator.js";
import { commit } from "./git.js";
import {
  ActionFrontmatter,
  ConnectionFrontmatter,
  ConnectorFrontmatter,
  ConstraintSchema,
  LinkSchema,
  ParamSchema,
  PipelineFrontmatter,
  TypeFrontmatter,
  type Constraint,
  type Link,
  type Param,
  type PipelineStep,
  type Problem,
} from "./types.js";

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function ensureDirs(root: string) {
  const p = paths(root);
  fs.mkdirSync(p.typesDir, { recursive: true });
  fs.mkdirSync(p.actionsDir, { recursive: true });
  fs.mkdirSync(p.connectionsDir, { recursive: true });
  fs.mkdirSync(p.connectorsDir, { recursive: true });
  fs.mkdirSync(p.pipelinesDir, { recursive: true });
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
  on?: string;
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
    ...(input.on ? { on: input.on } : {}),
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

// ---- read + edit: connectors ----

export function listConnectors(root: string) {
  const model = load(root);
  return [...model.connectors.values()].map((c) => ({
    name: c.name,
    kind: c.frontmatter.kind,
    description: c.frontmatter.description ?? "",
    module: c.frontmatter.module,
  }));
}

export function readConnector(root: string, name: string) {
  const file = paths(root).connectorFile(name);
  if (!fs.existsSync(file)) throw new Error(`connector '${name}' not found`);
  const raw = matter(fs.readFileSync(file, "utf8"));
  return { name, frontmatter: raw.data, body: raw.content, file: path.relative(root, file) };
}

export interface CreateConnectorInput {
  name: string;
  kind: string;
  description?: string;
  module?: string;
  config?: Record<string, unknown>;
  schedule?: string;
}

export function createConnector(root: string, input: CreateConnectorInput) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(input.name)) throw new Error(`invalid connector name '${input.name}'`);
  ensureDirs(root);
  const file = paths(root).connectorFile(input.name);
  if (fs.existsSync(file)) throw new Error(`connector '${input.name}' already exists`);

  const fm = {
    connector: input.name,
    kind: input.kind,
    ...(input.description ? { description: input.description } : {}),
    ...(input.module ? { module: input.module } : {}),
    ...(input.config ? { config: input.config } : {}),
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
  const parsed = ConnectorFrontmatter.parse(fm);
  const body = `# ${input.name}\n\n${input.description ?? "TODO: describe this connector — what it ingests and how it maps to types."}`;
  fs.writeFileSync(file, renderConnector(parsed, body));
  const c = commit(root, [file], `create connector ${input.name}`);
  return { created: input.name, file: path.relative(root, file), ...c };
}

// ---- read + edit: connections ----

export function listConnections(root: string) {
  const model = load(root);
  return [...model.connections.values()].map((c) => ({
    name: c.name,
    kind: c.frontmatter.kind,
    description: c.frontmatter.description ?? "",
  }));
}

export function readConnection(root: string, name: string) {
  const file = paths(root).connectionFile(name);
  if (!fs.existsSync(file)) throw new Error(`connection '${name}' not found`);
  const raw = matter(fs.readFileSync(file, "utf8"));
  return { name, frontmatter: raw.data, body: raw.content, file: path.relative(root, file) };
}

export interface CreateConnectionInput {
  name: string;
  kind: string;
  description?: string;
  config?: Record<string, unknown>;
}

export function createConnection(root: string, input: CreateConnectionInput) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(input.name)) throw new Error(`invalid connection name '${input.name}'`);
  ensureDirs(root);
  const file = paths(root).connectionFile(input.name);
  if (fs.existsSync(file)) throw new Error(`connection '${input.name}' already exists`);
  const NAME = input.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const fm = {
    connection: input.name,
    kind: input.kind,
    ...(input.description ? { description: input.description } : {}),
    ...(input.config ? { config: input.config } : {}),
  };
  const parsed = ConnectionFrontmatter.parse(fm);
  const body = `# ${input.name}\n\n${input.description ?? "TODO: describe this data connection."}\n\nSecrets are read from the environment as \`ONTOLAYER_CONN_${NAME}_<KEY>\`.`;
  fs.writeFileSync(file, renderConnection(parsed, body));
  const c = commit(root, [file], `create connection ${input.name}`);
  return { created: input.name, file: path.relative(root, file), ...c };
}

// ---- read + edit: pipelines ----

export function listPipelines(root: string) {
  const model = load(root);
  return [...model.pipelines.values()].map((p) => ({
    name: p.name,
    description: p.frontmatter.description ?? "",
    steps: p.frontmatter.steps.map((s) => s.connector ?? s.transform),
  }));
}

export function readPipeline(root: string, name: string) {
  const file = paths(root).pipelineFile(name);
  if (!fs.existsSync(file)) throw new Error(`pipeline '${name}' not found`);
  const raw = matter(fs.readFileSync(file, "utf8"));
  return { name, frontmatter: raw.data, body: raw.content, file: path.relative(root, file) };
}

export interface CreatePipelineInput {
  name: string;
  description?: string;
  steps: PipelineStep[];
  schedule?: string;
}

export function createPipeline(root: string, input: CreatePipelineInput) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(input.name)) throw new Error(`invalid pipeline name '${input.name}'`);
  ensureDirs(root);
  const file = paths(root).pipelineFile(input.name);
  if (fs.existsSync(file)) throw new Error(`pipeline '${input.name}' already exists`);

  const fm = {
    pipeline: input.name,
    ...(input.description ? { description: input.description } : {}),
    steps: input.steps,
    ...(input.schedule ? { schedule: input.schedule } : {}),
  };
  const parsed = PipelineFrontmatter.parse(fm);
  const body = `# ${input.name}\n\n${input.description ?? "TODO: describe this pipeline's data flow."}`;
  fs.writeFileSync(file, renderPipeline(parsed, body));
  const c = commit(root, [file], `create pipeline ${input.name}`);
  return { created: input.name, file: path.relative(root, file), ...c };
}

// ---- validate ----

export function validate(root: string): { ok: boolean; problems: Problem[] } {
  const problems = validateModel(load(root));
  return { ok: !problems.some((p) => p.level === "error"), problems };
}
