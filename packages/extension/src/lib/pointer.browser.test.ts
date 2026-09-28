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
import { __resetDebugSessions, cdpClick, cdpSnapshot, cdpType, drivePage } from "./cdp.js";
import { initDialogTracking, jevAct, jevObserve, openDialog } from "./jev.js";
import { jevSnapshot } from "./jev-snapshot.js";
import { fill, handleDialog, hover, pressKey } from "./page-actions.js";
import { pageDom } from "./page-dom.js";

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
<iframe id="frame" name="framed" style="width:200px;height:60px;border:0"
  srcdoc="<body style='margin:0'><button id=framed style='width:200px;height:60px' onclick='parent.__log.push(&quot;framed&quot;)'>in frame</button></body>"></iframe>
<div class="spacer"></div>
<button id="below">below the fold</button>
<div id="scroller"><div style="height:800px"></div><button id="inner">in scroller</button></div>
<div style="position:relative"><button id="covered">covered</button>
  <div id="overlay" style="position:absolute;inset:0"></div></div>
<button id="anim">animating</button>
<div id="host" style="display:inline-block"></div>
<form id="form"><input id="field"><button id="submit">submit</button></form>
<a id="blank" href="/" target="_blank">new tab</a>
<a id="wrapped" href="/" target="_blank"><span id="inner-span">span in a new-tab link</span></a>
<a id="framed-link" href="/" target="framed">into the frame</a>
<a id="plain" href="#plain">same tab</a>
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

const JEV_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px sans-serif }
  #modal { position: fixed; bottom: 10px; right: 10px }
  #hide { display: none }
</style></head><body>
<h1>Flights</h1>
<table><tr><td>Start Date</td><td><table><tr><td><select id="sm"><option>Jan</option><option>Feb</option></select></td><td><input id="sy" title="Year"></td></tr></table></td></tr>
<tr><td>End Date</td><td><input id="ey" title="Year"></td></tr></table>
<fieldset><legend>Shipping</legend><input id="ship"></fieldset>
<form id="f">
  <label for="from">Where from?</label><input id="from" value="San Francisco">
  <input id="to" aria-label="Where to?">
  <input id="pw" type="password" aria-label="Password" value="hunter2">
  <input id="h" type="hidden" value="secret">
  <select id="cabin" aria-label="Cabin"><option value="eco" selected>Economy</option><option value="biz">Business</option></select>
  <button id="search" type="submit">Search</button>
</form>
<button id="off" disabled>Disabled</button>
<button id="hide">Hidden</button>
<div style="position:relative"><button id="covered">Covered</button><div style="position:absolute;inset:0"></div></div>
<button id="swap">Swap me</button>
<button id="ask" onclick="confirm('Leave?')">Ask</button>
<a id="docs" href="/jev" target="_blank">Docs</a>
<a id="slowdocs" href="SLOW_URL" target="_blank">Slow docs</a>
<div id="modal" role="dialog"><button id="cookies">Accept cookies</button></div>
<div class="gdpr-notice"><p>We use tracking</p><span><button id="agree">Accept all</button></span></div>
<div role="dialog" id="invite"><p>Join the team</p><button id="accept-invite">Accept invitation</button></div>
<button id="accept-loose">Accept</button>
<form id="sf" role="search"><input id="q" name="q" aria-label="Search GitHub" value="cats"></form>
<form id="spa" role="search"><input id="rq" name="q" aria-label="Search repos" value="browser automation"></form>
<form id="go" role="search" action="/jev" method="get"><input id="gq" name="q" aria-label="Search issues" value="x"></form>
<input id="s2" type="search" placeholder="Search…" value="x">
<input id="s3" aria-label="Find a repo">
<textarea id="ta" placeholder="Search notes"></textarea>
<div id="ce" contenteditable="true" aria-label="Search drafts">x</div>
<input id="msg" aria-label="Message">
<input id="yr" aria-label="Year" value="2000">
<site-search id="ss" style="position:fixed;top:0;right:0;background:#fff"></site-search>
<div id="sealed-host" style="position:fixed;top:40px;right:0"></div>
<div style="height:2500px"></div>
<nav aria-label="Pagination"><a href="#p1" aria-current="page">1</a><a href="#p2">2</a><a rel="next" href="#n">Next</a></nav>
<a id="far" href="/jev?tld=ch" onclick="event.preventDefault(); __log.push('click:far')">.ch</a>
<a href="/jev?x">Unrelated</a>
<x-listbox id="xl" style="position:fixed;top:80px;right:0;background:#fff"></x-listbox>
<x-btn id="xb" style="position:fixed;top:120px;right:0;background:#fff">Sort by</x-btn>
<script>
  window.__log = [];
  // A site's search box built as a web component: its form lives in an open
  // shadow root. A closed root next to it is out of the page's reach.
  { const root = document.getElementById("ss").attachShadow({ mode: "open" });
    root.innerHTML = '<form role="search"><input id="sq" aria-label="Search docs"><button id="sgo" type="submit">Go</button></form><p>Docs search</p>';
    root.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); __log.push("submit:shadow:" + root.getElementById("sq").value); });
    document.getElementById("sealed-host").attachShadow({ mode: "closed" }).innerHTML = '<button id="sealed">Sealed</button>'; }
  // Web-component controls whose words are not their own light children: an
  // option whose text sits two shadow roots down, and a button whose caption
  // arrives through a slot.
  { const lb = document.getElementById("xl").attachShadow({ mode: "open" });
    lb.innerHTML = '<ul role="listbox"><x-opt role="option" id="o1"></x-opt></ul>';
    const o = lb.getElementById("o1").attachShadow({ mode: "open" });
    o.innerHTML = '<div><span aria-hidden="true">icon</span><x-txt id="t"></x-txt></div>';
    o.getElementById("t").attachShadow({ mode: "open" }).innerHTML = "Reactive properties";
    document.getElementById("xb").attachShadow({ mode: "open" }).innerHTML = '<button id="xbi"><slot></slot></button>';
    document.getElementById("xb").shadowRoot.getElementById("xbi").addEventListener("click", () => __log.push("click:xbi")); }
  // A field that keeps its own model: keyup writes the value into it, blur
  // writes the model back (a date widget re-deriving its state).
  { let model = "2000"; const yr = document.getElementById("yr");
    yr.addEventListener("keyup", () => { model = yr.value; });
    yr.addEventListener("blur", () => { yr.value = model; }); }
  document.getElementById("cabin").addEventListener("change", (e) => __log.push("change:" + e.target.value));
  document.getElementById("f").addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("sf").addEventListener("submit", (e) => { e.preventDefault(); __log.push("submit:sf"); });
  // A router search: the URL and results land well after Enter.
  document.getElementById("spa").addEventListener("submit", (e) => {
    e.preventDefault();
    setTimeout(() => {
      history.pushState({}, "", "?q=" + encodeURIComponent(document.getElementById("rq").value).replace(/%20/g, "+"));
      document.body.append(Object.assign(document.createElement("p"), { id: "results", textContent: "3 results" }));
    }, 600);
  });
