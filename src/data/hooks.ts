import type { Rec } from "./record.js";

export interface PutInput {
  type: string;
  id?: string;
  scope: string;
  data: Record<string, unknown>;
}

/**
 * Write middleware applied to every dataset.put (which means every connector,
 * action, and direct write). This is the cross-cutting data-management layer:
 * derive fields, enrich, embed for vector search, audit, notify.
 */
export interface PutHooks {
  name?: string;
  /** Runs before validation. Return new data to replace it, or void to leave unchanged. */
  beforePut?(input: PutInput): Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  /** Runs after the record is stored and written back to its file. */
  afterPut?(rec: Rec): void | Promise<void>;
}

/** A module-linked hook factory: receives the dataset, returns hooks. */
export type HookFactory = (dataset: unknown) => PutHooks | Promise<PutHooks>;
