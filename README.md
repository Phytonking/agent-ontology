# ontolayer

**Give your AI agents a shared understanding of your world.**

ontolayer is an open-source ontology framework where you define your domain as simple YAML files — one file per object — and the framework turns them into a typed database, a validated API, and a set of tools any AI agent can use.

The problem it solves: AI agents are probabilistic. Point them at raw databases and APIs and they don't know what things *mean*, can't follow relationships, and produce invalid results. ontolayer gives agents a structured, editable map of your domain — with types, relationships, state machines, and guardrails — so they can read it, act through it, and grow it.

## The idea

```
Customer.yaml       →    typed database table (obj_Customer)
  email: string     →    email TEXT column
  name: string      →    name TEXT column

Order.yaml          →    typed database table (obj_Order)
  status: enum      →    status TEXT column
    transitions:    →    state machine (paid → shipped → refunded)
  links:
    placed_by:      →    foreign key relationship to Customer
  actions:
    issue_refund:   →    callable tool for any connected agent
```

You write YAML. You get: a database with real tables, validated writes that enforce your rules, and an MCP server where every action you defined is a tool an agent can call. Edit a YAML file — the database updates. An agent calls `put()` — the file updates. Git tracks everything.

## Getting started

```bash
git clone https://github.com/Phytonking/agent-ontology.git
cd agent-ontology
npm install
npm run build
```

Requires **Node 22.5+** (uses the built-in `node:sqlite` — no native dependencies to compile).

### Create an ontology

```bash
# e-commerce example (Customer, Order, Product)
node dist/cli.js init my-project

# or an agent office (Agent, Task, Team, Tool, Channel, Thread, Message)
node dist/cli.js init --template office my-project
```

This creates a folder of YAML files. That folder *is* the ontology.

### Validate and serve

```bash
node dist/cli.js validate my-project    # check everything is coherent
node dist/cli.js serve my-project       # start MCP server (stdio)
```

Point any MCP-capable agent (Claude, LangGraph, your own) at the serve command. The agent can now read your objects, query data, run actions, and edit the ontology.

## What an object file looks like

Every object in your domain is one YAML file. Properties, relationships, and actions live together — because they describe one thing.

```yaml
object: Task
properties:
  title:
    type: string
    required: true
  status:
    type: enum
    values: [backlog, assigned, in_progress, review, done]
    required: true
    transitions:
      backlog: [assigned]
      assigned: [in_progress, backlog]
      in_progress: [review, blocked]
      review: [done, in_progress]
      done: []
  priority:
    type: enum
    values: [low, medium, high, urgent]
  tags:
    type: string
    many: true
links:
  assigned_to:
    to: Agent
    type: many-to-one
    via: agent_id
  raised_in:
    to: Thread
    type: many-to-one
    via: thread_id
actions:
  assign_task:
    description: Assign this task to an agent.
    inputs:
      task_id: { type: id, required: true }
      agent_id: { type: id, required: true }
    preconditions:
      - status in [backlog]
    effects:
      - set status = assigned
  complete_task:
    description: Mark this task as done.
    inputs:
      task_id: { type: id, required: true }
    preconditions:
      - status in [review]
    effects:
      - set status = done
```

That file gives you:
- A `obj_Task` table with `title`, `status`, `priority`, `tags`, `agent_id`, `thread_id` as real columns
- State machine enforcement: `done → in_progress` is rejected automatically
- Two MCP tools (`assign_task`, `complete_task`) that agents can call directly
- Relationship traversal to Agent and Thread

## How data flows

```
                    ┌──────────────────────┐
                    │   YAML object files   │   ← you define these
                    │   (Order.yaml, etc.)  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   data/ YAML files    │   ← instance data (source of truth)
                    │   data/Order/1042.yaml │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   typed database      │   ← derived index (one table per object)
                    │   .ontology/data.db   │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   MCP server          │   ← agents connect here
                    │   (stdio or HTTP)     │
                    └──────────────────────┘
```

**Two-way sync:**
- Edit `data/Order/1042.yaml` → run `ontology materialize` → database updates
- Agent calls `put()` via MCP → database updates → file writes back
- Git tracks every change to both object definitions and instance data

