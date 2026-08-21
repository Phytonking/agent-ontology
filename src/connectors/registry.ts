import type { Connector, ConnectorContext, ConnectorFactory, ConnectorResult } from "./types.js";

const registry = new Map<string, ConnectorFactory>();

/** Register a connector implementation under a `kind`. Called by built-in or user modules. */
export function registerConnector(kind: string, factory: ConnectorFactory): void {
  registry.set(kind, factory);
}

export function getConnectorFactory(kind: string): ConnectorFactory | undefined {
  return registry.get(kind);
}

export function listConnectorKinds(): string[] {
  return [...registry.keys()];
}

/** Author a connector inline from just a sync function. */
export function defineConnector(sync: (ctx: ConnectorContext) => Promise<ConnectorResult>): Connector {
  return { sync };
}

/** Re-exported for connector authors. */
export type { Connector, ConnectorContext, ConnectorFactory, ConnectorResult };
