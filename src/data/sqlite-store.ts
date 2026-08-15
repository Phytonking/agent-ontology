import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { hashData, textProjection, type Change, type Op, type Rec } from "./record.js";
import type { ApplyResult, QueryOpts, Store, UpsertInput } from "./store.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  type TEXT NOT NULL, id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'shared',
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, hash TEXT NOT NULL,
  source TEXT, json TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type, id, scope)
);
CREATE INDEX IF NOT EXISTS idx_records_type ON records(type, scope, deleted);
CREATE TABLE IF NOT EXISTS oplog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL, id TEXT NOT NULL,
  scope TEXT NOT NULL, op TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT NOT NULL, target TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (source, target)
);
`;

interface Row {
  type: string;
  id: string;
  scope: string;
  version: number;
  updated_at: string;
  hash: string;
  source: string | null;
  json: string;
  text: string;
  deleted: number;
}

interface OpRow {
  seq: number;
  ts: string;
  type: string;
  id: string;
  scope: string;
  op: Op;
  version: number;
  hash: string;
}

function toRec(r: Row): Rec {
  return {
    _type: r.type,
    _id: r.id,
    _scope: r.scope,
    _version: r.version,
    _updatedAt: r.updated_at,
    _hash: r.hash,
    _source: r.source ?? undefined,
    _deleted: r.deleted === 1,
    data: JSON.parse(r.json),
  };
}

/**
 * Sync-native reference store on Node's built-in SQLite (zero native deps):
 * a generic `records` table + an append-only `oplog` that drives incremental sync.
 */
export class SqliteStore implements Store {
  readonly name: string;
  private db: DatabaseSync;

  constructor(dbPath: string, name?: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    this.name = name ?? dbPath;
  }

  async get(type: string, id: string, scope = "shared"): Promise<Rec | null> {
    const r = this.db
      .prepare("SELECT * FROM records WHERE type=? AND id=? AND scope=? AND deleted=0")
      .get(type, id, scope) as Row | undefined;
    return r ? toRec(r) : null;
  }

  async query(type: string, filter: Record<string, unknown> = {}, opts: QueryOpts = {}): Promise<Rec[]> {
    const scope = opts.scope ?? "shared";
    const rows = this.db
      .prepare("SELECT * FROM records WHERE type=? AND scope=? AND deleted=0")
      .all(type, scope) as unknown as Row[];
    let recs = rows.map(toRec);
    const entries = Object.entries(filter);
    if (entries.length) recs = recs.filter((rec) => entries.every(([k, v]) => rec.data[k] === v));
    return opts.limit ? recs.slice(0, opts.limit) : recs;
  }

  async search(type: string, q: string, opts: QueryOpts = {}): Promise<Rec[]> {
    const scope = opts.scope ?? "shared";
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = this.db
      .prepare("SELECT * FROM records WHERE type=? AND scope=? AND deleted=0")
      .all(type, scope) as unknown as Row[];
    const matches = rows.filter((r) => terms.every((t) => r.text.includes(t)));
    return opts.limit ? matches.slice(0, opts.limit).map(toRec) : matches.map(toRec);
  }

  async upsert(input: UpsertInput): Promise<Rec> {
    const scope = input.scope ?? "shared";
    const now = new Date().toISOString();
    const hash = hashData(input.data);
    const prev = this.db
      .prepare("SELECT version, hash FROM records WHERE type=? AND id=? AND scope=?")
      .get(input.type, input.id, scope) as { version: number; hash: string } | undefined;

    if (prev && prev.hash === hash) {
      const cur = await this.get(input.type, input.id, scope);
      if (cur) return cur; // no change — skip the write and the oplog entry
    }

    const version = (prev?.version ?? 0) + 1;
    const text = textProjection(input.data);
    this.db
      .prepare(
        `INSERT INTO records (type,id,scope,version,updated_at,hash,source,json,text,deleted)
         VALUES (?,?,?,?,?,?,?,?,?,0)
         ON CONFLICT(type,id,scope) DO UPDATE SET
           version=excluded.version, updated_at=excluded.updated_at, hash=excluded.hash,
           source=excluded.source, json=excluded.json, text=excluded.text, deleted=0`
      )
      .run(input.type, input.id, scope, version, now, hash, input.source ?? null, JSON.stringify(input.data), text);
    this.appendOplog(now, input.type, input.id, scope, "upsert", version, hash);
    return {
      _type: input.type,
      _id: input.id,
      _scope: scope,
      _version: version,
      _updatedAt: now,
      _hash: hash,
      _source: input.source,
      data: input.data,
    };
  }

  async remove(type: string, id: string, scope = "shared"): Promise<void> {
    const now = new Date().toISOString();
    const prev = this.db
      .prepare("SELECT version FROM records WHERE type=? AND id=? AND scope=?")
      .get(type, id, scope) as { version: number } | undefined;
    if (!prev) return;
    const version = prev.version + 1;
    const hash = "deleted";
    this.db
      .prepare("UPDATE records SET deleted=1, version=?, updated_at=?, hash=?, json='{}', text='' WHERE type=? AND id=? AND scope=?")
      .run(version, now, hash, type, id, scope);
    this.appendOplog(now, type, id, scope, "delete", version, hash);
  }

  private appendOplog(ts: string, type: string, id: string, scope: string, op: Op, version: number, hash: string): void {
    this.db
      .prepare("INSERT INTO oplog (ts,type,id,scope,op,version,hash) VALUES (?,?,?,?,?,?,?)")
      .run(ts, type, id, scope, op, version, hash);
  }

  async changes(sinceSeq: number, types?: string[]): Promise<Change[]> {
    let sql = "SELECT * FROM oplog WHERE seq > ?";
    const args: (string | number)[] = [sinceSeq];
    if (types && types.length) {
      sql += ` AND type IN (${types.map(() => "?").join(",")})`;
      args.push(...types);
    }
    sql += " ORDER BY seq";
    const ops = this.db.prepare(sql).all(...args) as unknown as OpRow[];

    const changes: Change[] = [];
    for (const o of ops) {
      const row = this.db
        .prepare("SELECT * FROM records WHERE type=? AND id=? AND scope=?")
        .get(o.type, o.id, o.scope) as Row | undefined;
      const record: Rec = row
        ? toRec(row)
        : {
            _type: o.type,
            _id: o.id,
            _scope: o.scope,
            _version: o.version,
            _updatedAt: o.ts,
            _hash: o.hash,
            _deleted: o.op === "delete",
            data: {},
          };
      changes.push({ seq: o.seq, op: o.op, record });
    }
    return changes;
  }

  async apply(changes: Change[]): Promise<ApplyResult> {
    let applied = 0;
    let skipped = 0;
    this.db.exec("BEGIN");
    try {
      for (const ch of changes) {
        const inc = ch.record;
        const local = this.db
          .prepare("SELECT version, hash, updated_at, deleted FROM records WHERE type=? AND id=? AND scope=?")
          .get(inc._type, inc._id, inc._scope) as
          | { version: number; hash: string; updated_at: string; deleted: number }
          | undefined;

        if (local && local.hash === inc._hash && local.deleted === (inc._deleted ? 1 : 0)) {
          skipped++;
          continue;
        }
        const take =
          !local ||
          inc._version > local.version ||
          (inc._version === local.version && inc._updatedAt > local.updated_at);
        if (!take) {
          skipped++;
          continue;
        }

        const now = inc._updatedAt;
        if (ch.op === "delete" || inc._deleted) {
          this.db
            .prepare(
              `INSERT INTO records (type,id,scope,version,updated_at,hash,source,json,text,deleted)
               VALUES (?,?,?,?,?,?,?, '{}', '', 1)
               ON CONFLICT(type,id,scope) DO UPDATE SET
                 version=excluded.version, updated_at=excluded.updated_at, hash=excluded.hash, deleted=1`
            )
            .run(inc._type, inc._id, inc._scope, inc._version, now, inc._hash, inc._source ?? null);
          this.appendOplog(now, inc._type, inc._id, inc._scope, "delete", inc._version, inc._hash);
        } else {
          const text = textProjection(inc.data);
          this.db
            .prepare(
              `INSERT INTO records (type,id,scope,version,updated_at,hash,source,json,text,deleted)
               VALUES (?,?,?,?,?,?,?,?,?,0)
               ON CONFLICT(type,id,scope) DO UPDATE SET
                 version=excluded.version, updated_at=excluded.updated_at, hash=excluded.hash,
                 source=excluded.source, json=excluded.json, text=excluded.text, deleted=0`
            )
            .run(inc._type, inc._id, inc._scope, inc._version, now, inc._hash, inc._source ?? null, JSON.stringify(inc.data), text);
          this.appendOplog(now, inc._type, inc._id, inc._scope, "upsert", inc._version, inc._hash);
        }
        applied++;
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { applied, skipped };
  }

  async headSeq(): Promise<number> {
    const r = this.db.prepare("SELECT MAX(seq) as m FROM oplog").get() as { m: number | null };
    return r.m ?? 0;
  }

  async getCursor(source: string): Promise<number> {
    const r = this.db
      .prepare("SELECT cursor FROM sync_state WHERE source=? AND target=?")
      .get(source, this.name) as { cursor: number } | undefined;
    return r?.cursor ?? 0;
  }

  async setCursor(source: string, seq: number): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sync_state (source,target,cursor,updated_at) VALUES (?,?,?,?)
         ON CONFLICT(source,target) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at`
      )
      .run(source, this.name, seq, now);
  }

  close(): void {
    this.db.close();
  }
}
