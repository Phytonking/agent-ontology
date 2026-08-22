import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { paths } from "./paths.js";
import {
  ActionFrontmatter,
  ConnectorFrontmatter,
  OntologyConfig,
  PipelineFrontmatter,
  SPEC_VERSION,
  TypeFrontmatter,
  type ActionDoc,
  type ConnectorDoc,
  type OntologyModel,
  type PipelineDoc,
  type Problem,
  type TypeDoc,
} from "./types.js";

function listMd(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f));
}

function issues(root: string, file: string, err: { issues: { path: (string | number)[]; message: string }[] }): Problem {
  return {
    level: "error",
    where: path.relative(root, file),
    message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}

/** Read an ontology folder into an in-memory model, collecting parse problems. */
export function load(root: string): OntologyModel {
  const p = paths(root);
  const problems: Problem[] = [];

  let config: OntologyConfig = {
    name: path.basename(path.resolve(root)),
    version: "0.1.0",
    spec: SPEC_VERSION,
  };
  if (fs.existsSync(p.config)) {
    try {
      const parsed = OntologyConfig.safeParse(YAML.parse(fs.readFileSync(p.config, "utf8")));
      if (parsed.success) config = parsed.data;
      else problems.push({ level: "error", where: "ontology.config.yaml", message: parsed.error.message });
    } catch (e) {
      problems.push({ level: "error", where: "ontology.config.yaml", message: (e as Error).message });
    }
  } else {
    problems.push({ level: "warning", where: "ontology.config.yaml", message: "missing config; using defaults" });
  }

  const types = new Map<string, TypeDoc>();
  for (const file of listMd(p.typesDir)) {
    const raw = matter(fs.readFileSync(file, "utf8"));
    const parsed = TypeFrontmatter.safeParse(raw.data);
    if (parsed.success) {
      types.set(parsed.data.type, { name: parsed.data.type, frontmatter: parsed.data, body: raw.content, file });
    } else {
      problems.push(issues(root, file, parsed.error));
    }
  }

  const actions = new Map<string, ActionDoc>();
  for (const file of listMd(p.actionsDir)) {
    const raw = matter(fs.readFileSync(file, "utf8"));
    const parsed = ActionFrontmatter.safeParse(raw.data);
    if (parsed.success) {
      actions.set(parsed.data.action, { name: parsed.data.action, frontmatter: parsed.data, body: raw.content, file });
    } else {
      problems.push(issues(root, file, parsed.error));
    }
  }

  const connectors = new Map<string, ConnectorDoc>();
  for (const file of listMd(p.connectorsDir)) {
    const raw = matter(fs.readFileSync(file, "utf8"));
    const parsed = ConnectorFrontmatter.safeParse(raw.data);
    if (parsed.success) {
      connectors.set(parsed.data.connector, { name: parsed.data.connector, frontmatter: parsed.data, body: raw.content, file });
    } else {
      problems.push(issues(root, file, parsed.error));
    }
  }

  const pipelines = new Map<string, PipelineDoc>();
  for (const file of listMd(p.pipelinesDir)) {
    const raw = matter(fs.readFileSync(file, "utf8"));
    const parsed = PipelineFrontmatter.safeParse(raw.data);
    if (parsed.success) {
      pipelines.set(parsed.data.pipeline, { name: parsed.data.pipeline, frontmatter: parsed.data, body: raw.content, file });
    } else {
      problems.push(issues(root, file, parsed.error));
    }
  }

  return { root, config, types, actions, connectors, pipelines, problems };
}
