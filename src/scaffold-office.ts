import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { paths } from "./paths.js";
import { ensureRepo, commit } from "./git.js";
import { SPEC_VERSION } from "./types.js";

function writeObj(root: string, obj: Record<string, unknown>): void {
  const name = obj.object as string;
  const file = paths(root).objectFile(name);
  fs.writeFileSync(file, YAML.stringify(obj));
  commit(root, [file], `create object ${name}`);
}

export function initOffice(root: string): void {
  const p = paths(root);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });

  const name = path.basename(path.resolve(root));
  fs.writeFileSync(p.config, YAML.stringify({ name, version: "0.1.0", spec: SPEC_VERSION }));
  fs.writeFileSync(path.join(root, ".gitignore"), ".ontology/\n.env\n");

  ensureRepo(root);
  commit(root, [p.config, path.join(root, ".gitignore")], "init agent-office ontology");

  writeObj(root, {
    object: "Agent",
    keys: ["handle"],
    properties: {
      handle: { type: "string", required: true, unique: true },
      name: { type: "string", required: true },
      role: { type: "string" },
      status: {
        type: "enum",
        values: ["idle", "busy", "unavailable"],
        required: true,
        transitions: { idle: ["busy", "unavailable"], busy: ["idle", "unavailable"], unavailable: ["idle"] },
      },
      model: { type: "string" },
      team_id: { type: "id" },
    },
    links: {
      team: { to: "Team", type: "many-to-one", via: "team_id" },
      tools: { to: "Tool", type: "many-to-many", through: "AgentTool", through_from: "agent_id", through_to: "tool_id" },
      assignments: { to: "Task", type: "many-to-many", through: "Assignment", through_from: "agent_id", through_to: "task_id" },
    },
  });

  writeObj(root, {
    object: "Human",
    keys: ["slack_handle"],
    properties: {
      slack_handle: { type: "string", required: true, unique: true },
      name: { type: "string" },
      timezone: { type: "string" },
    },
  });

  writeObj(root, {
    object: "Team",
    keys: ["slug"],
    properties: {
      slug: { type: "string", required: true, unique: true },
      name: { type: "string", required: true },
      purpose: { type: "string" },
    },
    links: {
      agents: { to: "Agent", type: "one-to-many", via: "team_id", inverse: "team" },
    },
  });

  writeObj(root, {
    object: "Capability",
    keys: ["slug"],
    properties: {
      slug: { type: "string", required: true, unique: true },
      name: { type: "string" },
      description: { type: "string" },
    },
  });

  writeObj(root, {
    object: "AgentCapability",
    keys: ["agent_id", "capability_id"],
    properties: {
      agent_id: { type: "id", required: true },
      capability_id: { type: "id", required: true },
    },
  });

  writeObj(root, {
    object: "Tool",
    keys: ["slug"],
    properties: {
      slug: { type: "string", required: true, unique: true },
      name: { type: "string" },
      kind: { type: "enum", values: ["mcp", "api", "function", "cli"] },
      description: { type: "string" },
    },
  });

  writeObj(root, {
    object: "AgentTool",
    keys: ["agent_id", "tool_id"],
    properties: {
      agent_id: { type: "id", required: true },
      tool_id: { type: "id", required: true },
    },
  });

  writeObj(root, {
    object: "Channel",
    keys: ["slack_id"],
    properties: {
      slack_id: { type: "string", required: true, unique: true },
      name: { type: "string" },
      purpose: { type: "string" },
    },
  });

  writeObj(root, {
    object: "Thread",
    keys: ["slack_ts"],
    properties: {
      slack_ts: { type: "string", required: true, unique: true },
      topic: { type: "string" },
      channel_id: { type: "id", required: true },
    },
    links: {
      channel: { to: "Channel", type: "many-to-one", via: "channel_id" },
      tasks: { to: "Task", type: "one-to-many", via: "thread_id", inverse: "raised_in" },
    },
  });

  writeObj(root, {
    object: "Message",
    keys: ["slack_ts"],
    properties: {
      slack_ts: { type: "string", required: true, unique: true },
      thread_id: { type: "id", required: true },
      author_id: { type: "id", required: true },
      author_kind: { type: "enum", values: ["Agent", "Human"], required: true },
      content: { type: "text" },
    },
    links: {
      thread: { to: "Thread", type: "many-to-one", via: "thread_id" },
    },
  });

  writeObj(root, {
    object: "Task",
    properties: {
      title: { type: "string", required: true },
      description: { type: "text" },
      priority: { type: "enum", values: ["low", "medium", "high", "urgent"] },
      status: {
        type: "enum",
        values: ["backlog", "assigned", "in_progress", "review", "done", "blocked", "failed"],
        required: true,
        transitions: {
          backlog: ["assigned", "failed"],
          assigned: ["in_progress", "backlog", "failed"],
          in_progress: ["review", "blocked", "backlog", "failed"],
          review: ["done", "in_progress", "backlog"],
          blocked: ["in_progress", "backlog", "failed"],
          done: [],
          failed: [],
        },
      },
      thread_id: { type: "id" },
      tags: { type: "string", many: true },
    },
    links: {
      raised_in: { to: "Thread", type: "many-to-one", via: "thread_id", inverse: "tasks" },
      assignees: { to: "Agent", type: "many-to-many", through: "Assignment", through_from: "task_id", through_to: "agent_id" },
    },
    actions: {
      assign_task: {
        description: "Assign a task to an agent.",
        inputs: { task_id: { type: "id", required: true }, agent_id: { type: "id", required: true } },
        preconditions: ["status in [backlog, blocked]"],
        effects: ["set status = assigned"],
      },
      start_task: {
        description: "Agent begins work on a task.",
        inputs: { task_id: { type: "id", required: true } },
        preconditions: ["status in [assigned, blocked]"],
        effects: ["set status = in_progress"],
      },
      submit_for_review: {
        description: "Submit work for review.",
        inputs: { task_id: { type: "id", required: true } },
        preconditions: ["status in [in_progress]"],
        effects: ["set status = review"],
      },
      complete_task: {
        description: "Mark a task done.",
        inputs: { task_id: { type: "id", required: true } },
        preconditions: ["status in [review]"],
        effects: ["set status = done"],
      },
      block_task: {
        description: "Mark a task as blocked.",
        inputs: { task_id: { type: "id", required: true }, reason: { type: "string" } },
        preconditions: ["status in [assigned, in_progress]"],
        effects: ["set status = blocked"],
      },
      escalate_task: {
        description: "Escalate a task back to backlog.",
        inputs: { task_id: { type: "id", required: true }, reason: { type: "string" } },
        preconditions: ["status in [assigned, in_progress, blocked]"],
        effects: ["set status = backlog"],
      },
    },
  });

  writeObj(root, {
    object: "Assignment",
    keys: ["task_id", "agent_id"],
    properties: {
      task_id: { type: "id", required: true },
      agent_id: { type: "id", required: true },
    },
  });
}
