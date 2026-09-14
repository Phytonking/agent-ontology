#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { init } from "./scaffold.js";
import { initOffice } from "./scaffold-office.js";
import { serve } from "./mcp.js";
import { serveHttp } from "./http.js";
import { validate, listObjects } from "./ontology.js";
import { openStore } from "./data/dataset.js";
import { syncBidirectional } from "./data/sync.js";
import { execFileSync } from "node:child_process";
import { materialize, reindex } from "./data/materialize.js";
import { doctor } from "./data/resolver.js";

const VERSION = "0.3.0";

const program = new Command();
program.name("ontology").description("Filesystem-first, agent-editable ontology framework.").version(VERSION);

program.command("init").argument("[dir]", "target directory", ".")
  .option("--template <name>", "template: ecommerce (default) | office", "ecommerce")
  .description("Scaffold a new ontology folder.")
  .action((dir: string, opts: { template: string }) => {
    const root = path.resolve(dir);
    fs.mkdirSync(root, { recursive: true });
    opts.template === "office" ? initOffice(root) : init(root);
    console.log(`Initialized ontology at ${root}`);
    console.log(`Next: ontology serve ${dir}`);
  });

program.command("serve").argument("[dir]", "ontology directory", ".")
  .option("--http", "serve over HTTP (MCP Streamable HTTP)")
  .option("--port <port>", "HTTP port", "8787")
  .description("Start the ontology server.")
  .action(async (dir: string, opts: { http?: boolean; port: string }) => {
    const root = path.resolve(dir);
    if (!fs.existsSync(root)) { console.error(`No such directory: ${root}`); process.exit(1); }
    if (opts.http) await serveHttp(root, VERSION, Number(opts.port));
    else await serve(root, VERSION);
  });

program.command("validate").argument("[dir]", "ontology directory", ".")
  .description("Validate ontology coherence.")
  .action((dir: string) => {
    const { ok, problems } = validate(path.resolve(dir));
    for (const p of problems) console.log(`${p.level.toUpperCase().padEnd(7)} ${p.where}: ${p.message}`);
    if (!problems.length) console.log("OK — no problems.");
    process.exit(ok ? 0 : 1);
  });

program.command("objects").argument("[dir]", "ontology directory", ".")
  .description("List all objects.")
  .action((dir: string) => { console.log(JSON.stringify(listObjects(path.resolve(dir)), null, 2)); });

program.command("materialize").argument("[dir]", "ontology directory", ".")
  .description("Ingest all data/*.yaml files into the backing store.")
  .action(async (dir: string) => {
    const root = path.resolve(dir);
    const store = openStore(root);
    const r = await materialize(root, store);
    store.close();
    console.log(JSON.stringify(r, null, 2));
    if (r.errors.length) process.exit(1);
  });

program.command("branch").argument("[name]", "branch name (omit to show current)")
  .argument("[dir]", "ontology directory", ".")
  .description("Create or switch ontology branch (git branch + separate DB per branch).")
  .action((name: string | undefined, dir: string) => {
    const root = path.resolve(dir ?? ".");
    if (!name) {
      try {
        const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
        const safe = branch.replace(/[^a-zA-Z0-9_-]/g, "_");
        const dbPath = path.join(root, ".ontology", `data-${safe}.db`);
        console.log(`branch: ${branch}`);
        console.log(`db:     ${dbPath}`);
        console.log(`exists: ${fs.existsSync(dbPath)}`);
      } catch { console.log("not a git repo"); }
      return;
    }
    try {
      try { execFileSync("git", ["checkout", name], { cwd: root, stdio: "pipe" }); }
      catch { execFileSync("git", ["checkout", "-b", name], { cwd: root, stdio: "pipe" }); }
      const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const dbPath = path.join(root, ".ontology", `data-${safe}.db`);
      const isNew = !fs.existsSync(dbPath);
      console.log(`Switched to branch: ${name}`);
      console.log(`DB: ${dbPath}${isNew ? " (new — run 'ontology materialize' to populate)" : ""}`);
    } catch (e) {
      console.error(`git error: ${(e as Error).message}`);
      process.exit(1);
    }
  });

program.command("reindex").argument("[dir]", "ontology directory", ".")
  .description("Full re-index: wipe all tables and rebuild from data/*.yaml files.")
  .action(async (dir: string) => {
    const root = path.resolve(dir);
    const store = openStore(root);
    const r = await reindex(root, store);
    store.close();
    console.log(`Re-indexed: ${r.ingested} ingested, ${r.skipped} skipped, ${r.errors.length} errors`);
    if (r.errors.length) { console.log(JSON.stringify(r.errors, null, 2)); process.exit(1); }
  });

program.command("doctor").argument("[dir]", "ontology directory", ".")
  .description("Test connections to configured stores and blob backends.")
  .action(async (dir: string) => { await doctor(path.resolve(dir)); });

program.command("sync").argument("<a>", "first ontology").argument("<b>", "second ontology")
  .option("--type <type...>", "limit to types")
  .description("Sync instance data between two ontologies.")
  .action(async (a: string, b: string, opts: { type?: string[] }) => {
    const sa = openStore(path.resolve(a));
    const sb = openStore(path.resolve(b));
    const res = await syncBidirectional(sa, sb, { types: opts.type });
    sa.close(); sb.close();
    console.log(JSON.stringify(res, null, 2));
  });

program.parseAsync();
