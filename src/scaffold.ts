import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { paths } from "./paths.js";
import { ensureRepo, commit } from "./git.js";
import { SPEC_VERSION } from "./types.js";

export function init(root: string): void {
  const p = paths(root);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });

  const name = path.basename(path.resolve(root));
  fs.writeFileSync(p.config, YAML.stringify({ name, version: "0.1.0", spec: SPEC_VERSION }));
  fs.writeFileSync(path.join(root, ".gitignore"), ".ontology/\n.env\n");

  ensureRepo(root);
  commit(root, [p.config, path.join(root, ".gitignore")], "init ontology");

  // ---- example objects ----

  writeObj(root, {
    object: "Customer",
    keys: ["email"],
    properties: {
      email: { type: "string", required: true, unique: true },
      name: { type: "string" },
    },
    links: {
      orders: { to: "Order", type: "one-to-many", via: "customer_id", inverse: "placed_by" },
    },
  });

  writeObj(root, {
    object: "Product",
    keys: ["sku"],
    properties: {
      sku: { type: "string", required: true, unique: true },
      name: { type: "string" },
      price: { type: "money" },
    },
  });

  writeObj(root, {
    object: "OrderItem",
    keys: ["order_id", "product_id"],
    properties: {
      order_id: { type: "id", required: true },
      product_id: { type: "id", required: true },
      qty: { type: "int" },
    },
  });

  writeObj(root, {
    object: "Order",
    properties: {
      status: {
        type: "enum",
        values: ["paid", "shipped", "refunded"],
        required: true,
        transitions: { paid: ["shipped", "refunded"], shipped: ["refunded"], refunded: [] },
      },
      total: { type: "money" },
      customer_id: { type: "id" },
      tags: { type: "string", many: true },
    },
    links: {
      placed_by: { to: "Customer", type: "many-to-one", via: "customer_id", inverse: "orders" },
      items: { to: "Product", type: "many-to-many", through: "OrderItem", through_from: "order_id", through_to: "product_id" },
    },
    actions: {
      issue_refund: {
        description: "Refund this order. Only if paid or shipped.",
        inputs: { order_id: { type: "id", required: true }, amount: { type: "money" } },
        preconditions: ["status in [paid, shipped]"],
        effects: ["set status = refunded"],
      },
    },
  });
}

function writeObj(root: string, obj: Record<string, unknown>): void {
  const name = obj.object as string;
  const file = paths(root).objectFile(name);
  fs.writeFileSync(file, YAML.stringify(obj));
  commit(root, [file], `create object ${name}`);
}
