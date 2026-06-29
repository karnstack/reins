# reins M2-core — CDP Driving Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the core browser-driving tools — `navigate`, `read_snapshot` (with element refs), `click`, `type` — across protocol schemas, MCP-server tools, and the extension's `chrome.debugger` (CDP) handlers, so an agent can navigate and act on pages (not just list tabs).

**Architecture:** Same bridge as M1: the MCP server registers each tool and forwards `bridge.request(method, params)`; the extension's `dispatchMethod` routes the method to a `chrome.debugger` (CDP) handler. **Node-verifiable:** protocol schemas, MCP tool registration/result-validation (vs a fake bridge), and the dispatch routing table. **Browser-only (verified by loading the extension):** the actual `chrome.debugger` CDP execution.

**Tech Stack:** TypeScript 6.0.3, zod 4.4.3, @modelcontextprotocol/sdk 1.29.0, @types/chrome 0.2.0, vitest 4.1.9. Node 24.18.0 / pnpm 11.9.0 via mise.

## Global Constraints

- Exact versions; ESM (`.js` intra-repo imports); run tooling via `mise exec --`.
- Branch `feat/m2-core`. **Per-task gate (run all before commit):** `pnpm lint`, `pnpm typecheck`, `pnpm --filter <pkg> test` (or full `pnpm test`), `pnpm build` — all exit 0. Scoped `// biome-ignore` only.
- New wire methods + their param/result shapes live in `@reins/protocol` (single source of truth, reused as MCP input schemas via `Schema.shape`).
- Tool result formatting: `read_snapshot` → text content + a refs list; `navigate` → the resulting URL; `click`/`type` → `ok`. When `!bridge.paired`, every tool returns an `isError` result (as `list_tabs` does).
- The extension's `chrome.debugger` handlers cannot be verified in CI — write them carefully; their dispatch ROUTING is unit-tested, their CDP execution is browser-verified.

---

### Task 1: Protocol schemas for the driving tools

**Files:**
- Create: `packages/protocol/src/cdp.ts`, `packages/protocol/src/cdp.test.ts`
- Modify: `packages/protocol/src/index.ts` (add `export * from "./cdp.js"`)

**Interfaces:**
- Produces: `NavigateParams`/`NavigateResult`, `SnapshotParams`/`SnapshotResult` (+`SnapshotRef`), `ClickParams`, `TypeParams`, `OkResult` (zod schemas + inferred types). Each params schema is reused as an MCP input shape via `.shape` in Task 2; the extension validates against these in Task 3.

- [ ] **Step 1: Write the failing test** — `packages/protocol/src/cdp.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ClickParams, NavigateParams, OkResult, SnapshotParams, SnapshotResult, TypeParams } from "./cdp.js";

describe("cdp schemas", () => {
  it("navigate params require a destination", () => {
    expect(NavigateParams.parse({ to: "https://x" }).to).toBe("https://x");
    expect(() => NavigateParams.parse({})).toThrow();
  });

  it("snapshot params default mode to a11y", () => {
    expect(SnapshotParams.parse({}).mode).toBe("a11y");
    expect(SnapshotParams.parse({ mode: "dom" }).mode).toBe("dom");
    expect(() => SnapshotParams.parse({ mode: "bogus" })).toThrow();
  });

  it("snapshot result carries content + refs", () => {
    const r = SnapshotResult.parse({ content: "tree", refs: [{ ref: "e1", role: "button", name: "OK" }] });
    expect(r.refs[0]?.ref).toBe("e1");
  });

  it("click defaults button=left and clickCount=1", () => {
    const c = ClickParams.parse({ ref: "e1" });
    expect(c.button).toBe("left");
    expect(c.clickCount).toBe(1);
  });

  it("type requires text and defaults submit=false", () => {
    expect(TypeParams.parse({ ref: "e1", text: "hi" }).submit).toBe(false);
    expect(() => TypeParams.parse({ ref: "e1" })).toThrow();
  });

  it("OkResult accepts { ok: true }", () => {
    expect(OkResult.parse({ ok: true }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter @reins/protocol test cdp`
Expected: FAIL — cannot resolve `./cdp.js`.

- [ ] **Step 3: Write the implementation** — `packages/protocol/src/cdp.ts`

