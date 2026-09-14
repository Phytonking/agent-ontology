import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initOffice } from "../src/scaffold-office.js";
import { Dataset } from "../src/data/dataset.js";
import { registerConnector, defineConnector } from "../src/connectors/registry.js";
import { runConnector } from "../src/connectors/run.js";

let dir: string;
let d: Dataset;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "conn-test-")); initOffice(dir); d = new Dataset(dir); });
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("registered connector", () => {
  it("runs and ingests records", async () => {
    registerConnector("mock", () =>
      defineConnector(async (ctx) => {
        let n = 0;
        for (const h of ["@a", "@b"]) {
          await ctx.upsert("Agent", h.replace("@", ""), { handle: h, name: h, status: "idle" });
          n++;
        }
        return { connector: ctx.def.name, ingested: n, errors: [] };
      })
    );
    const res = await runConnector(dir, "mock", d, {}, { name: "mock", kind: "mock" });
    expect(res.ingested).toBe(2);
    expect(fs.existsSync(path.join(dir, "data", "Agent", "a.yaml"))).toBe(true);
  });

  it("validates writes (bad data rejected)", async () => {
    registerConnector("bad", () =>
      defineConnector(async (ctx) => {
        const errors: string[] = [];
        try { await ctx.upsert("Agent", "x", { name: "no handle", status: "flying" }); }
        catch (e) { errors.push((e as Error).message); }
        return { connector: ctx.def.name, ingested: 0, errors };
      })
    );
    const res = await runConnector(dir, "bad", d, {}, { name: "bad", kind: "bad" });
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("reports missing implementation", async () => {
    const res = await runConnector(dir, "ghost", d, {}, { name: "ghost", kind: "ghost" });
    expect(res.errors[0]).toMatch(/no implementation/);
  });
});
