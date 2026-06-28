# reins

Drive your real, logged-in Chromium browser (Chrome, Dia, Brave, Edge, Arc)
from an MCP client (Claude Code, Codex). MV3 extension + local MCP server.

> Status: M0 scaffold. Browser driving lands in M1+.

## Packages
- `packages/protocol` — shared zod bridge schemas (`@reins/protocol`)
- `packages/mcp` — MCP server + `reins` CLI (`reins-mcp`)
- `packages/extension` — MV3 extension (Vite + crxjs)

## Develop
```bash
mise install        # Node 24.18.0 + pnpm 11.9.0
pnpm install
pnpm test
pnpm build
```

## Design
See `docs/superpowers/specs/2026-06-28-reins-design.md`.
