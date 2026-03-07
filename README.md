# super-language-server

A meta-language server for Markdown files with embedded fenced code blocks. It spawns child language servers for each language and proxies LSP requests, giving you diagnostics, hover, completion, go-to-definition, and code actions inside code blocks — as if editing a standalone file in that language.

## How it works

```
Editor  ←→  Super Language Server  ←→  Child Language Servers
                    |                        (one per language)
            Markdown Parser                        |
            Position Mapper              Virtual Documents
            Virtual Doc Manager          (temp files on disk)
```

When your editor sends an LSP request for a `.md` file, the language server:

1. Finds which fenced code block the cursor is in
2. Translates the position from Markdown coordinates to virtual document coordinates
3. Forwards the request to the appropriate child language server
4. Translates the response back and returns it to the editor

## Usage

### 1. Install dependencies and build

```sh
npm install
npm run build
```

### 2. Configure language servers

Create a `.superlsconfig.json` in your workspace root:

```json
{
  "servers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"]
    },
    "python": {
      "command": "pylsp"
    },
    "go": {
      "command": "gopls"
    }
  }
}
```

Each key matches a language you expect to tag a fenced code block with (a list of supported languages is in `config.ts`). The `command` must be on your `PATH`, or you can provide an absolute path.

### 3. Configure your editor

Point your editor at the super language server for Markdown files. The server communicates over stdio.

For instance, using Neovim and `nvim-lspconfig`, you would add:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  callback = function()
    vim.lsp.start({
      name = "super-language-server",
      cmd = { "node", "/path/to/super-language-server/dist/server.js", "--stdio" },
      root_dir = vim.fs.root(0, { ".superlsconfig.json", ".git" }),
    })
  end,
})
```

### 4. Write Markdown with code blocks

~~~markdown
# My Document

Here is some TypeScript:

```typescript
const greet = (name: string): string => {
  return `Hello, ${name}!`;
};
```

And some Python:

```python
def greet(name: str) -> str:
    return f"Hello, {name}!"
```
~~~

Your editor will show diagnostics, completions, hover info, and go-to-definition inside each block.

## Configuration reference

`.superlsconfig.json` supports the following fields per server:

| Field | Type | Description |
|-------|------|-------------|
| `command` | `string` | Executable name or absolute path |
| `args` | `string[]` | Command-line arguments (default: `[]`) |
| `env` | `object` | Extra environment variables to set |

## Known limitations

- **No cross-block imports** — each code block is an isolated virtual file.
- **No `tsconfig.json` resolution** — virtual files live in `/tmp` and won't pick up your workspace TypeScript config.
- **Top-level blocks only** — indented code blocks (inside lists or blockquotes) are not supported.
- **No debouncing** — the Markdown is re-parsed on every keystroke.

## Development

```sh
npm run build   # compile TypeScript
npm run dev     # watch mode
npm test        # run tests (vitest)
```
