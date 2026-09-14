import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { init } from "../src/scaffold.js";
import { load } from "../src/loader.js";
import { validate } from "../src/validator.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "onto-test-")); init(dir); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("loader", () => {
  it("loads all objects from init scaffold", () => {
    const m = load(dir);
    expect([...m.objects.keys()]).toContain("Order");
    expect([...m.objects.keys()]).toContain("Customer");
  });
  it("derives types from objects", () => {
    const m = load(dir);
    expect(m.types.has("Order")).toBe(true);
    expect(m.types.get("Order")!.properties.status.type).toBe("enum");
  });
  it("derives actions from objects", () => {
    const m = load(dir);
    expect(m.actions.has("issue_refund")).toBe(true);
    expect(m.actions.get("issue_refund")!.on).toBe("Order");
  });
  it("parses transitions", () => {
    const m = load(dir);
    const t = m.types.get("Order")!.properties.status.transitions!;
    expect(t["paid"]).toContain("shipped");
  });
});

describe("validate", () => {
  it("clean scaffold has no errors", () => {
    const m = load(dir);
    const errs = validate(m).filter((p) => p.level === "error");
    expect(errs).toHaveLength(0);
  });
  it("errors on bad transition target", () => {
    fs.writeFileSync(path.join(dir, "Bad.yaml"), YAML.stringify({
      object: "Bad",
      properties: { s: { type: "enum", values: ["a", "b"], transitions: { a: ["NOPE"] } } },
    }));
    const m = load(dir);
    const errs = validate(m).filter((p) => p.message.includes("NOPE"));
    expect(errs.length).toBeGreaterThan(0);
  });
  it("errors on dangling link target", () => {
    fs.writeFileSync(path.join(dir, "Orphan.yaml"), YAML.stringify({
      object: "Orphan",
      properties: { x: { type: "string" } },
      links: { friend: { to: "Ghost", type: "many-to-one" } },
    }));
    const m = load(dir);
    const errs = validate(m).filter((p) => p.message.includes("Ghost"));
    expect(errs.length).toBeGreaterThan(0);
  });
});