```ts
import { z } from "zod";

/** Optional target tab; defaults (server/extension side) to the active tab. */
const tabId = z.number().optional();

export const NavigateParams = z.object({
  tabId,
  /** A URL, or one of "back" | "forward" | "reload". */
  to: z.string().min(1),
});
export type NavigateParams = z.infer<typeof NavigateParams>;

export const NavigateResult = z.object({ url: z.string() });
export type NavigateResult = z.infer<typeof NavigateResult>;

export const SnapshotParams = z.object({
  tabId,
  mode: z.enum(["text", "a11y", "dom"]).default("a11y"),
  maxChars: z.number().optional(),
});
export type SnapshotParams = z.infer<typeof SnapshotParams>;

export const SnapshotRef = z.object({
  ref: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
});
export type SnapshotRef = z.infer<typeof SnapshotRef>;

export const SnapshotResult = z.object({
  content: z.string(),
  refs: z.array(SnapshotRef),
});
export type SnapshotResult = z.infer<typeof SnapshotResult>;

export const ClickParams = z
  .object({
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    button: z.enum(["left", "right", "middle"]).default("left"),
    clickCount: z.number().int().min(1).default(1),
  })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "click requires a ref or a selector",
  });
export type ClickParams = z.infer<typeof ClickParams>;

export const TypeParams = z
  .object({
    tabId,
    ref: z.string().optional(),
    selector: z.string().optional(),
    text: z.string(),
    submit: z.boolean().default(false),
  })
  .refine((v) => v.ref !== undefined || v.selector !== undefined, {
    message: "type requires a ref or a selector",
  });
export type TypeParams = z.infer<typeof TypeParams>;

export const OkResult = z.object({ ok: z.literal(true) });
export type OkResult = z.infer<typeof OkResult>;
```

Note: `ClickParams`/`TypeParams` use `.refine`, so they are `ZodEffects`, not `ZodObject`. Task 2 needs raw shapes for MCP input — export the inner objects too. Add ABOVE the refined versions:

```ts
export const ClickShape = {
  tabId,
  ref: z.string().optional(),
  selector: z.string().optional(),
  button: z.enum(["left", "right", "middle"]).default("left"),
  clickCount: z.number().int().min(1).default(1),
} as const;

export const TypeShape = {
  tabId,
  ref: z.string().optional(),
  selector: z.string().optional(),
  text: z.string(),
  submit: z.boolean().default(false),
} as const;
```
and define `ClickParams = z.object(ClickShape).refine(...)`, `TypeParams = z.object(TypeShape).refine(...)` to avoid duplicating the field list.

- [ ] **Step 4: Update the barrel** — add to `packages/protocol/src/index.ts`:

