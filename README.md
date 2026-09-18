# ontolayer

**Give your AI agents a shared understanding of your world.**

ontolayer is an open-source ontology framework. You define your domain as YAML files — one file per object — and get a typed database, validated writes with state machines, and a server that any AI agent can connect to over [MCP](https://modelcontextprotocol.io).

## Why

AI agents are probabilistic. Point them at raw databases and APIs and they hallucinate field names, break relationships, and produce invalid state. Every agent integration is bespoke glue.

ontolayer gives agents a shared, structured map of your domain — types, relationships, state machines, and actions — that they can read, query, act through, and even edit. One server, any agent framework, validated guardrails.

## How it works

```
You write:                          You get:
─────────────────────               ─────────────────────────────
Customer.md                          obj_Customer table (email, name, ...)
Order.md                             obj_Order table (status, total, ...)
  status: enum [paid,shipped,...]    → state machine enforcement
  links: placed_by → Customer        → relationship traversal
  actions: issue_refund               → callable MCP tool
```

One YAML file = one object = one database table. Properties become columns. Actions become tools. Edit a file, the database updates. An agent calls `put()`, the file updates. Git tracks everything.

---

## Quick start

```bash
git clone https://github.com/Phytonking/agent-ontology.git
cd agent-ontology
npm install
npm run build
```

Requires **Node 22.5+** (uses built-in `node:sqlite` — zero native deps).

### 1. Create an ontology

```bash
# e-commerce example
node dist/cli.js init my-project

# or an agent office (agents, tasks, teams, tools, channels, threads)
node dist/cli.js init --template office my-project
```

### 2. Validate

```bash
node dist/cli.js validate my-project
```

### 3. Serve

```bash
# local agent (stdio — same machine, no network)
node dist/cli.js serve my-project

# or as a network server (any agent, any machine)
node dist/cli.js serve --http --port 8787 my-project
```

---

## Connecting agents

### Claude Desktop (local, stdio)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ontolayer": {
      "command": "node",
      "args": ["/path/to/agent-ontology/dist/cli.js", "serve", "/path/to/my-project"]
    }
  }
}
```

### Any MCP client (HTTP, remote)

Start the server:

```bash
node dist/cli.js serve --http --port 8787 my-project
```

Connect your agent to `http://your-host:8787/mcp` (MCP Streamable HTTP). Health check at `http://your-host:8787/health`.

Works with any framework that speaks MCP — Claude, LangGraph, custom agents, anything.

### What agents see

Once connected, agents get these tools:

| Tool | What it does |
|---|---|
| `list_objects` / `read_object` | discover the domain |
| `create_object` / `add_property` / `add_link` / `add_action` | edit the ontology (git-committed) |
| `validate` | check coherence |
| `put` / `get` / `query` / `search` / `traverse` | read + write data |
| `run_action` | execute any action |
| *+ one tool per action* | e.g. `assign_task`, `issue_refund` — call directly |

---

## Object file syntax

Every object is a **markdown file** (`.md`): YAML frontmatter (schema) + a prose body (documentation, meaning, context — readable by agents and humans). Connectors are separate `.yaml`/`.mjs` files in `connectors/`.

```markdown
---
object: Order
properties:
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
    description: Refund this order. Only if paid or shipped.
    inputs:
      order_id: { type: id, required: true }
    preconditions:
      - status in [paid, shipped]
    effects:
      - set status = refunded
---
# Order

An order placed by a customer.

## Rules
- Refunded at most once
- Payout goes to the buyer, never the support rep

## State machine
- `paid` → `shipped` or `refunded`
- `shipped` → `refunded`
- `refunded` is terminal
```

The frontmatter is the machine-readable schema. The markdown body is the human- and agent-readable meaning — what the object IS, its rules, its examples. Both in one file.

### Property types

`string` · `text` · `int` · `float` · `money` · `bool` · `datetime` · `date` · `id` · `json` · `enum`

Optional modifiers: `required` · `unique` · `many` (array) · `min`/`max` · `pattern` · `transitions` (state machine)

### Relationship types

| In YAML | Meaning | Foreign key |
|---|---|---|
| `type: one-to-one` | 1:1 | `via` on either side |
| `type: many-to-one` | N:1 | `via` on this record |
| `type: one-to-many` | 1:N | `via` on the target |
| `type: many-to-many` | N:M | `through` a join object |

### Constraints

```yaml
constraints:
  - { kind: disjoint, a: Customer, b: SupportRep }
  - { kind: conditional, if_field: status, if_value: refunded, require: refund_date }
  - { kind: required_together, fields: [start_date, end_date] }
  - { kind: mutually_exclusive, fields: [phone, fax] }
```

---

## Data

Instance data lives in `data/<ObjectName>/<id>.yaml`:

