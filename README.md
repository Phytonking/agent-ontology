# ontolayer

**A filesystem-first, agent-editable ontology framework.**

An ontology is a folder of plain markdown files — one per type, one per action.
Point any [MCP](https://modelcontextprotocol.io)-capable agent at the folder and
it can **read** the ontology to understand your domain and **edit** it to grow it.
Every change is a git commit, so it's reviewable and revertable.

No database, no cloud account, nothing to configure. It runs on your laptop.

> Status: **v0** — the editable-files core. The data layer (instances, query,
> connectors, backing stores) plugs in on top of this seed. See `PRD.md`.

## Why

LLM agents are probabilistic. Pointed at raw tables they don't know what an
entity *means*, can't follow relationships, and produce invalid results.
Existing semantic layers are built for SQL and humans, and are read-only — an
agent can't evolve them.

ontolayer gives agents an ontology they can read, act through, and **edit** —
kept honest by types and constraints (neuro-symbolic guardrails).

## Quickstart

```bash
npm install
npm run build

# scaffold an ontology with a small e-commerce example
node dist/cli.js init my-ontology

# check it's coherent
node dist/cli.js validate my-ontology

# serve it to an MCP agent (stdio)
node dist/cli.js serve my-ontology
```

Point an MCP client at the `serve` command. In Claude Desktop, add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ontolayer": {
      "command": "node",
      "args": ["/absolute/path/to/dist/cli.js", "serve", "/absolute/path/to/my-ontology"]
    }
  }
}
```

## MCP tools

| Tool | Purpose |
|---|---|
| `list_types` / `read_type` | understand the domain |
| `create_type` | add a new entity type |
| `add_property` / `add_link` / `add_constraint` | grow a type |
| `update_type_doc` | edit a type's prose meaning |
| `list_actions` / `read_action` / `create_action` | define what can be done |
| `validate` | check whole-ontology coherence |

## What an ontology folder looks like

```
my-ontology/
  ontology.config.yaml
  README.md
  types/
    customer.md
    order.md
    support_rep.md
  actions/
    issue_refund.md
```

A type file (`types/order.md`):

```markdown
---
type: Order
properties:
  status: { type: enum, values: [paid, shipped, refunded], required: true }
  total: { type: money }
links:
  placed_by: { to: Customer, cardinality: one }
  handled_by: { to: SupportRep, cardinality: one }
constraints:
  - { kind: disjoint, a: Customer, b: SupportRep }
  - { kind: at_most_once, of: refund }
---
# Order
An order a customer placed. Refunded at most once; payout goes to the buyer,
never the support rep.
```

The format is documented in [`spec/FORMAT.md`](spec/FORMAT.md).

## Roadmap (see `PRD.md`)

- **v0 (this):** editable-files core — types, actions, MCP read/edit, validate, git.
- **Next:** instances + query store (SQLite default, Postgres adapter), `get` /
  `traverse` / `search`.
- **Then:** actions with real effects; connectors (email, Slack) that ingest and
  propose ontology growth; S3 blob store; org/shared vs individual-agent scopes.

## License

[Apache-2.0](LICENSE). Open core — the framework is free and complete on its own.
