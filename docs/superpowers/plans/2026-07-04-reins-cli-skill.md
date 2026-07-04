# reins CLI + skill (MCP removal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MCP server with a CLI-first surface (`reins <tool>` → daemon `/rpc` → extension) plus a skills.sh-installable skill, with ten new bridge methods and a raw CDP escape hatch for full page control.

**Architecture:** The daemon keeps its WS bridge, port discovery, and Host validation but loses the MCP layer; a thin `POST /rpc {method, params}` replaces it. The CLI grows one subcommand per bridge method, auto-spawns the daemon, and formats results as compact text (`--json` for raw). A `skills/reins/SKILL.md` teaches any agent the CLI.

**Tech Stack:** TypeScript, zod, ws, vitest, tsdown, pnpm workspace. No new dependencies; `@modelcontextprotocol/sdk` is removed.

**Spec:** `docs/superpowers/specs/2026-07-04-reins-cli-skill-design.md`

## Global Constraints

- No backward compatibility required (no releases yet). Package name stays `@karnstack/reins`, bin stays `reins`, version stays 0.2.0.
- After any `packages/protocol/src` change: `pnpm --filter @reins/protocol build` before running mcp/cli tests (mcp resolves protocol from dist).
- Commits: conventional, no AI attribution.
- Every daemon HTTP route validates the Host header; forged-Host tests must use raw `node:http` with `setHost: false` (fetch drops forged Host).
- Zero new runtime dependencies in the CLI package.

---

### Task 1: Protocol — ten new method schemas

**Files:**
- Modify: `packages/protocol/src/cdp.ts`
- Test: `packages/protocol/src/cdp.test.ts`

**Produces:** `PressKeyParams`, `HoverParams`, `ScrollParams`, `FillParams`, `SelectOptionParams`, `UploadParams`, `ReadTextParams`, `ReadTextResult`, `ResizeParams`, `DialogParams`, `CdpParams`, `CdpResult` — all with the shared optional `browserId`/`tabId` fields.

- [ ] Add schemas (same file section style as existing):

```ts
export const PressKeyParams = z.object({
  browserId,
  tabId,
  /** "[Meta+|Ctrl+|Alt+|Shift+]<Key>", e.g. "Escape", "Meta+A", "Shift+Tab". */
  key: z.string().min(1),
});

export const HoverParams = z
  .object({ browserId, tabId, ref: z.string().optional(), selector: z.string().optional() })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "hover requires a ref or a selector",
  });

export const ScrollParams = z
  .object({
    browserId,
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    by: z.object({ dx: z.number(), dy: z.number() }).optional(),
    to: z.enum(["top", "bottom"]).optional(),
  })
  .refine((v) => v.ref ?? v.selector ?? v.by ?? v.to, {
    message: "scroll requires a ref, selector, --by, or --to",
  });

export const FillParams = z
  .object({ browserId, tabId, ref: z.string().optional(), selector: z.string().optional(), value: z.string() })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, { message: "fill requires a ref or a selector" });

export const SelectOptionParams = z
  .object({ browserId, tabId, ref: z.string().optional(), selector: z.string().optional(), value: z.string() })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, { message: "select requires a ref or a selector" });

export const UploadParams = z
  .object({ browserId, tabId, ref: z.string().optional(), selector: z.string().optional(), files: z.array(z.string()).min(1) })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, { message: "upload requires a ref or a selector" });

export const ReadTextParams = z.object({
  browserId,
  tabId,
  ref: z.string().optional(),
  selector: z.string().optional(), // no refine: default target is document.body
  maxChars: z.number().int().positive().optional(),
});
export const ReadTextResult = z.object({ text: z.string() });

export const ResizeParams = z.object({
  browserId,
  tabId,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const DialogParams = z.object({
  browserId,
  tabId,
  accept: z.boolean(),
  promptText: z.string().optional(),
});

export const CdpParams = z.object({
  browserId,
  tabId,
  method: z.string().regex(/^[A-Za-z]+\.[A-Za-z]+$/, "expected Domain.method"),
  params: z.record(z.string(), z.unknown()).optional(),
});
export const CdpResult = z.object({ result: z.unknown() });
```

(+ `z.infer` type exports for each, matching file style.)

- [ ] Tests: valid parse per schema; refine failures (hover without target, scroll with nothing, cdp bad method format); `ReadTextParams` valid without target.
- [ ] `pnpm --filter @reins/protocol test` → green; `pnpm --filter @reins/protocol build` (required before later tasks).
- [ ] Commit: `feat(protocol): schemas for press/hover/scroll/fill/select/upload/text/resize/dialog + raw cdp`