</script></body></html>`;

/** `reins snapshot` and ref-addressed commands: shadow DOM, custom controls. */
const STEPS_FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px sans-serif }
  .card { display: block; position: relative; border: 1px solid #999; padding: 12px; margin: 6px; width: 240px }
  .card input, [role=switch] input { position: absolute; width: 0; height: 0; margin: 0; padding: 0; border: 0; appearance: none }
  [role=switch] { display: inline-block; position: relative; width: 44px; height: 24px; background: #ccc }
</style></head><body>
<x-search id="xs"></x-search>
<x-field id="xf"><span slot="label">Due date</span></x-field>
<div id="sealed"></div>
<fieldset><legend>Plan</legend>
  <label class="card"><input type="radio" name="plan" id="solo" value="solo" checked> Solo</label>
  <label class="card"><input type="radio" name="plan" id="team" value="team"> Team</label>
</fieldset>
<input type="checkbox" id="terms" style="display:none"><label for="terms" class="card">I agree</label>
<div role="switch" id="sw" aria-checked="false" aria-label="Dark mode"><input type="checkbox" id="swi"></div>
<span id="dc" style="display:contents"><button id="dcb">Chip</button></span>
<div role="tablist"><button role="tab" id="t1">One</button><button role="tab" id="t2">Two</button></div>
<div id="p1"><input id="one" aria-label="First field"></div>
<div id="p2" hidden><button role="switch" id="alerts" aria-checked="false" aria-label="Alerts">x</button></div>
<script>
  window.__log = [];
  document.addEventListener("click", (e) => __log.push("click:" + (e.composedPath()[0].id || e.composedPath()[0].tagName)), true);
  // A site search built as a web component: field and button in an open root.
  { const r = document.getElementById("xs").attachShadow({ mode: "open" });
    r.innerHTML = '<input id="sq" placeholder="Search the docs"><button id="sb">Search</button>';
    r.getElementById("sb").addEventListener("click", () => __log.push("search:" + r.getElementById("sq").value)); }
  // A button two shadow roots down whose caption is slotted through both.
  { const r = document.getElementById("xf").attachShadow({ mode: "open" });
    r.innerHTML = '<x-inner id="xi"><slot name="label" slot="lbl"></slot></x-inner>';
    const inner = r.getElementById("xi").attachShadow({ mode: "open" });
    inner.innerHTML = '<button id="pick"><slot name="lbl"></slot></button>';
    inner.getElementById("pick").addEventListener("click", () => __log.push("pick")); }
  document.getElementById("sealed").attachShadow({ mode: "closed" }).innerHTML = "<button>Sealed</button>";
  const sw = document.getElementById("sw"), swi = document.getElementById("swi");
  sw.addEventListener("click", () => { swi.checked = !swi.checked; sw.setAttribute("aria-checked", String(swi.checked)); });
  const alerts = document.getElementById("alerts");
  alerts.addEventListener("click", () => alerts.setAttribute("aria-checked", String(alerts.getAttribute("aria-checked") !== "true")));
  for (const [tab, show] of [["t1", "p1"], ["t2", "p2"]]) document.getElementById(tab).addEventListener("click", () => {
    for (const p of ["p1", "p2"]) document.getElementById(p).hidden = p !== show;
  });
</script></body></html>`;

