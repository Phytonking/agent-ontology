import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { init } from "../src/scaffold.js";
import { Dataset } from "../src/data/dataset.js";
import { runAction } from "../src/data/actions.js";

let dir: string;
let d: Dataset;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "act-test-"));
  init(dir);
  d = new Dataset(dir);
});
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("run_action issue_refund", () => {
  it("happy path: refunds a paid order", async () => {
    const c = await d.put({ type: "Customer", data: { email: "x@x.com" } });
    const o = await d.put({ type: "Order", data: { status: "paid", customer_id: c._id } });
    const res = await runAction(dir, "issue_refund", { order_id: o._id });
    expect(res.status).toBe("ok");
    expect(res.record?.data.status).toBe("refunded");
  });
  it("rejects refunding an already-refunded order (transition)", async () => {
    const c = await d.put({ type: "Customer", data: { email: "x@x.com" } });
    const o = await d.put({ type: "Order", data: { status: "refunded", customer_id: c._id } });
    const res = await runAction(dir, "issue_refund", { order_id: o._id });
    expect(res.status).toBe("rejected");
  });
  it("rejects when precondition fails", async () => {
    const c = await d.put({ type: "Customer", data: { email: "x@x.com" } });
    const o = await d.put({ type: "Order", data: { status: "refunded", customer_id: c._id } });
    const res = await runAction(dir, "issue_refund", { order_id: o._id });
    expect(res.status).toBe("rejected");
    expect(res.reason).toMatch(/precondition|transition/);
  });
  it("rejects missing required input", async () => {
    const res = await runAction(dir, "issue_refund", {});
    expect(res.status).toBe("rejected");
    expect(res.reason).toMatch(/order_id/);
  });
  it("rejects unknown action", async () => {
    const res = await runAction(dir, "nonexistent", {});
    expect(res.status).toBe("rejected");
  });
  it("rejects unknown order id", async () => {
    const res = await runAction(dir, "issue_refund", { order_id: "ghost" });
    expect(res.status).toBe("rejected");
  });
});
