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

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-test-"));
  initOffice(dir);
  d = new Dataset(dir);
});
afterEach(() => { d.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// ---- seed helpers ----

async function seedAgents() {
  const researcher = await d.put({ type: "Agent", id: "researcher", data: { handle: "@researcher", name: "Research Agent", role: "researcher", status: "idle", model: "claude-sonnet-4-6" } });
  const coder = await d.put({ type: "Agent", id: "coder", data: { handle: "@coder", name: "Coder Agent", role: "coder", status: "idle", model: "claude-sonnet-4-6" } });
  const pm = await d.put({ type: "Agent", id: "pm", data: { handle: "@pm", name: "PM Agent", role: "pm", status: "busy", model: "claude-opus-4-8" } });
  return { researcher, coder, pm };
}

async function seedTools() {
  const webSearch = await d.put({ type: "Tool", id: "web-search", data: { slug: "web-search", name: "Web Search", kind: "mcp" } });
  const codeExec = await d.put({ type: "Tool", id: "code-exec", data: { slug: "code-exec", name: "Code Executor", kind: "mcp" } });
  return { webSearch, codeExec };
}

async function seedChannel() {
  return d.put({ type: "Channel", id: "ch-general", data: { slack_id: "C001", name: "general", purpose: "Main office channel" } });
}

async function seedTask(overrides: Record<string, unknown> = {}) {
  return d.put({ type: "Task", id: `task-${Date.now()}`, data: { title: "Test task", status: "backlog", priority: "medium", ...overrides } });
}

// ---- agent roster ----

describe("agent roster", () => {
  it("seeds agents and queries by role", async () => {
    await seedAgents();
    const all = await d.query("Agent");
    expect(all.length).toBe(3);
    const idle = await d.query("Agent", { status: "idle" });
    expect(idle.length).toBe(2);
    const busy = await d.query("Agent", { status: "busy" });
    expect(busy.map(a => a.data.handle)).toContain("@pm");
  });

  it("rejects duplicate handle (unique)", async () => {
    await d.put({ type: "Agent", id: "a1", data: { handle: "@dup", name: "A", status: "idle" } });
    await expect(
      d.put({ type: "Agent", id: "a2", data: { handle: "@dup", name: "B", status: "idle" } })
    ).rejects.toThrow(/unique conflict/);
  });

  it("natural-key upsert by handle", async () => {
    await d.put({ type: "Agent", data: { handle: "@coder", name: "Coder v1", status: "idle" } });
    await d.put({ type: "Agent", data: { handle: "@coder", name: "Coder v2", status: "idle" } });
    const all = await d.query("Agent", { handle: "@coder" });
    expect(all.length).toBe(1);
    expect(all[0].data.name).toBe("Coder v2");
  });
});

// ---- tool registry ----

describe("tool registry", () => {
  it("seeds tools", async () => {
    await seedTools();
    const tools = await d.query("Tool");
    expect(tools.length).toBe(2);
  });

  it("links agent to tool via AgentTool join", async () => {
    const { researcher } = await seedAgents();
    const { webSearch } = await seedTools();
    await d.put({ type: "AgentTool", data: { agent_id: researcher._id, tool_id: webSearch._id } });
    const linked = await d.traverse("Agent", researcher._id, "tools");
    expect(linked.results.map(r => r.data.slug)).toContain("web-search");
  });
});

// ---- slack channels + threads ----

describe("slack channels and threads", () => {
  it("creates channel and thread", async () => {
    const ch = await seedChannel();
    const thread = await d.put({ type: "Thread", data: { slack_ts: "1700000001.000", topic: "Bug report", channel_id: ch._id } });
    const back = await d.traverse("Thread", thread._id, "channel");
    expect(back.results[0]?.data.name).toBe("general");
  });

  it("posts messages from agent and human", async () => {
    const { researcher } = await seedAgents();
    const ch = await seedChannel();
    const thread = await d.put({ type: "Thread", data: { slack_ts: "1700000002.000", topic: "Feature request", channel_id: ch._id } });
    await d.put({ type: "Message", data: { slack_ts: "1700000002.001", thread_id: thread._id, author_id: researcher._id, author_kind: "Agent", content: "I found some relevant papers." } });
    await d.put({ type: "Message", data: { slack_ts: "1700000002.002", thread_id: thread._id, author_id: "human-avi", author_kind: "Human", content: "Great, summarize them." } });
    const msgs = await d.query("Message", { thread_id: thread._id });
    expect(msgs.length).toBe(2);
    const agentMsgs = msgs.filter(m => m.data.author_kind === "Agent");
    expect(agentMsgs.length).toBe(1);
  });

  it("raises a task from a thread", async () => {
    const ch = await seedChannel();
    const thread = await d.put({ type: "Thread", data: { slack_ts: "1700000003.000", topic: "Infra outage", channel_id: ch._id } });
    const task = await d.put({ type: "Task", data: { title: "Fix infra outage", status: "backlog", priority: "urgent", thread_id: thread._id } });
    const linked = await d.traverse("Thread", thread._id, "tasks");
    expect(linked.results.map(r => r._id)).toContain(task._id);
  });
});

// ---- task lifecycle ----

describe("task lifecycle", () => {
  it("full happy path: backlog → assigned → in_progress → review → done", async () => {
    const task = await seedTask();

    const r1 = await runAction(dir, "assign_task", { task_id: task._id, agent_id: "researcher" });
    expect(r1.status).toBe("ok");
    expect(r1.record?.data.status).toBe("assigned");

    const r2 = await runAction(dir, "start_task", { task_id: task._id });
    expect(r2.status).toBe("ok");
    expect(r2.record?.data.status).toBe("in_progress");

    const r3 = await runAction(dir, "submit_for_review", { task_id: task._id });
    expect(r3.record?.data.status).toBe("review");

    const r4 = await runAction(dir, "complete_task", { task_id: task._id });
    expect(r4.record?.data.status).toBe("done");
  });

  it("blocks then resumes", async () => {
    const task = await seedTask();
    await runAction(dir, "assign_task", { task_id: task._id, agent_id: "coder" });
    await runAction(dir, "start_task", { task_id: task._id });
    const r = await runAction(dir, "block_task", { task_id: task._id, reason: "Waiting on API keys" });
    expect(r.record?.data.status).toBe("blocked");
    const r2 = await runAction(dir, "start_task", { task_id: task._id });
    expect(r2.record?.data.status).toBe("in_progress");
  });

  it("escalates back to backlog", async () => {
    const task = await seedTask();
    await runAction(dir, "assign_task", { task_id: task._id, agent_id: "researcher" });
    await runAction(dir, "start_task", { task_id: task._id });
    const r = await runAction(dir, "escalate_task", { task_id: task._id, reason: "Need human input" });
    expect(r.record?.data.status).toBe("backlog");
  });

  it("rejects illegal transition: done → in_progress", async () => {
    const task = await seedTask();
    await runAction(dir, "assign_task", { task_id: task._id, agent_id: "coder" });
    await runAction(dir, "start_task", { task_id: task._id });
    await runAction(dir, "submit_for_review", { task_id: task._id });
    await runAction(dir, "complete_task", { task_id: task._id });
    const r = await runAction(dir, "start_task", { task_id: task._id });
    expect(r.status).toBe("rejected");
  });

  it("rejects assigning an already in_progress task", async () => {
    const task = await seedTask();
    await runAction(dir, "assign_task", { task_id: task._id, agent_id: "coder" });
    await runAction(dir, "start_task", { task_id: task._id });
    const r = await runAction(dir, "assign_task", { task_id: task._id, agent_id: "researcher" });
    expect(r.status).toBe("rejected");
  });

  it("filters tasks by status", async () => {
    await seedTask({ title: "T1", status: "backlog" });
    await seedTask({ title: "T2", status: "backlog" });
    const t3 = await seedTask({ title: "T3", status: "backlog" });
    await runAction(dir, "assign_task", { task_id: t3._id, agent_id: "researcher" });
    await runAction(dir, "start_task", { task_id: t3._id });

    const backlog = await d.query("Task", { status: "backlog" });
    const inProgress = await d.query("Task", { status: "in_progress" });
    expect(backlog.length).toBe(2);
    expect(inProgress.length).toBe(1);
  });
});

// ---- file↔DB binding ----

describe("file↔DB binding", () => {
  it("put() writes a YAML file", async () => {
    const task = await seedTask({ title: "File test" });
    const filePath = path.join(dir, "data", "Task", `${task._id}.yaml`);
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = YAML.parse(fs.readFileSync(filePath, "utf8"));
    expect(parsed.title).toBe("File test");
    expect(parsed.status).toBe("backlog");
  });

  it("editing a file + materialize updates the DB", async () => {
    const task = await seedTask({ title: "Edit me" });
    const filePath = path.join(dir, "data", "Task", `${task._id}.yaml`);
    const raw = YAML.parse(fs.readFileSync(filePath, "utf8"));
    raw.title = "Edited title";
    fs.writeFileSync(filePath, YAML.stringify(raw));
    await materialize(dir, d.store);
    const updated = await d.get("Task", task._id);
    expect(updated?.data.title).toBe("Edited title");
  });

  it("dropping a file does not remove from DB (tombstone model)", async () => {
    const task = await seedTask();
    const filePath = path.join(dir, "data", "Task", `${task._id}.yaml`);
    fs.unlinkSync(filePath);
    await materialize(dir, d.store);
    // file deletion doesn't auto-delete from store — explicit remove() needed
    const rec = await d.get("Task", task._id);
    expect(rec).not.toBeNull();
  });

  it("hand-written YAML file materializes into DB", async () => {
    const p = path.join(dir, "data", "Agent");
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "hand-agent.yaml"), YAML.stringify({
      _id: "hand-agent",
      handle: "@handwritten",
      name: "Hand Written Agent",
      status: "idle",
    }));
    const r = await materialize(dir, d.store);
    expect(r.ingested).toBeGreaterThan(0);
    const rec = await d.get("Agent", "hand-agent");
    expect(rec?.data.handle).toBe("@handwritten");
  });
});

// ---- search ----

describe("search", () => {
  it("keyword search finds tasks by title", async () => {
    await seedTask({ title: "Implement auth system" });
    await seedTask({ title: "Write unit tests" });
    const results = await d.search("Task", "auth");
    expect(results.map(r => r.data.title)).toContain("Implement auth system");
    expect(results.map(r => r.data.title)).not.toContain("Write unit tests");
  });

  it("searches agents by role", async () => {
    await seedAgents();
    const results = await d.search("Agent", "researcher");
    expect(results.some(r => r.data.role === "researcher")).toBe(true);
  });
});
