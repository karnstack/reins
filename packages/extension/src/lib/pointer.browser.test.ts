/**
 * Real-browser tests for pointer/key input. The unit tests stub the page; the
 * page-side actionability logic (scroll settling, hit-testing, the pointer
 * probe) only means something against real layout, so these drive a headless
 * Chrome: `chrome.debugger.sendCommand` is forwarded over CDP, and the actual
 * cdpClick / hover / pressKey run end to end.
 *
 * Skipped when no Chrome binary is found (set REINS_TEST_CHROME to point at one).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

vi.mock("./monitor.js", () => ({ isMonitored: () => false }));

import { autofillGuard } from "./autofill-guard.js";
import { __resetDebugSessions, cdpClick, cdpType } from "./cdp.js";
import { handleDialog, hover, pressKey } from "./page-actions.js";

const CHROME = [
  process.env.REINS_TEST_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p): p is string => !!p && existsSync(p));

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html { scroll-behavior: smooth }
  body { margin: 0; font: 14px sans-serif }
  header { position: sticky; top: 0; height: 60px; background: #ccc; z-index: 10 }
  .spacer { height: 1500px }
  #scroller { height: 200px; overflow: auto; scroll-behavior: smooth }
  .slide { animation: slide .6s ease-out }
  @keyframes slide { from { transform: translateY(300px) } to { transform: none } }
  #pulse { animation: pulse 1s infinite }
  @keyframes pulse { 50% { transform: scale(1.1) } }
</style></head><body>
<header>sticky</header>
<button id="top">top</button>
<button id="other">other</button>
<button id="zero" style="width:0;height:0;padding:0;border:0"></button>
<button id="off" disabled>disabled</button>
<button id="pulse">pulsing</button>
<iframe id="frame" style="width:200px;height:60px;border:0"
  srcdoc="<body style='margin:0'><button id=framed style='width:200px;height:60px' onclick='parent.__log.push(&quot;framed&quot;)'>in frame</button></body>"></iframe>
<div class="spacer"></div>
<button id="below">below the fold</button>
<div id="scroller"><div style="height:800px"></div><button id="inner">in scroller</button></div>
<div style="position:relative"><button id="covered">covered</button>
  <div id="overlay" style="position:absolute;inset:0"></div></div>
<button id="anim">animating</button>
<div id="host" style="display:inline-block"></div>
<form id="form"><input id="field"><button id="submit">submit</button></form>
<div class="spacer"></div>
<script>
  window.__log = [];
  document.addEventListener("click", (e) => __log.push("click:" + (e.composedPath()[0].id || e.composedPath()[0].tagName)), true);
  document.getElementById("form").addEventListener("submit", (e) => { e.preventDefault(); __log.push("submit"); });
  const root = document.getElementById("host").attachShadow({ mode: "open" });
  root.innerHTML = '<button id="shadowbtn">in shadow</button>';
</script></body></html>`;

const LOGIN_FIXTURE = `<!doctype html><html><body>
<com-1password-menu></com-1password-menu><input id="user" autofocus>
</body></html>`;

let chromeProc: ChildProcess | undefined;
const injected: string[] = [];
let server: http.Server | undefined;
let profile: string | undefined;
let ws: WebSocket | undefined;
let url = "";
let nextId = 0;
const pending = new Map<number, (msg: { result?: unknown; error?: { message: string } }) => void>();

function cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result as T),
    );
    ws?.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate<T>(expression: string): Promise<T> {
  const res = await cdp<{ result: { value: T } }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res.result.value;
}

/** Fresh fixture per test; resolves once the page has loaded. */
async function load(): Promise<void> {
  await cdp("Page.navigate", { url });
  for (let i = 0; i < 100; i++) {
    if ((await evaluate<string>("document.readyState").catch(() => "")) === "complete") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("fixture did not load");
}

const log = () => evaluate<string[]>("window.__log");

describe.skipIf(!CHROME)("pointer + key input in a real browser", () => {
  beforeAll(async () => {
    server = http.createServer((q, s) => {
      s.setHeader("content-type", "text/html");
      // A login-style page whose password-manager host exists from first parse.
      s.end(q.url === "/login" ? LOGIN_FIXTURE : FIXTURE);
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    profile = mkdtempSync(join(tmpdir(), "reins-pointer-"));
    const proc = spawn(
      CHROME as string,
      [
        "--headless=new",
        "--no-sandbox",
        "--no-first-run",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--window-size=1000,700",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    chromeProc = proc;
    const port = await new Promise<string>((resolve, reject) => {
      let buf = "";
      proc.stderr?.on("data", (d: Buffer) => {
        buf += d.toString();
        const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
        if (m?.[1]) resolve(m[1]);
      });
      proc.on("exit", () => reject(new Error(`chrome exited: ${buf}`)));
    });
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const target = targets.find((t) => t.type === "page");
    if (!target) throw new Error("no page target");
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    ws = sock;
    sock.on("message", (data) => {
      const msg = JSON.parse(String(data));
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    });
    await new Promise((r) => sock.once("open", r));

    // The extension's view of the world, forwarded to the headless browser.
    vi.stubGlobal("chrome", {
      debugger: {
        attach: async () => {},
        detach: async () => {},
        onDetach: { addListener: () => {} },
        sendCommand: async (_target: unknown, method: string, params?: Record<string, unknown>) => {
          const result = await cdp(method, params);
          // One real page serves every test: remember injected scripts so
          // afterEach can drop them, as a fresh debugger session would.
          if (method === "Page.addScriptToEvaluateOnNewDocument") {
            injected.push((result as { identifier: string }).identifier);
          }
          return result;
        },
      },
      tabs: { update: async () => ({}) },
    });
  }, 20_000);

  afterEach(async () => {
    __resetDebugSessions();
    for (const identifier of injected.splice(0)) {
      await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    ws?.close();
    chromeProc?.kill();
    server?.close();
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  });

  const click = (selector: string) =>
    cdpClick({ tabId: 1, selector, button: "left", clickCount: 1 });

  it("clicks an element in view", async () => {
    await load();
    await click("#top");
    expect(await log()).toEqual(["click:top"]);
  });

  it("clicks with the params exactly as the CLI sends them (no button, no count)", async () => {
    await load();
    await cdpClick({ tabId: 1, selector: "#top" } as Parameters<typeof cdpClick>[0]);
    expect(await log()).toEqual(["click:top"]);
  });

  it("waits out smooth scrolling before clicking below the fold", async () => {
    await load();
    await click("#below");
    expect(await log()).toEqual(["click:below"]);
  });

  it("clicks inside a smooth-scrolling container", async () => {
    await load();
    await click("#inner");
    expect(await log()).toEqual(["click:inner"]);
  });

  it("waits for an element to finish animating into place", async () => {
    await load();
    await evaluate(`(() => {
      const el = document.getElementById("anim");
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.classList.add("slide");
    })()`);
    await click("#anim");
    expect(await log()).toEqual(["click:anim"]);
  });

  it("clicks through into a shadow root", async () => {
    await load();
    await click("#host");
    expect(await log()).toEqual(["click:shadowbtn"]);
  });

  it("names what covers the element instead of clicking it", async () => {
    await load();
    await expect(click("#covered")).rejects.toThrow(
      "cannot click #covered: covered by div#overlay",
    );
    expect(await log()).toEqual([]);
  }, 10_000);

  it("refuses a zero-size element", async () => {
    await load();
    await expect(click("#zero")).rejects.toThrow(/zero size/);
  }, 10_000);

  it("refuses a disabled button instead of reporting a click that did nothing", async () => {
    await load();
    await expect(click("#off")).rejects.toThrow("cannot click #off: element is disabled");
  }, 10_000);

  it("waits for a button that becomes enabled", async () => {
    await load();
    await evaluate(`setTimeout(() => { document.getElementById("off").disabled = false; }, 300)`);
    await click("#off");
    expect(await log()).toEqual(["click:off"]);
  });

  it("reports when the press lands somewhere else", async () => {
    await load();
    // The target moves out from under the pointer between the hit-test and
    // the press: swap it with #other on the first mouse move.
    await evaluate(`document.addEventListener("mousemove", () => {
      const a = document.getElementById("top"), b = document.getElementById("other");
      a.parentNode.insertBefore(b, a);
    }, { once: true })`);
    await expect(click("#top")).rejects.toThrow(/landed on button#other/);
  });

  it("hovers an element below the fold", async () => {
    await load();
    await evaluate(
      `document.getElementById("below").addEventListener("mouseover", () => __log.push("hover"))`,
    );
    await hover({ tabId: 1, selector: "#below" });
    expect(await log()).toEqual(["hover"]);
  });

  it("presses Enter on a focused submit button: it activates and submits", async () => {
    await load();
    await evaluate(`document.getElementById("submit").focus()`);
    await pressKey({ tabId: 1, key: "Enter" });
    expect(await log()).toEqual(["click:submit", "submit"]);
  });

  it("clears password-manager autofill hosts while leased, then stands down", async () => {
    await load();
    // A password manager's host — even one already in the page when armed.
    await evaluate(`document.body.append(document.createElement("com-1password-button"))`);
    await evaluate(`(${autofillGuard})(600)`);
    const count = () =>
      evaluate<number>(
        `document.querySelectorAll("com-1password-button, com-1password-menu, iframe[src^='chrome-extension:']").length`,
      );
    expect(await count()).toBe(0);
    // Inserted while the lease is live — gone before anything can load in it.
    await evaluate(`(() => {
      document.body.append(document.createElement("com-1password-menu"));
      const f = document.createElement("iframe");
      f.src = "chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/menu.html";
      document.body.append(f);
    })()`);
    expect(await count()).toBe(0);
    // Page content is never touched.
    expect(await evaluate<number>(`document.querySelectorAll("button").length`)).toBeGreaterThan(5);
    // Lease over: the user's password manager works again.
    await new Promise((r) => setTimeout(r, 900));
    await evaluate(`document.body.append(document.createElement("com-1password-menu"))`);
    await new Promise((r) => setTimeout(r, 400));
    expect(await count()).toBe(1);
  });

  it("guards the next page a click navigates to, before its own scripts run", async () => {
    await load();
    await evaluate(`document.getElementById("top").onclick = () => { location.href = "/login"; }`);
    await click("#top");
    for (let i = 0; i < 100; i++) {
      if ((await evaluate<string>("location.pathname").catch(() => "")) === "/login") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(await evaluate<number>(`document.querySelectorAll("com-1password-menu").length`)).toBe(
      0,
    );
    expect(await evaluate<boolean>(`!!document.getElementById("user")`)).toBe(true);
  });

  it("answers a JS dialog even while it blocks the page", async () => {
    // With an alert up, the renderer can't evaluate anything; a command that
    // evaluates first would hang and leave the agent no way out.
    await load();
    // An agent drives the page before a dialog appears; that's what makes the
    // dialog answerable (Chrome only tracks dialogs opened after Page.enable).
    await hover({ tabId: 1, selector: "#top" });
    await evaluate(`setTimeout(() => { __log.push(confirm("go?") ? "yes" : "no"); }, 0)`);
    await new Promise((r) => setTimeout(r, 200));
    await handleDialog({ tabId: 1, accept: true });
    expect(await log()).toEqual(["yes"]);
  }, 10_000);

  it("clicks into an iframe without calling a delivered click a failure", async () => {
    await load();
    await click("#frame");
    expect(await log()).toEqual(["framed"]);
  });

  it("accepts a click on a node the framework re-mounted under the pointer", async () => {
    await load();
    await evaluate(`document.addEventListener("mousemove", () => {
      const a = document.getElementById("top");
      a.replaceWith(a.cloneNode(true));
    }, { once: true })`);
    await click("#top");
    expect(await log()).toEqual(["click:top"]);
  });

  it("doesn't fail a click just because a page listener stopped propagation first", async () => {
    await load();
    await evaluate(
      `window.addEventListener("pointerdown", (e) => e.stopImmediatePropagation(), true)`,
    );
    await click("#top");
    expect(await log()).toEqual(["click:top"]);
  });

  it("clicks an element with an infinite animation instead of waiting forever", async () => {
    await load();
    await click("#pulse");
    expect(await log()).toEqual(["click:pulse"]);
  }, 10_000);

  it("submits with type --enter", async () => {
    await load();
    await cdpType({ tabId: 1, selector: "#field", text: "hi", submit: true });
    // Implicit submission clicks the form's default button, then submits.
    expect(await log()).toEqual(["click:submit", "submit"]);
  });

  it("presses a letter into a focused input", async () => {
    await load();
    await evaluate(`document.getElementById("field").focus()`);
    await pressKey({ tabId: 1, key: "q" });
    expect(await evaluate("document.getElementById('field').value")).toBe("q");
  });
});
