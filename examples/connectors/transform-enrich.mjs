// transform-enrich.mjs — A transform that enriches records AFTER ingest
//
// Runs as a pipeline step after a connector. Reads data the connector just
// ingested (via the shared bag or by querying), then enriches/derives/links.
//
// Use case: connector dumps raw data → this transform resolves foreign keys,
// computes derived fields, or links records to each other.
//
// Usage in a pipeline (programmatic):
//   import { runPipeline } from "ontolayer/pipelines/run.js";
//   await runPipeline(root, "ingest-and-enrich", [
//     { connector: "raw", connectorDef: { name: "raw", kind: "raw", module: "connectors/my-source.mjs" } },
//     { transform: "enrich", module: "connectors/transform-enrich.mjs" },
//   ], dataset);

export default async function enrich(ctx) {
  const taskIds = ctx.bag.taskIds ?? [];
  let processed = 0;
  const errors = [];

  for (const taskId of taskIds) {
    try {
      const task = await ctx.dataset.get("Task", taskId);
      if (!task) continue;

      // ── example enrichment: derive priority from title keywords ──
      let priority = task.data.priority;
      const title = String(task.data.title ?? "").toLowerCase();
      if (title.includes("urgent") || title.includes("outage")) priority = "urgent";
      else if (title.includes("bug") || title.includes("fix")) priority = "high";

      // ── example enrichment: auto-tag based on content ──
      const tags = [...(task.data.tags ?? [])];
      if (title.includes("auth") && !tags.includes("security")) tags.push("security");
      if (title.includes("test") && !tags.includes("testing")) tags.push("testing");

      // only write back if something changed
      if (priority !== task.data.priority || tags.length !== (task.data.tags ?? []).length) {
        await ctx.upsert("Task", taskId, { ...task.data, priority, tags });
        processed++;
      }
    } catch (e) {
      errors.push(`Task ${taskId}: ${e.message}`);
    }
  }

  return { step: "enrich", kind: "transform", processed, errors };
}
