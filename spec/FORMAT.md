# Ontology File Format — Spec v0.1

An ontology is a directory of markdown files. This document defines its shape.
The format is the durable contract; implementations are replaceable.

## Directory layout

```
<ontology>/
  ontology.config.yaml     # required — metadata
  README.md                # optional — human/agent guide
  types/<Name>.md          # one entity type per file
  actions/<name>.md        # one action per file
```

File name should match the `type` / `action` declared inside it.

## `ontology.config.yaml`

```yaml
name: my-ontology     # required
version: 0.1.0        # semver of this ontology's content
spec: "0.1"           # format version (this document)
```

## Type files

A type file is YAML frontmatter (the machine-readable schema) followed by a
markdown body (the human- and agent-readable meaning).

```markdown
---
type: Order                    # required, matches /^[A-Za-z][A-Za-z0-9_]*$/
extends: BaseEntity            # optional, single inheritance (must exist)
properties:
  status:
    type: enum                 # see "Property types"
    values: [paid, shipped, refunded]   # required when type is enum
    required: true
  total:
    type: money
links:
  placed_by:
    to: Customer               # must be an existing type
    cardinality: one           # one | many  (default: one)
constraints:
  - { kind: disjoint, a: Customer, b: SupportRep }
  - { kind: at_most_once, of: refund }
---
# Order
Prose: what an Order means, examples, edge cases, ideas. This is what an agent
reads to understand the concept — write it for a smart reader who knows nothing
about your business.
```

### Property types

`string`, `text`, `int`, `float`, `bool`, `money`, `datetime`, `date`, `id`,
`json`, `enum`.

`enum` requires a non-empty `values` list. Every property may set
`required: true` and a `description`.

### Constraints

Declared here, enforced once the data/instance layer exists (v0 declares and
checks references; it does not yet hold instances to enforce against).

| kind | fields | meaning |
|---|---|---|
| `disjoint` | `a`, `b` | two types can't refer to the same real entity |
| `at_most_once` | `of` | the named event happens at most once |
| `custom` | `rule` | free-text escape hatch for anything not yet modeled |

## Action files

```markdown
---
action: issue_refund           # required, matches /^[A-Za-z][A-Za-z0-9_]*$/
description: Refund an order, once, if paid or shipped.
inputs:
  order_id: { type: id, required: true }
  amount:   { type: money }
preconditions:
  - order.status in [paid, shipped]
  - refund at_most_once
effects:
  - set order.status = refunded
---
# issue_refund
Prose: what this action does and when to use it.
```

`inputs` use the same typed-field shape as properties. `preconditions` and
`effects` are string lists in v0 (they become structured + executable in a later
version, when actions gain real side effects).

## Coherence rules (checked by `validate`)

- every `links.*.to` references an existing type (error);
- `extends` references an existing type (error);
- `disjoint` references existing types (warning);
- every file's frontmatter matches the shapes above (error).

Cross-reference errors do **not** block individual edits — an agent may create
types in any order. Run `validate` to see the whole picture.

## Versioning

`spec` in `ontology.config.yaml` pins the format version. This document is
versioned with it. Breaking format changes bump the spec version.

---

# Storage mapping (spec 0.2 — planned, additive)

v0.1 files describe *meaning* only. Spec 0.2 adds an **optional** mapping from
types to a backing store, so instances (rows, blobs) can be read and written.
Files without a `store:` block stay valid — this is additive.

**The rule that keeps it clean: definitions → git, data → the store, secrets → env.**
The mapping (structure) is committed; credentials never are.

## Named stores in `ontology.config.yaml` (committed, no secrets)

```yaml
name: acme-shared
spec: "0.2"
stores:
  main:                 # a named store — structure only
    kind: postgres      # postgres | sqlite | ...
    # connection URL comes from env: ONTOLAYER_STORE_MAIN_URL
  blobs:
    kind: s3            # s3 | fs | ...
    bucket: acme-ontology
    region: us-west-2
    # keys come from env
defaults:
  store: main           # where instances land unless a type overrides
```

Secrets bind by convention from the environment:
`ONTOLAYER_STORE_<NAME>_<FIELD>` (e.g. `ONTOLAYER_STORE_MAIN_URL`). Ship a
committed `.env.example`; keep the real `.env` gitignored.

## Per-type mapping (in the type frontmatter, committed)

```yaml
---
type: Order
store:
  backend: main         # references stores.main
  table: orders
  id: order_id
properties:
  status: { type: enum, values: [paid, shipped, refunded], column: status }
  total:  { type: money, column: total_cents }
links:
  placed_by: { to: Customer, via: customer_id }
---
```

Type→table→column and link→join-key are structural and shareable, so they live
in git. The store default is local (`sqlite` + local `fs`), so an ontology runs
with no configuration and no cloud account.

---

# Scope & extension points

This project defines a **contract** and ships one batteries-included default. It
is precise where portability demands it and open where real-world variety lives.

**The line: structure is defined, movement is open. Precise contract, open plumbing.**

## Defined by this project (stable, versioned — the contract)

- the ontology file format (this document);
- the `Store` interface — `get`, `upsert`, `query`, `search`;
- the `Blob` interface — `put`, `get`, `url`;
- the config + resolver (named store → adapter → env secret binding);
- one reference backend: **SQLite + local filesystem + sqlite-vec** (zero-config, offline);
- the read/act path — `get` / `traverse` / `search` / `run_action` — and the validator;
- the MCP tool surface.

## Left open (interface + at most one example — the ecosystem owns these)

- **additional backends** (Postgres, S3, Snowflake, …) — implement `Store`/`Blob`;
- **ingest / connectors** (email, Slack, ETL from existing systems) — a small
  `Connector` contract, not an ETL platform; the long tail is community plugins;
- **entity resolution / dedup** — a hook, not a built-in solution (v1 trusts keys);
- **auth / multi-tenant / governance** — an org-mode concern, out of the core.

If you're extending the project, this is your map: implement an interface above,
don't fork the spine.
