import type { OntologyModel, Problem, TypeDoc } from "./types.js";

export function checkConstraints(
  type: TypeDoc,
  data: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const c of type.constraints) {
    switch (c.kind) {
      case "conditional":
        if (data[c.if_field] === c.if_value && (data[c.require] == null))
          errors.push(`conditional: when ${c.if_field}=${JSON.stringify(c.if_value)}, ${c.require} is required`);
        break;
      case "required_together": {
        const present = c.fields.filter((f) => data[f] != null);
        if (present.length > 0 && present.length < c.fields.length)
          errors.push(`required_together: ${c.fields.join(", ")} must all be present; missing: ${c.fields.filter((f) => !present.includes(f)).join(", ")}`);
        break;
      }
      case "mutually_exclusive": {
        const set = c.fields.filter((f) => data[f] != null);
        if (set.length > 1)
          errors.push(`mutually_exclusive: at most one of [${c.fields.join(", ")}]; got: ${set.join(", ")}`);
        break;
      }
    }
  }
  return errors;
}

export function checkPropertyConstraints(
  propName: string,
  spec: { min?: number; max?: number; pattern?: string },
  value: unknown
): string[] {
  const errors: string[] = [];
  if (typeof value === "number") {
    if (spec.min !== undefined && value < spec.min) errors.push(`${propName}: ${value} < min ${spec.min}`);
    if (spec.max !== undefined && value > spec.max) errors.push(`${propName}: ${value} > max ${spec.max}`);
  }
  if (typeof value === "string" && spec.pattern !== undefined) {
    if (!new RegExp(spec.pattern).test(value)) errors.push(`${propName}: does not match /${spec.pattern}/`);
  }
  return errors;
}

export function validate(model: OntologyModel): Problem[] {
  const problems: Problem[] = [...model.problems];
  const typeNames = new Set(model.types.keys());

  for (const t of model.types.values()) {
    const propNames = new Set(Object.keys(t.properties));

    for (const key of t.keys) {
      if (!propNames.has(key))
        problems.push({ level: "error", where: `${t.name}.keys`, message: `key '${key}' is not a declared property` });
    }

    for (const [pName, spec] of Object.entries(t.properties)) {
      if (spec.transitions) {
        for (const [from, tos] of Object.entries(spec.transitions)) {
          if (!(spec.values ?? []).includes(from))
            problems.push({ level: "error", where: `${t.name}.${pName}`, message: `transition from '${from}' not in enum values` });
          for (const to of tos)
            if (!(spec.values ?? []).includes(to))
              problems.push({ level: "error", where: `${t.name}.${pName}`, message: `transition to '${to}' not in enum values` });
        }
      }
    }

    for (const [lName, link] of Object.entries(t.links)) {
      const where = `${t.name}.links.${lName}`;
      if (!typeNames.has(link.to)) {
        problems.push({ level: "error", where, message: `link target '${link.to}' does not exist` });
        continue;
      }
      if (link.through) {
        if (!typeNames.has(link.through))
          problems.push({ level: "error", where, message: `through type '${link.through}' does not exist` });
        if (!link.through_from || !link.through_to)
          problems.push({ level: "error", where, message: "many-to-many needs both through_from and through_to" });
      }
      if (link.inverse) {
        const target = model.types.get(link.to);
        const back = target?.links[link.inverse];
        if (!back) problems.push({ level: "warning", where, message: `inverse '${link.inverse}' not found on '${link.to}'` });
        else if (back.to !== t.name) problems.push({ level: "warning", where, message: `inverse points to '${back.to}', not '${t.name}'` });
      }
    }

    for (const c of t.constraints) {
      switch (c.kind) {
        case "disjoint":
          for (const ref of [c.a, c.b])
            if (!typeNames.has(ref))
              problems.push({ level: "warning", where: `${t.name}.constraints`, message: `disjoint references unknown type '${ref}'` });
          break;
        case "cardinality":
          if (!t.links[c.link])
            problems.push({ level: "error", where: `${t.name}.constraints`, message: `cardinality references unknown link '${c.link}'` });
          break;
        case "conditional":
          if (!propNames.has(c.if_field)) problems.push({ level: "error", where: `${t.name}.constraints`, message: `conditional.if_field '${c.if_field}' not a property` });
          if (!propNames.has(c.require)) problems.push({ level: "error", where: `${t.name}.constraints`, message: `conditional.require '${c.require}' not a property` });
          break;
        case "required_together":
        case "mutually_exclusive":
          for (const f of c.fields)
            if (!propNames.has(f)) problems.push({ level: "error", where: `${t.name}.constraints`, message: `${c.kind} references unknown property '${f}'` });
          break;
      }
    }
  }
  return problems;
}
