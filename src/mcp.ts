import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as onto from "./ontology.js";
import { load } from "./loader.js";
import { PropertyDef, LinkDef, ActionDef, ConstraintSchema, type PropertyDef as PD } from "./types.js";
import { Dataset, openStore } from "./data/dataset.js";
import { syncBidirectional } from "./data/sync.js";
import { runAction } from "./data/actions.js";
import { materialize, watchAndMaterialize } from "./data/materialize.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
function text(obj: unknown): ToolResult {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}
function fail(e: unknown): ToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
}

function paramToZod(spec: PD): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (spec.type) {
    case "int": case "float": case "money": base = z.number(); break;
    case "bool": base = z.boolean(); break;
    case "json": base = z.any(); break;
    case "enum": base = spec.values?.length ? z.enum(spec.values as [string, ...string[]]) : z.string(); break;
    default: base = z.string();
  }
  if (spec.many) base = z.array(base);
  return spec.required ? base : base.optional();
}

function registerActionTools(server: McpServer, root: string, data: Dataset): void {
  const model = load(root);
  for (const action of model.actions.values()) {
    const inputShape: Record<string, z.ZodTypeAny> = {};
    for (const [k, spec] of Object.entries(action.def.inputs ?? {})) {
      inputShape[k] = paramToZod(spec);
    }
    inputShape["scope"] = z.string().optional();
    server.tool(
      action.name,
      action.def.description ?? `Execute the ${action.name} action on ${action.on}.`,
      inputShape,
      async (args) => {
        const { scope, ...actionArgs } = args as Record<string, unknown>;
        try { return text(await runAction(root, action.name, actionArgs, typeof scope === "string" ? scope : undefined, data)); }
        catch (e) { return fail(e); }
      }
    );
  }
}

export function buildServer(root: string, version: string, dataset?: Dataset): McpServer {
  const server = new McpServer({ name: "ontolayer", version });
  const data = dataset ?? new Dataset(root);

  // ---- discover ----
  server.tool("list_objects", "List all objects in the ontology.", {}, async () => {
    try { return text(onto.listObjects(root)); } catch (e) { return fail(e); }
  });
  server.tool("read_object", "Read an object's full definition (properties, links, actions).", { name: z.string() }, async ({ name }) => {
    try { return text(onto.readObject(root, name)); } catch (e) { return fail(e); }
  });

  // ---- edit ontology ----
  server.tool("create_object", "Create a new object file (git-committed).", {
    name: z.string(), keys: z.array(z.string()).optional(),
    properties: z.record(PropertyDef).optional(), links: z.record(LinkDef).optional(),
    actions: z.record(ActionDef).optional(), constraints: z.array(ConstraintSchema).optional(),
  }, async (args) => { try { return text(onto.createObject(root, args)); } catch (e) { return fail(e); } });

  server.tool("add_property", "Add a property to an object.", { object: z.string(), name: z.string(), spec: PropertyDef }, async ({ object, name, spec }) => {
    try { return text(onto.addProperty(root, object, name, spec)); } catch (e) { return fail(e); }
  });
  server.tool("add_link", "Add a link to an object.", { object: z.string(), name: z.string(), spec: LinkDef }, async ({ object, name, spec }) => {
    try { return text(onto.addLink(root, object, name, spec)); } catch (e) { return fail(e); }
  });
  server.tool("add_action", "Add an action to an object.", { object: z.string(), name: z.string(), def: ActionDef }, async ({ object, name, def: d }) => {
    try { return text(onto.addAction(root, object, name, d)); } catch (e) { return fail(e); }
  });
  server.tool("add_constraint", "Add a constraint to an object.", { object: z.string(), constraint: ConstraintSchema }, async ({ object, constraint }) => {
    try { return text(onto.addConstraint(root, object, constraint)); } catch (e) { return fail(e); }
  });
  server.tool("validate", "Validate the whole ontology for coherence.", {}, async () => {
    try { return text(onto.validate(root)); } catch (e) { return fail(e); }
  });

  // ---- data ----
  server.tool("put", "Create/update an instance (validated against its object schema).",
    { type: z.string(), id: z.string().optional(), scope: z.string().optional(), data: z.record(z.any()) },
    async ({ type, id, scope, data: d }) => { try { return text(await data.put({ type, id, scope, data: d })); } catch (e) { return fail(e); } }
  );
  server.tool("get", "Fetch one instance.", { type: z.string(), id: z.string(), scope: z.string().optional() }, async ({ type, id, scope }) => {
    try { return text(await data.get(type, id, scope)); } catch (e) { return fail(e); }
  });
  server.tool("query", "List instances with optional field filters.", { type: z.string(), filter: z.record(z.any()).optional(), scope: z.string().optional() }, async ({ type, filter, scope }) => {
    try { return text(await data.query(type, filter, scope)); } catch (e) { return fail(e); }
  });
  server.tool("search", "Keyword search over instances.", { type: z.string(), q: z.string(), scope: z.string().optional() }, async ({ type, q, scope }) => {
    try { return text(await data.search(type, q, scope)); } catch (e) { return fail(e); }
  });
  server.tool("traverse", "Follow a link from one instance to related instances.",
    { type: z.string(), id: z.string(), link: z.string(), scope: z.string().optional() },
    async ({ type, id, link, scope }) => { try { return text(await data.traverse(type, id, link, scope)); } catch (e) { return fail(e); } }
  );
  server.tool("run_action", "Execute any action by name.", { action: z.string(), args: z.record(z.any()).optional(), scope: z.string().optional() },
    async ({ action, args, scope }) => { try { return text(await runAction(root, action, args ?? {}, scope, data)); } catch (e) { return fail(e); } }
  );
  server.tool("sync", "Bidirectional incremental sync with a peer ontology.",
    { peer: z.string(), types: z.array(z.string()).optional() },
    async ({ peer, types }) => {
      try { const b = openStore(peer); const res = await syncBidirectional(data.store, b, { types }); b.close(); return text(res); }
      catch (e) { return fail(e); }
    }
  );

  // ---- dynamic action tools (one per action in the object files) ----
  registerActionTools(server, root, data);

  return server;
}

export async function serve(root: string, version: string): Promise<void> {
  const dataset = await Dataset.open(root);
  const server = buildServer(root, version, dataset);
  const boot = await materialize(root, dataset.store);
  if (boot.ingested > 0 || boot.errors.length > 0)
    console.error(`ontolayer materialize: ${boot.ingested} ingested, ${boot.errors.length} errors`);
  watchAndMaterialize(root, dataset.store, (r) => {
    if (r.ingested > 0) console.error(`ontolayer watch: ${r.ingested} updated`);
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const model = load(root);
  console.error(`ontolayer serving '${model.config.name}' (${model.objects.size} objects, ${model.actions.size} actions)`);
}
