import type { OntologyModel, Problem } from "./types.js";

/**
 * Whole-ontology coherence checks (beyond per-file shape validation).
 * Reports dangling references without blocking edits — an agent may be
 * mid-construction when a link target doesn't exist yet.
 */
export function validate(model: OntologyModel): Problem[] {
  const problems: Problem[] = [...model.problems];
  const typeNames = new Set(model.types.keys());

  for (const t of model.types.values()) {
    const fm = t.frontmatter;

    if (fm.extends && !typeNames.has(fm.extends)) {
      problems.push({ level: "error", where: `types/${t.name}`, message: `extends unknown type '${fm.extends}'` });
    }

    for (const [linkName, link] of Object.entries(fm.links ?? {})) {
      if (!typeNames.has(link.to)) {
        problems.push({
          level: "error",
          where: `types/${t.name}.links.${linkName}`,
          message: `link target '${link.to}' does not exist`,
        });
      }
    }

    for (const c of fm.constraints ?? []) {
      if (c.kind === "disjoint") {
        for (const ref of [c.a, c.b]) {
          if (!typeNames.has(ref)) {
            problems.push({
              level: "warning",
              where: `types/${t.name}.constraints`,
              message: `disjoint references unknown type '${ref}'`,
            });
          }
        }
      }
    }
  }

  return problems;
}