```ts
export * from "./cdp.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `mise exec -- pnpm --filter @reins/protocol test cdp`
Expected: PASS — 6 tests.

- [ ] **Step 6: Build + typecheck**

Run: `mise exec -- pnpm --filter @reins/protocol build && mise exec -- pnpm --filter @reins/protocol typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(protocol): CDP driving-tool schemas (navigate/snapshot/click/type)"
```

---

### Task 2: MCP-server tools (navigate, read_snapshot, click, type)

**Files:**
- Modify: `packages/mcp/src/create-server.ts` (register the 4 tools)
- Modify: `packages/mcp/src/create-server.test.ts` (add tests against the fake bridge)

**Interfaces:**
- Consumes: `BridgePort` (existing), the Task 1 schemas from `@reins/protocol`.
- Produces: 4 new MCP tools that forward to `bridge.request(name, params)`, validate the result with the Task 1 result schema, and format it.

- [ ] **Step 1: Update the test** — add to `packages/mcp/src/create-server.test.ts` (keep existing ping/list_tabs tests; reuse the `fakeBridge`/`connect` helpers):

```ts
  it("navigate returns the resulting url", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ url: "https://example.com/" }) }));
    const result = await client.callTool({ name: "navigate", arguments: { to: "https://example.com" } });
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    expect(first!.text).toContain("https://example.com/");
    await client.close();
  });

  it("read_snapshot returns content and refs", async () => {
    const snap = { content: "button \"OK\" [e1]", refs: [{ ref: "e1", role: "button", name: "OK" }] };
    const client = await connect(fakeBridge({ request: async () => snap }));
    const result = await client.callTool({ name: "read_snapshot", arguments: { mode: "a11y" } });
    const first = (result.content as Array<{ type: string; text?: string }>)[0];
    // biome-ignore lint/style/noNonNullAssertion: tool result always has >=1 content item
    expect(first!.text).toContain("e1");
    await client.close();
  });

  it("click returns ok", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ ok: true }) }));
    const result = await client.callTool({ name: "click", arguments: { ref: "e1" } });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("type returns ok", async () => {
    const client = await connect(fakeBridge({ request: async () => ({ ok: true }) }));
    const result = await client.callTool({ name: "type", arguments: { ref: "e1", text: "hello" } });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("driving tools error when not paired", async () => {
    const client = await connect(fakeBridge({ paired: false }));
    const result = await client.callTool({ name: "navigate", arguments: { to: "https://x" } });
    expect(result.isError).toBe(true);
    await client.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec -- pnpm --filter reins-mcp test create-server`
Expected: FAIL — `navigate`/`read_snapshot`/`click`/`type` tools not registered.

- [ ] **Step 3: Update the implementation** — `packages/mcp/src/create-server.ts`

Add imports:
```ts
import {
  ClickShape,
  ListTabsResult,
  NavigateParams,
  NavigateResult,
  OkResult,
  SnapshotParams,
  SnapshotResult,
  TypeShape,
} from "@reins/protocol";
```

Add a small helper inside the module (above `createServer`):
```ts
const notConnected = {
  isError: true as const,
  content: [{ type: "text" as const, text: "No browser connected. Run `reins pair` and connect the extension." }],
};
```

Register the tools inside `createServer`, after `list_tabs`:
```ts
  server.registerTool(
    "navigate",
    {
      description: "Navigate the tab to a URL, or 'back' | 'forward' | 'reload'.",
      inputSchema: NavigateParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const { url } = NavigateResult.parse(await bridge.request("navigate", args));
      return { content: [{ type: "text", text: `Navigated to ${url}` }] };
    },
  );

  server.registerTool(
    "read_snapshot",
    {
      description: "Snapshot the page (text | a11y | dom). Returns content plus element refs for click/type.",
      inputSchema: SnapshotParams.shape,
    },
    async (args) => {
      if (!bridge.paired) return notConnected;
      const snap = SnapshotResult.parse(await bridge.request("read_snapshot", args));
      const refs = snap.refs.map((r) => `${r.ref}: ${r.role ?? ""} ${r.name ?? ""}`.trim()).join("\n");
      return { content: [{ type: "text", text: `${snap.content}\n\n--- refs ---\n${refs}` }] };
    },
  );

  server.registerTool(
    "click",
    { description: "Click an element by ref (from read_snapshot) or CSS selector.", inputSchema: ClickShape },
    async (args) => {
      if (!bridge.paired) return notConnected;
      OkResult.parse(await bridge.request("click", args));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );

  server.registerTool(
    "type",
    { description: "Type text into an element by ref or CSS selector; set submit to press Enter.", inputSchema: TypeShape },
    async (args) => {
      if (!bridge.paired) return notConnected;
      OkResult.parse(await bridge.request("type", args));
      return { content: [{ type: "text", text: "ok" }] };
    },
  );
```

(Refactor the existing `list_tabs` not-paired branch to reuse `notConnected` for DRY.)

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec -- pnpm --filter reins-mcp test create-server`
Expected: PASS — existing + 5 new.

- [ ] **Step 5: Gate + commit**

Run: `mise exec -- pnpm lint && mise exec -- pnpm typecheck && mise exec -- pnpm --filter reins-mcp test && mise exec -- pnpm build`

```bash
git add -A
git commit -m "feat(mcp): navigate/read_snapshot/click/type tools (forward to bridge)"
```

---

### Task 3: Extension CDP handlers + dispatch routing

**Files:**
- Create: `packages/extension/src/lib/cdp.ts` (chrome.debugger attach helper + the 4 handlers)
- Modify: `packages/extension/src/lib/dispatch.ts` (route the new methods)
- Modify: `packages/extension/src/lib/dispatch.test.ts` (assert routing for the new methods)

**Interfaces:**
- Consumes: `chrome.debugger`, `chrome.tabs`, Task 1 schemas.
- Produces: `dispatchMethod` routing `navigate`/`read_snapshot`/`click`/`type` to CDP handlers; handlers are browser-verified.

> The `chrome.debugger` execution CANNOT be verified headless. The dispatch ROUTING is unit-tested by stubbing the cdp handler module.

- [ ] **Step 1: Write the cdp handlers** — `packages/extension/src/lib/cdp.ts`

```ts
import type { NavigateParams, ClickParams, SnapshotParams, TypeParams } from "@reins/protocol";

const PROTOCOL = "1.3";

async function resolveTabId(tabId?: number): Promise<number> {
  if (typeof tabId === "number") return tabId;
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id === undefined) throw new Error("no active tab");
  return active.id;
}

async function withDebugger<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  await chrome.debugger.attach({ tabId }, PROTOCOL);
  try {
    return await fn();
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

function send<T = unknown>(tabId: number, method: string, params?: object): Promise<T> {
  return chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;
}

export async function cdpNavigate(params: NavigateParams): Promise<{ url: string }> {
  const tabId = await resolveTabId(params.tabId);
  return withDebugger(tabId, async () => {
    if (params.to === "reload") {
      await send(tabId, "Page.reload", {});
    } else if (params.to === "back" || params.to === "forward") {
      await send(tabId, "Runtime.evaluate", { expression: `history.${params.to}()` });
    } else {
      await send(tabId, "Page.navigate", { url: params.to });
    }
    const { result } = await send<{ result: { value: string } }>(tabId, "Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    return { url: result.value };
  });
}

/** Tag interactive/labelled elements with data-reins-ref and return a compact tree + refs. */
const SNAPSHOT_EXPR = `(() => {
  const refs = [];
  let n = 0;
  const sel = "a,button,input,textarea,select,[role],h1,h2,h3,[contenteditable=true]";
  for (const el of document.querySelectorAll(sel)) {
    if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
    const ref = "e" + (++n);
    el.setAttribute("data-reins-ref", ref);
    const role = el.getAttribute("role") || el.tagName.toLowerCase();
    const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 80);
    refs.push({ ref, role, name });
  }
  const text = refs.map(r => r.ref + ": " + r.role + " " + JSON.stringify(r.name)).join("\\n");
  return { content: text, refs };
})()`;

export async function cdpSnapshot(params: SnapshotParams): Promise<{ content: string; refs: Array<{ ref: string; role?: string; name?: string }> }> {
  const tabId = await resolveTabId(params.tabId);
  return withDebugger(tabId, async () => {
    const { result } = await send<{ result: { value: { content: string; refs: Array<{ ref: string; role?: string; name?: string }> } } }>(
      tabId,
      "Runtime.evaluate",
      { expression: SNAPSHOT_EXPR, returnByValue: true },
    );
    const value = result.value;
    const content = params.maxChars ? value.content.slice(0, params.maxChars) : value.content;
    return { content, refs: value.refs };
  });
}

function selectorFor(ref?: string, selector?: string): string {
  if (selector) return selector;
  if (ref) return `[data-reins-ref="${ref}"]`;
  throw new Error("click/type requires a ref or selector");
}

export async function cdpClick(params: ClickParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return withDebugger(tabId, async () => {
    // Resolve element center, then dispatch a trusted click there.
    const { result } = await send<{ result: { value: { x: number; y: number } | null } }>(tabId, "Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return null; const r = el.getBoundingClientRect(); el.scrollIntoView({block:"center"}); const r2 = el.getBoundingClientRect(); return { x: r2.x + r2.width/2, y: r2.y + r2.height/2 }; })()`,
      returnByValue: true,
    });
    if (!result.value) throw new Error(`element not found: ${css}`);
    const { x, y } = result.value;
    const base = { x, y, button: params.button, clickCount: params.clickCount };
    await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
    return { ok: true };
  });
}

