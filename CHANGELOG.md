# Changelog

## Unreleased

**Per-stack extension: connectors, transforms, pipelines, hooks**
- Connector framework: contract + registry + `module:` linking. Define/add/run
  connectors as files; `list/read/create/run_connector` tools + CLI.
- Transforms: reusable data-management steps (`registerTransform` / `module:`).
- Pipelines: `pipelines/<name>.md` composes ordered connector/transform steps
  with a shared `bag`. `run_pipeline` tool + `ontology run-pipeline`.
- Write hooks / middleware: `dataset.use({ beforePut, afterPut })` — applies to
  every write (connectors, actions, direct). Enrich, derive, embed, audit, notify.
  Module-linked via `hooks:` in ontology.config.yaml.

**Backends**
- Postgres store adapter (JSONB + tsvector, pgvector-ready).
- S3 / Cloudflare R2 blob adapter; filesystem blob default.
- Config-driven resolver: `Dataset.open` honors `stores:`/`blobs:` in config,
  secrets bound from env. `ontology doctor` tests connections.

**Files = source of truth**
- Two-way file↔DB binding: `put` writes back to `data/<Type>/<id>.yaml`.
- `materialize` ingests `data/` files into the store; `serve` auto-materializes
  and watches for edits. `ontology materialize` CLI.

**Templates**
- `ontology init --template office`: 12-type agent-office ontology + 7 actions.

## 0.2.0

**Ontology teeth**
- Enum state machines: declare legal transitions per value; illegal moves rejected at write time.
- Richer constraints: `cardinality`, `conditional`, `required_together`, `mutually_exclusive` (SHACL-lite).
- Property constraints: `min`/`max` (int/float/money), `pattern` (string/text).
- Relationship characteristics: `transitive`, `symmetric`, `functional`, `inverse_functional` on links.
- Light inference engine (`src/infer.ts`): transitive closure, symmetric backfill, functional/inverse-functional checks.

**M3 — Actions with effects**
- `run_action` executes a named action: validates inputs, checks preconditions, enforces state transitions, applies effects as store writes. No side effect until valid.
- MCP tool `run_action` exposed.
- `issue_refund` in the scaffold example is fully executable end-to-end.

**Data layer**
- `Store`/`Blob` interfaces with change primitives (`changes`/`apply`/cursor) — sync is first-class.
- `node:sqlite` reference store (zero native deps): `records` + append-only `oplog` + `sync_state`.
- Incremental, bidirectional, idempotent sync (last-write-wins, content-hash no-op, no echo loops).
- `Dataset`: validated `put`, `get`, `query`, `search`, `traverse` across all cardinalities (1:1, N:1, 1:N, N:M).

**Relationship model**
- Full cardinality matrix via `cardinality` + `via` + `inverse` + `through`/`through_from`/`through_to`.
- Natural keys (`keys:`), property `unique`, multi-valued (`many`), metadata (`deprecated`, `label`).

**Quality**
- 36-test vitest suite (loader, validator, store CRUD, sync, dataset, actions).
- GitHub Actions CI (Node 22 + 24).
- Spec bumped to 0.2; `ROADMAP.md` added.

## 0.1.0

Initial release: editable-files core — ontology format, loader, validator, 11-tool MCP read/edit, git-commit-per-edit, CLI (`init`/`serve`/`validate`), runnable e-commerce example.
