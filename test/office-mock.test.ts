import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { initOffice } from "../src/scaffold-office.js";
import { Dataset } from "../src/data/dataset.js";
import { materialize } from "../src/data/materialize.js";
import { runAction } from "../src/data/actions.js";

let dir: string;
let d: Dataset;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-test-")); initOffice(dir); d = new Dataset(dir); });
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function seedAgents() {
  const r = await d.put({ type: "Agent", id: "researcher", data: { handle: "@researcher", name: "Research Agent", role: "researcher", status: "idle" } });
  const c = await d.put({ type: "Agent", id: "coder", data: { handle: "@coder", name: "Coder Agent", role: "coder", status: "idle" } });
  return { researcher: r, coder: c };
}

async function seedTask(extra: Record<string, unknown> = {}) {
  return d.put({ type: "Task", id: `task-${Date.now()}`, data: { title: "Test", status: "backlog", priority: "medium", ...extra } });
}

describe("agent roster", () => {
  it("seeds and queries", async () => {
    await seedAgents();
    expect((await d.query("Agent")).length).toBe(2);
    expect((await d.query("Agent", { status: "idle" })).length).toBe(2);
  });
  it("rejects dup handle", async () => {
    await d.put({ type: "Agent", id: "a1", data: { handle: "@dup", name: "A", status: "idle" } });
    await expect(d.put({ type: "Agent", id: "a2", data: { handle: "@dup", name: "B", status: "idle" } })).rejects.toThrow(/unique/);
  });
});

describe("task lifecycle", () => {
  it("full path: backlog → done", async () => {
    const task = await seedTask();
    expect((await runAction(dir, "assign_task", { task_id: task._id, agent_id: "r" }, "shared", d)).record?.data.status).toBe("assigned");
    expect((await runAction(dir, "start_task", { task_id: task._id }, "shared", d)).record?.data.status).toBe("in_progress");
    expect((await runAction(dir, "submit_for_review", { task_id: task._id }, "shared", d)).record?.data.status).toBe("review");
    expect((await runAction(dir, "complete_task", { task_id: task._id }, "shared", d)).record?.data.status).toBe("done");
  });
  it("blocks then resumes", async () => {
    const task = await seedTask();
    await runAction(dir, "assign_task", { task_id: task._id, agent_id: "r" }, "shared", d);
    await runAction(dir, "start_task", { task_id: task._id }, "shared", d);
    expect((await runAction(dir, "block_task", { task_id: task._id }, "shared", d)).record?.data.status).toBe("blocked");
    expect((await runAction(dir, "start_task", { task_id: task._id }, "shared", d)).record?.data.status).toBe("in_progress");
  });
  it("escalates to backlog", async () => {
    const task = await seedTask();
    await runAction(dir, "assign_task", { task_id: task._id, agent_id: "r" }, "shared", d);
    await runAction(dir, "start_task", { task_id: task._id }, "shared", d);
    expect((await runAction(dir, "escalate_task", { task_id: task._id }, "shared", d)).record?.data.status).toBe("backlog");
  });
  it("rejects done → in_progress", async () => {
    const task = await seedTask();
    await runAction(dir, "assign_task", { task_id: task._id, agent_id: "r" }, "shared", d);
    await runAction(dir, "start_task", { task_id: task._id }, "shared", d);
    await runAction(dir, "submit_for_review", { task_id: task._id }, "shared", d);
    await runAction(dir, "complete_task", { task_id: task._id }, "shared", d);
    expect((await runAction(dir, "start_task", { task_id: task._id }, "shared", d)).status).toBe("rejected");
  });
});

describe("file↔DB binding", () => {
  it("put writes a YAML file", async () => {
    const task = await seedTask({ title: "File test" });
    expect(fs.existsSync(path.join(dir, "data", "Task", `${task._id}.yaml`))).toBe(true);
  });
  it("file edit + materialize updates DB", async () => {
    const task = await seedTask({ title: "Edit me" });
    const fp = path.join(dir, "data", "Task", `${task._id}.yaml`);
    const raw = YAML.parse(fs.readFileSync(fp, "utf8"));
    raw.title = "Edited";
    fs.writeFileSync(fp, YAML.stringify(raw));
    await materialize(dir, d.store);
    expect((await d.get("Task", task._id))?.data.title).toBe("Edited");
  });
  it("hand-written YAML materializes", async () => {
    fs.mkdirSync(path.join(dir, "data", "Agent"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "Agent", "hand.yaml"), YAML.stringify({ _id: "hand", handle: "@hand", name: "Hand", status: "idle" }));
    await materialize(dir, d.store);
    expect((await d.get("Agent", "hand"))?.data.handle).toBe("@hand");
  });
});

describe("search", () => {
  it("finds tasks by title", async () => {
    await seedTask({ title: "Implement auth system" });
    await seedTask({ title: "Write tests" });
    expect((await d.search("Task", "auth")).map((r) => r.data.title)).toContain("Implement auth system");
  });
});
