import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildServer } from "./mcp.js";
import { Dataset } from "./data/dataset.js";
import { materialize, watchAndMaterialize } from "./data/materialize.js";
import { load } from "./loader.js";

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Run the ontology as a long-lived network service (MCP Streamable HTTP).
 * One shared dataset (materialized + watched); one MCP server per session.
 *
 *   POST   /mcp     JSON-RPC (initialize creates a session)
 *   GET    /mcp     SSE stream for a session
 *   DELETE /mcp     end a session
 *   GET    /health  liveness + ontology name
 */
export async function serveHttp(root: string, version: string, port: number): Promise<void> {
  const dataset = await Dataset.open(root);

  const boot = await materialize(root, dataset.store);
  if (boot.ingested > 0 || boot.errors.length > 0)
    console.error(`ontolayer materialize: ${boot.ingested} ingested, ${boot.errors.length} errors`);
  watchAndMaterialize(root, dataset.store, (r) => {
    if (r.ingested > 0) console.error(`ontolayer watch: ${r.ingested} updated`);
    if (r.errors.length) console.error(`ontolayer watch errors: ${JSON.stringify(r.errors)}`);
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      const model = load(root);
      return json(res, 200, {
        ok: true,
        ontology: model.config.name,
        types: model.types.size,
        actions: model.actions.size,
        connectors: model.connectors.size,
        pipelines: model.pipelines.size,
      });
    }

    if (url.pathname !== "/mcp") return json(res, 404, { error: "not found" });

    const sid = req.headers["mcp-session-id"] as string | undefined;

    try {
      if (req.method === "POST") {
        const body = await readBody(req);
        let transport = sid ? transports.get(sid) : undefined;

        if (!transport) {
          if (!isInitializeRequest(body)) {
            return json(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "No valid session — send initialize first" }, id: null });
          }
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => { transports.set(id, transport!); },
          });
          transport.onclose = () => { if (transport!.sessionId) transports.delete(transport!.sessionId); };
          const mcp = buildServer(root, version, dataset);
          await mcp.connect(transport);
        }
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        const transport = sid ? transports.get(sid) : undefined;
        if (!transport) return json(res, 400, { error: "invalid or missing session id" });
        await transport.handleRequest(req, res);
        return;
      }

      return json(res, 405, { error: "method not allowed" });
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    }
  });

  server.listen(port, () => {
    const model = load(root);
    console.error(`ontolayer HTTP server on :${port}  (POST /mcp · GET /health) serving '${model.config.name}'`);
    if (model.actions.size) console.error(`  action tools: ${[...model.actions.keys()].join(", ")}`);
  });
}
