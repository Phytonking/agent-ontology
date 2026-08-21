import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as onto from "./ontology.js";
import { load } from "./loader.js";
import { ConstraintSchema, LinkSchema, ParamSchema, type Param } from "./types.js";
import { Dataset, openStore } from "./data/dataset.js";
import { syncBidirectional } from "./data/sync.js";
import { runAction } from "./data/actions.js";
import { materialize, watchAndMaterialize } from "./data/materialize.js";
import { runConnector } from "./connectors/run.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function text(obj: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}
function fail(e: unknown): ToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
}

/**
 * Map a Param spec to a Zod schema for MCP tool input validation.
 * Used to give each dynamically-registered action tool its own typed input schema.
 */
function paramToZod(spec: Param): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (spec.type) {
    case "int":
    case "float":
    case "money":
      base = z.number();
      break;
    case "bool":
      base = z.boolean();
      break;
    case "json":
      base = z.any();
      break;
    case "enum":
      base = spec.values?.length
        ? z.enum(spec.values as [string, ...string[]])
        : z.string();
      break;
    default:
      base = z.string();
  }
  if (spec.many) base = z.array(base);
  return spec.required ? base : base.optional();
}

/**
 * Register each action defined in actions/*.md as its own first-class MCP tool.
 * The tool name = action name. Inputs come from the action's `inputs` frontmatter.
 * Agents see every domain action as a direct callable tool — no generic run_action wrapper.
 */
function registerActionTools(server: McpServer, root: string, data: Dataset): void {
  const model = load(root);
  for (const action of model.actions.values()) {
    const fm = action.frontmatter;
    const inputShape: Record<string, z.ZodTypeAny> = {};
    for (const [k, spec] of Object.entries(fm.inputs ?? {})) {
      inputShape[k] = paramToZod(spec);
    }
    // Always allow an optional `scope` override
    inputShape["scope"] = z.string().optional();

    server.tool(
      fm.action,
      fm.description ?? `Execute the ${fm.action} action.`,
      inputShape,
      async (args) => {
        const { scope, ...actionArgs } = args as Record<string, unknown>;
        try {
          return text(await runAction(root, fm.action, actionArgs, typeof scope === "string" ? scope : undefined, data));
        } catch (e) {
          return fail(e);
        }
      }
    );
  }
}

/**
 * Build the MCP server. Static ontology-management tools + dynamic action tools.
 * Pass a resolved dataset (from Dataset.open) to use the configured backend;
 * otherwise defaults to the local SQLite index.
 */
