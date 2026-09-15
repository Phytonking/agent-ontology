import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TypedSqliteStore } from "../src/data/typed-sqlite-store.js";
import { syncBidirectional } from "../src/data/sync.js";

let dir: string;
let sa: TypedSqliteStore, sb: TypedSqliteStore;
const testTypes = new Map([["X", { name: "X", properties: { v: { type: "string" as const } }, links: {}, constraints: [], keys: [] }]]);
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-test-"));
  sa = new TypedSqliteStore(path.join(dir, "a.db"), "a", testTypes);
  sb = new TypedSqliteStore(path.join(dir, "b.db"), "b", testTypes);
});
afterEach(() => { sa.close(); sb.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("store CRUD", () => {
  it("upserts and gets", async () => {
    const r = await sa.upsert({ type: "X", id: "1", data: { v: "hello" } });
    expect(r._id).toBe("1");
    expect((await sa.get("X", "1"))?.data.v).toBe("hello");
  });
  it("skips write when hash matches", async () => {
    const r1 = await sa.upsert({ type: "X", id: "1", data: { v: "hi" } });
    const r2 = await sa.upsert({ type: "X", id: "1", data: { v: "hi" } });
    expect(r1._version).toBe(r2._version);
  });
  it("bumps version on change", async () => {
    const r1 = await sa.upsert({ type: "X", id: "1", data: { v: "a" } });
    const r2 = await sa.upsert({ type: "X", id: "1", data: { v: "b" } });
    expect(r2._version).toBeGreaterThan(r1._version);
  });
  it("marks deleted", async () => {
    await sa.upsert({ type: "X", id: "1", data: { v: "a" } });
    await sa.remove("X", "1");
    expect(await sa.get("X", "1")).toBeNull();
  });
  it("keyword search", async () => {
    await sa.upsert({ type: "X", id: "1", data: { v: "alpha beta" } });
    await sa.upsert({ type: "X", id: "2", data: { v: "gamma delta" } });
    const res = await sa.search("X", "alpha");
    expect(res.map((r) => r._id)).toContain("1");
    expect(res.map((r) => r._id)).not.toContain("2");
  });
});

describe("sync", () => {
  it("syncs new records", async () => {
    await sa.upsert({ type: "X", id: "1", data: { v: "hi" } });
    const res = await syncBidirectional(sa, sb);
    expect(res.ab.applied).toBe(1);
    expect(await sb.get("X", "1")).toBeTruthy();
  });
  it("second sync is a no-op", async () => {
    await sa.upsert({ type: "X", id: "1", data: { v: "hi" } });
    await syncBidirectional(sa, sb);
    const res2 = await syncBidirectional(sa, sb);
    expect(res2.ab.applied).toBe(0);
    expect(res2.ab.lastSeq).toBeGreaterThan(0);
  });
  it("no echo loop", async () => {
    await sa.upsert({ type: "X", id: "1", data: { v: "hi" } });
    await syncBidirectional(sa, sb);
    const res3 = await syncBidirectional(sa, sb);
    expect(res3.ba.applied).toBe(0);
  });
  it("LWW: newer version wins", async () => {
    await sa.upsert({ type: "X", id: "1", data: { v: "old" } });
    await syncBidirectional(sa, sb);
    await sb.upsert({ type: "X", id: "1", data: { v: "new" } });
    await syncBidirectional(sa, sb);
    expect((await sa.get("X", "1"))?.data.v).toBe("new");
  });
  it("syncs deletes", async () => {
    await sa.upsert({ type: "X", id: "1", data: { v: "hi" } });
    await syncBidirectional(sa, sb);
    await sa.remove("X", "1");
    await syncBidirectional(sa, sb);
    expect(await sb.get("X", "1")).toBeNull();
  });
});
