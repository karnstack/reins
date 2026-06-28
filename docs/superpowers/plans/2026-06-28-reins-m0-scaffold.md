# reins M0 — Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `reins` Turborepo/pnpm monorepo with three buildable packages (`protocol`, `mcp`, `extension`), each with one real passing test, and a green CI pipeline (lint → typecheck → test → build).

**Architecture:** pnpm workspaces orchestrated by Turborepo. `protocol` and `mcp` are tsdown-built ESM libraries; `extension` is a Vite + @crxjs MV3 build. This milestone produces no browser-driving behavior — it locks the toolchain, package boundaries, and CI so M1+ build on solid ground.

**Tech Stack:** Node 24.18.0, pnpm 11.9.0, TypeScript 6.0.3, Turborepo 2.10.0, tsdown 0.22.3, Vite 8.1.0, @crxjs/vite-plugin 2.7.0, Vitest 4.1.9, Biome 2.5.1, zod 4.4.3, @modelcontextprotocol/sdk 1.29.0, ws 8.21.0.

## Global Constraints

- **Exact versions only** — no `^`/`~`/`latest` anywhere (package.json, mise.toml). Copy the versions in Tech Stack verbatim.
- **Runtime pins:** Node `24.18.0`, pnpm `11.9.0` — pinned in `mise.toml` and `engines`.
- **Package names:** `@reins/protocol` (private), `reins-mcp` (publishable), `@reins/extension` (private).
- **ESM everywhere** — every package.json has `"type": "module"`; TS uses `moduleResolution: "Bundler"`, `verbatimModuleSyntax: true`. Intra-repo relative imports use `.js` extensions.
- **Repo root:** `~/code/karnstack/reins` (git already initialized; design spec already committed).
- All dependency versions: TypeScript 6.0.3, zod 4.4.3, tsdown 0.22.3, Vitest 4.1.9, Vite 8.1.0, @crxjs/vite-plugin 2.7.0, @modelcontextprotocol/sdk 1.29.0, ws 8.21.0, @types/node 26.0.1, @types/chrome 0.2.0, @types/ws 8.18.1, @biomejs/biome 2.5.1, turbo 2.10.0.

---

### Task 1: Monorepo tooling foundation

**Files:**
- Create: `mise.toml`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`

**Interfaces:**
- Consumes: nothing.
- Produces: root scripts `lint`/`typecheck`/`test`/`build` (all delegate to `turbo run <task>` except `lint` = `biome check .`); `tsconfig.base.json` extended by every package; pinned Node/pnpm via mise.

- [ ] **Step 1: Create `mise.toml`**

```toml
[tools]
node = "24.18.0"
pnpm = "11.9.0"
```

- [ ] **Step 2: Create `.npmrc`** (deterministic installs)

```ini
save-exact=true
engine-strict=true
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
dist/
.turbo/
coverage/
*.log
.DS_Store
```

- [ ] **Step 4: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 5: Create root `package.json`**

```json
{
  "name": "reins",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.9.0",
  "engines": {
    "node": "24.18.0",
    "pnpm": "11.9.0"
  },
  "scripts": {
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "build": "turbo run build"
  },
  "devDependencies": {
    "@biomejs/biome": "2.5.1",
    "turbo": "2.10.0",
    "typescript": "6.0.3"
  }
}
```

- [ ] **Step 6: Create `turbo.json`** (Turborepo 2 uses `tasks`, not `pipeline`)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 7: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.1/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!**/dist", "!**/.turbo"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "enabled": true }
}
```

- [ ] **Step 8: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "declaration": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 9: Install and verify the toolchain resolves**

Run: `cd ~/code/karnstack/reins && mise install && pnpm install`
Expected: mise installs Node 24.18.0 + pnpm 11.9.0; `pnpm install` writes `pnpm-lock.yaml` and exits 0 (no packages yet — root devDeps only).

- [ ] **Step 10: Verify turbo runs with no packages**

