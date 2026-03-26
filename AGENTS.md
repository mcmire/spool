# Spool — Agent Guide

## Overview

Spool is a reverse literate programming CLI. Instead of embedding docs in source, you annotate source files with named passages and write Markdown templates that reference them. The `spool weave` command builds a registry of every passage and weaves them into final Markdown output.

The annotation syntax is language-agnostic — any comment style (`//`, `#`, `--`, `%`, `;`) is supported.

## Common commands

```sh
# Run the CLI
npm run run-tool -- <args>

# Run all tests
npm test

# Type-check without emitting
npm run lint

# Format
npm run fmt

# Check formatting
npm run fmt:check

# Build compiled output to dist/
npm run build
```

## Tooling

This project uses **Node.js** (not Bun).

- Run TypeScript files with `tsx <file>` or via `npm run run-tool`
- Use `npm install` / `npm install --save-dev` for packages
- Use `node:fs`, `node:path`, `node:readline`, etc. (always with the `node:` prefix)
- Use `execa` for spawning subprocesses in tests

## File structure

```
src/
  cli.ts                  # Entry point; sets up commands with commander
  config.ts               # SpoolConfig type and config file loading
  parser.ts               # Parses ::SPOOL:: annotations and references from text
  parser.test.ts
  registries.ts           # Scans source directory and builds passage registries
  registries.test.ts
  weaver.ts               # Processes doc templates and writes output files
  commands/
    lint.ts               # spool lint — validates without writing output
    lsp.ts                # spool lsp — starts the LSP server over stdio
    preview.ts            # spool preview — serves rendered HTML with file watching
    weave.ts              # spool weave — full weave pipeline
  lsp/
    server.ts             # LSP server implementation (vscode-languageserver)
    diagnostics.ts        # Computes LSP diagnostics for source and doc files
    diagnostics.test.ts
dist/                     # Compiled output (tsc); mirrors src/ structure
```

## Formatting

After updating a batch of files, run `npm run fmt` to format them all before moving on.

## Code style

### No one-line statements

Avoid one-line conditionals and control flow. Use multi-line statements instead:

```ts
// Bad
if (foo) bar;

// Good
if (foo) {
  bar;
}
```

## Writing tests

Tests use `vitest`. Run them with `npm test`.

### Structure: conditions and outcomes

`describe` blocks name a **condition** — the situation under which the behaviour applies. `test` strings name the **outcome** — what happens when that condition holds. Together they should read as a natural sentence.

```ts
describe("when a file contains a null byte", () => {
  test("skips it silently", () => { ... });
});

describe("when a passage contains nested passages", () => {
  test("templateRegistry replaces the nested block with a ::SPOOL:: reference", () => { ... });
});
```

Avoid topic-named describes like `"binary and unreadable files"` or `"parse error collection"` — these describe categories, not conditions.

### No section separator comments

Do not use banner comments (e.g. `// ---`) to divide test files into sections. The structure is already clear from `function` definitions and `describe` blocks.

### Temporary directories

Tests that touch the filesystem use a `withTempDir` helper instead of `beforeEach`/`afterEach`. The helper creates a temp directory, passes it to the callback, and removes it in a `finally` block regardless of whether the test passes or throws.

```ts
async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "spool-test-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("finds passages in nested subdirectories", () =>
  withTempDir(async (root) => {
    // set up files, then assert
  }));
```
