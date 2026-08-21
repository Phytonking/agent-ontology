import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initOffice } from "../src/scaffold-office.js";
import { Dataset } from "../src/data/dataset.js";
import { createConnector, listConnectors } from "../src/ontology.js";
import { registerConnector, defineConnector } from "../src/connectors/registry.js";
import { runConnector } from "../src/connectors/run.js";

let dir: string;
let d: Dataset;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "conn-test-"));
  initOffice(dir);
  d = new Dataset(dir);
});
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("connector definitions", () => {
  it("create_connector writes a file and lists it", () => {
    createConnector(dir, { name: "mock-source", kind: "mock", description: "test", config: { count: 3 } });
    const list = listConnectors(dir);
    expect(list.map((c) => c.name)).toContain("mock-source");
    expect(list.find((c) => c.name === "mock-source")?.kind).toBe("mock");
    expect(fs.existsSync(path.join(dir, "connectors", "mock-source.md"))).toBe(true);
  });
});

describe("registered connector", () => {
  it("runs a registered connector kind and ingests records", async () => {
    // A mock connector that creates N agents from its config.
    registerConnector("mock", () =>
      defineConnector(async (ctx) => {
        const count = Number(ctx.config.count ?? 0);
        let ingested = 0;
        for (let i = 0; i < count; i++) {
          await ctx.upsert("Agent", `mock-agent-${i}`, {
            handle: `@mock${i}`,
            name: `Mock Agent ${i}`,
            status: "idle",
          });
          ingested++;
        }
        return { connector: ctx.def.connector, ingested, errors: [] };
      })
    );

    createConnector(dir, { name: "mock-agents", kind: "mock", config: { count: 3 } });
    const res = await runConnector(dir, "mock-agents", d);
    expect(res.ingested).toBe(3);
    expect(res.errors).toHaveLength(0);

    const agents = await d.query("Agent");
    expect(agents.length).toBe(3);
    // and files were written by the pipeline
    expect(fs.existsSync(path.join(dir, "data", "Agent", "mock-agent-0.yaml"))).toBe(true);
  });

  it("connector writes go through validation (bad data rejected via error)", async () => {
    registerConnector("bad", () =>
      defineConnector(async (ctx) => {
        const errors: string[] = [];
        try {
          await ctx.upsert("Agent", "x", { name: "no handle, bad status", status: "flying" });
        } catch (e) {
          errors.push((e as Error).message);
        }
        return { connector: ctx.def.connector, ingested: 0, errors };
      })
    );
    createConnector(dir, { name: "bad-source", kind: "bad" });
    const res = await runConnector(dir, "bad-source", d);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toMatch(/not in enum|status/);
  });

  it("reports missing implementation for an unregistered kind", async () => {
    createConnector(dir, { name: "ghost", kind: "does-not-exist" });
    const res = await runConnector(dir, "ghost", d);
    expect(res.ingested).toBe(0);
    expect(res.errors[0]).toMatch(/no implementation registered/);
  });

  it("reports unknown connector name", async () => {
    const res = await runConnector(dir, "nope", d);
    expect(res.errors[0]).toMatch(/not found/);
  });
});

describe("module-linked connector", () => {
  it("loads a connector from a module: path", async () => {
    // Write a connector implementation module into the ontology folder.
    const implDir = path.join(dir, "connectors", "impl");
    fs.mkdirSync(implDir, { recursive: true });
    fs.writeFileSync(
      path.join(implDir, "team-import.mjs"),
      `export default {
        async sync(ctx) {
          await ctx.upsert("Team", "eng", { slug: "eng", name: "Engineering", purpose: "Build things" });
          return { connector: ctx.def.connector, ingested: 1, errors: [] };
        }
      };\n`
    );
    createConnector(dir, { name: "team-import", kind: "custom", module: "connectors/impl/team-import.mjs" });
    const res = await runConnector(dir, "team-import", d);
    expect(res.ingested).toBe(1);
    const team = await d.get("Team", "eng");
    expect(team?.data.name).toBe("Engineering");
  });
});
