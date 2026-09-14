// webhook-receiver.mjs — Receive a webhook payload → pipeline to objects
//
// This connector is called externally (by a webhook handler, a cron job, or
// another service) with data already in ctx.config.payload. It maps the
// payload to ontology objects and upserts.
//
// Pattern: receive payload → map → upsert
// No fetch, no polling — the caller pushes data in.
//
// Usage (from a webhook handler, e.g. an Express/Hono route):
//   import { runConnector } from "ontolayer/connectors/run.js";
//   app.post("/webhook/slack", async (req, res) => {
//     const result = await runConnector(ontologyRoot, "slack-webhook", dataset, {},
//       { name: "slack-webhook", kind: "custom", module: "connectors/webhook-receiver.mjs",
//         config: { payload: req.body, source: "slack" } });
//     res.json(result);
//   });

export default {
  async sync(ctx) {
    const payload = ctx.config.payload;
    const source = ctx.config.source ?? "webhook";

    if (!payload) return { connector: "webhook", ingested: 0, errors: ["no payload in config"] };

    const events = Array.isArray(payload) ? payload : [payload];
    let ingested = 0;
    const errors = [];

    for (const event of events) {
      try {
        // ── MAPPING — customize per webhook source ──
        // This example maps a Slack-shaped event to a Message object
        if (event.type === "message" && event.text) {
          await ctx.upsert("Message", event.ts, {
            slack_ts: event.ts,
            thread_id: event.thread_ts ?? event.ts,
            author_id: event.user,
            author_kind: event.bot_id ? "Agent" : "Human",
            content: event.text,
          });
          ingested++;
        }

        // add more event type handlers as needed:
        // if (event.type === "channel_created") { ... }
        // if (event.type === "reaction_added") { ... }

      } catch (e) {
        errors.push(`event ${event.ts ?? "?"}: ${e.message}`);
      }
    }

    return { connector: source, ingested, errors };
  },
};
