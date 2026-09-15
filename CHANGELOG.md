# Changelog

## 1.0.0

First release. The ontology is a folder of YAML files — one per object,
properties + links + actions together.

**Core:**
- Object files: properties (typed, required, unique, multi-valued, min/max/pattern),
  links (one-to-one / many-to-one / one-to-many / many-to-many with through joins),
  actions (inputs, preconditions, effects), constraints, natural keys.
- Enum state machines: declare transitions per value, enforced at write time.
- Relationship characteristics: transitive, symmetric, functional, inverse_functional.
- Light inference engine for traversal (transitive closure, symmetric backfill).

**Data layer:**
- Per-object typed tables: one table per object, properties as columns, rows as data.
- Schema evolution: new property in YAML → ALTER TABLE ADD COLUMN automatically.
- Files = source of truth: `put()` writes DB + file; file edit → materialize → DB.
- Write modes: `bidirectional` (default) or `index_only`.
- Materialize with hash-skip (unchanged files = no re-upsert).
- Reindex: wipe + rebuild DB from files (clean slate).
- Branch-aware DB: one SQLite database per git branch, fully isolated.

**Actions:**
- Each action in an object file becomes its own MCP tool (dynamic registration).
- Validated: inputs checked, preconditions enforced, state transitions validated,
  effects applied — no side effect unless valid.

**Server:**
- MCP server (stdio + HTTP/Streamable HTTP).
- Docker + docker-compose (ontolayer + Postgres + MinIO).

**Backends:**
- SQLite (default, zero-config, node:sqlite built-in).
- Postgres adapter (JSONB + tsvector, pgvector-ready).
- S3 / Cloudflare R2 blob adapter.
- Config-driven resolver: swap backends by config, secrets from env.

**Extension:**
- Connectors: pluggable data ingest (registry + module linking).
- Transforms: reusable map/enrich steps.
- Pipelines: ordered connector + transform steps with shared context.
- Write hooks: beforePut / afterPut middleware on every write.
- Incremental cursor for connectors (persisted between runs).
- Connector examples: REST API, Postgres, CSV/JSON, webhook, multi-object, transform.

**Quality:**
- 48 tests (vitest), GitHub Actions CI (Node 22 + 24).
- Two templates: ecommerce, agent office (12 objects, 6 actions).
