# Agent Ontology Layer — PRD (v0.3, draft)

## 1. One-liner
A **plug-and-play ontology** that lives as **agent-editable text files**, tracked
by **git**, exposed to any agent framework over **MCP**. Agents don't just read
it — they query it, act through it, and grow it. Open source, local-first.

## 2. Status
**v0 (built):** the editable-files core — ontology format, loader, validator,
11-tool MCP server, git-commit-per-edit, CLI (`init` / `serve` / `validate`),
runnable e-commerce example. Runs on a laptop, no database, no cloud.
The data layer and everything below plugs onto this seed.

## 3. Problem
Agents (LLMs) are probabilistic. Pointed at raw tables and APIs they don't know
what an entity *means*, can't reliably follow relationships, and produce invalid
results (made-up status, double refund, payout to the wrong party). Existing
semantic layers (dbt, LookML) are built for SQL/humans and are **read-only** —
an agent can't evolve them. We want an ontology agents can **read, act through,
and edit**, that a person can set up in 60 seconds.

## 4. Core idea
The ontology is a **git-tracked folder of markdown files**. Each file has a
machine part (frontmatter: schema, constraints, store mapping) and a prose part
(docs, examples — for the agent *and* the human). Text is the source of truth for
**meaning**; a backing store holds the **data**. An MCP server wraps the folder
for query, actions, and safe edits. Plain text → any agent can read it even with
no server running.

## 5. Boundary — what it is / what it isn't
The single most important scope decision. We define a **contract** and ship one
batteries-included default. Precise where portability demands it; open where
real-world variety lives.

> **The line: structure is defined, movement is open. Precise contract, open plumbing.**

**HOLD — defined, owned, versioned (the spine):**
- the ontology file format (the spec);
- the `Store` interface (`get`, `upsert`, `query`, `search`) + `Blob` interface (`put`, `get`);
- config + resolver (named store → adapter → env secret);
- **one reference backend: SQLite + local FS + sqlite-vec** (zero-config, offline);
- the read/act path (`get` / `traverse` / `search` / `run_action`) + validator;
- the MCP tool surface.

**LEAVE OPEN — interface + at most one example (the ecosystem owns it):**
- extra backends (Postgres, S3, Snowflake…) — implement the interface;
- ingest / connectors (email, Slack, ETL) — a tiny `Connector` contract, **not**
  an ETL platform;
- entity resolution / dedup — a hook, not a solution (v1 trusts keys);
- auth / multi-tenant / governance — org-mode / commercial, out of core.

Why the line is here: too vague (no interface) → nothing portable, no
plug-and-play, half a spec. Too much (own every backend + ETL) →
Palantir + Airbyte scope death. **The line is the interface.**

## 6. The four pieces
1. **Text ontology (definitions)** — types, actions, connectors as markdown,
   git-tracked. Reversible, reviewable. Agent and human read the same files.
2. **Backing store (data)** — Postgres (typed rows) + S3 (raw blobs) for orgs;
   SQLite + local FS by default. Defs in text; data in the store; joined by the
   `store:` mapping.
3. **Actions** — text contract → real op. `run_action` → validate types then
   constraints → execute write. **No side effect until validated.**
4. **Connectors** — ingest email/Slack → map to types → upsert; unknown concept →
   *propose* an ontology edit. Grows bottom-up.

## 7. Folder layout
```
ontology/
  README.md
  ontology.config.yaml     # name, version, spec, named stores (no secrets)
  types/
    order.md               # frontmatter: schema + constraints + store mapping | body: meaning
  actions/
    issue_refund.md        # inputs, preconditions, effects
  connectors/
    email.md
```
Type file — one readable unit (schema + prose in one place). See `spec/FORMAT.md`.

## 8. Agent-editable ontology (the novel bit)
Edit tools (`create_type`, `add_property`, `add_link`, `add_constraint`,
`create_action`, `update_type_doc`) patch the markdown and make a git commit.
Because it's text + versioned: **safe** (revert), **reviewable** (diff / PR),
**composable** (connectors propose, a human approves). The ontology grows from
data instead of being frozen up front.

## 9. Scopes & server modes (the git model)
**An ontology = a git repo.** That's the atom; everything composes from it.

- **Individual agent** = its own repo (private memory).
- **Shared org** = one canonical repo (the "shared conceptualization").
- **Relationship** = git (remote + branch + PR) + read overlay.

