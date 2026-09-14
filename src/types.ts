import { z } from "zod";

export const SPEC_VERSION = "0.3";

export const PRIMITIVE_TYPES = [
  "string", "text", "int", "float", "bool", "money", "datetime", "date", "id", "json", "enum",
] as const;

export const PropertyType = z.enum(PRIMITIVE_TYPES);
export type PropertyType = z.infer<typeof PropertyType>;

// ---- property ----

export const PropertyDef = z
  .object({
    type: PropertyType,
    values: z.array(z.string()).optional(),
    transitions: z.record(z.array(z.string())).optional(),
    required: z.boolean().optional(),
    many: z.boolean().optional(),
    unique: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    description: z.string().optional(),
  })
  .refine((p) => p.type !== "enum" || (p.values && p.values.length > 0), {
    message: "enum type requires a non-empty 'values' list",
  });
export type PropertyDef = z.infer<typeof PropertyDef>;

// ---- link ----

export const LINK_TYPES = ["one-to-one", "many-to-one", "one-to-many", "many-to-many"] as const;

export const LinkDef = z.object({
  to: z.string(),
  type: z.enum(LINK_TYPES).default("many-to-one"),
  via: z.string().optional(),
  inverse: z.string().optional(),
  through: z.string().optional(),
  through_from: z.string().optional(),
  through_to: z.string().optional(),
  transitive: z.boolean().optional(),
  symmetric: z.boolean().optional(),
  functional: z.boolean().optional(),
  inverse_functional: z.boolean().optional(),
  description: z.string().optional(),
});
export type LinkDef = z.infer<typeof LinkDef>;

// ---- action (embedded in the object) ----

export const ActionDef = z.object({
  description: z.string().optional(),
  inputs: z.record(PropertyDef).optional(),
  preconditions: z.array(z.string()).optional(),
  effects: z.array(z.string()).optional(),
});
export type ActionDef = z.infer<typeof ActionDef>;

// ---- constraint ----

export const ConstraintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disjoint"), a: z.string(), b: z.string() }),
  z.object({ kind: z.literal("at_most_once"), of: z.string() }),
  z.object({ kind: z.literal("cardinality"), link: z.string(), min: z.number().int().optional(), max: z.number().int().optional() }),
  z.object({ kind: z.literal("conditional"), if_field: z.string(), if_value: z.unknown(), require: z.string() }),
  z.object({ kind: z.literal("required_together"), fields: z.array(z.string()) }),
  z.object({ kind: z.literal("mutually_exclusive"), fields: z.array(z.string()) }),
  z.object({ kind: z.literal("custom"), rule: z.string() }),
]);
export type Constraint = z.infer<typeof ConstraintSchema>;

// ---- the object file: ONE file = properties + links + actions ----

export const ObjectFileSchema = z.object({
  object: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  keys: z.array(z.string()).optional(),
  properties: z.record(PropertyDef).optional(),
  links: z.record(LinkDef).optional(),
  actions: z.record(ActionDef).optional(),
  constraints: z.array(ConstraintSchema).optional(),
});
export type ObjectFileSchema = z.infer<typeof ObjectFileSchema>;

// ---- config ----

export const OntologyConfig = z.object({
  name: z.string(),
  version: z.string().default("0.1.0"),
  spec: z.string().default(SPEC_VERSION),
});
export type OntologyConfig = z.infer<typeof OntologyConfig>;

// ---- internal model (what the engine works with) ----

/** Link in internal format (cardinality: one|many, derived from the file's link type). */
export interface InternalLink {
  to: string;
  cardinality: "one" | "many";
  via?: string;
  inverse?: string;
  through?: string;
  through_from?: string;
  through_to?: string;
  transitive?: boolean;
  symmetric?: boolean;
  functional?: boolean;
  inverse_functional?: boolean;
  description?: string;
}

export interface ObjectDoc {
  name: string;
  schema: ObjectFileSchema;
  file: string;
}

export interface TypeDoc {
  name: string;
  properties: Record<string, PropertyDef>;
  links: Record<string, InternalLink>;
  constraints: Constraint[];
  keys: string[];
}

export interface ActionDoc {
  name: string;
  on: string;
  def: ActionDef;
}

export interface Problem {
  level: "error" | "warning";
  where: string;
  message: string;
}

export interface OntologyModel {
  root: string;
  config: OntologyConfig;
  objects: Map<string, ObjectDoc>;
  types: Map<string, TypeDoc>;
  actions: Map<string, ActionDoc>;
  problems: Problem[];
}

/** Convert a file-format link type to internal cardinality. */
export function linkTypeToCardinality(lt: string): "one" | "many" {
  return lt === "one-to-one" || lt === "many-to-one" ? "one" : "many";
}
