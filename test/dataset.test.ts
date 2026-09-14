import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init } from "../src/scaffold.js";
import { Dataset } from "../src/data/dataset.js";

let dir: string;
let d: Dataset;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-test-")); init(dir); d = new Dataset(dir); });
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("put validation", () => {
  it("accepts valid Customer", async () => {
    const r = await d.put({ type: "Customer", data: { email: "x@x.com", name: "X" } });
    expect(r._type).toBe("Customer");
  });
  it("rejects bad enum", async () => {
    await expect(d.put({ type: "Order", data: { status: "maybe" } })).rejects.toThrow(/not in enum/);
  });
  it("rejects non-array for many", async () => {
    await expect(d.put({ type: "Order", data: { status: "paid", tags: "nope" } })).rejects.toThrow(/expected array/);
  });
  it("accepts multi-valued tags", async () => {
    const r = await d.put({ type: "Order", data: { status: "paid", tags: ["a", "b"] } });
    expect(r.data.tags).toEqual(["a", "b"]);
  });
});

describe("natural-key upsert + uniqueness", () => {
  it("same email → same id", async () => {
    const r1 = await d.put({ type: "Customer", data: { email: "a@a.com", name: "A" } });
    const r2 = await d.put({ type: "Customer", data: { email: "a@a.com", name: "B" } });
    expect(r1._id).toBe(r2._id);
  });
  it("unique conflict", async () => {
    await d.put({ type: "Customer", data: { email: "a@a.com" } });
    await expect(d.put({ type: "Customer", id: "other", data: { email: "a@a.com" } })).rejects.toThrow(/unique conflict/);
  });
});

describe("transitions", () => {
  it("allows paid → shipped", async () => {
    const o = await d.put({ type: "Order", data: { status: "paid" } });
    const o2 = await d.put({ type: "Order", id: o._id, data: { status: "shipped" } });
    expect(o2.data.status).toBe("shipped");
  });
  it("blocks refunded → shipped", async () => {
    const o = await d.put({ type: "Order", data: { status: "refunded" } });
    await expect(d.put({ type: "Order", id: o._id, data: { status: "shipped" } })).rejects.toThrow(/illegal transition/);
  });
});

describe("traverse", () => {
  it("many-to-one placed_by", async () => {
    const c = await d.put({ type: "Customer", data: { email: "t@t.com" } });
    const o = await d.put({ type: "Order", data: { status: "paid", customer_id: c._id } });
    const t = await d.traverse("Order", o._id, "placed_by");
    expect(t.results.map((r) => r._id)).toContain(c._id);
  });
  it("one-to-many Customer.orders", async () => {
    const c = await d.put({ type: "Customer", data: { email: "t@t.com" } });
    const o = await d.put({ type: "Order", data: { status: "paid", customer_id: c._id } });
    const t = await d.traverse("Customer", c._id, "orders");
    expect(t.results.map((r) => r._id)).toContain(o._id);
  });
  it("many-to-many Order.items", async () => {
    const c = await d.put({ type: "Customer", data: { email: "t@t.com" } });
    const o = await d.put({ type: "Order", data: { status: "paid", customer_id: c._id } });
    const p = await d.put({ type: "Product", data: { sku: "S1", name: "W", price: 10 } });
    await d.put({ type: "OrderItem", data: { order_id: o._id, product_id: p._id, qty: 1 } });
    const t = await d.traverse("Order", o._id, "items");
    expect(t.results.map((r) => r._id)).toContain(p._id);
  });
});
