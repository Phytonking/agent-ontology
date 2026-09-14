import type { InternalLink as Link } from "./types.js";
import type { Rec } from "./data/record.js";
import type { Store } from "./data/store.js";

/**
 * Light inference helpers for the four relationship characteristics.
 * All pure or async-pure — no side effects, no writes.
 */

/**
 * Transitive closure: starting from `id`, follow `link` repeatedly until no
 * new targets found. Returns all reachable ids (excluding the start).
 * Guard: max 512 hops to prevent infinite loops on cyclic graphs.
 */
export async function transitiveClosure(
  store: Store,
  type: string,
  id: string,
  link: Link,
  scope: string,
  visited = new Set<string>()
): Promise<Rec[]> {
  if (!link.via) return [];
  visited.add(id);
  const results: Rec[] = [];
  const MAX = 512;

  const queue = [id];
  while (queue.length && results.length < MAX) {
    const cur = queue.shift()!;
    const targets = link.cardinality === "one"
      ? await (async () => {
          const rec = await store.get(type, cur, scope);
          const tid = rec?.data[link.via!];
          if (tid == null) return [];
          const t = await store.get(link.to, String(tid), scope);
          return t ? [t] : [];
        })()
      : await store.query(link.to, { [link.via]: cur }, { scope });

    for (const t of targets) {
      if (!visited.has(t._id)) {
        visited.add(t._id);
        results.push(t);
        queue.push(t._id);
      }
    }
  }
  return results;
}

/**
 * Symmetric backfill: if A→B is declared on `type`, also return A when
 * querying from B's perspective (i.e. find all records where B appears as target).
 */
export async function symmetricTargets(
  store: Store,
  type: string,
  id: string,
  link: Link,
  scope: string
): Promise<Rec[]> {
  if (!link.via) return [];
  if (link.cardinality === "one") {
    return store.query(type, { [link.via]: id }, { scope });
  }
  const rec = await store.get(type, id, scope);
  const tid = rec?.data[link.via];
  if (tid == null) return [];
  const t = await store.get(link.to, String(tid), scope);
  return t ? [t] : [];
}

/**
 * Check functional constraint: for a link declared `functional`, verify the
 * source record does not already have a different target via `via`.
 * Returns the conflicting record if violated, null if ok.
 */
export async function checkFunctional(
  store: Store,
  type: string,
  id: string,
  link: Link,
  newTargetId: string,
  scope: string
): Promise<Rec | null> {
  if (!link.via) return null;
  const rec = await store.get(type, id, scope);
  const existing = rec?.data[link.via];
  if (existing != null && String(existing) !== newTargetId) {
    return rec!;
  }
  return null;
}

/**
 * Check inverse-functional constraint: for a link declared `inverse_functional`,
 * verify the target is not already linked from a different source.
 */
export async function checkInverseFunctional(
  store: Store,
  type: string,
  currentId: string,
  link: Link,
  targetId: string,
  scope: string
): Promise<Rec | null> {
  if (!link.via || link.cardinality !== "one") return null;
  const others = await store.query(type, { [link.via]: targetId }, { scope });
  const conflict = others.find((r) => r._id !== currentId);
  return conflict ?? null;
}

/**
 * Check legal enum transition: if `spec.transitions` is declared, only allow
 * moves listed in the map. A new record (no prior) may start at any value.
 */
export function checkTransition(
  propName: string,
  transitions: Record<string, string[]>,
  oldValue: unknown,
  newValue: unknown
): string | null {
  if (oldValue === undefined || oldValue === null) return null;
  if (oldValue === newValue) return null;
  const allowed = transitions[String(oldValue)] ?? [];
  if (!allowed.includes(String(newValue))) {
    return `illegal transition on ${propName}: ${String(oldValue)} → ${String(newValue)} (allowed: ${allowed.join(", ") || "none"})`;
  }
  return null;
}
