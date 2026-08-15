import type { OntologyModel, Problem } from "./types.js";

/**
 * Whole-ontology coherence checks (beyond per-file shape validation).
 * Reports dangling references without blocking edits — an agent may be
 * mid-construction when a link target doesn't exist yet.
 */
export function validate(model: OntologyModel): Problem[] {
  const problems: Problem[] = [...model.problems];
  const typeNames = new Set(model.types.keys());
  const isDeprecated = (name: string) => model.types.get(name)?.frontmatter.deprecated === true;

  for (const t of model.types.values()) {
    const fm = t.frontmatter;
    const propNames = new Set(Object.keys(fm.properties ?? {}));

    if (fm.extends && !typeNames.has(fm.extends)) {
      problems.push({ level: "error", where: `types/${t.name}`, message: `extends unknown type '${fm.extends}'` });
    }

    for (const key of fm.keys ?? []) {
      if (!propNames.has(key)) {
        problems.push({ level: "error", where: `types/${t.name}.keys`, message: `key '${key}' is not a declared property` });
      }
    }

    for (const [linkName, link] of Object.entries(fm.links ?? {})) {
      const where = `types/${t.name}.links.${linkName}`;
      if (!typeNames.has(link.to)) {
        problems.push({ level: "error", where, message: `link target '${link.to}' does not exist` });
        continue;
      }
      if (isDeprecated(link.to)) {
        problems.push({ level: "warning", where, message: `links to deprecated type '${link.to}'` });
      }

      if (link.through) {
        if (!typeNames.has(link.through)) {
          problems.push({ level: "error", where, message: `through type '${link.through}' does not exist` });
        }
        if (!link.through_from || !link.through_to) {
          problems.push({ level: "error", where, message: "many-to-many link needs both through_from and through_to" });
        } else {
          const join = model.types.get(link.through);
          const joinProps = new Set(Object.keys(join?.frontmatter.properties ?? {}));
          for (const f of [link.through_from, link.through_to]) {
            if (join && !joinProps.has(f)) {
              problems.push({ level: "warning", where, message: `through field '${f}' is not a property of '${link.through}'` });
            }
          }
        }
      }

      if (link.inverse) {
        const target = model.types.get(link.to);
        const back = target?.frontmatter.links?.[link.inverse];
        if (!back) {
          problems.push({ level: "warning", where, message: `inverse '${link.inverse}' not found on '${link.to}'` });
        } else if (back.to !== t.name) {
          problems.push({ level: "warning", where, message: `inverse '${link.to}.${link.inverse}' points to '${back.to}', not '${t.name}'` });
        }
      }
    }

    for (const c of fm.constraints ?? []) {
      if (c.kind === "disjoint") {
        for (const ref of [c.a, c.b]) {
          if (!typeNames.has(ref)) {
            problems.push({ level: "warning", where: `types/${t.name}.constraints`, message: `disjoint references unknown type '${ref}'` });
          }
        }
      }
    }
  }

  return problems;
}
