// rest-api.mjs — Pull from a REST API → pipeline to ontology objects
//
// Targets: Agent, Tool (or any objects in your ontology)
// Auth:    Bearer token from env
// Pattern: fetch → map → upsert per item → incremental via cursor
//
// Usage:
//   1. Copy this file into your ontology folder (e.g. connectors/my-api.mjs)
//   2. Set env: MY_API_TOKEN=... MY_API_URL=https://api.example.com/agents
//   3. Run: node dist/cli.js run-connector my-api /path/to/ontology
//      Or reference it from a connector def with module: connectors/my-api.mjs

export default {
  async sync(ctx) {
    const token = ctx.env("MY_API_TOKEN");
    const baseUrl = ctx.config.url ?? ctx.env("MY_API_URL") ?? "https://api.example.com/agents";

    if (!token) return { connector: "rest-api", ingested: 0, errors: ["MY_API_TOKEN not set"] };

    // ── incremental: resume from where we left off ──
    const lastModified = await ctx.cursor.get("last_modified");
    const url = lastModified ? `${baseUrl}?modified_since=${lastModified}` : baseUrl;

    // ── fetch (handle pagination if your API uses it) ──
    let items = [];
    let nextUrl = url;
    while (nextUrl) {
      const res = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!res.ok) return { connector: "rest-api", ingested: 0, errors: [`HTTP ${res.status}: ${await res.text()}`] };
      const body = await res.json();
      items.push(...(Array.isArray(body) ? body : body.data ?? []));
      // common pagination: Link header or body.next
      nextUrl = body.next ?? null;
    }

    // ── map each item to an ontology object and upsert ──
    let ingested = 0;
    const errors = [];
    let maxModified = lastModified ?? "";

    for (const item of items) {
      try {
        // ── THIS IS THE MAPPING — change these lines for your objects ──
        await ctx.upsert("Agent", item.id, {
          handle: `@${item.username}`,
          name: item.display_name,
          role: item.role ?? "agent",
          status: "idle",
          model: item.model ?? null,
        });
        ingested++;

        // track the latest modified timestamp for next run
        if (item.updated_at && item.updated_at > maxModified) maxModified = item.updated_at;
      } catch (e) {
        errors.push(`${item.id}: ${e.message}`);
      }
    }

    // ── advance cursor so next run only gets new/changed items ──
    if (maxModified) await ctx.cursor.set("last_modified", maxModified);

    return { connector: "rest-api", ingested, errors };
  },
};
