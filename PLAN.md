# Super Language Server — Implementation Plan

## Context

Build a "meta-language server" that operates on Markdown files with embedded fenced code blocks. It parses the Markdown, extracts code blocks, spawns child language servers for each language, and proxies LSP requests by translating positions between the Markdown document and virtual documents. The user gets full LSP features (diagnostics, hover, completion, go-to-definition, code actions) within each code block, as if editing a standalone file in that language.

## Architecture

```
Editor  ←→  Super Language Server  ←→  Child Language Servers
                    |                        (one per language)
            Markdown Parser                        |
            Position Mapper              Virtual Documents
            Virtual Doc Manager          (temp files on disk)
```

**Request flow**: Client sends LSP request for `.md` file → super server finds which code block the cursor is in → translates position from Markdown coordinates to virtual document coordinates → forwards to child language server → translates response back → returns to client.

## Tech Stack

- **`vscode-languageserver`** (9.x) + **`vscode-languageserver-textdocument`** — LSP server framework
- **`vscode-jsonrpc`** — JSON-RPC for child server communication via stdio
- **`mdast-util-from-markdown`** + **`unist-util-visit`** — Markdown parsing (ESM-only)
- **`vitest`** — testing
- **TypeScript** with ESM output (`"type": "module"` in package.json)

## Project Structure

```
super-language-server/
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts              # LSP entry point
    ├── types.ts               # Shared interfaces (CodeBlock, VirtualDocument, config types)
    ├── config.ts              # Config loading from .superlsconfig.json or initOptions
    ├── markdown-parser.ts     # Extract CodeBlock[] from Markdown text
    ├── position-map.ts        # Bidirectional position/range translation
    ├── virtual-document.ts    # Shadow filesystem (temp files in os.tmpdir())
    ├── child-server.ts        # Child server spawn/init/communication/crash recovery
    └── document-manager.ts    # Coordination layer tying everything together
```

## Key Design Decisions

1. **Shadow filesystem for virtual documents**: Write temp files with correct extensions (`.ts`, `.py`, etc.) to `os.tmpdir()/super-ls-<pid>/`. This maximizes compatibility — many language servers (especially TypeScript) require real `file://` URIs they can read from disk.

2. **One child server per language**: Multiple code blocks in the same language share a single child server process. Servers are spawned lazily on first encounter.

3. **Full document sync**: Re-parse the entire Markdown on every change (simpler, and Markdown files are typically small). Diff the resulting code blocks against the previous state to send minimal `didOpen`/`didChange`/`didClose` to child servers.

4. **Position mapping is just a line offset**: Code block content starts at column 0 in Markdown (no indentation prefix from the fence), so translation is simply `virtualLine = markdownLine - blockStartLine`. Character positions stay the same.

5. **Configuration via `.superlsconfig.json`**:
   ```json
   {
     "servers": {
       "typescript": { "command": "typescript-language-server", "args": ["--stdio"] },
       "python": { "command": "pylsp" }
     }
   }
   ```

## Implementation Order

### Phase 1: Foundation
1. **Project setup** — `package.json` (with `"type": "module"`), `tsconfig.json`, install dependencies
2. **`src/types.ts`** — `CodeBlock`, `VirtualDocument`, `LanguageServerConfig`, `SuperLSConfig` interfaces
3. **`src/config.ts`** — Load config from `.superlsconfig.json` or `initializationOptions`; language-to-extension map; include example configs for TypeScript (`typescript-language-server --stdio`), Python (`pylsp`), and Go (`gopls`)
4. **`src/markdown-parser.ts`** — Parse Markdown with `mdast-util-from-markdown`, visit `code` nodes, extract `CodeBlock[]` with 0-indexed line numbers. Skip blocks without a language identifier.
5. **`src/position-map.ts`** — `toVirtualPosition`, `toMarkdownPosition`, `toVirtualRange`, `toMarkdownRange`, `findCodeBlockAtPosition`
6. **`src/virtual-document.ts`** — `VirtualDocumentManager` class: `syncCodeBlocks()` diffs old vs new blocks and returns `{opened, changed, closed}`. Manages temp files. `dispose()` cleans up.

### Phase 2: Server Skeleton
7. **`src/server.ts`** — LSP connection, `onInitialize` declaring capabilities (hover, completion, definition, codeAction), document lifecycle handlers
8. **`src/document-manager.ts`** — `onDocumentOpen`/`onDocumentChange`/`onDocumentClose` wiring parser → virtual docs

### Phase 3: Child Server Communication
9. **`src/child-server.ts`** — `ChildServerManager` and internal `ChildServer` class:
    - Spawn via `child_process.spawn` with stdio pipes
    - JSON-RPC connection via `vscode-jsonrpc`
    - Send `initialize` → `initialized` handshake
    - `didOpen`/`didChange`/`didClose` notifications
    - Forward `publishDiagnostics` from child → translate ranges → publish to client
    - `sendRequest()` for proxying hover/completion/definition/codeAction

### Phase 4: Feature Proxying (all in `document-manager.ts`)
10. **Hover** — Find block at position, translate position, forward, translate response range back
11. **Completion** — Same pattern; also translate `textEdit` ranges and `additionalTextEdits` in `CompletionItem`s
12. **Definition** — Translate position, forward; for response locations, remap virtual URIs back to parent Markdown URI (leave external file URIs as-is)
13. **Code Actions** — Translate range and context diagnostics, forward; translate `WorkspaceEdit` changes and diagnostic ranges in response
14. **Diagnostics** — Merge per-block diagnostics into a single `publishDiagnostics` per parent document

### Phase 5: Robustness
15. Error handling: catch child spawn failures, protocol errors, timeouts (10s default via `Promise.race`)
16. Child crash recovery: remove from map, re-spawn on next request, re-send `didOpen` for open documents
17. Graceful shutdown: `shutdown` → `exit` to each child, force-kill after 5s, clean up shadow dir

## LSP Capabilities Declared

| Feature | Method | Translation |
|---------|--------|-------------|
| Hover | `textDocument/hover` | Position in → range out |
| Completion | `textDocument/completion` | Position in → edit ranges out |
| Definition | `textDocument/definition` | Position in → location URIs + ranges out |
| Code Actions | `textDocument/codeAction` | Range + context in → workspace edits out |
| Diagnostics | `textDocument/publishDiagnostics` | Ranges out (push from child) |

## Known Limitations (Future Work)

- **No cross-block imports**: Each code block is an isolated virtual file. Blocks can't import from each other.
- **No `tsconfig.json` resolution**: Virtual files in `/tmp` won't find workspace `tsconfig.json`. Could be solved by generating a synthetic config in the shadow dir.
- **Top-level code blocks only**: Indented code blocks (inside lists/blockquotes) would need character-offset adjustments in position mapping.
- **No debouncing**: Every keystroke re-parses. Could add 100ms debounce on `didChange`.

## Verification

1. `npm run build` — compiles without errors
2. **Manual test**: Create a `.superlsconfig.json` pointing to `typescript-language-server`, open a Markdown file with a TypeScript code block in an editor configured to use super-language-server, verify:
   - Diagnostics appear for type errors in the code block
   - Hovering over a symbol shows type info
   - Completion suggestions appear
   - Go-to-definition works within the block
3. Tests will be added after the server is working end-to-end
