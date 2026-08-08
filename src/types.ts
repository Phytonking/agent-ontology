import { z } from "zod";

/** Version of the ontology file-format spec this build understands. */
export const SPEC_VERSION = "0.1";

/** Primitive property/input types allowed in the v0 spec. */
export const PRIMITIVE_TYPES = [
  "string",
  "text",
  "int",
  "float",
  "bool",
  "money",
  "datetime",
  "date",
  "id",
  "json",
  "enum",
] as const;

export const PropertyType = z.enum(PRIMITIVE_TYPES);
export type PropertyType = z.infer<typeof PropertyType>;

/** A typed field — used for both type properties and action inputs. */
export const ParamSchema = z
  .object({
    type: PropertyType,
    values: z.array(z.string()).optional(),
    required: z.boolean().optional(),
    description: z.string().optional(),
  })
  .refine((p) => p.type !== "enum" || (p.values !== undefined && p.values.length > 0), {
    message: "enum type requires a non-empty 'values' list",
  });
export type Param = z.infer<typeof ParamSchema>;

/** A relationship from one type to another. */
export const LinkSchema = z.object({
  to: z.string(),
  cardinality: z.enum(["one", "many"]).default("one"),
  description: z.string().optional(),
});
export type Link = z.infer<typeof LinkSchema>;

/** Declarative constraints. Declared in v0; enforced once the data layer exists. */
export const ConstraintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disjoint"), a: z.string(), b: z.string() }),
  z.object({ kind: z.literal("at_most_once"), of: z.string() }),
  z.object({ kind: z.literal("custom"), rule: z.string() }),
]);
export type Constraint = z.infer<typeof ConstraintSchema>;

export const TypeFrontmatter = z.object({
  type: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "type name must be alphanumeric/underscore"),
  extends: z.string().optional(),
  properties: z.record(ParamSchema).optional(),
  links: z.record(LinkSchema).optional(),
  constraints: z.array(ConstraintSchema).optional(),
});
export type TypeFrontmatter = z.infer<typeof TypeFrontmatter>;

export const ActionFrontmatter = z.object({
  action: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "action name must be alphanumeric/underscore"),
  description: z.string().optional(),
  inputs: z.record(ParamSchema).optional(),
  preconditions: z.array(z.string()).optional(),
  effects: z.array(z.string()).optional(),
});
export type ActionFrontmatter = z.infer<typeof ActionFrontmatter>;

export const OntologyConfig = z.object({
  name: z.string(),
  version: z.string().default("0.1.0"),
  spec: z.string().default(SPEC_VERSION),
});
export type OntologyConfig = z.infer<typeof OntologyConfig>;

export interface TypeDoc {
  name: string;
  frontmatter: TypeFrontmatter;
  body: string;
  file: string;
}

export interface ActionDoc {
  name: string;
  frontmatter: ActionFrontmatter;
  body: string;
  file: string;
}

export interface Problem {
  level: "error" | "warning";
  where: string;
  message: string;
}

export interface OntologyModel {
  root: string;
  config: OntologyConfig;
  types: Map<string, TypeDoc>;
  actions: Map<string, ActionDoc>;
  /** Parse-time problems collected while loading the folder. */
  problems: Problem[];
}
