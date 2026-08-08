import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { paths } from "./paths.js";
import { ensureRepo, commit } from "./git.js";
import { createType, createAction } from "./ontology.js";
import { SPEC_VERSION } from "./types.js";

const README = `# Ontology

This folder **is** an ontology. It is plain markdown, git-tracked, and meant to be
read *and edited* by agents.

## Layout

- \`ontology.config.yaml\` — name, version, spec version.
- \`types/\` — one file per entity type. Frontmatter = schema + constraints; body = meaning.
- \`actions/\` — one file per action. Frontmatter = inputs + preconditions + effects.

## How an agent works with it

Run \`ontology serve\` and point any MCP-capable agent at it. The agent can:

- \`list_types\` / \`read_type\` — understand the domain,
- \`create_type\`, \`add_property\`, \`add_link\`, \`add_constraint\` — grow it,
- \`create_action\` — define what can be done,
- \`validate\` — check the whole thing stays coherent.

Every edit writes a markdown file and makes a git commit, so changes are
reviewable and revertable.

Prefer reusing existing vocabularies (schema.org, FOAF, Dublin Core) over
inventing new terms.
`;

/** Scaffold a fresh ontology folder with a small runnable e-commerce example. */
export function init(root: string) {
  const p = paths(root);
  fs.mkdirSync(p.typesDir, { recursive: true });
  fs.mkdirSync(p.actionsDir, { recursive: true });

  const name = path.basename(path.resolve(root));
  fs.writeFileSync(p.config, YAML.stringify({ name, version: "0.1.0", spec: SPEC_VERSION }));
  fs.writeFileSync(p.readme, README);

  ensureRepo(root);
  commit(root, [p.config, p.readme], "init ontology");

  createType(root, {
    name: "Customer",
    description: "A person who buys from us.",
    properties: {
      email: { type: "string", required: true },
      name: { type: "string" },
    },
  });

  createType(root, {
    name: "SupportRep",
    description: "An employee who handles support. Never the buyer on an order.",
    properties: {
      name: { type: "string", required: true },
    },
  });

  createType(root, {
    name: "Order",
    description:
      "An order a customer placed. Refunded at most once; a payout goes to the buyer, never the support rep.",
    properties: {
      status: { type: "enum", values: ["paid", "shipped", "refunded"], required: true },
      total: { type: "money" },
      placed_at: { type: "datetime" },
    },
    links: {
      placed_by: { to: "Customer", cardinality: "one" },
      handled_by: { to: "SupportRep", cardinality: "one" },
    },
    constraints: [
      { kind: "disjoint", a: "Customer", b: "SupportRep" },
      { kind: "at_most_once", of: "refund" },
    ],
  });

  createAction(root, {
    name: "issue_refund",
    description: "Refund an order. Only once per order, and only if it is paid or shipped.",
    inputs: {
      order_id: { type: "id", required: true },
      amount: { type: "money" },
    },
    preconditions: ["order.status in [paid, shipped]", "refund at_most_once"],
    effects: ["set order.status = refunded"],
  });
}
