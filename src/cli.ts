#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("spool")
  .description("Reverse literate programming — weave annotated source into docs");

// == ::SPOOL:: start(#weave) ==
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
// == ::SPOOL:: end(#weave) ==

// == ::SPOOL:: start(#lint) ==
program
  .command("lint")
  .description("Check for errors in source annotations and passage references")
  .option("--coverage", "Also check that all source files are marked and all passages are documented")
  .action(async (options: { coverage?: boolean }) => {
    const { lintCommand } = await import("./commands/lint/command.ts");
    const result = await lintCommand({
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      coverage: options.coverage,
    });
    if (result.exitCode !== undefined) {
      process.exitCode = result.exitCode;
    }
  });
// == ::SPOOL:: end(#lint) ==

// == ::SPOOL:: start(#site) ==
const site = program
  .command("site")
  .description("Build and serve a documentation site from woven output")
  .option("--verify-unique-references", "Error if any passage is referenced on multiple pages")
  .option(
    "--link-references",
    "Link unexpanded passage references to the page where they are expanded (implies --verify-unique-references)",
  );

// == ::SPOOL:: start(#site-dev) ==
site
  .command("dev")
  .description("Start a development server with live reloading")
  .option("-p, --port <port>", "Port to listen on", "5173")
  .action(async (options: { port?: string }) => {
    const parentOpts = site.opts() as {
      verifyUniqueReferences?: boolean;
      linkReferences?: boolean;
    };
    const { siteDevCommand } = await import("./commands/site/command.ts");
    const { server } = await siteDevCommand({
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      verifyUniqueReferences: parentOpts.verifyUniqueReferences || parentOpts.linkReferences,
      linkReferences: parentOpts.linkReferences,
      ...options,
    });
    process.on("SIGINT", () => {
      server
        .stop()
        .catch(() => {})
        .finally(() => {
          // Kill the process group to take down child processes spawned by
          // Vite/VitePress (e.g. the esbuild binary), then exit.
          try {
            process.kill(0, "SIGTERM");
          } catch {}
          process.exit(0);
        });
      // Failsafe: force exit if stop() hangs.
      setTimeout(() => process.exit(0), 3000).unref();
    });
  });
// == ::SPOOL:: end(#site-dev) ==

// == ::SPOOL:: start(#site-build) ==
site
  .command("build")
  .description("Build the documentation site for production")
  .action(async () => {
    const parentOpts = site.opts() as {
      verifyUniqueReferences?: boolean;
      linkReferences?: boolean;
    };
    const { siteBuildCommand } = await import("./commands/site/command.ts");
    const result = await siteBuildCommand({
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
      verifyUniqueReferences: parentOpts.verifyUniqueReferences || parentOpts.linkReferences,
      linkReferences: parentOpts.linkReferences,
    });
    if (result.exitCode !== undefined) {
      process.exitCode = result.exitCode;
    }
  });
// == ::SPOOL:: end(#site-build) ==
// == ::SPOOL:: end(#site) ==

// == ::SPOOL:: start(#lsp) ==
program
  .command("lsp")
  .description("Start the Language Server Protocol server")
  .action(async () => {
    const { lspCommand } = await import("./commands/lsp/command.ts");
    lspCommand();
  });
// == ::SPOOL:: end(#lsp) ==

program.parse();