```yaml
# data/Order/1042.yaml
_id: "1042"
status: paid
total: 4200
customer_id: c1
tags:
  - vip
  - rush
```

### Files are the source of truth

- Edit `data/Order/1042.yaml` → `ontology materialize` → database updates
- Agent calls `put()` → database updates → file writes back
- `ontology reindex` → wipes the DB and rebuilds from files (clean slate)

### Write modes

Set in `ontology.config.yaml`:

```yaml
write_mode: bidirectional   # default — put() writes DB + file
write_mode: index_only      # DB is read-only index, files managed externally (git, CI)
```

---

## Branching

Each git branch gets its own isolated database:

```bash
ontology branch experiment       # git checkout + new DB
ontology materialize .           # populate from data files
# test, break things, add objects...
ontology branch main             # switch back — main DB untouched
git merge experiment
ontology reindex .               # rebuild main DB with merged changes
```

---

## Hosting as a server

### Option 1: bare Node process

```bash
node dist/cli.js serve --http --port 8787 my-project
```

Run it on any VM, VPS, or behind a reverse proxy. That's it — one process, one port. SQLite by default (no external DB needed). Add a process manager (`pm2`, `systemd`) to keep it running.

### Option 2: Docker

```bash
node dist/cli.js init --template office ./ontology
docker compose up --build
```

The included `docker-compose.yml` runs ontolayer + Postgres + MinIO (S3-compatible blob store). Configure via `ontology.config.yaml`:

```yaml
stores:
  main: { kind: postgres }     # URL from env: ONTOLAYER_STORE_MAIN_URL
defaults:
  store: main
```

Secrets go in `.env` (gitignored):

```
ONTOLAYER_STORE_MAIN_URL=postgres://user:pass@host:5432/db
```

### Health check

```bash
curl http://localhost:8787/health
# {"ok":true,"ontology":"my-project","objects":12,"actions":6}
```

---

## Connectors

A connector pulls data from an external source into your ontology. It's a small `.mjs` file:

```js
// connectors/my-api.mjs
export default {
  async sync(ctx) {
    const items = await fetch(ctx.env("API_URL"), {
      headers: { Authorization: `Bearer ${ctx.env("API_TOKEN")}` },
    }).then(r => r.json());

    let ingested = 0;
    for (const item of items) {
      await ctx.upsert("Task", item.id, {
        title: item.name,
        status: "backlog",
      });
      ingested++;
    }
    return { connector: "my-api", ingested, errors: [] };
  },
};
```

Every `ctx.upsert` is validated against the object schema — bad data is rejected with a clear error.

See `examples/connectors/` for complete patterns:
- `_template.mjs` — copy-paste starter with a checklist
- `rest-api.mjs` — REST API with auth, pagination, incremental cursor
- `postgres-table.mjs` — SQL table with incremental sync
- `csv-file.mjs` — CSV/JSON file import
- `webhook-receiver.mjs` — event-driven ingest
- `multi-object-pipeline.mjs` — one source → multiple linked objects
- `transform-enrich.mjs` — post-ingest enrichment

---

## CLI

```
ontology init [dir]                create a new ontology
ontology init --template office    agent office template (12 objects, 6 actions)
ontology serve [dir]               MCP server (stdio)
ontology serve --http [dir]        MCP server (HTTP, default port 8787)
ontology validate [dir]            check ontology coherence
ontology objects [dir]             list all objects
ontology materialize [dir]         sync data files → database (hash-skip)
ontology reindex [dir]             wipe + rebuild database from files
ontology branch [name]             create/switch git branch (separate DB)
ontology sync <a> <b>              bidirectional sync between two ontologies
ontology doctor [dir]              test backend connections
```

---

## Folder structure

```
my-project/
  ontology.config.yaml     # config
  Customer.md              # object definitions (.md = schema + prose docs)
  Order.md
  Task.md
  connectors/              # data connectors (.yaml config + .mjs code)
    slack.yaml
    slack.mjs
  data/                    # instance data (.yaml, git-tracked)
    Customer/c1.yaml
    Order/1042.yaml
  .ontology/               # database (gitignored, one per branch)
    data-main.db
  .env                     # secrets (gitignored)
```

---

## Backends

| Backend | Use | Config |
|---|---|---|
| **SQLite** (default) | local dev, single-agent, zero setup | built-in, no config |
| **Postgres** | shared/production, full SQL, pgvector-ready | `stores: { main: { kind: postgres } }` |
| **S3 / Cloudflare R2** | blob storage (attachments, docs) | `blobs: { files: { kind: s3, bucket: ... } }` |

Swap backends by changing config — no code changes. Secrets from env (`ONTOLAYER_STORE_MAIN_URL`, etc.).

---

## License

[Apache-2.0](LICENSE)

Built by [Avi Agola](https://github.com/Phytonking).