let chromeProc: ChildProcess | undefined;
/** Scripts drivePage injected, with the tab (socket) each belongs to. */
const injected: Array<{ identifier: string; tabId: number | undefined }> = [];
/** Page targets opened by the fixture (target=_blank), closed after each test. */
const openedTargets: string[] = [];
let pageTargetId = "";
const tabCreatedListeners: Array<(tab: chrome.tabs.Tab) => void> = [];
const activated: Array<[number, unknown]> = [];
/** What the extension asked chrome.tabs.create for. */
const createdTabs: unknown[] = [];
let server: http.Server | undefined;
let slowServer: http.Server | undefined;
let slowUrl = "";
let profile: string | undefined;
let ws: WebSocket | undefined;
let devtoolsPort = "";
/** Sockets to the tabs the fixture opened, by the tab id the harness gave them. */
const openedSockets = new Map<number, Promise<WebSocket>>();
let url = "";
let nextId = 0;
const pending = new Map<number, (msg: { result?: unknown; error?: { message: string } }) => void>();
type EventListener = (source: { tabId?: number }, method: string, params?: unknown) => void;
const eventListeners: EventListener[] = [];

function cdp<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  sock: WebSocket | undefined = ws,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result as T),
    );
    sock?.send(JSON.stringify({ id, method, params }));
  });
}

