// postgres-table.mjs — Pull rows from a Postgres table → pipeline to ontology objects
//
// Targets: Customer (or any object — change the mapping)
// Auth:    Connection string from env
// Pattern: query → map → upsert per row → incremental by updated_at
//
// Requires: npm install pg (already a dep of ontolayer)
//
// Usage:
//   1. Copy into your ontology folder
//   2. Set env: SOURCE_DB_URL=postgres://user:pass@host:5432/db
//   3. Run: ontology run-connector pg-customers /path/to/ontology

import pg from "pg";
const { Pool } = pg;

export default {
  async sync(ctx) {
    const url = ctx.config.connection_url ?? ctx.env("SOURCE_DB_URL");
    if (!url) return { connector: "postgres-table", ingested: 0, errors: ["SOURCE_DB_URL not set"] };

    const table = ctx.config.table ?? "customers";
    const pool = new Pool({ connectionString: url, max: 3 });

    try {
      // ── incremental: only rows updated since last run ──
      const since = await ctx.cursor.get("last_updated_at");
      const query = since
        ? `SELECT * FROM ${table} WHERE updated_at > $1 ORDER BY updated_at`
        : `SELECT * FROM ${table} ORDER BY updated_at`;
      const params = since ? [since] : [];
      const { rows } = await pool.query(query, params);

      let ingested = 0;
      const errors = [];
      let maxTs = since ?? "";

      for (const row of rows) {
        try {
          // ── MAPPING — change for your objects ──
          await ctx.upsert("Customer", String(row.id), {
            email: row.email,
            name: row.full_name ?? row.name,
            // add more fields as needed
          });
          ingested++;
          if (row.updated_at && String(row.updated_at) > maxTs) maxTs = String(row.updated_at);
        } catch (e) {
          errors.push(`row ${row.id}: ${e.message}`);
        }
      }

      if (maxTs) await ctx.cursor.set("last_updated_at", maxTs);
      return { connector: "postgres-table", ingested, errors };
    } finally {
      await pool.end();
    }
  },
};
