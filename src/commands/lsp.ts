import { startServer } from "../lsp/server.ts";

export function lspCommand(): void {
  startServer();
}
