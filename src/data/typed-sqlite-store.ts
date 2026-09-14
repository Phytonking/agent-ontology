import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { hashData, textProjection, type Change, type Op, type Rec } from "./record.js";
import type { ApplyResult, QueryOpts, Store, UpsertInput } from "./store.js";
import type { TypeDoc, PropertyDef } from "../types.js";

const META_COLS = ["_id", "_scope", "_version", "_updated_at", "_hash", "_source", "_deleted"];

function sqlType(prop: PropertyDef): string {
  switch (prop.type) {
    case "int": return "INTEGER";
    case "float": case "money": return "REAL";
    case "bool": return "INTEGER";
    default: return "TEXT";
  }
}

function toSqlValue(prop: PropertyDef, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (prop.many && Array.isArray(value)) return JSON.stringify(value);
  if (prop.type === "bool") return value ? 1 : 0;
  if (prop.type === "json" && typeof value === "object") return JSON.stringify(value);
  return value;
}

function fromSqlValue(prop: PropertyDef, value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (prop.many && typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  if (prop.type === "bool") return value === 1 || value === true;
  if (prop.type === "json" && typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  if ((prop.type === "int" || prop.type === "float" || prop.type === "money") && typeof value === "string") {
    return Number(value);
  }
  return value;
}

/**
 * Typed SQLite store: one table per object type, properties as columns.
 * The oplog + sync_state stay as generic tables (they track changes, not data).
 *
 * When the ontology model changes (new property added), ensureTable adds the
 * missing column via ALTER TABLE — zero-downtime schema evolution.
 */
export class TypedSqliteStore implements Store {
  readonly name: string;
  private db: DatabaseSync;
  private schemas = new Map<string, TypeDoc>();

  constructor(dbPath: string, name: string, types?: Map<string, TypeDoc>) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oplog (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT NOT NULL,
        id TEXT NOT NULL, scope TEXT NOT NULL, op TEXT NOT NULL,
        version INTEGER NOT NULL, hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        source TEXT NOT NULL, target TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL, PRIMARY KEY (source, target)
      );
    `);
    this.name = name;
    if (types) {
      for (const t of types.values()) this.ensureTable(t);
    }
  }

  updateSchemas(types: Map<string, TypeDoc>): void {
    for (const t of types.values()) this.ensureTable(t);
  }

  private ensureTable(type: TypeDoc): void {
    this.schemas.set(type.name, type);
    const tbl = this.tableName(type.name);
    const propCols = Object.entries(type.properties).map(
      ([name, spec]) => `${this.q(name)} ${sqlType(spec)}`
    );
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${tbl} (
      _id TEXT NOT NULL, _scope TEXT NOT NULL DEFAULT 'shared',
      _version INTEGER NOT NULL DEFAULT 1, _updated_at TEXT NOT NULL,
      _hash TEXT NOT NULL, _source TEXT, _deleted INTEGER NOT NULL DEFAULT 0,
      ${propCols.join(", ")},
      PRIMARY KEY (_id, _scope)
    )`);
    // add missing columns (schema evolution)
    const existing = new Set(
      (this.db.prepare(`PRAGMA table_info(${tbl})`).all() as unknown as { name: string }[]).map((r) => r.name)
    );
    for (const [name, spec] of Object.entries(type.properties)) {
      if (!existing.has(name)) {
        this.db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${this.q(name)} ${sqlType(spec)}`);
      }
    }
  }

  private tableName(type: string): string { return `"obj_${type}"`; }
  private q(col: string): string { return `"${col}"`; }
  private getSchema(type: string): TypeDoc | undefined { return this.schemas.get(type); }

  private rowToRec(type: string, row: Record<string, unknown>): Rec {
    const schema = this.getSchema(type);
    const data: Record<string, unknown> = {};
    if (schema) {
      for (const [name, spec] of Object.entries(schema.properties)) {
        const v = fromSqlValue(spec, row[name]);
        if (v !== undefined) data[name] = v;
      }
    }
    return {
      _type: type,
      _id: row._id as string,
      _scope: row._scope as string,
      _version: row._version as number,
      _updatedAt: row._updated_at as string,
      _hash: row._hash as string,
      _source: (row._source as string) ?? undefined,
      _deleted: row._deleted === 1,
      data,
    };
  }

  async get(type: string, id: string, scope = "shared"): Promise<Rec | null> {
    const tbl = this.tableName(type);
    try {
      const row = this.db.prepare(`SELECT * FROM ${tbl} WHERE _id=? AND _scope=? AND _deleted=0`).get(id, scope) as Record<string, unknown> | undefined;
      return row ? this.rowToRec(type, row) : null;
    } catch { return null; }
  }

  async query(type: string, filter: Record<string, unknown> = {}, opts: QueryOpts = {}): Promise<Rec[]> {
    const tbl = this.tableName(type);
    const scope = opts.scope ?? "shared";
    const schema = this.getSchema(type);
    const entries = Object.entries(filter);

    let sql = `SELECT * FROM ${tbl} WHERE _scope=? AND _deleted=0`;
    const params: (string | number | null)[] = [scope];
    for (const [k, v] of entries) {
      const spec = schema?.properties[k];
      if (spec?.many) {
        sql += ` AND ${this.q(k)} LIKE ?`;
        params.push(`%${JSON.stringify(v).replace(/"/g, "")}%`);
      } else {
        sql += ` AND ${this.q(k)}=?`;
        params.push(spec ? toSqlValue(spec, v) as string | number | null : v as string | number | null);
      }
    }
    if (opts.limit) sql += ` LIMIT ${opts.limit}`;

    try {
      const rows = this.db.prepare(sql).all(...(params as (string | number | null)[])) as unknown as Record<string, unknown>[];
      return rows.map((r) => this.rowToRec(type, r));
    } catch { return []; }
  }

  async search(type: string, q: string, opts: QueryOpts = {}): Promise<Rec[]> {
    const scope = opts.scope ?? "shared";
    const schema = this.getSchema(type);
    if (!schema) return [];

    const textCols = Object.entries(schema.properties)
      .filter(([, s]) => ["string", "text", "id", "enum"].includes(s.type))
      .map(([n]) => `COALESCE(${this.q(n)},'')`);

    if (!textCols.length) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const concat = textCols.join(" || ' ' || ");
    const where = terms.map(() => `LOWER(${concat}) LIKE ?`).join(" AND ");
    const params: unknown[] = [scope, ...terms.map((t) => `%${t}%`)];
    let sql = `SELECT * FROM ${this.tableName(type)} WHERE _scope=? AND _deleted=0 AND ${where}`;
    if (opts.limit) sql += ` LIMIT ${opts.limit}`;

    try {
      const rows = this.db.prepare(sql).all(...(params as (string | number | null)[])) as unknown as Record<string, unknown>[];
      return rows.map((r) => this.rowToRec(type, r));
    } catch { return []; }
  }

  async upsert(input: UpsertInput): Promise<Rec> {
    const scope = input.scope ?? "shared";
    const now = new Date().toISOString();
    const hash = hashData(input.data);
    const tbl = this.tableName(input.type);
    const schema = this.getSchema(input.type);

    // ensure table exists even for types not pre-registered (e.g. __cursor__)
    if (!schema) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${tbl} (
        _id TEXT NOT NULL, _scope TEXT NOT NULL DEFAULT 'shared',
        _version INTEGER NOT NULL DEFAULT 1, _updated_at TEXT NOT NULL,
        _hash TEXT NOT NULL, _source TEXT, _deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (_id, _scope)
      )`);
    }

    const prev = (() => {
      try {
        return this.db.prepare(`SELECT _version, _hash FROM ${tbl} WHERE _id=? AND _scope=?`).get(input.id, scope) as { _version: number; _hash: string } | undefined;
      } catch { return undefined; }
    })();

    if (prev && prev._hash === hash) {
      const cur = await this.get(input.type, input.id, scope);
      if (cur) return cur;
    }

    const version = (prev?._version ?? 0) + 1;
    type SqlVal = string | number | null;
    const metaVals: SqlVal[] = [input.id, scope, version, now, hash, input.source ?? null, 0];

    if (schema) {
      const propNames = Object.keys(schema.properties);
      const allCols = [...META_COLS, ...propNames.map((n) => this.q(n))];
      const propVals = propNames.map((n) => toSqlValue(schema.properties[n], input.data[n]) as SqlVal);
      const placeholders = allCols.map(() => "?").join(",");
      const updates = allCols.slice(2).map((c) => `${c}=excluded.${c}`).join(",");
      this.db.prepare(
        `INSERT INTO ${tbl} (${allCols.join(",")}) VALUES (${placeholders})
         ON CONFLICT(_id,_scope) DO UPDATE SET ${updates}`
      ).run(...metaVals, ...propVals);
    } else {
      this.db.prepare(
        `INSERT INTO ${tbl} (${META_COLS.join(",")}) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(_id,_scope) DO UPDATE SET _version=excluded._version,
         _updated_at=excluded._updated_at, _hash=excluded._hash,
         _source=excluded._source, _deleted=0`
      ).run(...metaVals);
    }

    this.appendOplog(now, input.type, input.id, scope, "upsert", version, hash);
    return {
      _type: input.type, _id: input.id, _scope: scope, _version: version,
      _updatedAt: now, _hash: hash, _source: input.source, data: input.data,
    };
  }

  async remove(type: string, id: string, scope = "shared"): Promise<void> {
    const tbl = this.tableName(type);
    const now = new Date().toISOString();
    try {
      const prev = this.db.prepare(`SELECT _version FROM ${tbl} WHERE _id=? AND _scope=?`).get(id, scope) as { _version: number } | undefined;
      if (!prev) return;
      const version = prev._version + 1;
      this.db.prepare(`UPDATE ${tbl} SET _deleted=1, _version=?, _updated_at=?, _hash='deleted' WHERE _id=? AND _scope=?`).run(version, now, id, scope);
      this.appendOplog(now, type, id, scope, "delete", version, "deleted");
    } catch { /* table might not exist */ }
  }

  private appendOplog(ts: string, type: string, id: string, scope: string, op: Op, version: number, hash: string): void {
    this.db.prepare("INSERT INTO oplog (ts,type,id,scope,op,version,hash) VALUES (?,?,?,?,?,?,?)").run(ts, type, id, scope, op, version, hash);
  }

  async changes(sinceSeq: number, types?: string[]): Promise<Change[]> {
    let sql = "SELECT * FROM oplog WHERE seq > ?";
    const args: (string | number)[] = [sinceSeq];
    if (types?.length) {
      sql += ` AND type IN (${types.map(() => "?").join(",")})`;
      args.push(...types);
    }
    sql += " ORDER BY seq";
    const ops = this.db.prepare(sql).all(...args) as unknown as { seq: number; ts: string; type: string; id: string; scope: string; op: Op; version: number; hash: string }[];
    const changes: Change[] = [];
    for (const o of ops) {
      const rec = await this.get(o.type, o.id, o.scope)
        ?? { _type: o.type, _id: o.id, _scope: o.scope, _version: o.version, _updatedAt: o.ts, _hash: o.hash, _deleted: o.op === "delete", data: {} };
      changes.push({ seq: o.seq, op: o.op, record: rec });
    }
    return changes;
  }

  async apply(changes: Change[]): Promise<ApplyResult> {
    let applied = 0, skipped = 0;
    this.db.exec("BEGIN");
    try {
      for (const ch of changes) {
        const inc = ch.record;
        const existing = await this.get(inc._type, inc._id, inc._scope);
        if (existing && existing._hash === inc._hash && existing._deleted === (inc._deleted ?? false)) { skipped++; continue; }
        const take = !existing || inc._version > existing._version || (inc._version === existing._version && inc._updatedAt > existing._updatedAt);
        if (!take) { skipped++; continue; }
        if (ch.op === "delete" || inc._deleted) {
          await this.remove(inc._type, inc._id, inc._scope);
        } else {
          await this.upsert({ type: inc._type, id: inc._id, scope: inc._scope, data: inc.data, source: inc._source });
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
    const r = this.db.prepare("SELECT cursor FROM sync_state WHERE source=? AND target=?").get(source, this.name) as { cursor: number } | undefined;
    return r?.cursor ?? 0;
  }

  async setCursor(source: string, seq: number): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO sync_state (source,target,cursor,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(source,target) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at`).run(source, this.name, seq, now);
  }

  close(): void { this.db.close(); }
}
