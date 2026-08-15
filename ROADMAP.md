# ontolayer — Roadmap

## Status
- **v0** — editable-files core: markdown ontology (`types/`, `actions/`), 11-tool
  MCP read/edit, git-commit-per-edit, CLI (`init`/`serve`/`validate`), coherence validator.
- **M2** (this branch) — data layer + relationship model:
  - `Store`/`Blob` interface with change primitives; `node:sqlite` reference store
    (records + append-only oplog); incremental **bidirectional sync** (cursor, LWW, idempotent).
  - `Dataset`: validated `put` / `get` / `query` / `search` / `traverse`; 6 data MCP tools; `ontology sync`.
  - Full **relationship model**: 1:1, N:1, 1:N, N:M (`via`, `inverse`, `through`).
  - **Natural keys + uniqueness** (key-based upsert, conflict rejection).
  - **Multi-valued properties**; **metadata** (`deprecated`, `label`).

## What else

### Ontology structure — remaining teeth
1. **Relationship characteristics + inference** — `transitive` / `symmetric` /
   `functional` / `inverse_functional`. Derive facts and enforce guardrails
   (the neuro-symbolic core). Declared in frontmatter, resolved by a light pass.
2. **State machines** — allowed enum transitions (`paid → shipped → refunded`);
   block illegal moves. Pairs directly with actions.
3. **Richer constraints (SHACL-lite)** — cardinality min/max, numeric/regex
   ranges, conditional (`if X then Y required`), mutually-exclusive,
   required-together. Enforced on write and surfaced by `validate`.
4. **Derived / computed properties** — metrics (`total = sum(items.amount)`);
   needs an evaluator.
5. **Events + temporal / valid-time** — events vs actions; bitemporal facts,
   effective dates.
6. **Parked** (custom escape hatch / later): SKOS taxonomies, multiple
   inheritance, full OWL reasoner.

### Platform milestones
- **M3 — actions with effects.** `run_action`: validate inputs (types) → check
  preconditions (constraints + transitions) → execute store write → oplog.
  No side effect until valid.
- **Adapters** behind `Store`/`Blob` — Postgres, S3; pgvector + embeddings to
  upgrade `search` from keyword to semantic.
- **M4 — org mode.** HTTP transport (MCP streamable-HTTP), multi-repo registry,
  auth/identity, overlay read across stores (individual ∪ shared),
  `propose_to` (git PR up), `pull`.
- **M5 — connectors.** Email + Slack ingest → map to types → upsert → propose
  ontology growth. Small `Connector` contract; the long tail is community plugins.

### Engineering / OSS readiness
- **Tests** — none yet (biggest gap). Vitest: loader, validator, store CRUD,
  sync idempotency/conflict, traverse, keys/unique.
- **CI** — GitHub Actions: build + typecheck + test (Node 22 / 24).
- **Publish** — npm `ontolayer`; semver the spec; CHANGELOG.
- **SDK** — files-mode SDK; Python SDK fast-follow.
- **Docs / examples** — quickstart, spec docs, the e-commerce example as a package.
- **Security** — threat-model doc (agent edits + connectors read email/Slack;
  secret handling; approval gates).
- **Robustness** — error handling, structured stderr logging, graceful store errors.

## Proposed sequencing
1. This PR — M2 + relationship model.
2. Tests + CI — lock the spine before adding teeth.
3. Ontology teeth — characteristics + inference (1), state machines (2),
   constraints (3) → spec 0.3.
4. M3 — actions with effects (consumes 2 + 3).
5. Postgres / S3 adapters + pgvector search.
6. M4 — org mode.
7. M5 — connectors.

## Boundary (unchanged)
Structure is defined, movement is open. Core owns the format, `Store`/`Blob`
interfaces, resolver, the SQLite reference, and the MCP surface. Extra backends,
connectors/ETL, entity resolution, and auth/governance are interface +
one-example, ecosystem-owned. See `spec/FORMAT.md` §"Scope & extension points".