Run: `pnpm build`
Expected: turbo reports "No tasks were executed" (or 0 successful) and exits 0.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: monorepo tooling foundation (turbo, pnpm, mise, biome, tsconfig)"
```

---

### Task 2: `@reins/protocol` package with first bridge schema

**Files:**
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/tsdown.config.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/frames.ts`, `packages/protocol/src/frames.test.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1).
- Produces: package `@reins/protocol` exporting `HelloFrame` (zod schema) and its inferred type `HelloFrame`. Consumed by `reins-mcp` (Task 3) and `@reins/extension` (Task 4) in later milestones.

- [ ] **Step 1: Create `packages/protocol/package.json`**

```json
{
  "name": "@reins/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "4.4.3"
  },
  "devDependencies": {
    "tsdown": "0.22.3",
    "typescript": "6.0.3",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2: Create `packages/protocol/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/protocol/tsdown.config.ts`**

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
```

- [ ] **Step 4: Install package deps**

Run: `pnpm install`
Expected: exits 0; `zod`, `tsdown`, `vitest`, `typescript` resolved for `@reins/protocol`.

- [ ] **Step 5: Write the failing test** — `packages/protocol/src/frames.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { HelloFrame } from "./frames.js";

describe("HelloFrame", () => {
  it("accepts a valid hello frame", () => {
    const frame = HelloFrame.parse({ type: "hello", token: "abc123", browser: "chrome" });
    expect(frame.token).toBe("abc123");
    expect(frame.type).toBe("hello");
  });

  it("rejects a hello frame with an empty token", () => {
    expect(() => HelloFrame.parse({ type: "hello", token: "", browser: "chrome" })).toThrow();
  });

  it("rejects a hello frame missing the token", () => {
    expect(() => HelloFrame.parse({ type: "hello", browser: "chrome" })).toThrow();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @reins/protocol test`
Expected: FAIL — cannot resolve `./frames.js` (module does not exist).

- [ ] **Step 7: Write minimal implementation** — `packages/protocol/src/frames.ts`

```ts
import { z } from "zod";

/** First frame the extension sends to the MCP server to authenticate. */
export const HelloFrame = z.object({
  type: z.literal("hello"),
  token: z.string().min(1),
  browser: z.string(),
});
export type HelloFrame = z.infer<typeof HelloFrame>;
```

- [ ] **Step 8: Create the barrel** — `packages/protocol/src/index.ts`

```ts
export * from "./frames.js";
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @reins/protocol test`
Expected: PASS — 3 tests.

- [ ] **Step 10: Verify build and typecheck**

Run: `pnpm --filter @reins/protocol build && pnpm --filter @reins/protocol typecheck`
Expected: `dist/index.js` + `dist/index.d.ts` emitted; `tsc --noEmit` exits 0.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(protocol): HelloFrame schema + package scaffold"
```

---

### Task 3: `reins-mcp` package with `ping` tool + CLI stub

**Files:**
- Create: `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/tsdown.config.ts`, `packages/mcp/src/create-server.ts`, `packages/mcp/src/server.ts`, `packages/mcp/src/cli.ts`, `packages/mcp/src/create-server.test.ts`

**Interfaces:**
- Consumes: `@reins/protocol` (workspace), `@modelcontextprotocol/sdk`.
- Produces: `createServer(): McpServer` exposing a `ping` tool that returns text `"pong"`. Bins `reins-mcp` (stdio server) and `reins` (CLI stub). M1 extends `createServer` with the WS bridge.

- [ ] **Step 1: Create `packages/mcp/package.json`**

```json
{
  "name": "reins-mcp",
  "version": "0.0.0",
  "type": "module",
  "bin": {
    "reins-mcp": "./dist/server.js",
    "reins": "./dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0",
    "@reins/protocol": "workspace:*",
    "ws": "8.21.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "26.0.1",
    "@types/ws": "8.18.1",
    "tsdown": "0.22.3",
    "typescript": "6.0.3",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2: Create `packages/mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/mcp/tsdown.config.ts`** (bins keep their shebang)

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts", "src/cli.ts", "src/create-server.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
```

- [ ] **Step 4: Install package deps**

Run: `pnpm install`
Expected: exits 0; `@reins/protocol` linked via `workspace:*`.

- [ ] **Step 5: Write the failing test** — `packages/mcp/src/create-server.test.ts`

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "./create-server.js";

describe("createServer", () => {
  it("exposes a ping tool that returns pong", async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "ping", arguments: {} });
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    expect(first.text).toBe("pong");

    await client.close();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter reins-mcp test`
Expected: FAIL — cannot resolve `./create-server.js`.

- [ ] **Step 7: Write minimal implementation** — `packages/mcp/src/create-server.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Build the reins MCP server. M0: a single `ping` tool. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "reins", version: "0.0.0" });

  server.registerTool(
    "ping",
    { description: "Health check. Returns 'pong'.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] }),
  );

  return server;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter reins-mcp test`
Expected: PASS — 1 test.

- [ ] **Step 9: Create the stdio entrypoint** — `packages/mcp/src/server.ts`

```ts
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./create-server.js";

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 10: Create the CLI stub** — `packages/mcp/src/cli.ts`

```ts
#!/usr/bin/env node
// `reins` CLI — M0 stub. Real commands (pair/status/doctor) arrive in M1.
const [command] = process.argv.slice(2);
if (command) {
  console.log(`reins: unknown command '${command}' (CLI commands land in M1)`);
} else {
  console.log("reins CLI — commands land in M1 (pair, status, doctor)");
}
```

- [ ] **Step 11: Build, then verify both bins run**

Run:
```bash
pnpm --filter reins-mcp build
node packages/mcp/dist/cli.js
```
Expected: build emits `dist/{server,cli,create-server}.js` (+ `.d.ts`); `cli.js` prints "reins CLI — commands land in M1 (pair, status, doctor)". If `dist/server.js` lost its shebang, add `chmod +x` is not needed (invoked via `node`), but confirm the shebang line is present in `dist/server.js` and `dist/cli.js`; if tsdown stripped it, add `shims: true` is not required — instead set `outputOptions` is unnecessary; verify with `head -1 packages/mcp/dist/cli.js` showing `#!/usr/bin/env node`.

- [ ] **Step 12: Typecheck**

Run: `pnpm --filter reins-mcp typecheck`
Expected: exits 0.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(mcp): ping tool, stdio server, reins CLI stub"
```

---

### Task 4: `@reins/extension` MV3 build with a tested util

**Files:**
- Create: `packages/extension/package.json`, `packages/extension/tsconfig.json`, `packages/extension/vite.config.ts`, `packages/extension/manifest.config.ts`, `packages/extension/src/background.ts`, `packages/extension/src/popup.html`, `packages/extension/src/popup.ts`, `packages/extension/src/lib/backoff.ts`, `packages/extension/src/lib/backoff.test.ts`

**Interfaces:**
- Consumes: `@reins/protocol` (workspace, declared for M1 use), `@crxjs/vite-plugin`.
- Produces: a loadable unpacked MV3 extension at `packages/extension/dist/`; pure util `nextBackoff(attempt, baseMs?, maxMs?): number` used by the M1 reconnect loop.

- [ ] **Step 1: Create `packages/extension/package.json`**

```json
{
  "name": "@reins/extension",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch --mode development",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@reins/protocol": "workspace:*"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "2.7.0",
    "@types/chrome": "0.2.0",
    "typescript": "6.0.3",
    "vite": "8.1.0",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2: Create `packages/extension/manifest.config.ts`**

```ts
import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "reins",
  version: "0.0.0",
  description: "Drive your real, logged-in browser from an MCP client.",
  permissions: ["debugger", "tabs", "storage", "offscreen", "alarms"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "src/background.ts", type: "module" },
  action: { default_popup: "src/popup.html" },
});
```

- [ ] **Step 3: Create `packages/extension/vite.config.ts`**

```ts
import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.config.js";

export default defineConfig({
  plugins: [crx({ manifest })],
  server: { port: 5733, strictPort: true },
});
```

- [ ] **Step 4: Create `packages/extension/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["chrome"]
  },
  "include": ["src", "vite.config.ts", "manifest.config.ts"]
}
```

- [ ] **Step 5: Install package deps**

Run: `pnpm install`
Expected: exits 0; verify the resolved `vite` is `8.1.0` and `@crxjs/vite-plugin` is `2.7.0` (`pnpm --filter @reins/extension why vite` shows 8.1.0). If crxjs refuses Vite 8 at build time in Step 11, pin `vite` to the highest 7.x and record the reason in the commit body.

- [ ] **Step 6: Write the failing test** — `packages/extension/src/lib/backoff.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { nextBackoff } from "./backoff.js";

describe("nextBackoff", () => {
  it("grows exponentially from the base delay", () => {
    expect(nextBackoff(0)).toBe(500);
    expect(nextBackoff(1)).toBe(1000);
    expect(nextBackoff(2)).toBe(2000);
  });

  it("caps at the maximum delay", () => {
    expect(nextBackoff(20)).toBe(30_000);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @reins/extension test`
Expected: FAIL — cannot resolve `./backoff.js`.

- [ ] **Step 8: Write minimal implementation** — `packages/extension/src/lib/backoff.ts`

```ts
/** Exponential backoff (ms) for the M1 WS reconnect loop. */
export function nextBackoff(attempt: number, baseMs = 500, maxMs = 30_000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @reins/extension test`
Expected: PASS — 2 tests.

- [ ] **Step 10: Create the MV3 stubs**

`packages/extension/src/background.ts`:
```ts
// reins background service worker — M0 stub.
// M1 adds the offscreen-held WS client + chrome.debugger bridge.
chrome.runtime.onInstalled.addListener(() => {
  console.log("[reins] extension installed");
});
```

`packages/extension/src/popup.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>reins</title>
  </head>
  <body>
    <main>
      <h1>reins</h1>
      <p id="status">Not paired (M1)</p>
    </main>
    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

`packages/extension/src/popup.ts`:
```ts
// reins popup — M0 stub. M1 adds pairing form, connection indicator, kill switch.
const status = document.getElementById("status");
if (status) {
  status.textContent = "Not paired (M1)";
}
```

- [ ] **Step 11: Build and verify the unpacked extension**

Run: `pnpm --filter @reins/extension build`
Expected: exits 0; `packages/extension/dist/manifest.json` exists with `"manifest_version": 3`. Confirm `node -e "console.log(require('./packages/extension/dist/manifest.json').manifest_version)"` prints `3`.

- [ ] **Step 12: Typecheck**

Run: `pnpm --filter @reins/extension typecheck`
Expected: exits 0.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(extension): MV3 vite+crxjs build, backoff util, popup/background stubs"
```

---

### Task 5: CI pipeline + full green run

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: none

**Interfaces:**
- Consumes: root scripts `lint`/`typecheck`/`test`/`build` (Task 1); all three packages (Tasks 2–4).
- Produces: a CI workflow running the full pipeline on push/PR; a README documenting setup.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v4.2.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 2: Create `README.md`**

````markdown
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
````

- [ ] **Step 3: Format the whole repo**

Run: `pnpm format`
Expected: Biome rewrites any unformatted files; exits 0.

- [ ] **Step 4: Run the full pipeline locally (mirror CI)**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all four exit 0. `test` runs 6 tests total (protocol 3, mcp 1, extension 2). `build` emits `dist/` in all three packages.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: full lint/typecheck/test/build pipeline + README"
```

---

## Self-Review

**1. Spec coverage (M0 milestone — design §11.1):** "monorepo (turbo/pnpm/mise/biome/tsconfig), three empty packages building + lint + test green in CI." → Task 1 (tooling), Tasks 2–4 (three packages, each building + one test), Task 5 (CI + green pipeline). Covered. Spec §2 package boundaries (`protocol`/`mcp`/`extension`) → Tasks 2/3/4. Spec §3 exact pins → Global Constraints + every package.json. Later-milestone items (bridge, tools, security, offscreen) are intentionally out of M0 scope and tracked for M1–M4.

**2. Placeholder scan:** No "TBD"/"add error handling"/"write tests for the above". Stub files are explicitly labeled M0 stubs with real, complete content (not placeholders for M0's deliverable, which is "it builds + a real test passes"). The crxjs↔Vite-8 contingency (Task 4 Step 5/11) is a concrete fallback with a recorded reason, not a vague "handle compatibility".

**3. Type consistency:** `createServer(): McpServer` defined in Task 3 Step 7, consumed identically in Task 3 Step 5 test and Step 9 entrypoint. `HelloFrame` named identically across Task 2. `nextBackoff(attempt, baseMs?, maxMs?)` signature identical in Task 4 Steps 6 and 8. Package names match Global Constraints. Test count (6) in Task 5 Step 4 matches Tasks 2–4 (3+1+2).

## Notes for M1 (next plan)
- Bridge protocol frames (request/response/event envelopes) extend `packages/protocol`.
- `createServer` gains the WS host + pairing/token + origin check.
- Extension gains offscreen-doc WS client (uses `nextBackoff`), `hello/welcome` handshake, popup pairing UI + kill switch, and `reins pair/status/doctor`.
- Deliverable: agent calls a `connected_browser` tool and gets live tab info end-to-end.
