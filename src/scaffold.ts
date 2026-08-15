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
  // definitions -> git, data -> the store: keep instance data and secrets out of git.
  const gitignore = path.join(root, ".gitignore");
  fs.writeFileSync(gitignore, ".ontology/\n.env\n");

  ensureRepo(root);
  commit(root, [p.config, p.readme, gitignore], "init ontology");

  // Customer — 1:N to Order (inverse of Order.placed_by); email is a natural key.
  createType(root, {
    name: "Customer",
    description: "A person who buys from us.",
    keys: ["email"],
    properties: {
      email: { type: "string", required: true, unique: true },
      name: { type: "string" },
    },
    links: {
      orders: { to: "Order", cardinality: "many", via: "customer_id", inverse: "placed_by" },
    },
  });

  // SupportRep — 1:N to Order (inverse of Order.handled_by).
  createType(root, {
    name: "SupportRep",
    description: "An employee who handles support. Never the buyer on an order.",
    properties: {
      name: { type: "string", required: true },
    },
    links: {
      handled: { to: "Order", cardinality: "many", via: "support_rep_id", inverse: "handled_by" },
    },
  });

  // Product — N:M to Order through OrderItem; sku is a natural key.
  createType(root, {
    name: "Product",
    description: "Something we sell.",
    keys: ["sku"],
    properties: {
      sku: { type: "string", required: true, unique: true },
      name: { type: "string" },
      price: { type: "money" },
    },
    links: {
      orders: { to: "Order", cardinality: "many", through: "OrderItem", through_from: "product_id", through_to: "order_id" },
    },
  });

  // OrderItem — the join type carrying the N:M between Order and Product.
  createType(root, {
    name: "OrderItem",
    description: "A line item joining an Order to a Product.",
    keys: ["order_id", "product_id"],
    properties: {
      order_id: { type: "id", required: true },
      product_id: { type: "id", required: true },
      qty: { type: "int" },
    },
    links: {
      order: { to: "Order", cardinality: "one", via: "order_id" },
      product: { to: "Product", cardinality: "one", via: "product_id" },
    },
  });

  // Order — N:1 to Customer/SupportRep, N:M to Product; `tags` is multi-valued.
  createType(root, {
    name: "Order",
    description:
      "An order a customer placed. Refunded at most once; a payout goes to the buyer, never the support rep.",
    properties: {
      status: {
        type: "enum",
        values: ["paid", "shipped", "refunded"],
        required: true,
        transitions: { paid: ["shipped", "refunded"], shipped: ["refunded"], refunded: [] },
      },
      total: { type: "money" },
      placed_at: { type: "datetime" },
      customer_id: { type: "id" },
      support_rep_id: { type: "id" },
      tags: { type: "string", many: true },
    },
    links: {
      placed_by: { to: "Customer", cardinality: "one", via: "customer_id", inverse: "orders" },
      handled_by: { to: "SupportRep", cardinality: "one", via: "support_rep_id", inverse: "handled" },
      items: { to: "Product", cardinality: "many", through: "OrderItem", through_from: "order_id", through_to: "product_id" },
    },
    constraints: [
      { kind: "disjoint", a: "Customer", b: "SupportRep" },
      { kind: "at_most_once", of: "refund" },
    ],
  });

  createAction(root, {
    name: "issue_refund",
    description: "Refund an order. Only once per order, and only if it is paid or shipped.",
    on: "Order",
    inputs: {
      order_id: { type: "id", required: true },
      amount: { type: "money" },
    },
    preconditions: ["status in [paid, shipped]"],
    effects: ["set status = refunded"],
  });
}
