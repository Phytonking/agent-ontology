import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initOffice } from "../src/scaffold-office.js";
import { Dataset } from "../src/data/dataset.js";
import { registerConnector, defineConnector } from "../src/connectors/registry.js";
import { registerTransform, defineTransform } from "../src/transforms/registry.js";
import { createConnector, createPipeline, listPipelines } from "../src/ontology.js";
import { runPipeline } from "../src/pipelines/run.js";

let dir: string;
let d: Dataset;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipe-test-"));
  initOffice(dir);
  d = new Dataset(dir);
});
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("write hooks (middleware)", () => {
  it("beforePut derives a field before validation", async () => {
    d.use({
      beforePut: (input) => {
        if (input.type === "Agent" && !input.data.name && input.data.handle) {
          return { ...input.data, name: String(input.data.handle).replace("@", "") };
        }
      },
    });
    const a = await d.put({ type: "Agent", data: { handle: "@derived", status: "idle" } });
    expect(a.data.name).toBe("derived"); // required field filled by hook
  });

  it("afterPut fires with the stored record", async () => {
    const seen: string[] = [];
    d.use({ afterPut: (rec) => { seen.push(`${rec._type}/${rec._id}`); } });
    const t = await d.put({ type: "Team", data: { slug: "eng", name: "Eng" } });
    expect(seen).toContain(`Team/${t._id}`);
  });

  it("hooks apply to writes made through connectors", async () => {
    let afterCount = 0;
    d.use({ afterPut: () => { afterCount++; } });
    registerConnector("hooked", () => defineConnector(async (ctx) => {
      await ctx.upsert("Team", "t1", { slug: "t1", name: "Team One" });
      return { connector: ctx.def.connector, ingested: 1, errors: [] };
    }));
    createConnector(dir, { name: "hooked-src", kind: "hooked" });
    const { runConnector } = await import("../src/connectors/run.js");
    await runConnector(dir, "hooked-src", d);
    expect(afterCount).toBeGreaterThan(0);
  });
});

describe("transforms", () => {
  it("registered transform runs and upserts", async () => {
    registerTransform("seed-teams", defineTransform(async (ctx) => {
      await ctx.upsert("Team", "sales", { slug: "sales", name: "Sales" });
      return { step: "seed-teams", kind: "transform", processed: 1, errors: [] };
    }));
    createPipeline(dir, { name: "seed", steps: [{ transform: "seed-teams" }] });
    const res = await runPipeline(dir, "seed", d);
    expect(res.steps[0].processed).toBe(1);
    expect((await d.get("Team", "sales"))?.data.name).toBe("Sales");
  });
});

describe("pipelines", () => {
  it("composes connector + transform, threading the shared bag", async () => {
    // connector stashes raw ids in the bag
    registerConnector("raw-agents", () => defineConnector(async (ctx) => {
      const ids: string[] = [];
      for (const h of ["@a", "@b"]) {
        const r = await ctx.upsert("Agent", h.replace("@", ""), { handle: h, name: h, status: "idle" });
        ids.push(r._id);
      }
      ctx.bag.agentIds = ids;
      return { connector: ctx.def.connector, ingested: ids.length, errors: [] };
    }));
    // transform reads the bag and creates a team, links via team_id
    registerTransform("group-into-team", defineTransform(async (ctx) => {
      const ids = (ctx.bag.agentIds as string[]) ?? [];
      await ctx.upsert("Team", "grp", { slug: "grp", name: "Grouped" });
      for (const id of ids) {
        const rec = await ctx.dataset.get("Agent", id);
        await ctx.upsert("Agent", id, { ...rec!.data, team_id: "grp" });
      }
      return { step: "group-into-team", kind: "transform", processed: ids.length, errors: [] };
    }));

    createConnector(dir, { name: "raw-agents-src", kind: "raw-agents" });
    createPipeline(dir, {
      name: "ingest-and-group",
      steps: [{ connector: "raw-agents-src" }, { transform: "group-into-team" }],
    });

    const res = await runPipeline(dir, "ingest-and-group", d);
    expect(res.errors).toHaveLength(0);
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].processed).toBe(2);
    expect(res.steps[1].processed).toBe(2);

    // both agents now linked to the team
    const team = await d.traverse("Team", "grp", "agents");
    expect(team.results.length).toBe(2);
  });

  it("lists pipelines and records step errors without throwing", async () => {
    createPipeline(dir, { name: "broken", steps: [{ transform: "does-not-exist" }] });
    expect(listPipelines(dir).map((p) => p.name)).toContain("broken");
    const res = await runPipeline(dir, "broken", d);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.steps[0].errors[0]).toMatch(/not registered/);
  });
});
