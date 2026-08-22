import { z } from "zod";

export const SPEC_VERSION = "0.2";

export const PRIMITIVE_TYPES = [
  "string", "text", "int", "float", "bool", "money", "datetime", "date", "id", "json", "enum",
] as const;

export const PropertyType = z.enum(PRIMITIVE_TYPES);
export type PropertyType = z.infer<typeof PropertyType>;

export const ParamSchema = z
  .object({
    type: PropertyType,
    values: z.array(z.string()).optional(),
    /** Legal state transitions: { from: [to, ...] }. Only valid when type=enum. */
    transitions: z.record(z.array(z.string())).optional(),
    required: z.boolean().optional(),
    many: z.boolean().optional(),
    unique: z.boolean().optional(),
    /** Numeric min/max for int/float/money. */
    min: z.number().optional(),
    max: z.number().optional(),
    /** Regex pattern for string/text. */
    pattern: z.string().optional(),
    deprecated: z.boolean().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
  })
  .refine((p) => p.type !== "enum" || (p.values !== undefined && p.values.length > 0), {
    message: "enum type requires a non-empty 'values' list",
  })
  .refine((p) => p.transitions === undefined || p.type === "enum", {
    message: "transitions only valid on enum properties",
  })
  .refine((p) => p.min === undefined || ["int", "float", "money"].includes(p.type), {
    message: "min only valid on int/float/money",
  })
  .refine((p) => p.max === undefined || ["int", "float", "money"].includes(p.type), {
    message: "max only valid on int/float/money",
  })
  .refine((p) => p.pattern === undefined || ["string", "text"].includes(p.type), {
    message: "pattern only valid on string/text",
  });
export type Param = z.infer<typeof ParamSchema>;

export const LinkSchema = z.object({
  to: z.string(),
  cardinality: z.enum(["one", "many"]).default("one"),
  via: z.string().optional(),
  inverse: z.string().optional(),
  through: z.string().optional(),
  through_from: z.string().optional(),
  through_to: z.string().optional(),
  /** Transitive: A→B→C implies A→C. */
  transitive: z.boolean().optional(),
  /** Symmetric: A→B implies B→A. */
  symmetric: z.boolean().optional(),
  /** Functional: at most one target per source (implies cardinality=one). */
  functional: z.boolean().optional(),
  /** Inverse-functional: at most one source per target (implies uniqueness of `via`). */
  inverse_functional: z.boolean().optional(),
  deprecated: z.boolean().optional(),
  description: z.string().optional(),
});
export type Link = z.infer<typeof LinkSchema>;

export const ConstraintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("disjoint"), a: z.string(), b: z.string() }),
  z.object({ kind: z.literal("at_most_once"), of: z.string() }),
  /** min/max instances of a link from one source. */
  z.object({ kind: z.literal("cardinality"), link: z.string(), min: z.number().int().optional(), max: z.number().int().optional() }),
  /** Conditional: if `field` equals `value`, then `require` field must be present. */
  z.object({ kind: z.literal("conditional"), if_field: z.string(), if_value: z.unknown(), require: z.string() }),
  /** All listed fields must be present together or absent together. */
  z.object({ kind: z.literal("required_together"), fields: z.array(z.string()) }),
  /** At most one of the listed fields may be set. */
  z.object({ kind: z.literal("mutually_exclusive"), fields: z.array(z.string()) }),
  z.object({ kind: z.literal("custom"), rule: z.string() }),
]);
export type Constraint = z.infer<typeof ConstraintSchema>;

export const TypeFrontmatter = z.object({
  type: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "type name must be alphanumeric/underscore"),
  extends: z.string().optional(),
  label: z.string().optional(),
  deprecated: z.boolean().optional(),
  keys: z.array(z.string()).optional(),
  properties: z.record(ParamSchema).optional(),
  links: z.record(LinkSchema).optional(),
  constraints: z.array(ConstraintSchema).optional(),
});
export type TypeFrontmatter = z.infer<typeof TypeFrontmatter>;

export const ActionFrontmatter = z.object({
  action: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "action name must be alphanumeric/underscore"),
  description: z.string().optional(),
  /** The entity type this action operates on (e.g. "Order"). */
  on: z.string().optional(),
  inputs: z.record(ParamSchema).optional(),
  preconditions: z.array(z.string()).optional(),
  effects: z.array(z.string()).optional(),
});
export type ActionFrontmatter = z.infer<typeof ActionFrontmatter>;

/**
 * A connector definition. Connectors ingest data from an external source and
 * upsert it into the ontology. Core ships the framework, not specific connectors:
 * `kind` maps to a registered implementation, or `module` points to one to load.
 */
export const ConnectorFrontmatter = z.object({
  connector: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "connector name must be alphanumeric/underscore/dash"),
  kind: z.string(),
  description: z.string().optional(),
  /** Path (relative to the ontology root) to a module exporting the connector implementation. */
  module: z.string().optional(),
  /** Non-secret source configuration. Secrets come from env, referenced by name. */
  config: z.record(z.any()).optional(),
  /** Optional cron hint. Core does not schedule; a host may read this to schedule runs. */
  schedule: z.string().optional(),
});
export type ConnectorFrontmatter = z.infer<typeof ConnectorFrontmatter>;

/** One step in a pipeline: exactly one of connector | transform. */
export const PipelineStep = z
  .object({
    connector: z.string().optional(),
    transform: z.string().optional(),
    module: z.string().optional(),
    config: z.record(z.any()).optional(),
  })
  .refine((s) => (s.connector ? 1 : 0) + (s.transform ? 1 : 0) === 1, {
    message: "each step must have exactly one of 'connector' or 'transform'",
  });
export type PipelineStep = z.infer<typeof PipelineStep>;

/** A pipeline composes ordered ingest/transform steps into a data-management flow. */
export const PipelineFrontmatter = z.object({
  pipeline: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "pipeline name must be alphanumeric/underscore/dash"),
  description: z.string().optional(),
  steps: z.array(PipelineStep),
  schedule: z.string().optional(),
});
export type PipelineFrontmatter = z.infer<typeof PipelineFrontmatter>;

export const OntologyConfig = z.object({
  name: z.string(),
  version: z.string().default("0.1.0"),
  spec: z.string().default(SPEC_VERSION),
});
export type OntologyConfig = z.infer<typeof OntologyConfig>;

export interface TypeDoc { name: string; frontmatter: TypeFrontmatter; body: string; file: string; }
export interface ActionDoc { name: string; frontmatter: ActionFrontmatter; body: string; file: string; }
export interface ConnectorDoc { name: string; frontmatter: ConnectorFrontmatter; body: string; file: string; }
export interface PipelineDoc { name: string; frontmatter: PipelineFrontmatter; body: string; file: string; }
export interface Problem { level: "error" | "warning"; where: string; message: string; }
export interface OntologyModel {
  root: string;
  config: OntologyConfig;
  types: Map<string, TypeDoc>;
  actions: Map<string, ActionDoc>;
  connectors: Map<string, ConnectorDoc>;
  pipelines: Map<string, PipelineDoc>;
  problems: Problem[];
}
