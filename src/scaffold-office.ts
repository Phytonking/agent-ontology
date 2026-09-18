import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { paths } from "./paths.js";
import { ensureRepo, commit } from "./git.js";
import { SPEC_VERSION } from "./types.js";

function writeObj(root: string, fm: Record<string, unknown>, body: string): void {
  const name = fm.object as string;
  const file = paths(root).objectFile(name);
  fs.writeFileSync(file, matter.stringify(`\n${body.trim()}\n`, fm));
  commit(root, [file], `create object ${name}`);
}

export function initOffice(root: string): void {
  const p = paths(root);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(p.connectorsDir, { recursive: true });

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
      status: { type: "enum", values: ["idle", "busy", "unavailable"], required: true,
        transitions: { idle: ["busy", "unavailable"], busy: ["idle", "unavailable"], unavailable: ["idle"] } },
      model: { type: "string" },
      team_id: { type: "id" },
    },
    links: {
      team: { to: "Team", type: "many-to-one", via: "team_id" },
      tools: { to: "Tool", type: "many-to-many", through: "AgentTool", through_from: "agent_id", through_to: "tool_id" },
      assignments: { to: "Task", type: "many-to-many", through: "Assignment", through_from: "agent_id", through_to: "task_id" },
    },
  }, `# Agent\n\nAn AI agent in the office. Has a role, capabilities, tools, and a current status.\n\nAgents pick up tasks, use tools, and communicate in Slack channels.`);

  writeObj(root, { object: "Human", keys: ["slack_handle"],
    properties: { slack_handle: { type: "string", required: true, unique: true }, name: { type: "string" }, timezone: { type: "string" } },
  }, `# Human\n\nA person in the office. Can own tasks, review agent work, and approve ontology changes.`);

  writeObj(root, { object: "Team", keys: ["slug"],
    properties: { slug: { type: "string", required: true, unique: true }, name: { type: "string", required: true }, purpose: { type: "string" } },
    links: { agents: { to: "Agent", type: "one-to-many", via: "team_id", inverse: "team" } },
  }, `# Team\n\nA named group of agents and humans working toward a shared goal.`);

  writeObj(root, { object: "Capability", keys: ["slug"],
    properties: { slug: { type: "string", required: true, unique: true }, name: { type: "string" }, description: { type: "string" } },
  }, `# Capability\n\nSomething an agent or team can do. Coarse-grained: web-search, code-execution, data-analysis.`);

  writeObj(root, { object: "AgentCapability", keys: ["agent_id", "capability_id"],
    properties: { agent_id: { type: "id", required: true }, capability_id: { type: "id", required: true } },
  }, `# AgentCapability\n\nJoin: Agent has Capability.`);

  writeObj(root, { object: "Tool", keys: ["slug"],
    properties: { slug: { type: "string", required: true, unique: true }, name: { type: "string" },
      kind: { type: "enum", values: ["mcp", "api", "function", "cli"] }, description: { type: "string" } },
  }, `# Tool\n\nAn available tool or MCP server. Agents request access; the tool registry tracks availability.`);

  writeObj(root, { object: "AgentTool", keys: ["agent_id", "tool_id"],
    properties: { agent_id: { type: "id", required: true }, tool_id: { type: "id", required: true } },
  }, `# AgentTool\n\nJoin: Agent has access to Tool.`);

  writeObj(root, { object: "Channel", keys: ["slack_id"],
    properties: { slack_id: { type: "string", required: true, unique: true }, name: { type: "string" }, purpose: { type: "string" } },
  }, `# Channel\n\nA Slack channel. Agents and humans collaborate here. Threads hang off channels.`);

  writeObj(root, { object: "Thread", keys: ["slack_ts"],
    properties: { slack_ts: { type: "string", required: true, unique: true }, topic: { type: "string" }, channel_id: { type: "id", required: true } },
    links: { channel: { to: "Channel", type: "many-to-one", via: "channel_id" },
      tasks: { to: "Task", type: "one-to-many", via: "thread_id", inverse: "raised_in" } },
  }, `# Thread\n\nA Slack thread — a unit of conversation. Tasks can be raised from threads.`);

  writeObj(root, { object: "Message", keys: ["slack_ts"],
    properties: { slack_ts: { type: "string", required: true, unique: true }, thread_id: { type: "id", required: true },
      author_id: { type: "id", required: true }, author_kind: { type: "enum", values: ["Agent", "Human"], required: true }, content: { type: "text" } },
    links: { thread: { to: "Thread", type: "many-to-one", via: "thread_id" } },
  }, `# Message\n\nA Slack message in a thread. Author may be an Agent or a Human.`);

  writeObj(root, { object: "Task",
    properties: {
      title: { type: "string", required: true }, description: { type: "text" },
      priority: { type: "enum", values: ["low", "medium", "high", "urgent"] },
      status: { type: "enum", values: ["backlog", "assigned", "in_progress", "review", "done", "blocked", "failed"], required: true,
        transitions: { backlog: ["assigned", "failed"], assigned: ["in_progress", "backlog", "failed"],
          in_progress: ["review", "blocked", "backlog", "failed"], review: ["done", "in_progress", "backlog"],
          blocked: ["in_progress", "backlog", "failed"], done: [], failed: [] } },
      thread_id: { type: "id" }, tags: { type: "string", many: true },
    },
    links: { raised_in: { to: "Thread", type: "many-to-one", via: "thread_id", inverse: "tasks" },
      assignees: { to: "Agent", type: "many-to-many", through: "Assignment", through_from: "task_id", through_to: "agent_id" } },
    actions: {
      assign_task: { description: "Assign a task to an agent.", inputs: { task_id: { type: "id", required: true }, agent_id: { type: "id", required: true } },
        preconditions: ["status in [backlog, blocked]"], effects: ["set status = assigned"] },
      start_task: { description: "Agent begins work.", inputs: { task_id: { type: "id", required: true } },
        preconditions: ["status in [assigned, blocked]"], effects: ["set status = in_progress"] },
      submit_for_review: { description: "Submit work for review.", inputs: { task_id: { type: "id", required: true } },
        preconditions: ["status in [in_progress]"], effects: ["set status = review"] },
      complete_task: { description: "Mark done.", inputs: { task_id: { type: "id", required: true } },
        preconditions: ["status in [review]"], effects: ["set status = done"] },
      block_task: { description: "Mark as blocked.", inputs: { task_id: { type: "id", required: true }, reason: { type: "string" } },
        preconditions: ["status in [assigned, in_progress]"], effects: ["set status = blocked"] },
      escalate_task: { description: "Escalate back to backlog.", inputs: { task_id: { type: "id", required: true }, reason: { type: "string" } },
        preconditions: ["status in [assigned, in_progress, blocked]"], effects: ["set status = backlog"] },
    },
  }, `# Task\n\nA unit of work in the office.\n\n## State machine\n- \`backlog\` → \`assigned\` → \`in_progress\` → \`review\` → \`done\`\n- Can be \`blocked\` from in_progress or assigned\n- Can be \`escalate\`d back to backlog from most active states\n- \`done\` and \`failed\` are terminal\n\n## Assignment\nTasks are assigned to agents via the Assignment join object.`);

  writeObj(root, { object: "Assignment", keys: ["task_id", "agent_id"],
    properties: { task_id: { type: "id", required: true }, agent_id: { type: "id", required: true } },
  }, `# Assignment\n\nJoin: Agent assigned to Task.`);
}
