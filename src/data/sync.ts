import type { Store } from "./store.js";

export interface SyncResult {
  from: string;
  to: string;
  applied: number;
  skipped: number;
  lastSeq: number;
}

export interface SyncOpts {
  types?: string[];
}

/**
 * One-directional incremental sync: pull `from`'s changes since the cursor,
 * apply them to `to` (conflict-resolved), advance the cursor. Idempotent —
 * re-running applies nothing new because content hashes match.
 */
export async function syncStores(from: Store, to: Store, opts: SyncOpts = {}): Promise<SyncResult> {
  const cursor = await to.getCursor(from.name);
  const changes = await from.changes(cursor, opts.types);
  const { applied, skipped } = await to.apply(changes);
  const lastSeq = changes.length ? changes[changes.length - 1].seq : cursor;
  if (changes.length) await to.setCursor(from.name, lastSeq);
  return { from: from.name, to: to.name, applied, skipped, lastSeq };
}

/** Bidirectional sync. Echoes terminate because replayed changes hash-match and are skipped. */
export async function syncBidirectional(a: Store, b: Store, opts: SyncOpts = {}): Promise<{ ab: SyncResult; ba: SyncResult }> {
  const ab = await syncStores(a, b, opts);
  const ba = await syncStores(b, a, opts);
  return { ab, ba };
}
