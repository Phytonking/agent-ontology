#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { init } from "./scaffold.js";
import { initOffice } from "./scaffold-office.js";
import { serve } from "./mcp.js";
import { serveHttp } from "./http.js";
import { validate } from "./ontology.js";
import { openStore } from "./data/dataset.js";
import { syncBidirectional } from "./data/sync.js";
import { materialize } from "./data/materialize.js";
import { doctor } from "./data/resolver.js";
import { runConnector } from "./connectors/run.js";
import { runPipeline } from "./pipelines/run.js";
import { listConnectors, listConnections, listPipelines } from "./ontology.js";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("ontology")
  .description("Filesystem-first, agent-editable ontology framework.")
  .version(VERSION);

program
  .command("init")
  .argument("[dir]", "target directory", ".")
  .option("--template <name>", "scaffold template: ecommerce (default) | office", "ecommerce")
  .description("Scaffold a new ontology folder.")
  .action((dir: string, opts: { template: string }) => {
    const root = path.resolve(dir);
    fs.mkdirSync(root, { recursive: true });
    if (opts.template === "office") {
      initOffice(root);
      console.log(`Initialized agent-office ontology at ${root}`);
    } else {
      init(root);
      console.log(`Initialized ontology at ${root}`);
    }
    console.log(`Next: ontology serve ${dir}   (then point an MCP agent at it)`);
  });

program
  .command("serve")
  .argument("[dir]", "ontology directory", ".")
  .option("--http", "serve over HTTP (MCP Streamable HTTP) instead of stdio")
  .option("--port <port>", "HTTP port", "8787")
  .description("Start the ontology server. Default stdio; --http runs it as a network service.")
  .action(async (dir: string, opts: { http?: boolean; port: string }) => {
    const root = path.resolve(dir);
    if (!fs.existsSync(root)) {
      console.error(`No such directory: ${root}`);
      process.exit(1);
    }
    if (opts.http) await serveHttp(root, VERSION, Number(opts.port));
    else await serve(root, VERSION);
  });

program
  .command("validate")
  .argument("[dir]", "ontology directory", ".")
  .description("Validate ontology coherence and print any problems.")
  .action((dir: string) => {
    const root = path.resolve(dir);
    const { ok, problems } = validate(root);
    for (const p of problems) {
      console.log(`${p.level.toUpperCase().padEnd(7)} ${p.where}: ${p.message}`);
    }
    if (problems.length === 0) console.log("OK — no problems.");
    process.exit(ok ? 0 : 1);
  });

program
  .command("materialize")
  .argument("[dir]", "ontology directory", ".")
  .description("Ingest all data/*.yaml files into the backing store. Idempotent.")
  .action(async (dir: string) => {
    const root = path.resolve(dir);
    const store = openStore(root);
    const r = await materialize(root, store);
    store.close();
    console.log(JSON.stringify(r, null, 2));
    if (r.errors.length) process.exit(1);
  });

program
  .command("connections")
  .argument("[dir]", "ontology directory", ".")
  .description("List defined data connections.")
  .action((dir: string) => {
    console.log(JSON.stringify(listConnections(path.resolve(dir)), null, 2));
  });

program
  .command("connectors")
  .argument("[dir]", "ontology directory", ".")
  .description("List defined connectors.")
  .action((dir: string) => {
    console.log(JSON.stringify(listConnectors(path.resolve(dir)), null, 2));
  });

program
  .command("run-connector")
  .argument("<name>", "connector name")
  .argument("[dir]", "ontology directory", ".")
  .description("Run a connector: ingest from its source into the ontology.")
  .action(async (name: string, dir: string) => {
    const res = await runConnector(path.resolve(dir), name);
    console.log(JSON.stringify(res, null, 2));
    if (res.errors.length) process.exit(1);
  });

program
  .command("pipelines")
  .argument("[dir]", "ontology directory", ".")
  .description("List defined pipelines.")
  .action((dir: string) => {
    console.log(JSON.stringify(listPipelines(path.resolve(dir)), null, 2));
  });

program
  .command("run-pipeline")
  .argument("<name>", "pipeline name")
  .argument("[dir]", "ontology directory", ".")
  .description("Run a pipeline end to end.")
  .action(async (name: string, dir: string) => {
    const res = await runPipeline(path.resolve(dir), name);
    console.log(JSON.stringify(res, null, 2));
    if (res.errors.length) process.exit(1);
  });

program
  .command("doctor")
  .argument("[dir]", "ontology directory", ".")
  .description("Test connections to all configured stores and blob backends.")
  .action(async (dir: string) => {
    await doctor(path.resolve(dir));
  });

program
  .command("sync")
  .argument("<a>", "first ontology directory")
  .argument("<b>", "second ontology directory")
  .option("--type <type...>", "limit sync to these types")
  .description("Sync instance data between two ontologies (bidirectional, incremental).")
  .action(async (a: string, b: string, opts: { type?: string[] }) => {
    const sa = openStore(path.resolve(a));
    const sb = openStore(path.resolve(b));
    const res = await syncBidirectional(sa, sb, { types: opts.type });
    sa.close();
    sb.close();
    console.log(JSON.stringify(res, null, 2));
  });

program.parseAsync();
