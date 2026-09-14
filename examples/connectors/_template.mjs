// _template.mjs — Copy this file, fill in the blanks, done.
//
// A connector pulls data from a source and pipelines it to ontology objects.
// The ontology validates every upsert — if the data doesn't match the object
// schema, it's rejected with a clear error. You just map; the framework guards.
//
// Steps to make your own:
//   1. Copy this file into your ontology folder (e.g. connectors/my-source.mjs)
//   2. Fill in: where you fetch, how you map, which objects you upsert to
//   3. Set env vars for secrets (tokens, passwords — never hardcode)
//   4. Run: ontology run-connector my-source /path/to/ontology
//   5. Check data/YourObject/*.yaml — your data is there, validated + versioned
//
// Checklist before shipping:
//   [ ] Uses ctx.env() for secrets (never hardcoded)
//   [ ] Uses stable IDs for upsert (same source ID = same record, not duplicates)
//   [ ] Catches errors per-item (one bad record doesn't abort the batch)
//   [ ] Uses ctx.cursor for incremental sync (only fetches new/changed items)
//   [ ] Works in dry-run mode (ctx.dryRun — validates without writing)

export default {
  async sync(ctx) {
    // ── 1. CONNECT TO YOUR SOURCE ──
    const token = ctx.env("MY_SOURCE_TOKEN"); // secret from env
    const baseUrl = ctx.config.url ?? "https://api.example.com/items";

    if (!token) return { connector: "my-source", ingested: 0, errors: ["MY_SOURCE_TOKEN not set"] };

    // ── 2. FETCH DATA (with optional incremental cursor) ──
    const since = await ctx.cursor.get("last_sync");
    const url = since ? `${baseUrl}?since=${since}` : baseUrl;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { connector: "my-source", ingested: 0, errors: [`HTTP ${res.status}`] };
    const items = await res.json();

    // ── 3. MAP + UPSERT TO ONTOLOGY OBJECTS ──
    let ingested = 0;
    const errors = [];

    for (const item of items) {
      try {
        await ctx.upsert(
          "MyObject",           // ← which object in your ontology
          item.id,              // ← stable source ID (for upsert, not dup)
          {
            name: item.title,   // ← map source fields to object properties
            status: item.state,
            // ... add your mappings here
          }
        );
        ingested++;
      } catch (e) {
        errors.push(`${item.id}: ${e.message}`); // catch per-item, don't abort
      }
    }

    // ── 4. ADVANCE CURSOR (for next incremental run) ──
    await ctx.cursor.set("last_sync", new Date().toISOString());

    // ── 5. RETURN RESULT ──
    return { connector: "my-source", ingested, errors };
  },
};