/** Route a chrome.debugger command to the tab it names: the fixture page, or one it opened. */
async function socketFor(tabId: number | undefined): Promise<WebSocket | undefined> {
  if (tabId === undefined || tabId === 1) return ws;
  const targetId = openedTargets[tabId - 101];
  if (!targetId) throw new Error(`no tab ${tabId}`);
  let sock = openedSockets.get(tabId);
  if (!sock) {
    sock = new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${devtoolsPort}/devtools/page/${targetId}`);
      s.on("message", (data) => {
        const msg = JSON.parse(String(data));
        if (msg.id === undefined && msg.method) {
          for (const listener of eventListeners) listener({ tabId }, msg.method, msg.params);
          return;
        }
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      });
      s.once("open", () => resolve(s));
      s.once("error", reject);
    });
    openedSockets.set(tabId, sock);
  }
  return sock;
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
async function load(path = "/"): Promise<void> {
  await cdp("Page.navigate", { url: new URL(path, url).href });
  for (let i = 0; i < 100; i++) {
    if ((await evaluate<string>("document.readyState").catch(() => "")) === "complete") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("fixture did not load");
}

const log = () => evaluate<string[]>("window.__log");

/**
 * One setup step under its own deadline, so a hang names the step it was on
 * instead of vitest's bare "Hook timed out".
 */
async function step<T>(name: string, ms: number, run: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`setup: "${name}" did not finish in ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!CHROME)("pointer + key input in a real browser", () => {
  beforeAll(async () => {
    server = http.createServer((q, s) => {
      s.setHeader("content-type", "text/html");
      // A login-style page whose password-manager host exists from first parse.
      const path = (q.url ?? "").split("?")[0];
      s.end(
        path === "/login"
          ? LOGIN_FIXTURE
          : path === "/jev"
            ? JEV_FIXTURE.replace("SLOW_URL", slowUrl)
            : path === "/steps"
              ? STEPS_FIXTURE
              : FIXTURE,
      );
    });
    // A second origin (so its tab gets its own renderer, as another site's
    // would) whose page takes its time: what a new tab shows before it loads.
    slowServer = http.createServer((_q, s) => {
      s.setHeader("content-type", "text/html");
      s.write("<!doctype html><title>slow docs</title>"); // commits at once, still loading
      setTimeout(() => s.end("<p>Docs, at last</p>"), 800);
    });
    await step("fixture servers listen", 5_000, async () => {
      await new Promise<void>((r) => slowServer?.listen(0, "localhost", r));
      slowUrl = `http://localhost:${(slowServer?.address() as AddressInfo).port}/slow`;
      await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server?.address() as AddressInfo).port}/`;
    });

    profile = mkdtempSync(join(tmpdir(), "reins-pointer-"));
    const proc = spawn(
      CHROME as string,
      [
        "--headless=new",
        "--no-sandbox",
        "--no-first-run",
        // Linux CI has no GPU and a small /dev/shm; without these the browser
        // can stall in GPU-process startup or crash renderers under load.
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--window-size=1000,700",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    chromeProc = proc;
    // Chrome's stderr, kept so a failure to start can say what it printed.
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    const port = await step("chrome prints its DevTools port", 15_000, () => {
      return new Promise<string>((resolve, reject) => {
        const check = () => {
          const m = stderr.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
          if (m?.[1]) resolve(m[1]);
        };
        check();
        proc.stderr?.on("data", check);
        proc.on("error", (err) => reject(new Error(`chrome failed to spawn: ${err.message}`)));
        proc.on("exit", (code, signal) =>
          reject(new Error(`chrome exited (${code ?? signal}) before listening`)),
        );
      });
    }).catch((err: Error) => {
      throw new Error(`${err.message}\nchrome stderr so far:\n${stderr || "(nothing)"}`);
    });
    devtoolsPort = port;
    const targets = await step("GET /json/list", 5_000, async () => {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await res.json()) as Array<{
        type: string;
        id: string;
        webSocketDebuggerUrl: string;
      }>;
    });
    const target = targets.find((t) => t.type === "page");
    if (!target) throw new Error(`no page target in ${JSON.stringify(targets)}`);
    pageTargetId = target.id;
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    ws = sock;
    sock.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (msg.id === undefined && msg.method) {
        // A tab opened from our page — by the page itself or by the stubbed
        // chrome.tabs.create on its behalf: what chrome.tabs.onCreated would
        // report. The fixture tab is the only page here, so every other page
        // target is one of these. (DevTools names an `openerId` only for a
        // tab the renderer created, so it can't tell them apart.)
        if (msg.method === "Target.targetCreated") {
          const info = msg.params.targetInfo as { targetId: string; type: string };
          if (info.type === "page" && info.targetId !== pageTargetId) {
            openedTargets.push(info.targetId);
            const tab = { id: 100 + openedTargets.length, openerTabId: 1, active: false };
            for (const fn of tabCreatedListeners) fn(tab as chrome.tabs.Tab);
          }
          return;
        }
        // A CDP event: deliver it the way chrome.debugger.onEvent would.
        for (const listener of eventListeners) listener({ tabId: 1 }, msg.method, msg.params);
        return;
      }
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    });
    await step("page WebSocket opens", 5_000, () => {
      return new Promise<void>((resolve, reject) => {
        sock.once("open", () => resolve());
        sock.once("error", reject);
      });
    });
    await step("Target.setDiscoverTargets", 5_000, () =>
      cdp("Target.setDiscoverTargets", { discover: true }),
    );

    // The extension's view of the world, forwarded to the headless browser.
    vi.stubGlobal("chrome", {
      debugger: {
        attach: async () => {},
        detach: async () => {},
        onDetach: { addListener: () => {} },
        onEvent: { addListener: (fn: EventListener) => eventListeners.push(fn) },
        sendCommand: async (
          target: { tabId?: number },
          method: string,
          params?: Record<string, unknown>,
        ) => {
          const result = await cdp(method, params, await socketFor(target.tabId));
          // One real page serves every test: remember injected scripts so
          // afterEach can drop them, as a fresh debugger session would.
          if (method === "Page.addScriptToEvaluateOnNewDocument") {
            const identifier = (result as { identifier: string }).identifier;
            injected.push({ identifier, tabId: target.tabId });
          } else if (method === "Page.removeScriptToEvaluateOnNewDocument") {
            // A second drivePage in one case re-arms the guard and drops its
            // own previous script; don't try to drop it again in afterEach.
            const i = injected.findIndex((s) => s.identifier === String(params?.identifier));
            if (i >= 0) injected.splice(i, 1);
          }
          return result;
        },
      },
      tabs: {
        update: async (id: number, props: unknown) => {
          activated.push([id, props]);
          return {};
        },
        // What the extension would read while a dialog blocks CDP, and the
        // opener's place for a tab it creates.
        get: async () => ({
          url: new URL("/jev", url).href,
          title: "jev fixture",
          windowId: 1,
          index: 0,
        }),
        // A tab the extension opens for a new-tab link: a real page target,
        // numbered as the harness numbers the tabs the fixture opens.
        create: async (props: { url: string }) => {
          createdTabs.push(props);
          const { targetId } = await cdp<{ targetId: string }>("Target.createTarget", {
            url: props.url,
          });
          for (let i = 0; i < 50 && !openedTargets.includes(targetId); i++) {
            await new Promise((r) => setTimeout(r, 20));
          }
          return { id: 101 + openedTargets.indexOf(targetId) };
        },
        onCreated: {
          addListener: (fn: (tab: chrome.tabs.Tab) => void) => tabCreatedListeners.push(fn),
          removeListener: (fn: (tab: chrome.tabs.Tab) => void) => {
            const i = tabCreatedListeners.indexOf(fn);
            if (i >= 0) tabCreatedListeners.splice(i, 1);
          },
        },
      },
    });
    // jev.ts registered at import against no `chrome`; register on the stub.
    initDialogTracking();
  }, 40_000); // above the steps' own deadlines, so a stall reports its step

  afterEach(async () => {
    __resetDebugSessions();
    activated.length = 0;
    createdTabs.length = 0;
    for (const { identifier, tabId } of injected.splice(0)) {
      const sock = await socketFor(tabId);
      // A tab closed mid-test (a navigation away) has no scripts left to drop.
      await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sock).catch(() => {});
    }
    for (const sock of openedSockets.values()) (await sock).close();
    openedSockets.clear();
    for (const targetId of openedTargets.splice(0)) {
      await cdp("Target.closeTarget", { targetId }).catch(() => {});
    }
    // An opened tab took the foreground; the fixture tab must have it back.
    await cdp("Page.bringToFront").catch(() => {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    ws?.close();
    chromeProc?.kill();
    server?.close();
    slowServer?.close();
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

  it("settles on real frames, never on a timer that fires between them", async () => {
    // Between main-thread frames the animation clock is frozen: a timer-task
    // read repeats the last frame's rect while the compositor keeps moving
    // the element. On a busy page the rAF fallback timer fires before the
    // next frame now and then; here every short timer does, so the stale
    // "still" read happens on every attempt.
    await load();
    await evaluate(`(() => {
      const st = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => st(fn, ms <= 100 ? 0 : ms, ...args);
      const el = document.getElementById("anim");
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.classList.add("slide");
    })()`);
    await click("#anim");
    expect(await log()).toEqual(["click:anim"]);
  }, 10_000);

  it("clicks through into a shadow root", async () => {
    await load();
    await click("#host");
    expect(await log()).toEqual(["click:shadowbtn"]);
  });

  it("opens the tab a new-tab link would have, itself, and reports it", async () => {
    // A trusted click on target=_blank makes Chrome open a foreground tab
    // *and* raise its window over the app the user is in. The probe cancels
    // the link's own navigation once the page's handlers have run, and the
    // extension opens the URL with chrome.tabs.create, which raises nothing.
    await load();
    await expect(click("#blank")).resolves.toEqual({ ok: true, openedTabId: 101 });
    expect(await log()).toEqual(["click:blank"]); // the page's own handler saw the click
    expect(createdTabs).toEqual([{ url, windowId: 1, index: 1, openerTabId: 1, active: true }]);
    expect(openedTargets).toHaveLength(1); // ours; the link opened none of its own
    expect(await evaluate<string>("location.href")).toBe(url); // and didn't navigate here
  });

  it("a click inside a new-tab link (a span in the anchor) opens the tab the same way", async () => {
    await load();
    await expect(click("#inner-span")).resolves.toEqual({ ok: true, openedTabId: 101 });
    expect(await log()).toEqual(["click:inner-span"]); // the probe saw the press land
    expect(createdTabs).toHaveLength(1);
    expect(openedTargets).toHaveLength(1);
  });

  it("a button, a same-tab link and a link into a named frame are left to the page", async () => {
    await load();
    await expect(click("#top")).resolves.toEqual({ ok: true });
    await expect(click("#framed-link")).resolves.toEqual({ ok: true });
    await expect(click("#plain")).resolves.toEqual({ ok: true }); // last: its hash jump smooth-scrolls
    expect(createdTabs).toEqual([]);
    expect(openedTargets).toHaveLength(0);
    expect(await evaluate<string>("location.hash")).toBe("#plain"); // the same-tab link navigated
  });

  it("a new-tab link the page handles itself (preventDefault) is the page's business", async () => {
    await load();
    await evaluate(
      `document.getElementById("blank").addEventListener("click", (e) => { e.preventDefault(); __log.push("handled"); })`,
    );
    await expect(click("#blank")).resolves.toEqual({ ok: true });
    expect(await log()).toEqual(["click:blank", "handled"]);
    expect(createdTabs).toEqual([]);
    expect(openedTargets).toHaveLength(0);
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

  it("the page reports focus once reins drives it", async () => {
    // A tab `reins open` created sits behind the omnibox and reports no
    // focus; focus emulation makes the page report focus like a foreground
    // tab a person is looking at. Here another target takes the real focus
    // (the harness brings the fixture forward after every test).
    await load();
    await cdp("Emulation.setFocusEmulationEnabled", { enabled: false });
    const { targetId } = await cdp<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    try {
      expect(await evaluate<boolean>("document.hasFocus()")).toBe(false);
      await drivePage(1, async () => {});
      expect(await evaluate<boolean>("document.hasFocus()")).toBe(true);
    } finally {
      await cdp("Target.closeTarget", { targetId }).catch(() => {});
    }
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

  type Snap = NonNullable<ReturnType<typeof jevSnapshot>>;
  const snap = () => evaluate<Snap>(`(${jevSnapshot})([], ${pageDom})`);
  const nodeOf = (s: Snap, label: string) => s.actions.find((a) => a.label === label)?.node;

  it("jev: lists visible controls, including a fixed-position dialog, and skips the rest", async () => {
    await load("/jev");
    const s = await snap();
    const labels = s.actions.map((a) => `${a.kind}:${a.label}`);
    expect(labels).toContain("fill:Where from?");
    expect(labels).toContain("fill:Where to?");
    expect(labels).toContain("click:Accept cookies");
    expect(labels).toContain("select:Cabin → Business");
    expect(labels.join()).not.toMatch(/Password|Disabled|Hidden|secret/);
    expect(s.actions.find((a) => a.label === "Where from?")?.value).toBe("San Francisco");
    expect(s.text).toContain("Flights");
  });

  it("jev: marks accept/agree buttons inside consent banners, nothing else", async () => {
    await load("/jev");
    const s = await snap();
    const consent = (label: string) =>
      s.actions.find((a) => a.kind === "click" && a.label === label)?.consent;
    expect(consent("Accept cookies")).toBe(true); // role=dialog whose text says cookies
    expect(consent("Accept all")).toBe(true); // an ancestor class says gdpr
    expect(consent("Accept invitation")).toBeUndefined(); // a dialog about something else
    expect(consent("Accept")).toBeUndefined(); // no banner around it
    expect(consent("Search")).toBeUndefined(); // not an accept label
  });

  it("jev: an unlabelled control is named by its row or group, never by its options", async () => {
    await load("/jev");
    const labels = (await snap()).actions.map((a) => `${a.kind}:${a.label}`);
    expect(labels).toContain("select:Start Date → Feb"); // the outer row's first cell
    expect(labels).toContain("fill:Start Date: Year"); // context + the weak title name
    expect(labels).toContain("fill:End Date: Year");
    expect(labels).toContain("fill:Shipping"); // the fieldset's legend
    expect(labels.join()).not.toMatch(/Jan Feb/); // options are not a name
  });

  it("jev: controls and text in an open shadow root are listed, typed into, submitted and clicked; a closed root stays invisible", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const labels = s.actions.map((a) => `${a.kind}:${a.label}`);
    expect(labels).toContain("fill:Search docs");
    expect(labels).toContain("click:Go");
    expect(labels.join()).not.toContain("Sealed");
    expect(s.text).toContain("Docs search");
    const field = s.actions.find((a) => a.kind === "fill" && a.label === "Search docs");
    expect(field?.submit).toBe(true); // form[role=search] in the shadow tree
    const node = field?.node as number;
    expect(await jevAct({ tabId: 1, op: "type", node, text: "shadow" })).toEqual({ ok: true });
    expect(
      await evaluate<string>('document.getElementById("ss").shadowRoot.getElementById("sq").value'),
    ).toBe("shadow");
    // The loop reads the page again after typing; the typed value is part of the guard.
    const typed = nodeOf(await snap(), "Search docs") as number;
    expect(await jevAct({ tabId: 1, op: "submit", node: typed, label: "Search docs" })).toEqual({
      ok: true,
    });
    expect(await log()).toContain("submit:shadow:shadow");
    const go = nodeOf(await snap(), "Go") as number;
    expect(await jevAct({ tabId: 1, op: "click", node: go })).toEqual({ ok: true });
    expect((await log()).filter((l) => l === "submit:shadow:shadow")).toHaveLength(2);
  });

  it("jev: names a control by the text its shadow root or slot renders", async () => {
    await load("/jev");
    const labels = (await snap()).actions.map((a) => `${a.kind}:${a.label}`);
    expect(labels).toContain("click:Reactive properties"); // option: text two roots down
    expect(labels).toContain("click:Sort by"); // button: caption slotted from the host
    expect(labels.filter((l) => l === "click:option" || l === "click:button")).toEqual([]);
  });

  it("jev: lists off-screen pagers and goal-named controls, marked offscreen, and clicks them", async () => {
    await load("/jev");
    const plain = await jevObserve({ tabId: 1 });
    const off = (s: typeof plain) =>
      s.actions.filter((a) => a.offscreen).map((a) => `${a.role}:${a.label}`);
    expect(off(plain)).toEqual(["link:2", "link:Next"]); // the pager alone, page 1 being current
    expect(plain.text).not.toContain("Unrelated"); // text stays viewport-only
    const s = await jevObserve({ tabId: 1, terms: [".ch", "Flights"] });
    expect(off(s)).toEqual(["link:2", "link:Next", "link:.ch"]); // a goal word names the far link
    expect(s.actions.find((a) => a.label === "Search")?.offscreen).toBeUndefined();
    const far = s.actions.find((a) => a.label === ".ch")?.node as number;
    expect(await jevAct({ tabId: 1, op: "click", node: far })).toEqual({ ok: true });
    expect(await log()).toContain("click:far"); // scrolled into view, then pressed
  });

  it("jev: clicks a shadow button whose caption is slotted (hit-testing stops at the host)", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.label === "Sort by")?.node as number;
    expect(await jevAct({ tabId: 1, op: "click", node })).toEqual({ ok: true });
    expect(await log()).toContain("click:xbi");
  });

  it("jev: a node keeps its id across snapshots", async () => {
    await load("/jev");
    const a = nodeOf(await snap(), "Search");
    const b = nodeOf(await snap(), "Search");
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  it("jev: an observation never carries a password or hidden-field value", async () => {
    await load("/jev");
    const wire = JSON.stringify(await jevObserve({ tabId: 1 }));
    expect(wire).not.toMatch(/hunter2/);
    expect(wire).not.toMatch(/secret/);
  });

  it("jev: types over an existing value", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.label === "Where from?")?.node as number;
    expect(await jevAct({ tabId: 1, op: "type", node, text: "Zurich" })).toEqual({ ok: true });
    expect(await evaluate<string>('document.getElementById("from").value')).toBe("Zurich");
  });

  it("jev: a field that re-derives its value from keyup keeps the typed value", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.label === "Year")?.node as number;
    expect(await jevAct({ tabId: 1, op: "type", node, text: "2024" })).toEqual({ ok: true });
    await evaluate('document.getElementById("yr").blur()');
    expect(await evaluate<string>('document.getElementById("yr").value')).toBe("2024");
  });

  it("jev: picks a native select option and fires change", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const opt = s.actions.find((a) => a.label === "Cabin → Business");
    expect(
      await jevAct({ tabId: 1, op: "select", node: opt?.node as number, value: "biz" }),
    ).toEqual({ ok: true });
    expect(await log()).toContain("change:biz");
  });

  it("jev: marks search-like single-line fields submittable, nothing else", async () => {
    await load("/jev");
    const s = await snap();
    const submit = (label: string) =>
      s.actions.find((a) => a.kind === "fill" && a.label === label)?.submit;
    expect(submit("Search GitHub")).toBe(true); // form[role=search] + name=q
    expect(submit("Search…")).toBe(true); // type=search
    expect(submit("Find a repo")).toBe(true); // label says find
    expect(submit("Search notes")).toBeUndefined(); // textarea
    expect(submit("Search drafts")).toBeUndefined(); // contenteditable
    expect(submit("Message")).toBeUndefined(); // Enter would send
    expect(submit("Where from?")).toBeUndefined();
  });

  it("jev: submit presses Enter in the search field; other fields and gone ones are stale", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const fill = (label: string) =>
      s.actions.find((a) => a.kind === "fill" && a.label === label)?.node as number;
    const node = fill("Search GitHub");
    // The form does nothing after Enter: the wait for an effect is bounded.
    const started = Date.now();
    expect(await jevAct({ tabId: 1, op: "submit", node, label: "Search GitHub" })).toEqual({
      ok: true,
    });
    expect(Date.now() - started).toBeLessThan(1700);
    expect(await log()).toContain("submit:sf");
    expect(await jevAct({ tabId: 1, op: "submit", node: fill("Message") })).toMatchObject({
      stale: true,
      reason: "the field is not a search field",
    });
    await evaluate(
      'document.getElementById("q").replaceWith(Object.assign(document.createElement("input"), { id: "q" }))',
    );
    expect(await jevAct({ tabId: 1, op: "submit", node })).toMatchObject({
      stale: true,
      reason: "the element is gone",
    });
  });

  it("jev: submit returns once a router search has landed its URL and results", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.kind === "fill" && a.label === "Search repos")
      ?.node as number;
    const started = Date.now();
    expect(await jevAct({ tabId: 1, op: "submit", node, label: "Search repos" })).toEqual({
      ok: true,
    });
    // Resolved on the URL change (~600 ms), well before the 1.5 s cap.
    expect(Date.now() - started).toBeLessThan(1400);
    expect(await evaluate<string>("location.search")).toBe("?q=browser+automation");
    expect(await evaluate<boolean>('!!document.getElementById("results")')).toBe(true);
    // The next read is of the landed page.
    expect((await jevObserve({ tabId: 1 })).url).toContain("?q=browser+automation");
  });

  it("jev: submit that navigates the document is settled, and the next read waits for the new page", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.kind === "fill" && a.label === "Search issues")
      ?.node as number;
    expect(await jevAct({ tabId: 1, op: "submit", node, label: "Search issues" })).toEqual({
      ok: true,
    });
    const next = await jevObserve({ tabId: 1 });
    expect(next.url).toBe(new URL("/jev?q=x", url).href);
    expect(next.title).toBe(""); // the fixture has no <title>: it is the new document, read whole
    expect(next.actions.some((a) => a.label === "Search issues")).toBe(true);
  });

  it("jev: a click that opens a new tab reports it, brought to the front", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.kind === "click" && a.label === "Docs")?.node as number;
    expect(await jevAct({ tabId: 1, op: "click", node, label: "Docs" })).toEqual({
      ok: true,
      openedTabId: 101,
    });
    // Opened by the extension (the link's own navigation would raise
    // Chrome's window over the user's app), active, next to the opener.
    expect(createdTabs).toEqual([
      { url: new URL("/jev", url).href, windowId: 1, index: 1, openerTabId: 1, active: true },
    ]);
    expect(activated).toEqual([[101, { active: true }]]);
    expect(tabCreatedListeners).toEqual([]); // the watcher is gone after the act
    expect(openedTargets).toHaveLength(1);
  });

  it("jev: the opened tab is handed over only once its page has loaded", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.label === "Slow docs")?.node as number;
    const t0 = Date.now();
    const r = await jevAct({ tabId: 1, op: "click", node, label: "Slow docs" });
    expect(r).toEqual({ ok: true, openedTabId: 101 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700); // the slow page had to arrive
    // The first read of the new tab is of its loaded page, not about:blank.
    const obs = await jevObserve({ tabId: 101 });
    expect(obs).toMatchObject({ url: slowUrl, title: "slow docs" });
    expect(obs.text).toContain("Docs, at last");
  }, 10_000);

  it("jev: a node replaced after the read comes back stale, not clicked", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.label === "Swap me")?.node as number;
    await evaluate(
      'document.getElementById("swap").replaceWith(Object.assign(document.createElement("button"), { textContent: "Swap me" }))',
    );
    const r = await jevAct({ tabId: 1, op: "click", node });
    expect(r).toMatchObject({ stale: true, reason: "the element is gone" });
  });

  it("jev: a covered target comes back stale within about half a second", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    // The snapshot lists it (it is visible); only the act-time hit test sees the overlay.
    const node = s.actions.find((a) => a.label === "Covered")?.node as number;
    const t0 = Date.now();
    expect(await jevAct({ tabId: 1, op: "click", node })).toMatchObject({ stale: true });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it("jev: a click that opens a dialog returns ok, and the next read reports the dialog", async () => {
    await load("/jev");
    const s = await jevObserve({ tabId: 1 });
    const node = s.actions.find((a) => a.label === "Ask")?.node as number;
    const t0 = Date.now();
    expect(await jevAct({ tabId: 1, op: "click", node })).toEqual({ ok: true });
    expect(Date.now() - t0).toBeLessThan(2000);
    const after = await jevObserve({ tabId: 1 });
    expect(after.dialog).toEqual({ type: "confirm", message: "Leave?" });
    // The blocked page can't be read, but the tab's url/title still come through.
    expect(after).toMatchObject({ url: new URL("/jev", url).href, title: "jev fixture" });
    // Dismiss it so later cases aren't blocked; Page.javascriptDialogClosed clears the record.
    await handleDialog({ tabId: 1, accept: false });
    await new Promise((r) => setTimeout(r, 200));
    expect(openDialog(1)).toBeUndefined();
  }, 10_000);

  const refOf = async (role: string, name: string) => {
    const { refs } = await cdpSnapshot({ tabId: 1, mode: "a11y" });
    const hit = refs.find((r) => r.role === role && r.name === name);
    if (!hit) throw new Error(`no ${role} "${name}" in ${JSON.stringify(refs)}`);
    return hit.ref;
  };
  const byRef = (ref: string) => cdpClick({ tabId: 1, ref, button: "left", clickCount: 1 });

  it("snapshot: lists controls in an open shadow root, and click/type/fill by ref reach them; a closed root stays invisible", async () => {
    await load("/steps");
    const { content } = await cdpSnapshot({ tabId: 1, mode: "a11y" });
    expect(content).toMatch(/e\d+: input "Search the docs"/);
    expect(content).toMatch(/e\d+: button "Search"/);
    expect(content).not.toContain("Sealed");
    const field = await refOf("input", "Search the docs");
    await fill({ tabId: 1, ref: field, value: "fe" });
    await cdpType({ tabId: 1, ref: field, text: "tch", submit: false });
    await byRef(await refOf("button", "Search"));
    expect(await log()).toContain("search:fetch");
  });

  it("snapshot: a shadow button two roots down is named by its slotted caption", async () => {
    await load("/steps");
    await byRef(await refOf("button", "Due date"));
    // The press lands on the slotted caption, inside the button as rendered.
    expect(await log()).toEqual(["click:SPAN", "pick"]);
  });

  it("snapshot: refs are re-issued each time, so a ref an element hidden since held reaches its new owner", async () => {
    await load("/steps");
    const first = await refOf("input", "First field");
    await byRef(await refOf("tab", "Two"));
    // The panel switch hid the field; the switch now listed takes its number.
    const alerts = await refOf("switch", "Alerts");
    expect(alerts).toBe(first);
    await byRef(alerts);
    expect(await evaluate("document.getElementById('alerts').getAttribute('aria-checked')")).toBe(
      "true",
    );
  });

  it("a radio card whose native input is 0x0 is clicked by ref through its label, and ends checked", async () => {
    await load("/steps");
    await byRef(await refOf("input", "Team"));
    expect(await evaluate("document.getElementById('team').checked")).toBe(true);
    expect(await evaluate("document.getElementById('solo').checked")).toBe(false);
  });

  it("a display:none checkbox is clicked through its label[for]", async () => {
    await load("/steps");
    await click("#terms");
    expect(await evaluate("document.getElementById('terms').checked")).toBe(true);
  });

  it("a role=switch toggle whose native checkbox is 0x0 is clicked by the checkbox's ref, and ends checked", async () => {
    await load("/steps");
    await cdpSnapshot({ tabId: 1, mode: "a11y" });
    const ref = await evaluate<string>(
      "document.getElementById('swi').getAttribute('data-reins-ref')",
    );
    await byRef(ref);
    expect(await evaluate("document.getElementById('swi').checked")).toBe(true);
    expect(await evaluate("document.getElementById('sw').getAttribute('aria-checked')")).toBe(
      "true",
    );
  });

  it("a display:contents element is clicked on its first rendered child", async () => {
    await load("/steps");
    await click("#dc");
    expect(await log()).toEqual(["click:dcb"]);
  });
});