### Task 2: Extension — new handlers + dispatch + popup copy

**Files:**
- Create: `packages/extension/src/lib/page-actions.ts`, `packages/extension/src/lib/keys.ts`
- Modify: `packages/extension/src/lib/cdp.ts` (export `resolveTabId`, `withDebugger`, `send`, `selectorFor`), `packages/extension/src/lib/dispatch.ts`, `packages/extension/src/lib/tab-handler.ts` (resize via `chrome.windows`), `packages/extension/src/popup.ts`/`popup.html` (hint copy only)
- Test: `packages/extension/src/lib/keys.test.ts`, `packages/extension/src/lib/page-actions.test.ts`, `packages/extension/src/lib/dispatch.test.ts`

**Interfaces produced (bridge methods):** `press_key`, `hover`, `scroll`, `fill`, `select_option`, `upload`, `read_text`, `resize`, `handle_dialog`, `cdp`.

- [ ] `keys.ts` — pure key-spec parser (unit-testable without chrome):

```ts
// CDP modifier bits: Alt=1, Ctrl=2, Meta/Command=4, Shift=8
const NAMED: Record<string, { key: string; code: string; keyCode: number }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  space: { key: " ", code: "Space", keyCode: 32 },
};
const MODS: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

export interface KeyEventSpec { key: string; code: string; keyCode: number; modifiers: number }

export function parseKeySpec(spec: string): KeyEventSpec {
  const parts = spec.split("+");
  const keyPart = parts.pop() ?? "";
  let modifiers = 0;
  for (const p of parts) {
    const bit = MODS[p.toLowerCase()];
    if (bit === undefined) throw new Error(`unknown modifier: ${p}`);
    modifiers |= bit;
  }
  const named = NAMED[keyPart.toLowerCase()];
  if (named) return { ...named, modifiers };
  if (/^[a-zA-Z]$/.test(keyPart)) {
    const upper = keyPart.toUpperCase();
    return { key: keyPart, code: `Key${upper}`, keyCode: upper.charCodeAt(0), modifiers };
  }
  if (/^[0-9]$/.test(keyPart)) {
    return { key: keyPart, code: `Digit${keyPart}`, keyCode: keyPart.charCodeAt(0), modifiers };
  }
  throw new Error(`unknown key: ${keyPart}`);
}
```

- [ ] `page-actions.ts` — handlers reusing the exported cdp.ts helpers, all `resolveTabId` + `withDebugger` wrapped:
  - `pressKey`: `Input.dispatchKeyEvent` keyDown + keyUp with `{key, code, windowsVirtualKeyCode, nativeVirtualKeyCode, modifiers}`.
  - `hover`: resolve center like `cdpClick` (scrollIntoView + rect), then `Input.dispatchMouseEvent {type:"mouseMoved", x, y}`.
  - `scroll`: single `Runtime.evaluate` expression — target el → `scrollIntoView({block:"center"})`; `by` → `window.scrollBy(dx,dy)`; `to` → `window.scrollTo(0, 0 | document.documentElement.scrollHeight)`.
  - `fill`: `Runtime.evaluate` with native value setter (React-safe) + `input`/`change` events:

