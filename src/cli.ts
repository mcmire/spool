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
    const result = await weaveCommand({
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      ...options,
    });
    if (result.exitCode !== undefined) {
      process.exitCode = result.exitCode;
    }
  });

program
  .command("lint")
  .description("Check for errors in source annotations and passage references")
  .action(async () => {
    const { lintCommand } = await import("./commands/lint/command.ts");
    const result = await lintCommand({
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
    });
    if (result.exitCode !== undefined) {
      process.exitCode = result.exitCode;
    }
  });

program
  .command("preview")
  .description("Start a preview server with live reloading")
  .option("-p, --port <port>", "Port to listen on", "4567")
  .action(async (options: { port?: string }) => {
    const { previewCommand } = await import("./commands/preview/command.ts");
    const { server } = await previewCommand({
      cwd: process.cwd(),
      stdout: process.stdout,
      ...options,
    });
    process.on("SIGINT", () => {
      server.stop();
    });
  });

program
  .command("lsp")
  .description("Start the Language Server Protocol server")
  .action(async () => {
    const { lspCommand } = await import("./commands/lsp/command.ts");
    lspCommand();
  });

program.parse();
