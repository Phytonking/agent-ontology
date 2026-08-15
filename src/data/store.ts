import type { Change, Rec } from "./record.js";

export interface QueryOpts {
  scope?: string;
  limit?: number;
}

export interface UpsertInput {
  type: string;
  id: string;
  scope?: string;
  data: Record<string, unknown>;
  source?: string;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
}

/**
 * The backing-store contract. CRUD plus the change primitives that make sync
 * first-class: `changes(since)` (incremental source), `apply` (incremental sink),
 * and a resumable per-source cursor. Adapters (SQLite reference, Postgres, …)
 * implement this; the sync engine works against the interface, not a backend.
 */
export interface Store {
  readonly name: string;

  get(type: string, id: string, scope?: string): Promise<Rec | null>;
  query(type: string, filter?: Record<string, unknown>, opts?: QueryOpts): Promise<Rec[]>;
  search(type: string, q: string, opts?: QueryOpts): Promise<Rec[]>;

  /** Local authoring write: bumps version, records to the oplog. Idempotent by content hash. */
  upsert(input: UpsertInput): Promise<Rec>;
  remove(type: string, id: string, scope?: string): Promise<void>;

  /** Incremental change feed since a cursor (oplog seq). Captures updates and deletes. */
  changes(sinceSeq: number, types?: string[]): Promise<Change[]>;
  /** Apply remote changes idempotently, resolving conflicts (last-write-wins by default). */
  apply(changes: Change[]): Promise<ApplyResult>;
  headSeq(): Promise<number>;

  /** Resumable sync watermark, keyed by source store name. */
  getCursor(source: string): Promise<number>;
  setCursor(source: string, seq: number): Promise<void>;

  close(): void;
}