export async function cdpType(params: TypeParams): Promise<{ ok: true }> {
  const tabId = await resolveTabId(params.tabId);
  const css = selectorFor(params.ref, params.selector);
  return withDebugger(tabId, async () => {
    const { result } = await send<{ result: { value: boolean } }>(tabId, "Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return false; el.focus(); return true; })()`,
      returnByValue: true,
    });
    if (!result.value) throw new Error(`element not found: ${css}`);
    await send(tabId, "Input.insertText", { text: params.text });
    if (params.submit) {
      for (const type of ["keyDown", "keyUp"]) {
        await send(tabId, "Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      }
    }
    return { ok: true };
  });
}
```

- [ ] **Step 2: Route the methods + keep routing testable** — `packages/extension/src/lib/dispatch.ts`

```ts
import { cdpClick, cdpNavigate, cdpSnapshot, cdpType } from "./cdp.js";
import { listTabs } from "./tab-handler.js";

export async function dispatchMethod(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "list_tabs":
      return listTabs();
    case "navigate":
      return cdpNavigate(params as Parameters<typeof cdpNavigate>[0]);
    case "read_snapshot":
      return cdpSnapshot(params as Parameters<typeof cdpSnapshot>[0]);
    case "click":
      return cdpClick(params as Parameters<typeof cdpClick>[0]);
    case "type":
      return cdpType(params as Parameters<typeof cdpType>[0]);
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
```

- [ ] **Step 3: Update routing test** — add to `packages/extension/src/lib/dispatch.test.ts`, mocking `./cdp.js` so routing is verified without a browser:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./cdp.js", () => ({
  cdpNavigate: vi.fn(async () => ({ url: "https://x/" })),
  cdpSnapshot: vi.fn(async () => ({ content: "", refs: [] })),
  cdpClick: vi.fn(async () => ({ ok: true })),
  cdpType: vi.fn(async () => ({ ok: true })),
}));

// ...existing list_tabs + unknown-method tests...

describe("dispatchMethod routing (CDP)", () => {
  it("routes navigate to cdpNavigate", async () => {
    const { dispatchMethod } = await import("./dispatch.js");
    expect(await dispatchMethod("navigate", { to: "https://x" })).toEqual({ url: "https://x/" });
  });
  it("routes click/type/read_snapshot", async () => {
    const { dispatchMethod } = await import("./dispatch.js");
    expect(await dispatchMethod("click", { ref: "e1" })).toEqual({ ok: true });
    expect(await dispatchMethod("type", { ref: "e1", text: "hi" })).toEqual({ ok: true });
    expect(await dispatchMethod("read_snapshot", {})).toEqual({ content: "", refs: [] });
  });
});
```

(Keep the existing `list_tabs`/unknown tests; they may need the chrome.tabs stub as before. Ensure `vi.mock` for `./cdp.js` doesn't break the existing `list_tabs` test — `list_tabs` routes to `listTabs` (not mocked), which still uses the chrome.tabs stub.)

- [ ] **Step 4: Run tests**

Run: `mise exec -- pnpm --filter @reins/extension test dispatch`
Expected: PASS — list_tabs, unknown, + the 4 CDP routing cases.

- [ ] **Step 5: Gate + commit**

Run: `mise exec -- pnpm lint && mise exec -- pnpm typecheck && mise exec -- pnpm test && mise exec -- pnpm build`
Expected: all exit 0; build still emits the extension (offscreen.html etc.).

```bash
git add -A
git commit -m "feat(extension): chrome.debugger CDP handlers + dispatch routing (navigate/snapshot/click/type)"
```

---

## Self-Review

**1. Spec coverage (design §5 tools, §11.3 M2 core driving):** `navigate` (Task 1 schema, Task 2 tool, Task 3 `cdpNavigate`); `read_snapshot` w/ refs (Task 1 `SnapshotResult.refs`, Task 2 formatting, Task 3 `cdpSnapshot` tags `data-reins-ref`); `click` by ref/selector (Tasks 1/2/3, `data-reins-ref` resolution + trusted Input events); `type` w/ submit (Tasks 1/2/3). `screenshot`/`wait_for`/`eval_js`/`read_console`/`read_network` are M3 (power tools), out of scope.

**2. Placeholder scan:** none. Node-verifiable layers (protocol, MCP tools, routing) have complete code + tests; CDP execution is complete code, browser-verified (explicitly flagged).

**3. Type consistency:** `NavigateParams/Result`, `SnapshotParams/Result/Ref`, `ClickShape/ClickParams`, `TypeShape/TypeParams`, `OkResult` defined in Task 1 and consumed by name in Tasks 2/3. MCP input uses `.shape`/`*Shape`; the `.refine`'d Click/Type export `*Shape` raw objects for MCP and the refined schema for validation. Wire method names (`navigate`/`read_snapshot`/`click`/`type`) identical across server tool names, `bridge.request` calls, and the extension `dispatchMethod` switch.

## Notes for M2 verification (browser) + M3
- Browser verification: load the rebuilt extension, pair, then have the agent `navigate` → `read_snapshot` → `click {ref}` / `type {ref,text}`. The `chrome.debugger` attach shows the automation banner (expected).
- `read_snapshot` uses `Runtime.evaluate` DOM tagging (pragmatic) rather than the CDP Accessibility tree; revisit if a11y fidelity matters.
- M3 power tools: `screenshot` (Page.captureScreenshot → MCP image), `wait_for`, `eval_js`, `read_console`/`read_network` (ring buffers via CDP events — needs the debugger to stay attached, a design shift from M2's attach-per-call).
