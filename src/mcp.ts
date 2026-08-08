import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as onto from "./ontology.js";
import { ConstraintSchema, LinkSchema, ParamSchema } from "./types.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function text(obj: unknown): ToolResult {
  return {
    content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
  };
}

function fail(e: unknown): ToolResult {
  return { isError: true, content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
}

/** Build the MCP server exposing read + edit tools over an ontology folder. */
export function buildServer(root: string, version: string): McpServer {
  const server = new McpServer({ name: "ontolayer", version });

  server.tool("list_types", "List all ontology types with their properties, links, and constraint counts.", {}, async () => {
    try {
      return text(onto.listTypes(root));
    } catch (e) {
      return fail(e);
    }
  });

  server.tool(
    "read_type",
    "Read one type: its schema (frontmatter) and its prose documentation.",
    { name: z.string() },
    async ({ name }) => {
      try {
        return text(onto.readType(root, name));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "create_type",
    "Create a new ontology type as a markdown file (git-committed).",
    {
      name: z.string(),
      description: z.string().optional(),
      properties: z.record(ParamSchema).optional(),
      links: z.record(LinkSchema).optional(),
      constraints: z.array(ConstraintSchema).optional(),
    },
    async (args) => {
      try {
        return text(onto.createType(root, args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "add_property",
    "Add a typed property to an existing type.",
    { type: z.string(), name: z.string(), spec: ParamSchema },
    async ({ type, name, spec }) => {
      try {
        return text(onto.addProperty(root, type, name, spec));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "add_link",
    "Add a relationship (link) from one type to another.",
    { type: z.string(), name: z.string(), spec: LinkSchema },
    async ({ type, name, spec }) => {
      try {
        return text(onto.addLink(root, type, name, spec));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "add_constraint",
    "Add a constraint to a type: disjoint | at_most_once | custom.",
    { type: z.string(), constraint: ConstraintSchema },
    async ({ type, constraint }) => {
      try {
        return text(onto.addConstraint(root, type, constraint));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "update_type_doc",
    "Replace the prose documentation body of a type (schema is preserved).",
    { type: z.string(), doc: z.string() },
    async ({ type, doc }) => {
      try {
        return text(onto.updateTypeDoc(root, type, doc));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool("list_actions", "List all defined actions.", {}, async () => {
    try {
      return text(onto.listActions(root));
    } catch (e) {
      return fail(e);
    }
  });

  server.tool(
    "read_action",
    "Read one action definition.",
    { name: z.string() },
    async ({ name }) => {
      try {
        return text(onto.readAction(root, name));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool(
    "create_action",
    "Create a new action definition (typed inputs, preconditions, effects).",
    {
      name: z.string(),
      description: z.string().optional(),
      inputs: z.record(ParamSchema).optional(),
      preconditions: z.array(z.string()).optional(),
      effects: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        return text(onto.createAction(root, args));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.tool("validate", "Validate the whole ontology for coherence (missing link targets, dangling refs).", {}, async () => {
    try {
      return text(onto.validate(root));
    } catch (e) {
      return fail(e);
    }
  });

  return server;
}

/** Start the MCP server over stdio. */
export async function serve(root: string, version: string): Promise<void> {
  const server = buildServer(root, version);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel; log to stderr.
  console.error(`ontolayer MCP server serving '${root}'`);
}
