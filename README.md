# spool

Reverse literate programming CLI. Start with annotated source code, weave it into publishable Markdown docs.

Traditional literate programming tangles documentation into source. Spool works the other way: you annotate your source code with named passages, write doc templates that reference those passages, and spool weaves them together into final Markdown.

The annotation syntax is language-agnostic — it works with any comment style (`//`, `#`, `--`, `%`, `;`, etc.).

## How it works

**1. Annotate your source code:**

```ts
// ::SPOOL:: start(#car)
export class Car {
  drive() {
    console.log("vroom");
  }
}
// ::SPOOL:: end(#car)
```

**2. Reference passages in your doc templates:**

````md
## The Car Class

```ts
// ::SPOOL:: <<src/car.ts#car>>
```
````

**3. Run `spool weave` to produce the final docs.**

Passages are referenced by `::SPOOL:: <<relativePath#passageName>>` where the path is relative to the project root. Any comment characters before `::SPOOL::` are ignored, so `// ::SPOOL:: ...`, `# ::SPOOL:: ...`, etc. all work. Passages can be nested — content lines are added to all currently-open passages on the stack.

To include an entire file without a named passage, omit the `#passageName` part:

```md
// ::SPOOL:: <<src/car.ts>>
```

To include a range of lines between two passage markers:

```md
// ::SPOOL:: <<src/car.ts@START..end(#car)>>
```

`START` and `END` refer to the beginning and end of the file; `start(#name)` and `end(#name)` refer to named passage boundaries.

## Setup

Create a `spool.json` at your project root:

```json
{
  "source": {
    "code": "src",
    "docs": "docs"
  },
  "target": "output"
}
```

| Field         | Description                                  |
| ------------- | -------------------------------------------- |
| `source.code` | Directory scanned for annotated source files |
| `source.docs` | Directory containing `.md` doc templates     |
| `target`      | Directory where woven output is written      |

`source.docs` may be inside `source.code` — spool skips it when scanning for annotations.

To exclude files from the source scan, use an array for `source.code` with `!`-prefixed glob patterns:

```json
{
  "source": {
    "code": ["src", "!**/*.test.ts"],
    "docs": "docs"
  },
  "target": "dist/docs"
}
```

## Usage

```
spool <command> [options]
```

### `spool weave`

Builds the passage registry from source annotations and weaves all `.md` templates in `source.docs` into `target`, preserving directory structure.

```sh
spool weave
```

| Option        | Description                                  |
| ------------- | -------------------------------------------- |
| `-w, --watch` | Watch for changes and re-weave automatically |
| `-c, --clean` | Clear the target directory before weaving    |

Exits with code 1 if any errors are found (unclosed passages, unknown references, etc.).

### `spool lint`

Validates source annotations and doc references without writing any output files. Use this in CI to catch broken references early.

```sh
spool lint
```

| Option       | Description                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `--coverage` | Also check that every source file has at least one passage and every passage is referenced in a doc |

Exits with code 1 if any errors are found.

### `spool site dev`

Runs an initial weave, then starts a VitePress development server with live reloading.

```sh
spool site dev
spool site dev --port 8080
```

| Option                       | Default | Description                                                                                                   |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `-p, --port <port>`          | `5173`  | Port for the dev server                                                                                       |
| `--verify-unique-references` |         | Error if any passage is referenced on multiple pages                                                          |
| `--link-references`          |         | Link unexpanded passage references to the page where they are expanded (implies `--verify-unique-references`) |

### `spool site build`

Builds the documentation site for production.

```sh
spool site build
```

Accepts the same `--verify-unique-references` and `--link-references` flags as `spool site dev`.

### `spool lsp`

Starts the Language Server Protocol server over stdio. Provides inline diagnostics for:

- **Source files**: malformed annotations (unclosed passages, mismatched close tags, duplicate names)
- **Doc files**: references to passages that don't exist in the registry

```sh
spool lsp
```

Configure your editor to launch `spool lsp` as an LSP server for the relevant file types.
