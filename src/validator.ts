import type { OntologyModel, Problem, TypeFrontmatter } from "./types.js";

/** Pure constraint checks reusable by the data layer at write time. */
export function checkConstraints(
  fm: TypeFrontmatter,
  data: Record<string, unknown>,
  typeNames: Set<string>
): string[] {
  const errors: string[] = [];
  for (const c of fm.constraints ?? []) {
    switch (c.kind) {
      case "conditional": {
        if (data[c.if_field] === c.if_value && (data[c.require] === undefined || data[c.require] === null)) {
          errors.push(`conditional: when ${c.if_field}=${JSON.stringify(c.if_value)}, ${c.require} is required`);
        }
        break;
      }
      case "required_together": {
        const present = c.fields.filter((f) => data[f] !== undefined && data[f] !== null);
        if (present.length > 0 && present.length < c.fields.length) {
          const missing = c.fields.filter((f) => !present.includes(f));
          errors.push(`required_together: ${c.fields.join(", ")} must all be present; missing: ${missing.join(", ")}`);
        }
        break;
      }
      case "mutually_exclusive": {
        const set = c.fields.filter((f) => data[f] !== undefined && data[f] !== null);
        if (set.length > 1) {
          errors.push(`mutually_exclusive: at most one of [${c.fields.join(", ")}] may be set; got: ${set.join(", ")}`);
        }
        break;
      }
    }
  }
  return errors;
}

/** Pure property-level checks reusable at write time. */
export function checkPropertyConstraints(
  propName: string,
  spec: ReturnType<(typeof import("./types.js"))["ParamSchema"]["parse"]>,
  value: unknown
): string[] {
  const errors: string[] = [];
  if (typeof value === "number") {
    if (spec.min !== undefined && value < spec.min)
      errors.push(`${propName}: ${value} < min ${spec.min}`);
    if (spec.max !== undefined && value > spec.max)
      errors.push(`${propName}: ${value} > max ${spec.max}`);
  }
  if (typeof value === "string" && spec.pattern !== undefined) {
    if (!new RegExp(spec.pattern).test(value))
      errors.push(`${propName}: "${value}" does not match pattern /${spec.pattern}/`);
  }
  return errors;
}

/**
 * Whole-ontology coherence checks (beyond per-file shape validation).
 */
export function validate(model: OntologyModel): Problem[] {
  const problems: Problem[] = [...model.problems];
  const typeNames = new Set(model.types.keys());
  const isDeprecated = (n: string) => model.types.get(n)?.frontmatter.deprecated === true;

  for (const t of model.types.values()) {
    const fm = t.frontmatter;
    const propNames = new Set(Object.keys(fm.properties ?? {}));

    if (fm.extends && !typeNames.has(fm.extends))
      problems.push({ level: "error", where: `types/${t.name}`, message: `extends unknown type '${fm.extends}'` });

    for (const key of fm.keys ?? []) {
      if (!propNames.has(key))
        problems.push({ level: "error", where: `types/${t.name}.keys`, message: `key '${key}' is not a declared property` });
    }

    for (const [pName, spec] of Object.entries(fm.properties ?? {})) {
      const where = `types/${t.name}.properties.${pName}`;
      if (spec.transitions) {
        for (const [from, tos] of Object.entries(spec.transitions)) {
          if (!(spec.values ?? []).includes(from))
            problems.push({ level: "error", where, message: `transition from '${from}' is not in enum values` });
          for (const to of tos) {
            if (!(spec.values ?? []).includes(to))
              problems.push({ level: "error", where, message: `transition to '${to}' is not in enum values` });
          }
        }
      }
    }

    for (const [linkName, link] of Object.entries(fm.links ?? {})) {
      const where = `types/${t.name}.links.${linkName}`;
      if (!typeNames.has(link.to)) {
        problems.push({ level: "error", where, message: `link target '${link.to}' does not exist` });
        continue;
      }
      if (isDeprecated(link.to))
        problems.push({ level: "warning", where, message: `links to deprecated type '${link.to}'` });
      if (link.functional && link.cardinality !== "one")
        problems.push({ level: "warning", where, message: "functional characteristic implies cardinality=one" });
      if (link.transitive && link.to !== t.name)
        problems.push({ level: "warning", where, message: "transitive is only meaningful on self-referencing links" });
      if (link.through) {
        if (!typeNames.has(link.through))
          problems.push({ level: "error", where, message: `through type '${link.through}' does not exist` });
        if (!link.through_from || !link.through_to)
          problems.push({ level: "error", where, message: "many-to-many link needs both through_from and through_to" });
        else {
          const join = model.types.get(link.through);
          const joinProps = new Set(Object.keys(join?.frontmatter.properties ?? {}));
          for (const f of [link.through_from, link.through_to]) {
            if (join && !joinProps.has(f))
              problems.push({ level: "warning", where, message: `through field '${f}' is not a property of '${link.through}'` });
          }
        }
      }
      if (link.inverse) {
        const back = model.types.get(link.to)?.frontmatter.links?.[link.inverse];
        if (!back)
          problems.push({ level: "warning", where, message: `inverse '${link.inverse}' not found on '${link.to}'` });
        else if (back.to !== t.name)
          problems.push({ level: "warning", where, message: `inverse '${link.to}.${link.inverse}' points to '${back.to}', not '${t.name}'` });
      }
    }

    for (const c of fm.constraints ?? []) {
      switch (c.kind) {
        case "disjoint":
          for (const ref of [c.a, c.b])
            if (!typeNames.has(ref))
              problems.push({ level: "warning", where: `types/${t.name}.constraints`, message: `disjoint references unknown type '${ref}'` });
          break;
        case "cardinality":
          if (!Object.keys(fm.links ?? {}).includes(c.link))
            problems.push({ level: "error", where: `types/${t.name}.constraints`, message: `cardinality constraint references unknown link '${c.link}'` });
          break;
        case "conditional":
          if (!propNames.has(c.if_field))
            problems.push({ level: "error", where: `types/${t.name}.constraints`, message: `conditional.if_field '${c.if_field}' not a property` });
          if (!propNames.has(c.require))
            problems.push({ level: "error", where: `types/${t.name}.constraints`, message: `conditional.require '${c.require}' not a property` });
          break;
        case "required_together":
        case "mutually_exclusive": {
          const fields = c.kind === "required_together" ? c.fields : c.fields;
          for (const f of fields)
            if (!propNames.has(f))
              problems.push({ level: "error", where: `types/${t.name}.constraints`, message: `${c.kind} references unknown property '${f}'` });
          break;
        }
      }
    }
  }

  return problems;
}