## Relationships

| In YAML | Means | Example |
|---|---|---|
| `type: one-to-one` | exactly one on each side | User → Profile |
| `type: many-to-one` | many of this, one of that | Order → Customer |
| `type: one-to-many` | one of this, many of that | Customer → Orders |
| `type: many-to-many` | many on both sides (via a join object) | Order ↔ Product (through OrderItem) |

## What agents see (MCP tools)

When you serve an ontology, agents get these tools:

**Understand the domain:** `list_objects`, `read_object`

**Edit the ontology:** `create_object`, `add_property`, `add_link`, `add_action`, `add_constraint`, `validate`

**Work with data:** `put`, `get`, `query`, `search`, `traverse`

**Take action:** `run_action` — plus every action defined in your object files becomes its own named tool (e.g. `assign_task`, `issue_refund`)

**Sync:** `sync` (incremental bidirectional sync between ontologies)

## Branching

Each git branch gets its own database. Experiment without touching production data.

```bash
ontology branch experiment       # creates git branch + new empty DB
ontology materialize .           # populate from data files
# ... test, break things, add objects ...
ontology branch main             # switch back — main DB is untouched
git merge experiment             # merge the files
ontology reindex .               # rebuild main DB with merged schema + data
```

## Bringing in data (connectors)

A connector is a small JS module that pulls data from a source and maps it to your objects. Copy the template, fill in the blanks:

```js
// connectors/my-source.mjs
export default {
  async sync(ctx) {
    const res = await fetch(ctx.env("API_URL"), {
      headers: { Authorization: `Bearer ${ctx.env("API_TOKEN")}` },
    });
    const items = await res.json();
    for (const item of items) {
      await ctx.upsert("Task", item.id, {
        title: item.name,
        status: "backlog",
        priority: item.priority,
      });
    }
    return { connector: "my-source", ingested: items.length, errors: [] };
  },
};
```

Every `ctx.upsert` is validated against your object definition — a connector can't inject bad data.

See `examples/connectors/` for patterns: REST API, Postgres, CSV, webhooks, multi-object pipelines, and post-ingest transforms.

## Configuration

`ontology.config.yaml` in your ontology folder:

```yaml
name: my-project
version: 1.0.0
spec: "0.3"

# write_mode: bidirectional (default) — put() writes DB + file
# write_mode: index_only — DB only, files are the read-only source

# Optional: swap the backing store (default is local SQLite)
# stores:
#   main: { kind: postgres }       # URL from env: ONTOLAYER_STORE_MAIN_URL
# defaults:
#   store: main
```

## CLI reference

```
ontology init [dir]                scaffold a new ontology
ontology init --template office    agent office template
ontology serve [dir]               MCP server (stdio, for local agents)
ontology serve --http [dir]        HTTP service (for remote agents)
ontology validate [dir]            check ontology coherence
ontology objects [dir]             list all objects
ontology materialize [dir]         sync data files → database
ontology reindex [dir]             wipe + rebuild database from files
ontology branch [name]             create/switch git branch (separate DB)
ontology sync <a> <b>              bidirectional sync between ontologies
ontology doctor [dir]              test configured backend connections
```

## Folder structure

```
my-project/
  ontology.config.yaml     # configuration
  Customer.yaml            # object definitions
  Order.yaml
  Task.yaml
  data/                    # instance data (git-tracked, source of truth)
    Customer/c1.yaml
    Order/1042.yaml
  .ontology/               # database index (gitignored, one per branch)
    data-main.db
    data-experiment.db
```

## Running as a service

For shared use (multiple agents connecting over the network), run as an HTTP service:

```bash
node dist/cli.js serve --http --port 8787 my-project
# agents connect to http://localhost:8787/mcp
# health check at http://localhost:8787/health
```

A Dockerfile and docker-compose.yml are included for containerized deployment with Postgres and S3/MinIO. See the files for details — but you don't need Docker to use ontolayer. A local `node dist/cli.js serve` is the normal way to run it.

## License

[Apache-2.0](LICENSE)
