import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { paths } from "./paths.js";
import { ensureRepo, commit } from "./git.js";
import { createType, createAction } from "./ontology.js";
import { SPEC_VERSION } from "./types.js";

const README = `# Agent Office Ontology

An office of AI agents working together via Slack and shared tools.

## Scopes

- **Shared** — team structure, tool registry, task board, Slack channels.
- **Individual agent** — its own ontology folder (private memory, current assignments).

## How agents use this

Run \`ontology serve\` and point any MCP agent at it. The agent can:
- discover who exists and what they can do (\`list_types\`, \`query Agent\`)
- pick up tasks (\`query Task filter:status=backlog\`)
- call domain actions directly (\`assign_task\`, \`complete_task\`, \`escalate_task\`)
- grow the ontology when new concepts appear (\`create_type\`, \`create_action\`)

Every edit is git-committed. Every action is validated before it writes.
`;

export function initOffice(root: string): void {
  const p = paths(root);
  fs.mkdirSync(p.typesDir, { recursive: true });
  fs.mkdirSync(p.actionsDir, { recursive: true });
  const name = path.basename(path.resolve(root));
  fs.writeFileSync(p.config, YAML.stringify({ name, version: "0.1.0", spec: SPEC_VERSION }));
  fs.writeFileSync(p.readme, README);
  const gitignore = path.join(root, ".gitignore");
  fs.writeFileSync(gitignore, ".ontology/\n.env\n");
  // Create the data/ directory so git tracks it from the start.
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  ensureRepo(root);
  commit(root, [p.config, p.readme, gitignore], "init agent-office ontology");

  // ---- types ----

  createType(root, {
    name: "Agent",
    description: "An AI agent in the office. Has a role, a set of capabilities, and a current status. Agents pick up tasks, use tools, and post in Slack channels.",
    keys: ["handle"],
    properties: {
      handle: { type: "string", required: true, unique: true, description: "Unique slug, e.g. @researcher" },
      name: { type: "string", required: true },
      role: { type: "string", description: "e.g. researcher, coder, pm, reviewer" },
      status: {
        type: "enum",
        values: ["idle", "busy", "unavailable"],
        required: true,
        transitions: { idle: ["busy", "unavailable"], busy: ["idle", "unavailable"], unavailable: ["idle"] },
      },
      model: { type: "string", description: "Underlying model, e.g. claude-sonnet-4-6" },
    },
    links: {
      capabilities: { to: "Capability", cardinality: "many", through: "AgentCapability", through_from: "agent_id", through_to: "capability_id" },
      tools: { to: "Tool", cardinality: "many", through: "AgentTool", through_from: "agent_id", through_to: "tool_id" },
      assignments: { to: "Task", cardinality: "many", through: "Assignment", through_from: "agent_id", through_to: "task_id" },
      team: { to: "Team", cardinality: "one", via: "team_id" },
    },
  });

  createType(root, {
    name: "Human",
    description: "A human member of the office. Can own tasks, review agent output, and approve ontology changes.",
    keys: ["slack_handle"],
    properties: {
      slack_handle: { type: "string", required: true, unique: true },
      name: { type: "string" },
      timezone: { type: "string" },
    },
  });

  createType(root, {
    name: "Team",
    description: "A named group of agents and humans working toward a shared goal.",
    keys: ["slug"],
    properties: {
      slug: { type: "string", required: true, unique: true },
      name: { type: "string", required: true },
      purpose: { type: "string" },
    },
    links: {
      agents: { to: "Agent", cardinality: "many", via: "team_id", inverse: "team" },
    },
  });

  createType(root, {
    name: "Capability",
    description: "Something an agent or team can do. Coarse-grained (e.g. web-search, code-execution, data-analysis).",
    keys: ["slug"],
    properties: {
      slug: { type: "string", required: true, unique: true },
      name: { type: "string" },
      description: { type: "string" },
    },
  });

  createType(root, {
    name: "AgentCapability",
    description: "Join type: Agent has Capability.",
    keys: ["agent_id", "capability_id"],
    properties: {
      agent_id: { type: "id", required: true },
      capability_id: { type: "id", required: true },
    },
    links: {
      agent: { to: "Agent", cardinality: "one", via: "agent_id" },
      capability: { to: "Capability", cardinality: "one", via: "capability_id" },
    },
  });

  createType(root, {
    name: "Tool",
    description: "An available tool or MCP server. Agents request access; the tool registry tracks what is available.",
    keys: ["slug"],
    properties: {
      slug: { type: "string", required: true, unique: true },
      name: { type: "string" },
      kind: { type: "enum", values: ["mcp", "api", "function", "cli"] },
      description: { type: "string" },
      schema_ref: { type: "string", description: "URL or path to the tool's schema" },
    },
  });

  createType(root, {
    name: "AgentTool",
    description: "Join type: Agent has access to Tool.",
    keys: ["agent_id", "tool_id"],
    properties: {
      agent_id: { type: "id", required: true },
      tool_id: { type: "id", required: true },
      granted_at: { type: "datetime" },
    },
    links: {
      agent: { to: "Agent", cardinality: "one", via: "agent_id" },
      tool: { to: "Tool", cardinality: "one", via: "tool_id" },
    },
  });

  createType(root, {
    name: "Channel",
    description: "A Slack channel. Agents and humans work in channels. Threads hang off channels.",
    keys: ["slack_id"],
    properties: {
      slack_id: { type: "string", required: true, unique: true },
      name: { type: "string" },
      purpose: { type: "string" },
      is_private: { type: "bool" },
    },
  });

  createType(root, {
    name: "Thread",
    description: "A Slack thread. The unit of conversation. Tasks can be raised from threads.",
    keys: ["slack_ts"],
    properties: {
      slack_ts: { type: "string", required: true, unique: true, description: "Slack thread timestamp (ts)" },
      topic: { type: "string" },
      channel_id: { type: "id", required: true },
    },
    links: {
      channel: { to: "Channel", cardinality: "one", via: "channel_id" },
      tasks: { to: "Task", cardinality: "many", via: "thread_id", inverse: "raised_in" },
    },
  });

  createType(root, {
    name: "Message",
    description: "A Slack message in a thread. Author may be an Agent or a Human.",
    keys: ["slack_ts"],
    properties: {
      slack_ts: { type: "string", required: true, unique: true },
      thread_id: { type: "id", required: true },
      author_id: { type: "id", required: true },
      author_kind: { type: "enum", values: ["Agent", "Human"], required: true },
      content: { type: "text" },
      posted_at: { type: "datetime" },
    },
    links: {
      thread: { to: "Thread", cardinality: "one", via: "thread_id" },
    },
  });

  createType(root, {
    name: "Task",
    description: "A unit of work. Moves through a state machine. Assigned to agents via Assignment.",
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
          in_progress: ["review", "blocked", "failed"],
          review: ["done", "in_progress"],
          blocked: ["in_progress", "failed"],
          done: [],
          failed: [],
        },
      },
      thread_id: { type: "id", description: "Slack thread where the task was raised" },
      tags: { type: "string", many: true },
    },
    links: {
      raised_in: { to: "Thread", cardinality: "one", via: "thread_id", inverse: "tasks" },
      assignees: { to: "Agent", cardinality: "many", through: "Assignment", through_from: "task_id", through_to: "agent_id" },
    },
  });

  createType(root, {
    name: "Assignment",
    description: "Join type: Agent assigned to Task. Tracks when and by whom.",
    keys: ["task_id", "agent_id"],
    properties: {
      task_id: { type: "id", required: true },
      agent_id: { type: "id", required: true },
      assigned_at: { type: "datetime" },
      assigned_by: { type: "id", description: "id of the Human or Agent who assigned" },
    },
    links: {
      task: { to: "Task", cardinality: "one", via: "task_id" },
      agent: { to: "Agent", cardinality: "one", via: "agent_id" },
    },
  });

  // ---- actions ----

  createAction(root, {
    name: "assign_task",
    description: "Assign a task to an agent. Task must be in backlog or unblocked. Agent must be idle.",
    on: "Task",
    inputs: {
      task_id: { type: "id", required: true },
      agent_id: { type: "id", required: true },
    },
    preconditions: ["status in [backlog, blocked]"],
    effects: ["set status = assigned"],
  });

  createAction(root, {
    name: "start_task",
    description: "Agent picks up an assigned task and begins work.",
    on: "Task",
    inputs: { task_id: { type: "id", required: true } },
    preconditions: ["status in [assigned]"],
    effects: ["set status = in_progress"],
  });

  createAction(root, {
    name: "submit_for_review",
    description: "Agent submits completed work for review.",
    on: "Task",
    inputs: { task_id: { type: "id", required: true } },
    preconditions: ["status in [in_progress]"],
    effects: ["set status = review"],
  });

  createAction(root, {
    name: "complete_task",
    description: "Reviewer marks a task done.",
    on: "Task",
    inputs: { task_id: { type: "id", required: true } },
    preconditions: ["status in [review]"],
    effects: ["set status = done"],
  });

  createAction(root, {
    name: "block_task",
    description: "Mark a task as blocked (dependency or blocker encountered).",
    on: "Task",
    inputs: {
      task_id: { type: "id", required: true },
      reason: { type: "string" },
    },
    preconditions: ["status in [assigned, in_progress]"],
    effects: ["set status = blocked"],
  });

  createAction(root, {
    name: "escalate_task",
    description: "Escalate a task — move it back to backlog for re-assignment or human review.",
    on: "Task",
    inputs: {
      task_id: { type: "id", required: true },
      reason: { type: "string" },
    },
    preconditions: ["status in [assigned, in_progress, blocked]"],
    effects: ["set status = backlog"],
  });

  createAction(root, {
    name: "request_tool",
    description: "Agent requests access to a tool. Creates an AgentTool record.",
    on: "Agent",
    inputs: {
      agent_id: { type: "id", required: true },
      tool_id: { type: "id", required: true },
    },
    preconditions: [],
    effects: [],
  });
}
