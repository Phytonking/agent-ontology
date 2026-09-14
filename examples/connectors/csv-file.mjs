// csv-file.mjs — Read a CSV/JSON file dropped in a folder → pipeline to objects
//
// Targets: any object — change the mapping below
// Pattern: read file → parse → map → upsert per row
// No auth, no cursor (file is the batch)
//
// Usage:
//   1. Copy into your ontology folder
//   2. Drop a file at the configured path (or set FILE_PATH env)
//   3. Run: ontology run-connector csv-import /path/to/ontology

import fs from "node:fs";
import path from "node:path";

export default {
  async sync(ctx) {
    const filePath = ctx.config.file ?? ctx.env("FILE_PATH");
    if (!filePath) return { connector: "csv-file", ingested: 0, errors: ["FILE_PATH not set (config.file or env)"] };

    const abs = path.isAbsolute(filePath) ? filePath : path.join(ctx.root, filePath);
    if (!fs.existsSync(abs)) return { connector: "csv-file", ingested: 0, errors: [`file not found: ${abs}`] };

    const ext = path.extname(abs).toLowerCase();
    let rows;

    if (ext === ".json") {
      const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
      rows = Array.isArray(raw) ? raw : [raw];
    } else {
      // simple CSV parser (handles quoted fields, no dep)
      const lines = fs.readFileSync(abs, "utf8").trim().split("\n");
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
      });
    }

    let ingested = 0;
    const errors = [];

    // ── which object are we pipelining to? ──
    const targetType = ctx.config.target_type ?? "Customer";
    const idField = ctx.config.id_field ?? "id";

    for (const row of rows) {
      try {
        const id = row[idField] ?? undefined;
        // ── MAPPING — by default passes the whole row as data ──
        // customize: pick specific fields, rename them, compute derived values
        const data = { ...row };
        delete data[idField]; // id is separate from data

        await ctx.upsert(targetType, id, data);
        ingested++;
      } catch (e) {
        errors.push(`row: ${e.message}`);
      }
    }

    return { connector: "csv-file", ingested, errors };
  },
};
