# spool

Reverse literate programming CLI. Start with annotated source code, weave it into publishable Markdown docs.

Traditional literate programming tangles documentation into source. Spool works the other way: you annotate your source code with named passages, write doc templates that reference those passages, and spool weaves them together into final Markdown.

The annotation syntax is language-agnostic — it works with any comment style (`//`, `#`, `--`, `%`, `;`, etc.).

## How it works

**1. Annotate your source code:**

```ts
//::spool:: <car-class>
export class Car {
  drive() {
    console.log("vroom");
  }
}
//::spool:: </car-class>
```

**2. Reference passages in your doc templates:**

```md
## The Car Class

~~~ts
::spool:: {{src/car.ts:car-class}}
~~~
```

**3. Run `spool weave` to produce the final docs.**

Passages are referenced by `::spool:: {{relativePath:passageName}}` where the path is relative to the project root. Any comment characters before `::spool::` are ignored, so `//::spool:: {{...}}`, `# ::spool:: {{...}}`, etc. all work. Passages can be nested — content lines are added to all currently-open passages on the stack.

## Setup

Create a `spool.json` at your project root:

```json
{
  "sourceCodeDir": "src",
  "sourceDocsDir": "docs",
  "targetDocsDir": "output"
}
```

| Field | Description |
|---|---|
| `sourceCodeDir` | Directory scanned for annotated source files |
| `sourceDocsDir` | Directory containing `.md` doc templates |
| `targetDocsDir` | Directory where woven output is written |

`sourceDocsDir` may be inside `sourceCodeDir` — spool skips it when scanning for annotations.

## Usage

```
spool <command> [options]
```

### `spool weave`

Builds the block registry from source annotations and weaves all `.md` templates in `sourceDocsDir` into `targetDocsDir`, preserving directory structure.

```sh
spool weave
```

Exits with code 1 if any errors are found (unclosed blocks, unknown references, etc.).

### `spool lint`

Validates source annotations and doc references without writing any output files. Use this in CI to catch broken references early.

```sh
spool lint
```

Exits with code 1 if any errors are found.

### `spool preview`

Runs an initial weave, then starts a local HTTP server that renders `.md` files as HTML. Watches `sourceCodeDir` and `sourceDocsDir` for changes and re-weaves automatically.

```sh
spool preview
spool preview --port 8080
```

| Option | Default | Description |
|---|---|---|
| `-p, --port <port>` | `4567` | Port for the preview server |

### `spool lsp`

Starts the Language Server Protocol server over stdio. Provides inline diagnostics for:

- **Source files**: malformed annotations (unclosed blocks, mismatched close tags, duplicate names)
- **Doc files**: references to blocks that don't exist in the registry

```sh
spool lsp
```

Configure your editor to launch `spool lsp` as an LSP server for the relevant file types.
