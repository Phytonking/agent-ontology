# ontolayer

An agent-editable ontology framework. Define objects as YAML files — properties, links, actions — and the framework gives you typed database tables, validated writes, state machines, git versioning, and an MCP server that any AI agent can connect to.

## How it works

```
Order.yaml                          →    obj_Order table
  properties:                             status TEXT
    status: enum [paid,shipped,refunded]   total REAL
    total: money                           customer_id TEXT
  links:
    placed_by: Customer (many-to-one)
  actions:
    issue_refund: ...                →    callable MCP tool
```

**One YAML file = one object.** Properties become columns. Links define relationships. Actions become validated, callable tools. Edit the YAML → the database updates.

## Quickstart

```bash
git clone https://github.com/Phytonking/agent-ontology.git
cd agent-ontology
npm install && npm run build

# scaffold an ontology with an e-commerce example
node dist/cli.js init my-ontology

# or an agent office (agents, tasks, teams, tools, slack objects)
node dist/cli.js init --template office my-ontology

# check it
node dist/cli.js validate my-ontology

# serve to any MCP agent (stdio)
node dist/cli.js serve my-ontology

# or as a network service (HTTP)
node dist/cli.js serve --http --port 8787 my-ontology
```

Requires **Node >= 22.5** (uses built-in `node:sqlite`, zero native deps).

## Object file syntax

```yaml
object: Order
keys: [order_no]
properties:
  order_no: { type: string, unique: true }
  status:
    type: enum
    values: [paid, shipped, refunded]
    required: true
    transitions:
      paid: [shipped, refunded]
      shipped: [refunded]
      refunded: []
  total: { type: money, min: 0 }
  customer_id: { type: id }
  tags: { type: string, many: true }
links:
  placed_by:
    to: Customer
    type: many-to-one
    via: customer_id
  items:
    to: Product
    type: many-to-many
    through: OrderItem
    through_from: order_id
    through_to: product_id
actions:
  issue_refund:
    description: Refund this order.
    inputs:
      order_id: { type: id, required: true }
    preconditions:
      - status in [paid, shipped]
    effects:
      - set status = refunded
constraints:
  - { kind: disjoint, a: Customer, b: SupportRep }
```

## What you get

- **Per-object typed tables** — real columns, real SQL, not JSON blobs
- **Validated writes** — type checks, enum enforcement, state machine transitions, constraints
- **Actions as tools** — each action in an object file becomes its own MCP tool
- **Files = source of truth** — edit `data/Order/1042.yaml` → DB updates; `put()` → file writes back
- **Branch-aware DB** — `ontology branch experiment` → separate database per git branch
- **Git versioning** — every edit is a commit; rollback, review, merge, PR
- **Sync** — incremental, bidirectional, idempotent (oplog + cursor + content hash)
- **Connectors** — pluggable data ingest with validation; copy `examples/connectors/_template.mjs`
- **Hooks** — `beforePut` / `afterPut` middleware on every write
- **Backends** — SQLite (default), Postgres (JSONB + tsvector), S3/R2 blobs

## Link types

| YAML | Relationship | FK location |
|---|---|---|
| `type: one-to-one` | 1:1 | `via` on either side |
| `type: many-to-one` | N:1 | `via` on this record |
| `type: one-to-many` | 1:N | `via` on the target |
| `type: many-to-many` | N:M | `through` join object |

## CLI

```
ontology init [dir]              scaffold a new ontology
ontology init --template office  scaffold the agent office template
ontology serve [dir]             start MCP server (stdio)
ontology serve --http [dir]      start HTTP service
ontology validate [dir]          check coherence
ontology objects [dir]           list all objects
ontology materialize [dir]       sync data files → DB (hash-skip)
ontology reindex [dir]           wipe + rebuild DB from files
ontology branch [name]           create/switch branch (separate DB)
ontology sync <a> <b>            bidirectional sync between ontologies
ontology doctor [dir]            test backend connections
```

## MCP tools

| Tool | Purpose |
|---|---|
| `list_objects` / `read_object` | discover the ontology |
| `create_object` | add a new object (git-committed) |
| `add_property` / `add_link` / `add_action` / `add_constraint` | grow an object |
| `validate` | check coherence |
| `put` / `get` / `query` / `search` / `traverse` | read + write data |
| `run_action` | execute any action by name |
| `sync` | sync with a peer ontology |
| *+ one tool per action* | e.g. `assign_task`, `issue_refund` — direct callable |

## Docker

```bash
ontology init --template office ./ontology
docker compose up --build
# agents → http://localhost:8787/mcp
# health → http://localhost:8787/health
```

## Write modes

In `ontology.config.yaml`:

```yaml
write_mode: bidirectional   # default: put() writes DB + file; edit file → materialize → DB
write_mode: index_only      # DB only, no file write-back; files are read-only source
```

## Connectors

Copy `examples/connectors/_template.mjs`, fill in the blanks:

```js
export default {
  async sync(ctx) {
    const items = await fetch(ctx.env("API_URL")).then(r => r.json());
    for (const item of items) {
      await ctx.upsert("MyObject", item.id, { name: item.title, status: item.state });
    }
    return { connector: "my-source", ingested: items.length, errors: [] };
  },
};
```

See `examples/connectors/` for REST API, Postgres, CSV, webhook, multi-object pipeline, and transform patterns.

## Project structure

```
my-ontology/
  ontology.config.yaml          # config (stores, write_mode, hooks)
  Customer.yaml                 # object definitions (one per file)
  Order.yaml
  Task.yaml
  data/                         # instance data (source of truth, git-tracked)
    Order/1042.yaml
    Customer/c1.yaml
  .ontology/                    # derived DB index (gitignored, per-branch)
    data-main.db
    data-experiment.db
```

## License

[Apache-2.0](LICENSE)
