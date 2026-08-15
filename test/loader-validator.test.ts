import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init } from "../src/scaffold.js";
import { load } from "../src/loader.js";
import { validate } from "../src/validator.js";
import { createType, createAction } from "../src/ontology.js";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "onto-test-")); init(dir); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("loader", () => {
  it("loads all types from init scaffold", () => {
    const m = load(dir);
    expect([...m.types.keys()]).toContain("Order");
    expect([...m.types.keys()]).toContain("Customer");
    expect([...m.types.keys()]).toContain("Product");
    expect([...m.types.keys()]).toContain("OrderItem");
  });
  it("loads actions", () => {
    const m = load(dir);
    expect([...m.actions.keys()]).toContain("issue_refund");
  });
  it("parses enum transitions on Order.status", () => {
    const m = load(dir);
    const status = m.types.get("Order")!.frontmatter.properties!.status;
    expect(status.transitions).toBeDefined();
    expect(status.transitions!["paid"]).toContain("shipped");
  });
});

describe("validate — clean scaffold", () => {
  it("returns no errors on the init scaffold", () => {
    const m = load(dir);
    const probs = validate(m).filter((p) => p.level === "error");
    expect(probs).toHaveLength(0);
  });
});

describe("validate — constraint coherence", () => {
  it("errors on transition to non-existent enum value", () => {
    createType(dir, {
      name: "Ticket",
      properties: {
        status: { type: "enum", values: ["open", "closed"], transitions: { open: ["closed", "NOPE"] } },
      },
    });
    const m = load(dir);
    const errs = validate(m).filter((p) => p.level === "error" && p.where.includes("Ticket"));
    expect(errs.some((e) => e.message.includes("NOPE"))).toBe(true);
  });
  it("errors on conditional that references unknown field", () => {
    createType(dir, {
      name: "Ticket2",
      properties: { state: { type: "string" } },
      constraints: [{ kind: "conditional", if_field: "state", if_value: "x", require: "ghost_field" }],
    });
    const m = load(dir);
    const errs = validate(m).filter((p) => p.level === "error" && p.where.includes("Ticket2"));
    expect(errs.some((e) => e.message.includes("ghost_field"))).toBe(true);
  });
  it("errors on cardinality constraint referencing unknown link", () => {
    createType(dir, {
      name: "Ticket3",
      properties: { name: { type: "string" } },
      constraints: [{ kind: "cardinality", link: "nonexistent", min: 1 }],
    });
    const m = load(dir);
    const errs = validate(m).filter((p) => p.level === "error" && p.where.includes("Ticket3"));
    expect(errs.length).toBeGreaterThan(0);
  });
  it("warns on missing inverse", () => {
    createType(dir, {
      name: "Ticket4",
      properties: { name: { type: "string" } },
      links: { owner: { to: "Customer", cardinality: "one", via: "customer_id", inverse: "tickets" } },
    });
    const m = load(dir);
    const warns = validate(m).filter((p) => p.level === "warning" && p.where.includes("Ticket4"));
    expect(warns.some((w) => w.message.includes("inverse"))).toBe(true);
  });
});
