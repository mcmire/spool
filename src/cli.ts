#!/usr/bin/env bun

import { Command } from "commander";

const program = new Command();

program
  .name("spool")
  .description("Reverse literate programming — weave annotated source into docs");

program
  .command("weave")
  .description("Weave source annotations into documentation files")
  .option("-w, --watch", "Watch for changes and re-weave automatically")
  .option("-c, --clean", "Clear the target directory before weaving")
  .action(async (options: { watch?: boolean; clean?: boolean }) => {
    const { weaveCommand } = await import("./commands/weave/command.ts");
    await weaveCommand(options);
  });

program
  .command("lint")
  .description("Check for errors in source annotations and passage references")
  .action(async () => {
    const { lintCommand } = await import("./commands/lint/command.ts");
    await lintCommand();
  });

program
  .command("preview")
  .description("Start a preview server with live reloading")
  .option("-p, --port <port>", "Port to listen on", "4567")
  .action(async (options: { port?: string }) => {
    const { previewCommand } = await import("./commands/preview.ts");
    await previewCommand(options);
  });

program
  .command("lsp")
  .description("Start the Language Server Protocol server")
  .action(async () => {
    const { lspCommand } = await import("./commands/lsp.ts");
    lspCommand();
  });

program.parse();