```ts
const expr = `(() => {
  const el = document.querySelector(${JSON.stringify(css)});
  if (!el) return false;
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
  const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
  if (desc?.set) desc.set.call(el, ${JSON.stringify(value)});
  else if (el.isContentEditable) el.textContent = ${JSON.stringify(value)};
  else el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;
```

  - `selectOption`: evaluate — set `el.value`, verify an option matched (`el.value === value` after set, else try matching by label), dispatch `input`+`change`, return matched or throw.
  - `upload`: `DOM.getDocument {depth: 0}` → `DOM.querySelector {nodeId: root.nodeId, selector: css}` (error if `nodeId === 0`) → `DOM.setFileInputFiles {files, nodeId}`.
  - `readText`: evaluate `(document.querySelector(css) ?? never)`/`document.body` `.innerText`, truncate to `maxChars`, return `{ text }`.
  - `handleDialog`: `Page.enable` then `Page.handleJavaScriptDialog {accept, promptText}`; map the "no dialog" CDP error to `no JavaScript dialog is open on this tab`.
  - `cdpRaw`: `send(tabId, params.method, params.params)` → `{ result }` (the passthrough).
- [ ] `tab-handler.ts` — `resizeWindow({tabId, width, height})`: `chrome.tabs.get(tabId)` → `chrome.windows.update(windowId, {width, height})` → OkResult. (Window resize, not CDP emulation — emulation overrides die on debugger detach; `reins cdp Emulation.*` remains for that, noted in the skill.)
- [ ] `dispatch.ts` — add the ten cases mapping method names to handlers.
- [ ] Popup hint copy: replace `reins up` references with `reins status` / `reins allow <id>` guidance (extension auto-connects; daemon auto-spawns on first CLI use).
- [ ] Tests: keys.test (named keys, modifiers combine, letters/digits, unknown throws); page-actions.test with mocked `chrome.debugger`/`chrome.tabs` (existing harness pattern) — per handler: correct CDP commands issued, element-missing errors, dialog no-op error mapping, cdp passthrough forwards method+params verbatim; dispatch.test covers new routes.
- [ ] `pnpm --filter reins-extension test` → green. Commit: `feat(extension): press/hover/scroll/fill/select/upload/text/resize/dialog + raw cdp passthrough`

### Task 3: Daemon — /rpc + /shutdown, MCP layer deleted

**Files:**
- Create: `packages/mcp/src/rpc.ts` (moves `listAllTabs` + `route` out of create-server.ts)
- Modify: `packages/mcp/src/daemon.ts`, `packages/mcp/src/serve.ts` (drop stdio mode), `packages/mcp/package.json` (drop `@modelcontextprotocol/sdk`)
- Delete: `packages/mcp/src/create-server.ts`, `packages/mcp/src/create-server.test.ts`
- Test: `packages/mcp/src/daemon.test.ts` (rewrite), `packages/mcp/src/rpc.ts` tests, `packages/mcp/src/integration.test.ts` (rework to /rpc)

**Interfaces produced:**
- `POST /rpc` body `{method: string, params?: object}` → `200 {result}` | `400 {error}` | `502 {error}`.
- `POST /shutdown` → `200 {ok: true}` then clean daemon close (via `startDaemon` opts `onShutdown?: () => void`).
- `handleRpc(bridge: BridgeHost, body: unknown): Promise<unknown>` in rpc.ts.

- [ ] `rpc.ts`:

```ts
const RpcBody = z.object({
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

export async function handleRpc(bridge: BridgeHost, body: unknown): Promise<unknown> {
  const { method, params: raw } = RpcBody.parse(body);
  const { browserId, params } = route(raw ?? {});
  if (method === "list_tabs") return { tabs: await listAllTabs(bridge, browserId) };
  return bridge.request(method, params, { browserId });
}
```

  `RpcBody.parse` failures → daemon replies 400; bridge/tool errors → 502.
- [ ] `daemon.ts`: remove `/mcp`, sessions, SDK imports; add `/rpc` (read body, 1 MB cap, JSON parse) and `/shutdown` (reply, then `setImmediate(opts.onShutdown)`); keep `/health`; drop `/browsers` and `/tabs`.
- [ ] `serve.ts`: drop the `--stdio` branch and `createServer`/`StdioServerTransport` imports; rename `runServe` → `runDaemon` (singleton guard lands in Task 4).
- [ ] Remove `@modelcontextprotocol/sdk` from package.json + lockfile (`pnpm install`).
- [ ] Tests: rpc happy path via fake bridge; list_tabs aggregation/tagging (port the relevant create-server tests); browserId split; malformed body → 400; unknown method bubbles as 502; forged-Host 403 on `/rpc` and `/shutdown` (raw http, `setHost: false`); `/shutdown` triggers onShutdown; 404s for removed routes.
- [ ] `pnpm --filter @karnstack/reins test` → green. Commit: `feat(daemon)!: replace MCP endpoint with /rpc + /shutdown, drop MCP SDK`

### Task 4: Lazy spawn + singleton guard

**Files:**
- Create: `packages/mcp/src/ensure.ts`
- Modify: `packages/mcp/src/serve.ts` (singleton guard), `packages/mcp/src/cli-commands.ts` (move `DaemonHealth` type here if not already)
- Test: `packages/mcp/src/ensure.test.ts`, serve guard test

**Interfaces produced:**
- `findDaemon(cfg): Promise<{port, health} | undefined>` (moved from cli.ts, exported)
- `ensureDaemon(cfg, opts?: {spawnDaemon?: () => void, pollMs?, timeoutMs?}): Promise<{port, health, spawned: boolean}>`
- `waitForBrowsers(port, {timeoutMs, pollMs}): Promise<DaemonHealth>` (rejects with extension hint on timeout)
- `cliJsPath(): string` (from service.ts, moved here before service.ts dies)

- [ ] `ensure.ts`: probe → absent: `spawn(process.execPath, [cliJsPath(), "daemon"], { detached: true, stdio: "ignore", windowsHide: true }).unref()` → poll `findDaemon` every 150 ms up to 4 s → error `daemon failed to start — check \`reins logs\``.
- [ ] Singleton guard in `runDaemon` (after bind + recordPort): probe all candidate ports except own; any live daemon on a **lower** port → log `another reins daemon owns port <p> — exiting` → `daemon.close()` → exit 0.
- [ ] Tests with injected fakes (fake probe results, spy spawn): running daemon → no spawn; absent → spawn + poll resolves; spawn but never healthy → error; guard: lower-port peer → exit path taken, higher-port peer → keep running.
- [ ] Commit: `feat(cli): lazy daemon spawn + lower-port-wins singleton guard`

### Task 5: CLI surface

**Files:**
- Create: `packages/mcp/src/args.ts` (flag parser), `packages/mcp/src/commands.ts` (command table: rpc param builders + result formatters)
- Modify: `packages/mcp/src/cli.ts` (rewrite), `packages/mcp/src/cli-commands.ts` (drop install/codex/claude/mcpJson snippets + `installText`; keep health/browsers/tabs/doctor/logs text, update `helpText` + `doctorReport` for the new world)
- Delete: `packages/mcp/src/service.ts`, `packages/mcp/src/service.test.ts`
- Test: `packages/mcp/src/args.test.ts`, `packages/mcp/src/commands.test.ts`, updated `cli-commands.test.ts`

**Interfaces produced:**
- `parseArgs(argv, spec: {booleans?: string[], multi?: string[]}): {positional: string[], flags: Record<string, string | true | string[]>}` — supports `--k v`, `--k=v`, boolean flags, repeated multi flags.
- `TOOL_COMMANDS: Record<string, {method, usage, build(parsed): object, format(result, parsed): string}>` — pure, unit-tested; `build` throws usage errors on missing required flags; shared flags `--browser`, `--tab`, `--json` handled by the runner.

Command map (spec table is authoritative): `tabs`→list_tabs, `open`→open_tab (`--background`→`activate:false`), `close`, `focus`→select_tab, `nav`→navigate, `snapshot`, `click` (`--button`, `--count`), `type` (`--enter`→submit), `press`, `hover`, `scroll` (`--by "dx,dy"` parsed to `{dx,dy}`, `--to`), `fill`, `select`→select_option, `upload` (repeat `--file`, resolved absolute), `text`→read_text, `screenshot` (base64 → file → prints path; default `~/.reins/shots/shot-<ISO>.png`), `eval` (positional expression, `--await`), `wait`, `console` (`--since`, repeat `--level`), `network` (`--since`, `--url`), `resize`, `dialog` (`--accept`/`--dismiss`, `--text`), `cdp` (positional method + optional positional JSON params).

- [ ] Runner in cli.ts for tool commands: `parseArgs` → `ensureDaemon` → if `spawned`, `waitForBrowsers(port, {timeoutMs: 15_000})`, else fail fast when `health.browsers.length === 0` with `no browser connected — is the reins extension installed? (reins status)` → `POST /rpc` → `--json` ? raw JSON : `format(...)` → exit 0/1.
- [ ] Management commands kept/adjusted: `browsers`, `status`, `doctor` (drop service checks; add extension-connected + rpc-reachable checks), `logs`, `allow`, `daemon` (foreground `runDaemon`), new `kill` (findDaemon → `POST /shutdown`; "no daemon running" otherwise), `version`, `help`. `up`/`down`/`restart`/`serve`/`install` removed.
- [ ] `helpText`: tool commands grouped (tabs/pages, interaction, reading, advanced: eval/cdp/daemon), management group; every line shows canonical usage.
- [ ] Tests: args parser matrix; every command's `build` (happy + missing-flag error) and `format`; screenshot path logic (`--out` override); scroll `--by` parse; upload path absolutization; kill/doctor text.
- [ ] Full package green: `pnpm --filter @karnstack/reins test`. Commit: `feat(cli)!: full tool surface (23 commands), service management removed`

### Task 6: Rename packages/mcp → packages/cli + log filename

**Files:**
- Rename: `git mv packages/mcp packages/cli`
- Modify: root `package.json` (scripts `mcp`→`daemon`, filters unchanged — pnpm filters by package name), `.github/workflows/release.yml` + `ci.yml` (any `packages/mcp` paths), `packages/cli/src/log.ts` (`daemon-<day>.log`), `packages/cli/tsdown.config.ts` if it references paths

- [ ] `git mv`, then grep the repo for `packages/mcp` and fix every hit (workflows, docs get rewritten in Task 8 anyway but fix paths now if referenced by CI).
- [ ] `log.ts`: `logFilePath` → `daemon-${day}.log`; check `logsInfo` glob still matches.
- [ ] Root scripts: `"daemon": "pnpm --filter @karnstack/reins build && node packages/cli/dist/cli.js daemon"`, `"reins"` path updated.
- [ ] `pnpm install && pnpm build && pnpm test` all green. Commit: `refactor: rename packages/mcp → packages/cli (daemon-<date>.log)`

### Task 7: Skill

**Files:**
- Create: `skills/reins/SKILL.md`

- [ ] Frontmatter exactly:

```yaml
---
name: reins
description: Control the user's real, logged-in browser from the shell — list tabs, click, type, screenshot, read pages, run JS and raw CDP — via the reins CLI. Use when asked to interact with, test, or scrape a live webpage in the user's browser.
---
```

- [ ] Body sections (lean): Check setup (`reins status`; install hint `npm i -g @karnstack/reins` + extension); Core loop (`tabs` → `snapshot` → act via `--ref` → verify via `text`/`screenshot`); Command reference (grouped, one line each, matching `reins help`); Targeting (`--tab`, `--browser` from `tabs` output, ambiguity error explanation); Reading pages (`text` vs `snapshot` vs `screenshot` — screenshot prints a file path to Read); Escape hatches (`eval`, `cdp` with one example each; note emulation overrides reset when the debugger detaches); Gotchas (dialogs block JS → `reins dialog`; `reins allow <id>` for dev builds; `reins doctor`/`logs`).
- [ ] Sanity: `npx skills add ./ --list` from repo root discovers `reins` (or verify layout matches `skills/<name>/SKILL.md` convention if the command needs a git URL).
- [ ] Commit: `feat(skill): skills.sh-installable reins skill`

### Task 8: Docs + local MCP deregistration

**Files:**
- Modify: `README.md`, `docs/RUNNING.md`, `docs/PUBLISHING.md`, `docs/PRIVACY.md`, `packages/cli/README.md`

- [ ] README: pitch "browser skill for any agent"; new diagram (shell → CLI → /rpc → WS → extension); install = npm i -g + npx skills add + extension; command table replaces tool table; security section unchanged claims minus MCP wording.
- [ ] RUNNING: from-source flow — build, load unpacked, `pnpm reins allow <id>`, `pnpm reins tabs` (auto-spawn covers daemon start), foreground `pnpm daemon` for debugging.
- [ ] PUBLISHING: npm + store sections stay; MCP wording out; add skills.sh note (repo layout is the registration; installable once public).
- [ ] PRIVACY: "local MCP daemon" → "local daemon installed by the reins CLI"; storage/permissions text unchanged otherwise.
- [ ] `packages/cli/README.md`: npm-facing rewrite (setup, command list, multi-browser, security).
- [ ] This machine: `claude mcp remove reins` (registration points at a dead endpoint now).
- [ ] Commit: `docs: CLI-first era — README/RUNNING/PUBLISHING/PRIVACY + package README`

### Task 9: Verification sweep + live smoke

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm zip` — all green.
- [ ] Tarball smoke: `cd packages/cli && npm pack` → install into a temp prefix → `reins --version`, `reins help`, `reins status` (no workspace deps leaked).
- [ ] Live smoke on this machine: stop any old 0.2.0 daemon squatting a candidate port (`lsof -nP -iTCP:8765-8774 -sTCP:LISTEN`), then `node packages/cli/dist/cli.js status` → auto-spawn observed → `reins kill` works → logs written to `~/.reins/logs/daemon-<date>.log`.
- [ ] Push: `git push origin main`.

## Manual follow-ups (human)

- Reload the unpacked extension; `reins allow <dev-id>`; drive a real tab (`reins tabs` → `snapshot` → `click`).
- After first Chrome Web Store publish: fill `PUBLISHED_EXTENSION_IDS` (unchanged from daemon plan).
- `npx skills add karnstack/reins` once the repo is public.
