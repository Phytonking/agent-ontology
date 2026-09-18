import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { paths } from "./paths.js";
import {
  ObjectFileSchema,
  OntologyConfig,
  SPEC_VERSION,
  linkTypeToCardinality,
  type ActionDoc,
  type InternalLink,
  type ObjectDoc,
  type OntologyModel,
  type Problem,
  type TypeDoc,
} from "./types.js";

/**
 * Load an ontology folder into an in-memory model.
 *
 * Object files: *.md at the root (YAML frontmatter + markdown prose).
 * Connector configs: connectors/*.yaml
 * Instance data: data/<Type>/<id>.yaml (not loaded here).
 */
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
  }

  const objects = new Map<string, ObjectDoc>();
  const types = new Map<string, TypeDoc>();
  const actions = new Map<string, ActionDoc>();

  if (!fs.existsSync(root)) return { root, config, objects, types, actions, problems };

  // read *.md at root — each is an object definition
  const mdFiles = fs.readdirSync(root)
    .filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "CHANGELOG.md")
    .map((f) => path.join(root, f));

  for (const file of mdFiles) {
    try {
      const raw = matter(fs.readFileSync(file, "utf8"));
      const fm = raw.data as Record<string, unknown>;
      if (!fm || !fm.object) {
        problems.push({ level: "warning", where: path.relative(root, file), message: "no 'object' field in frontmatter — skipped" });
        continue;
      }
      const parsed = ObjectFileSchema.safeParse(fm);
      if (!parsed.success) {
        const msgs = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        problems.push({ level: "error", where: path.relative(root, file), message: msgs });
        continue;
      }

      const obj = parsed.data;
      const body = raw.content.trim();
      objects.set(obj.object, { name: obj.object, schema: obj, body, file });

      const internalLinks: Record<string, InternalLink> = {};
      for (const [lName, lDef] of Object.entries(obj.links ?? {})) {
        internalLinks[lName] = {
          to: lDef.to,
          cardinality: linkTypeToCardinality(lDef.type ?? "many-to-one"),
          via: lDef.via, inverse: lDef.inverse,
          through: lDef.through, through_from: lDef.through_from, through_to: lDef.through_to,
          transitive: lDef.transitive, symmetric: lDef.symmetric,
          functional: lDef.functional, inverse_functional: lDef.inverse_functional,
          description: lDef.description,
        };
      }
      types.set(obj.object, {
        name: obj.object,
        properties: obj.properties ?? {},
        links: internalLinks,
        constraints: obj.constraints ?? [],
        keys: obj.keys ?? [],
      });

      for (const [aName, aDef] of Object.entries(obj.actions ?? {})) {
        actions.set(aName, { name: aName, on: obj.object, def: aDef });
      }
    } catch (e) {
      problems.push({ level: "error", where: path.relative(root, file), message: (e as Error).message });
    }
  }

  return { root, config, objects, types, actions, problems };
}
