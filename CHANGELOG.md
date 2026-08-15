# Changelog

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