export function buildServer(root: string, version: string, dataset?: Dataset): McpServer {
  const server = new McpServer({ name: "ontolayer", version });
  const data = dataset ?? new Dataset(root);

  // ---- ontology management (static) ----

  server.tool("list_types", "List all types with properties, links, and constraint counts.", {}, async () => {
    try { return text(onto.listTypes(root)); } catch (e) { return fail(e); }
  });

  server.tool("read_type", "Read a type's schema and prose documentation.", { name: z.string() }, async ({ name }) => {
    try { return text(onto.readType(root, name)); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_type",
    "Create a new type (markdown file, git-committed).",
    { name: z.string(), description: z.string().optional(), keys: z.array(z.string()).optional(), properties: z.record(ParamSchema).optional(), links: z.record(LinkSchema).optional(), constraints: z.array(ConstraintSchema).optional() },
    async (args) => { try { return text(onto.createType(root, args)); } catch (e) { return fail(e); } }
  );

  server.tool("add_property", "Add a typed property to a type.", { type: z.string(), name: z.string(), spec: ParamSchema }, async ({ type, name, spec }) => {
    try { return text(onto.addProperty(root, type, name, spec)); } catch (e) { return fail(e); }
  });

  server.tool("add_link", "Add a relationship to a type.", { type: z.string(), name: z.string(), spec: LinkSchema }, async ({ type, name, spec }) => {
    try { return text(onto.addLink(root, type, name, spec)); } catch (e) { return fail(e); }
  });

  server.tool("add_constraint", "Add a constraint to a type.", { type: z.string(), constraint: ConstraintSchema }, async ({ type, constraint }) => {
    try { return text(onto.addConstraint(root, type, constraint)); } catch (e) { return fail(e); }
  });

  server.tool("update_type_doc", "Replace a type's prose body (schema preserved).", { type: z.string(), doc: z.string() }, async ({ type, doc }) => {
    try { return text(onto.updateTypeDoc(root, type, doc)); } catch (e) { return fail(e); }
  });

  server.tool("list_actions", "List all defined actions.", {}, async () => {
    try { return text(onto.listActions(root)); } catch (e) { return fail(e); }
  });

  server.tool("read_action", "Read an action definition.", { name: z.string() }, async ({ name }) => {
    try { return text(onto.readAction(root, name)); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_action",
    "Define a new action (markdown file, git-committed). The action is immediately callable as its own tool on server restart.",
    { name: z.string(), description: z.string().optional(), on: z.string().optional(), inputs: z.record(ParamSchema).optional(), preconditions: z.array(z.string()).optional(), effects: z.array(z.string()).optional() },
    async (args) => { try { return text(onto.createAction(root, args)); } catch (e) { return fail(e); } }
  );

  server.tool("validate", "Validate whole-ontology coherence.", {}, async () => {
    try { return text(onto.validate(root)); } catch (e) { return fail(e); }
  });

  // ---- data layer ----

  server.tool(
    "put", "Create or update an instance (validated against its type schema).",
    { type: z.string(), id: z.string().optional(), scope: z.string().optional(), data: z.record(z.any()) },
    async ({ type, id, scope, data: d }) => { try { return text(await data.put({ type, id, scope, data: d })); } catch (e) { return fail(e); } }
  );

  server.tool("get", "Fetch one instance by type and id.", { type: z.string(), id: z.string(), scope: z.string().optional() }, async ({ type, id, scope }) => {
    try { return text(await data.get(type, id, scope)); } catch (e) { return fail(e); }
  });

  server.tool(
    "query", "List instances of a type with optional field filters.",
    { type: z.string(), filter: z.record(z.any()).optional(), scope: z.string().optional() },
    async ({ type, filter, scope }) => { try { return text(await data.query(type, filter, scope)); } catch (e) { return fail(e); } }
  );

  server.tool("search", "Keyword search over instances of a type.", { type: z.string(), q: z.string(), scope: z.string().optional() }, async ({ type, q, scope }) => {
    try { return text(await data.search(type, q, scope)); } catch (e) { return fail(e); }
  });

  server.tool(
    "traverse", "Follow a link from one instance to related instances (handles 1:1, N:1, 1:N, N:M).",
    { type: z.string(), id: z.string(), link: z.string(), scope: z.string().optional() },
    async ({ type, id, link, scope }) => { try { return text(await data.traverse(type, id, link, scope)); } catch (e) { return fail(e); } }
  );

  server.tool(
    "run_action",
    "Execute any action by name with arbitrary args. Use the action's own named tool instead when available.",
    { action: z.string(), args: z.record(z.any()).optional(), scope: z.string().optional() },
    async ({ action, args, scope }) => {
      try { return text(await runAction(root, action, args ?? {}, scope, data)); } catch (e) { return fail(e); }
    }
  );

  // ---- connectors ----

  server.tool("list_connectors", "List all defined connectors (external data sources).", {}, async () => {
    try { return text(onto.listConnectors(root)); } catch (e) { return fail(e); }
  });

  server.tool("read_connector", "Read a connector definition.", { name: z.string() }, async ({ name }) => {
    try { return text(onto.readConnector(root, name)); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_connector",
    "Define a new connector. `kind` maps to a registered implementation, or set `module` to a JS module path to link a custom one.",
    { name: z.string(), kind: z.string(), description: z.string().optional(), module: z.string().optional(), config: z.record(z.any()).optional(), schedule: z.string().optional() },
    async (args) => { try { return text(onto.createConnector(root, args)); } catch (e) { return fail(e); } }
  );

  server.tool(
    "run_connector",
    "Run a connector: pulls from its source and upserts mapped records into the ontology.",
    { name: z.string() },
    async ({ name }) => { try { return text(await runConnector(root, name, data)); } catch (e) { return fail(e); } }
  );

  server.tool(
    "sync", "Bidirectional incremental sync with a peer ontology folder.",
    { peer: z.string(), types: z.array(z.string()).optional() },
    async ({ peer, types }) => {
      try {
        const b = openStore(peer);
        const res = await syncBidirectional(data.store, b, { types });
        b.close();
        return text(res);
      } catch (e) { return fail(e); }
    }
  );

  // ---- dynamic action tools (one per actions/*.md) ----
  registerActionTools(server, root, data);

  return server;
}

export async function serve(root: string, version: string): Promise<void> {
  // Resolve the configured backend (SQLite by default, Postgres if configured).
  const dataset = await Dataset.open(root);
  const server = buildServer(root, version, dataset);

  // Materialize any existing data/ files into the store before accepting connections.
  const boot = await materialize(root, dataset.store);
  if (boot.ingested > 0 || boot.errors.length > 0)
    console.error(`ontolayer materialize: ${boot.ingested} ingested, ${boot.errors.length} errors`);

  // Watch data/ for edits and re-materialize automatically.
  watchAndMaterialize(root, dataset.store, (r) => {
    if (r.ingested > 0) console.error(`ontolayer watch: ${r.ingested} updated`);
    if (r.errors.length) console.error(`ontolayer watch errors: ${JSON.stringify(r.errors)}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`ontolayer MCP server serving '${root}'`);
  const model = load(root);
  if (model.actions.size > 0)
    console.error(`  dynamic action tools: ${[...model.actions.keys()].join(", ")}`);
  if (model.connectors.size > 0)
    console.error(`  connectors: ${[...model.connectors.keys()].join(", ")}`);
}
