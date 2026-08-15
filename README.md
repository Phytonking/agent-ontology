# ontolayer

**A filesystem-first, agent-editable ontology framework.**

[![CI](https://github.com/Phytonking/agent-ontology/actions/workflows/ci.yml/badge.svg)](https://github.com/Phytonking/agent-ontology/actions/workflows/ci.yml)

An ontology is a folder of plain markdown files — one per type, one per action. Point any [MCP](https://modelcontextprotocol.io)-capable agent at the folder and it can **read** the ontology to understand your domain, **edit** it to grow it, and **act** through it with validated, effect-driven actions. Every change is a git commit.

No database required to start. Runs on your laptop. Plugs into any agent framework.

> **v0.2** — editable-files core + sync-first data layer + ontology teeth (state machines, richer constraints, relationship inference) + M3 actions. See [ROADMAP.md](ROADMAP.md) for what's next.

## Why

LLM agents are probabilistic. Pointed at raw tables and APIs they don't know what an entity *means*, can't follow relationships, and produce invalid results. Existing semantic layers (dbt, LookML) are built for SQL and humans, and are read-only — an agent can't evolve them.

ontolayer gives agents an ontology they can **read, act through, and edit** — with types, constraints, state machines, and relationship inference as guardrails. Neuro-symbolic: keep the probabilistic LLM on symbolic rails.

## Quickstart (60 seconds)

```bash
npx ontolayer init my-ontology   # scaffold a folder + git + e-commerce example
npx ontolayer validate my-ontology
npx ontolayer serve my-ontology  # start MCP endpoint (stdio)
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ontolayer": {
      "command": "npx",
      "args": ["ontolayer", "serve", "/absolute/path/to/my-ontology"]
    }
  }
}
```

Requires **Node ≥ 22.5** (uses built-in `node:sqlite`).

## What an ontology looks like

```
my-ontology/
  ontology.config.yaml
  README.md
  types/       Customer.md  Order.md  Product.md  OrderItem.md  SupportRep.md
  actions/     issue_refund.md
  .gitignore   (.ontology/ + .env — data and secrets stay out of git)
```

A type file (`types/Order.md`):

```markdown
---
type: Order
keys: [order_no]
properties:
  status:
    type: enum
    values: [paid, shipped, refunded]
    required: true
    transitions:               # state machine
      paid: [shipped, refunded]
      shipped: [refunded]
      refunded: []
  total: { type: money }
  tags: { type: string, many: true }
links:
  placed_by: { to: Customer, cardinality: one, via: customer_id, inverse: orders }
  items:     { to: Product, cardinality: many, through: OrderItem, through_from: order_id, through_to: product_id }
constraints:
  - { kind: disjoint, a: Customer, b: SupportRep }
  - { kind: conditional, if_field: status, if_value: refunded, require: refund_date }
---
# Order
An order a customer placed. Refunded at most once. Payout goes to the buyer, never the support rep.
```

## MCP tools (18 total)

| Group | Tool | Purpose |
|---|---|---|
| **Discover** | `list_types` | list all types |
| | `read_type` | schema + prose doc |
| | `list_actions` | list all actions |
| | `read_action` | action definition |
| **Edit ontology** | `create_type` | add a type (git-committed) |
| | `add_property` | add a typed field |
| | `add_link` | add a relationship |
| | `add_constraint` | add a constraint |
| | `update_type_doc` | update prose body |
| | `create_action` | define a new action |
| | `validate` | coherence check |
| **Data** | `put` | create/update an instance (validated) |
| | `get` | fetch one by id |
| | `query` | filter instances |
| | `search` | keyword search |
| | `traverse` | follow a link (1:1 / N:1 / 1:N / N:M) |
| | `run_action` | execute a validated action |
| | `sync` | incremental bidirectional sync to a peer |

## Data layer

- **Default:** `node:sqlite` — zero native deps, offline, no config.
- **Store contract:** `Store`/`Blob` interfaces with `changes`/`apply`/cursor — sync is first-class, not bolted on.
- **Sync:** incremental, bidirectional, idempotent (oplog cursor, last-write-wins, content-hash no-ops, no echo loops).
- **Upgrade path:** implement `Store` for Postgres, S3, Snowflake — same tool surface, no code changes.

## Ontology features

- **Types:** properties (typed, required, unique, multi-valued, deprecated), natural keys, single inheritance.
- **Relationships:** 1:1, N:1, 1:N, N:M (`via`, `inverse`, `through`); characteristics: `transitive`, `symmetric`, `functional`, `inverse_functional`.
- **State machines:** enum `transitions` block illegal state moves at write time.
- **Constraints (SHACL-lite):** `disjoint`, `at_most_once`, `cardinality`, `conditional`, `required_together`, `mutually_exclusive`.
- **Property constraints:** `min`/`max`, regex `pattern`.
- **Actions:** typed inputs, preconditions, effects — executed only when valid.

## Scopes

- **Individual agent:** local ontology folder (private memory).
- **Org/shared:** git remote + HTTP MCP server (M4, on the roadmap).
- **Rule:** write to your own, `propose_to` a shared parent (git PR), everyone pulls merged truth.

## CLI

```
ontology init   <dir>        scaffold new ontology folder
ontology serve  <dir>        start MCP server (stdio)
ontology validate <dir>      check coherence
ontology sync <a> <b>        bidirectional incremental sync
```

## Extending

ontolayer ships a contract; the ecosystem extends it. Implement `Store` / `Blob` / `Connector` interfaces to add Postgres, S3, email ingest, etc. See [`spec/FORMAT.md`](spec/FORMAT.md) §"Scope & extension points".

## Links

- Format spec: [`spec/FORMAT.md`](spec/FORMAT.md)
- Roadmap: [`ROADMAP.md`](ROADMAP.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)
- Issues: [github.com/Phytonking/agent-ontology/issues](https://github.com/Phytonking/agent-ontology/issues)

## License

[Apache-2.0](LICENSE). Open core — the framework is free and complete on its own.
