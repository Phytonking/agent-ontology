import pg from "pg";
import { hashData, textProjection, type Change, type Op, type Rec } from "../data/record.js";
import type { ApplyResult, QueryOpts, Store, UpsertInput } from "../data/store.js";

const { Pool } = pg;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  type        TEXT        NOT NULL,
  id          TEXT        NOT NULL,
  scope       TEXT        NOT NULL DEFAULT 'shared',
  version     INTEGER     NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL,
  hash        TEXT        NOT NULL,
  source      TEXT,
  data        JSONB       NOT NULL DEFAULT '{}',
  text_search TSVECTOR,
  deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (type, id, scope)
);
CREATE INDEX IF NOT EXISTS idx_records_type  ON records (type, scope, deleted);
CREATE INDEX IF NOT EXISTS idx_records_text  ON records USING GIN (text_search);
CREATE INDEX IF NOT EXISTS idx_records_data  ON records USING GIN (data);

CREATE TABLE IF NOT EXISTS oplog (
  seq        BIGSERIAL   PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type       TEXT        NOT NULL,
  id         TEXT        NOT NULL,
  scope      TEXT        NOT NULL,
  op         TEXT        NOT NULL,
  version    INTEGER     NOT NULL,
  hash       TEXT        NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  source     TEXT        NOT NULL,
  target     TEXT        NOT NULL,
  cursor     BIGINT      NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (source, target)
);
`;

interface Row {
  type: string; id: string; scope: string; version: number;
  updated_at: Date; hash: string; source: string | null;
  data: Record<string, unknown>; deleted: boolean;
}

function toRec(r: Row): Rec {
  return {
    _type: r.type, _id: r.id, _scope: r.scope, _version: r.version,
    _updatedAt: r.updated_at.toISOString(), _hash: r.hash,
    _source: r.source ?? undefined, _deleted: r.deleted,
    data: r.data,
  };
}

/**
 * PostgreSQL Store adapter.
 *
 * Env (via resolver): ONTOLAYER_STORE_<NAME>_URL  (postgres://user:pass@host/db)
 * Optional: set search_path to namespace multiple ontologies in one DB.
 *
 * pgvector: if the `vector` extension is installed, add an `embedding` column
 * manually and the `search()` method can be upgraded to ANN similarity search.
 */
export class PostgresStore implements Store {
  readonly name: string;
  private pool: pg.Pool;

  constructor(connectionUrl: string, name: string) {
    this.name = name;
    this.pool = new Pool({ connectionString: connectionUrl, max: 10 });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try { await client.query(SCHEMA); }
    finally { client.release(); }
  }

  async get(type: string, id: string, scope = "shared"): Promise<Rec | null> {
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM records WHERE type=$1 AND id=$2 AND scope=$3 AND deleted=FALSE",
      [type, id, scope]
    );
    return rows[0] ? toRec(rows[0]) : null;
  }

  async query(type: string, filter: Record<string, unknown> = {}, opts: QueryOpts = {}): Promise<Rec[]> {
    const scope = opts.scope ?? "shared";
    const entries = Object.entries(filter);
    if (entries.length === 0) {
      const { rows } = await this.pool.query<Row>(
        "SELECT * FROM records WHERE type=$1 AND scope=$2 AND deleted=FALSE",
        [type, scope]
      );
      const recs = rows.map(toRec);
      return opts.limit ? recs.slice(0, opts.limit) : recs;
    }
    // filter via JSONB containment @>
    const { rows } = await this.pool.query<Row>(
      "SELECT * FROM records WHERE type=$1 AND scope=$2 AND deleted=FALSE AND data @> $3",
      [type, scope, JSON.stringify(filter)]
    );
    const recs = rows.map(toRec);
    return opts.limit ? recs.slice(0, opts.limit) : recs;
  }

  async search(type: string, q: string, opts: QueryOpts = {}): Promise<Rec[]> {
    const scope = opts.scope ?? "shared";
    const terms = q.trim().split(/\s+/).filter(Boolean).map(t => t + ":*").join(" & ");
    if (!terms) return this.query(type, {}, opts);
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM records
       WHERE type=$1 AND scope=$2 AND deleted=FALSE
         AND text_search @@ to_tsquery('simple', $3)
       ORDER BY ts_rank(text_search, to_tsquery('simple', $3)) DESC
       ${opts.limit ? `LIMIT ${opts.limit}` : ""}`,
      [type, scope, terms]
    );
    return rows.map(toRec);
  }

  async upsert(input: UpsertInput): Promise<Rec> {
    const scope = input.scope ?? "shared";
    const hash = hashData(input.data);
    const text = textProjection(input.data);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ version: number; hash: string }>(
        "SELECT version, hash FROM records WHERE type=$1 AND id=$2 AND scope=$3",
        [input.type, input.id, scope]
      );
      if (existing.rows[0]?.hash === hash) {
        await client.query("ROLLBACK");
        const cur = await this.get(input.type, input.id, scope);
        if (cur) return cur;
      }
      const version = (existing.rows[0]?.version ?? 0) + 1;
      const now = new Date();
      await client.query(
        `INSERT INTO records (type,id,scope,version,updated_at,hash,source,data,text_search,deleted)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_tsvector('simple',$9),FALSE)
         ON CONFLICT (type,id,scope) DO UPDATE SET
           version=$4, updated_at=$5, hash=$6, source=$7, data=$8,
           text_search=to_tsvector('simple',$9), deleted=FALSE`,
        [input.type, input.id, scope, version, now, hash, input.source ?? null, input.data, text]
      );
      await client.query(
        "INSERT INTO oplog (ts,type,id,scope,op,version,hash) VALUES ($1,$2,$3,$4,'upsert',$5,$6)",
        [now, input.type, input.id, scope, version, hash]
      );
      await client.query("COMMIT");
      return {
        _type: input.type, _id: input.id, _scope: scope, _version: version,
        _updatedAt: now.toISOString(), _hash: hash, _source: input.source, data: input.data,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async remove(type: string, id: string, scope = "shared"): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ version: number }>(
        "SELECT version FROM records WHERE type=$1 AND id=$2 AND scope=$3",
        [type, id, scope]
      );
      if (!rows[0]) { await client.query("ROLLBACK"); return; }
      const version = rows[0].version + 1;
      const now = new Date();
      await client.query(
        "UPDATE records SET deleted=TRUE, version=$1, updated_at=$2, hash='deleted', data='{}', text_search=NULL WHERE type=$3 AND id=$4 AND scope=$5",
        [version, now, type, id, scope]
      );
      await client.query(
        "INSERT INTO oplog (ts,type,id,scope,op,version,hash) VALUES ($1,$2,$3,$4,'delete',$5,'deleted')",
        [now, type, id, scope, version]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async changes(sinceSeq: number, types?: string[]): Promise<Change[]> {
    let sql = "SELECT * FROM oplog WHERE seq > $1";
    const params: unknown[] = [sinceSeq];
    if (types?.length) {
      sql += ` AND type = ANY($2)`;
      params.push(types);
    }
    sql += " ORDER BY seq";
    const { rows } = await this.pool.query(sql, params);
    const changes: Change[] = [];
    for (const o of rows) {
      const rec = await this.get(o.type, o.id, o.scope)
        ?? { _type: o.type, _id: o.id, _scope: o.scope, _version: o.version, _updatedAt: o.ts.toISOString(), _hash: o.hash, _deleted: o.op === "delete", data: {} };
      changes.push({ seq: Number(o.seq), op: o.op as Op, record: rec });
    }
    return changes;
  }

  async apply(changes: Change[]): Promise<ApplyResult> {
    let applied = 0, skipped = 0;
    for (const ch of changes) {
      const inc = ch.record;
      const { rows } = await this.pool.query<{ version: number; hash: string; updated_at: Date; deleted: boolean }>(
        "SELECT version, hash, updated_at, deleted FROM records WHERE type=$1 AND id=$2 AND scope=$3",
        [inc._type, inc._id, inc._scope]
      );
      const local = rows[0];
      if (local && local.hash === inc._hash && local.deleted === (inc._deleted ?? false)) { skipped++; continue; }
      const take = !local || inc._version > local.version || (inc._version === local.version && inc._updatedAt > local.updated_at.toISOString());
      if (!take) { skipped++; continue; }
      if (ch.op === "delete" || inc._deleted) {
        await this.remove(inc._type, inc._id, inc._scope);
      } else {
        await this.upsert({ type: inc._type, id: inc._id, scope: inc._scope, data: inc.data, source: inc._source });
      }
      applied++;
    }
    return { applied, skipped };
  }

  async headSeq(): Promise<number> {
    const { rows } = await this.pool.query("SELECT MAX(seq) as m FROM oplog");
    return Number(rows[0]?.m ?? 0);
  }

  async getCursor(source: string): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT cursor FROM sync_state WHERE source=$1 AND target=$2", [source, this.name]
    );
    return Number(rows[0]?.cursor ?? 0);
  }

  async setCursor(source: string, seq: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_state (source,target,cursor,updated_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (source,target) DO UPDATE SET cursor=$3, updated_at=NOW()`,
      [source, this.name, seq]
    );
  }

  close(): void { this.pool.end(); }
}
