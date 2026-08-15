import { createHash } from "node:crypto";

/** An instance record. Sync metadata (`_`-prefixed) lives alongside `data`. */
export interface Rec {
  _type: string;
  _id: string;
  _scope: string;
  _version: number;
  _updatedAt: string;
  _hash: string;
  _source?: string;
  _deleted?: boolean;
  data: Record<string, unknown>;
}

export type Op = "upsert" | "delete";

/** A single change drawn from the oplog — the unit of sync. */
export interface Change {
  seq: number;
  op: Op;
  record: Rec;
}

/** Deterministic JSON (sorted keys) so content hashes are stable. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Short content hash used to detect changes and skip no-op syncs. */
export function hashData(data: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(data)).digest("hex").slice(0, 16);
}

/** Flatten a record's values into a lowercase string for keyword search. */
export function textProjection(data: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "object") {
      if (Array.isArray(v)) v.forEach(walk);
      else Object.values(v as Record<string, unknown>).forEach(walk);
    } else {
      parts.push(String(v));
    }
  };
  walk(data);
  return parts.join(" ").toLowerCase();
}
