#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { init } from "./scaffold.js";
import { serve } from "./mcp.js";
import { validate } from "./ontology.js";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("ontology")
  .description("Filesystem-first, agent-editable ontology framework.")
  .version(VERSION);

program
  .command("init")
  .argument("[dir]", "target directory", ".")
  .description("Scaffold a new ontology folder (types, actions, example, git).")
  .action((dir: string) => {
    const root = path.resolve(dir);
    fs.mkdirSync(root, { recursive: true });
    init(root);
    console.log(`Initialized ontology at ${root}`);
    console.log(`Next: ontology serve ${dir}   (then point an MCP agent at it)`);
  });

program
  .command("serve")
  .argument("[dir]", "ontology directory", ".")
  .description("Start the MCP server (stdio) over an ontology folder.")
  .action(async (dir: string) => {
    const root = path.resolve(dir);
    if (!fs.existsSync(root)) {
      console.error(`No such directory: ${root}`);
      process.exit(1);
    }
    await serve(root, VERSION);
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

program.parseAsync();