Two run modes, one codebase:
- **Local mode (built):** `ontology serve ./repo` over **stdio**. One repo, local
  files + git. Private, fast, offline. The solo/individual scope.
- **Org mode (planned):** one server holds **many** repos, served over **HTTP**,
  routed by ontology id, gated by auth. A multiplexer over repos.

**Hybrid is the norm:** agent runs local (speed + private memory) with the org
repo as a git remote + parent. Reads shared, proposes up.

Compose by **overlay** (read `own ∪ parents`, parents read-only, provenance
tagged). Track + promote by **git** (write to your own; `propose_to` a parent =
PR; everyone `pull`s the merged truth). Approval policy per repo: `shared` =
human-approve, `agents/*` = auto.

Organizing many ontologies = a namespace of repos (can be a GitHub org):
```
acme/  shared/  teams/{support,sales}/  agents/bot-7/  people/avi/
```

## 10. Storage & config (the data layer)
**Rule: definitions → git, data → the store, secrets → env.**

- **Committed (no secrets):** named stores in `ontology.config.yaml` + per-type
  `store:` mapping (table, columns, join keys). Structural, shareable.
- **Not committed (secrets):** connection URLs/keys via env
  (`ONTOLAYER_STORE_<NAME>_<FIELD>`) or a gitignored `.env`; ship `.env.example`.
- **Code:** `Store`/`Blob` interfaces in core; adapters as optional packages
  (`store-sqlite` default, `store-postgres`, `blob-fs` default, `blob-s3`); a
  resolver binds named store → adapter → env secret.
- **Local default:** SQLite + local FS + sqlite-vec → data layer works with zero
  config, offline. Org: point stores at Postgres/S3 via env; same mappings, same
  tools. `ontology doctor` verifies connections.

Full detail in `spec/FORMAT.md`.

## 11. Plug-and-play
- **MCP mode:** `ontology serve` → point any MCP agent at it. Zero glue.
- **Files mode:** a framework that reads a repo just reads `ontology/` + a thin SDK.

```
npx ontolayer init my-ontology   # scaffold folder + example + git
ontology serve my-ontology       # start MCP endpoint → point your agent at it
```

## 12. MCP surface
Built (v0): `list_types · read_type · create_type · add_property · add_link ·
add_constraint · update_type_doc · list_actions · read_action · create_action ·
validate`.

Planned: data (`get · traverse · search · run_action`); scopes
(`list_ontologies · use_ontology · propose_to · pull`).

## 13. How an agent uses it
1. Source data → `search` / `get` / `traverse`.
2. Propose result/action → `run_action`.
3. Validator checks: types (Pydantic), then constraints/inference (ontology).
4. Valid → execute. Invalid → retry via LLM, or escalate to a human.
5. New concept → `edit_ontology` / `propose_to` grows it; human approves the diff.

## 14. Example — e-commerce
The bundled `init` example catches, without hand-written English rules:
- `status = "probably shipped"` → rejected (enum);
- second refund on the same order → rejected (cardinality);
- payout to a SupportRep instead of the buyer → rejected (disjoint);
- support email mentions "chargeback" (unknown) → connector proposes a
  `Chargeback` type; human approves.

## 15. Roadmap
- **v0 — editable-files core.** ✅ Done (format, loader, validator, MCP read/edit,
  git, CLI, example).
- **M2 — data spine.** `Store`/`Blob` interfaces + SQLite reference + resolver +
  `get`/`traverse`/`search`. Freeze the interface; Postgres/S3 land as optional
  packages after.
- **M3 — actions with effects.** `run_action` validated writes.
- **M4 — org mode.** HTTP transport + multi-repo registry + auth + overlay
  resolver + `propose_to`/`pull`.
- **M5 — connectors.** Email + Slack ingest → upsert → propose ontology growth.

## 16. Open questions
| Question | Options | Recommendation |
|---|---|---|
| Language | TS · Python | **TS primary** (+ Python SDK later) |
| License | Apache-2.0 · MIT · source-available | **Apache-2.0, open core** |
| Search backend | sqlite-vec · pgvector · external | **sqlite-vec local / pgvector org** |
| Edit approval | auto · human-approve | **human-approve on shared, auto on own** |
| Individual memory | local per agent · namespaced on server | **local, with org as remote** |
| First org dataset | — | **need from you** |
