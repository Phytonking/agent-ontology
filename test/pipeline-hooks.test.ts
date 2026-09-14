import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initOffice } from "../src/scaffold-office.js";
import { Dataset } from "../src/data/dataset.js";
import { registerConnector, defineConnector } from "../src/connectors/registry.js";
import { registerTransform, defineTransform } from "../src/transforms/registry.js";
import { runPipeline } from "../src/pipelines/run.js";

let dir: string;
let d: Dataset;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipe-test-")); initOffice(dir); d = new Dataset(dir); });
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("hooks", () => {
  it("beforePut derives a field", async () => {
    d.use({ beforePut: (input) => {
      if (input.type === "Agent" && !input.data.name && input.data.handle)
        return { ...input.data, name: String(input.data.handle).replace("@", "") };
    }});
    const a = await d.put({ type: "Agent", data: { handle: "@derived", status: "idle" } });
    expect(a.data.name).toBe("derived");
  });
  it("afterPut fires", async () => {
    const seen: string[] = [];
    d.use({ afterPut: (rec) => { seen.push(rec._type); } });
    await d.put({ type: "Team", data: { slug: "eng", name: "Eng" } });
    expect(seen).toContain("Team");
  });
});

describe("pipeline", () => {
  it("composes connector + transform with shared bag", async () => {
    registerConnector("raw", () => defineConnector(async (ctx) => {
      const ids: string[] = [];
      for (const h of ["@x", "@y"]) {
        const r = await ctx.upsert("Agent", h.replace("@", ""), { handle: h, name: h, status: "idle" });
        ids.push(r._id);
      }
      ctx.bag.agentIds = ids;
      return { connector: ctx.def.name, ingested: ids.length, errors: [] };
    }));
    registerTransform("group", defineTransform(async (ctx) => {
      const ids = (ctx.bag.agentIds as string[]) ?? [];
      await ctx.upsert("Team", "grp", { slug: "grp", name: "Grouped" });
      for (const id of ids) {
        const rec = await ctx.dataset.get("Agent", id);
        await ctx.upsert("Agent", id, { ...rec!.data, team_id: "grp" });
      }
      return { step: "group", kind: "transform", processed: ids.length, errors: [] };
    }));
    const res = await runPipeline(dir, "test-pipe", [
      { connector: "raw", connectorDef: { name: "raw", kind: "raw" } },
      { transform: "group" },
    ], d);
    expect(res.errors).toHaveLength(0);
    expect(res.steps[0].processed).toBe(2);
    expect((await d.traverse("Team", "grp", "agents")).results.length).toBe(2);
  });
});
