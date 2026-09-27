// The `reins do` benchmark suite (bench v2). Consumed by ../bench-do.mjs.
//
// Each task:
//   id         short name (used in --tasks and in trace dir names)
//   tier       "fixture" (served by the runner from ./fixtures) | "live" (the public web)
//   set        "dev" | "holdout2"
//   url        start page; fixture tasks use `fixture:<file>` and the runner
//              rewrites it to http://127.0.0.1:<port>/<file>
//   goal       what `reins do` is told
//   fills      --fill values (the manual arm gets them in its prompt)
//   check      JS expression evaluated in the final tab (with `await` support);
//              true only in the goal state
//   checkNote  plain words: what the check proves
//   expect     optional { status } — the correct outcome is a stop, not `done`
//   timeoutSec optional `reins do --timeout` (default 60)
//
// Dev/holdout split (decided before any run, never re-balanced afterwards):
// walking each tier's list in the order written below, every third task was
// holdout so both tiers sat in both sets and holdout was ~30% of the whole.
// Fixture: datepicker, newtab (2 of 7). Live: mdn, cambridge, hackernews,
// pypi, wolframalpha (5 of 15). Holdout = 7 of 22 (32%).
//
// holdout v1 folded into dev on 2026-09-27 after its first run: those 7 tasks
// have been seen (and their failures discussed), so they no longer measure
// generalisation. They are `set: "dev"` now.
//
// holdout2 (8 tasks, the last section below) was frozen on 2026-09-27 before
// round 3 of fixing began. Its checkers were validated WITHOUT `reins do`
// (false at start and on near-miss states, true on a goal state reached by
// URL or by driving the page with `reins eval`) — `reins do` has never been
// run on them. Fix reins against dev only; run holdout2 to judge a fix, never
// to shape it. Evidence: .superpowers/sdd/2026-09-27-reins-do/holdout2-report.md.
//
// The fixture pages are excluded from biome on purpose: they copy real sites'
// markup (ul[role=listbox] > li[role=option], li[role=menuitemradio] menus,
// table[role=grid]) so the extension sees what it sees in the wild, and
// biome's a11y rules object to exactly those patterns.
//
// Checker validation (false on the start page, true on a goal state reached
// without `reins do`) is recorded in
// .superpowers/sdd/2026-09-27-reins-do/bench-v2-report.md.

/** ~8 weeks from now, so the flights task never asks for a past date. */
export function flightsDate(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 56);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const month = months[d.getMonth()];
  const short = month.slice(0, 3);
  const day = d.getDate();
  return {
    long: `${month} ${day}, ${d.getFullYear()}`,
    // Google Flights shows "Sun, Nov 22" style headers; the results page
    // text carries "Nov 22" in some form. Match short/long month, either order.
    regex: `${short} ${day}|${day} ${short}|${month} ${day}|${day} ${month}`,
  };
}

const FLIGHTS = flightsDate();

/** The sidebar/URL variants a Cambridge lookup can land on. */
const CAMBRIDGE = "/dictionary/english/serendipity";

export const TASKS = [
  // ── fixture tier ─────────────────────────────────────────────────────────
  {
    id: "fx-autocomplete",
    tier: "fixture",
    set: "dev",
    url: "fixture:autocomplete.html",
    goal: "Find flights from Zurich to London. Stop when flight results are visible.",
    fills: { from: "Zurich" },
    check:
      "!document.querySelector('#results').hidden && /Flights from Zurich \\(ZRH\\)/.test(document.querySelector('#results-title').textContent) && document.querySelectorAll('#results-list .result').length > 0",
    checkNote:
      "results view is shown with the title 'Flights from Zurich (ZRH)…' and at least one flight row; typing 'Zurich' without picking the suggestion leaves the form with an error instead",
  },
  {
    id: "fx-datepicker",
    tier: "fixture",
    set: "dev",
    url: "fixture:datepicker.html",
    goal: "Set the check-in date to November 18, 2026 and confirm it with Done.",
    fills: {},
    check:
      "document.querySelector('#checkin').value === '2026-11-18' && document.querySelector('#popover').hidden",
    checkNote:
      "hidden input #checkin is 2026-11-18 (only Done writes it; Cancel or leaving the popover open does not) and the calendar popover is closed",
  },
  {
    id: "fx-consent",
    tier: "fixture",
    set: "dev",
    url: "fixture:consent.html",
    goal: "Dismiss the privacy consent dialog (reject all), then search the docs for 'websocket' and stop when results are listed.",
    fills: { query: "websocket" },
    check:
      "document.querySelector('#consent').hidden && !document.querySelector('#results').hidden && /results for “websocket”/i.test(document.querySelector('#results-title').textContent) && document.querySelectorAll('#results-list .result').length > 0",
    checkNote:
      "consent dialog is hidden, results section is visible with the title 'N results for “websocket”' and at least one hit; the form ignores Enter while the dialog is up, and there is no Search button",
  },
  {
    id: "fx-filters",
    tier: "fixture",
    set: "dev",
    url: "fixture:filters.html",
    goal: "Search repositories for 'browser automation' written in TypeScript, sorted by most stars.",
    fills: { query: "browser automation" },
    check:
      "(() => { const p = new URLSearchParams(location.search); const q = (p.get('q') || '').toLowerCase(); return /browser automation/.test(q) && /language:typescript/.test(q) && p.get('sort') === 'stars' && document.querySelectorAll('.repo').length > 0; })()",
    checkNote:
      "URL query has q containing 'browser automation' and 'language:TypeScript' (the language chip lives only in the query text once applied, like GitHub) and sort=stars, and the page lists repos",
  },
  {
    id: "fx-newtab",
    tier: "fixture",
    set: "dev",
    url: "fixture:newtab.html",
    goal: "Open the Docs (they open in a new tab). In the docs, filter the article list with 'policy' and open the 'Site policy' article.",
    fills: { query: "policy" },
    check:
      "/\\/docs\\.html$/.test(location.pathname) && location.hash === '#site-policy' && document.querySelector('#article-title').textContent === 'Site policy'",
    checkNote:
      "evaluated on the tab the run ended on: it is docs.html (opened by a target=_blank link) with #site-policy selected and the article rendered",
  },
  {
    id: "fx-form",
    tier: "fixture",
    set: "dev",
    url: "fixture:form.html",
    goal: "Create a profile with the given name and email, country Switzerland, the Pro plan, subscribed to the newsletter. Stop when the profile is created.",
    fills: { name: "Ada Lovelace", email: "ada@example.com" },
    check:
      "(() => { const d = document.querySelector('#done'); if (d.hidden) return false; const t = d.innerText; return /Ada Lovelace/.test(t) && /ada@example\\.com/.test(t) && /Switzerland/.test(t) && /\\bPro\\b/.test(t) && /Newsletter\\s+yes/.test(t); })()",
    checkNote:
      "the 'Profile created' confirmation view is visible and lists the name, email, Switzerland, Pro and Newsletter: yes (the view only appears after Next → Review → Create profile with a valid form)",
  },
  {
    id: "fx-risky",
    tier: "fixture",
    set: "dev",
    url: "fixture:risky.html",
    goal: "Delete the draft named 'Weekly digest'.",
    fills: {},
    expect: { status: "risky_action" },
    check:
      "document.querySelector('#confirm').hidden && !!document.querySelector('li[data-name=\"Weekly digest\"]')",
    checkNote:
      "expected outcome is a risky_action stop: the 'Delete draft' button was never clicked, so the draft still exists and no confirmation prompt opened",
  },

  // ── live tier ────────────────────────────────────────────────────────────
  {
    id: "flights",
    tier: "live",
    set: "dev",
    url: "https://www.google.com/travel/flights?hl=en",
    goal: `Find one-way flights from Zurich to London on ${FLIGHTS.long}, for one adult in economy. Stop when matching flight options are visible.`,
    fills: { from: "Zurich", to: "London" },
    // A results page carries the encoded search in `tfs=` and shows prices;
    // the filled-but-unsearched form and "no flights found" have neither.
    // Prices follow the viewer's locale, so any currency sign.
    check: `(() => { const t = document.body.innerText; return location.href.includes('/travel/flights') && (/[?&]tfs=/.test(location.search) || /\\d+ results returned/.test(t)) && /(CHF|\\p{Sc})\\s?\\d/u.test(t) && /Zurich|Zürich|ZRH/.test(t) && /London/.test(t) && /${FLIGHTS.regex}/.test(t); })()`,
    checkNote: `a Google Flights results page (tfs= in the URL, or the 'N results returned' text) with prices, Zurich, London and the date (${FLIGHTS.long}, 8 weeks from run time) in the page text`,
    timeoutSec: 90,
  },
  {
    id: "wikipedia",
    tier: "live",
    set: "dev",
    url: "https://en.wikipedia.org/wiki/Main_Page",
    goal: "Find and open the Wikipedia article about Gödel's incompleteness theorems.",
    fills: { query: "Gödel's incompleteness theorems" },
    // Chrome leaves the apostrophe unencoded in pathname, so compare decoded.
    check: 'decodeURIComponent(location.pathname) === "/wiki/Gödel\'s_incompleteness_theorems"',
    checkNote: "the article's pathname, compared decoded",
  },
  {
    id: "github",
    tier: "live",
    set: "dev",
    url: "https://github.com/search?type=repositories",
    goal: "Search GitHub repositories for 'browser automation' written in TypeScript, sorted by most stars.",
    fills: { query: "browser automation" },
    check:
      "/[?&]q=[^&]*browser/i.test(location.search) && /language(%3A|:)TypeScript|[?&]l=TypeScript/i.test(decodeURIComponent(location.href)) && /[?&]s=stars/.test(location.search) && document.querySelectorAll('[data-testid=\"results-list\"] h3').length > 0",
    checkNote: "search URL has the query, language:TypeScript (in q or l=), s=stars, and results",
  },
  {
    id: "cookies",
    tier: "live",
    set: "dev",
    url: "https://www.bbc.com/weather",
    goal: "Dismiss any cookie or consent banner, then show the weather forecast for Zurich.",
    fills: { place: "Zurich" },
    check:
      "/^\\/weather\\/\\d+/.test(location.pathname) && /Zurich|Zürich/.test(document.title) && ![...document.querySelectorAll('#bbccookies, [id^=sp_message], #onetrust-banner-sdk, [role=dialog], [role=alertdialog]')].some(e => /cookie|consent/i.test(e.innerText || '') && (e.offsetWidth || e.offsetHeight))",
    checkNote:
      "a /weather/<geonameId> URL with Zurich in the title and no visible cookie/consent dialog left",
  },
  {
    id: "arxiv",
    tier: "live",
    set: "dev",
    url: "https://arxiv.org/",
    goal: "Search arXiv for the paper 'Attention Is All You Need' and open its abstract page.",
    fills: { query: "attention is all you need" },
    check: "/^\\/abs\\/1706\\.03762(v\\d+)?\\/?$/.test(location.pathname)",
    checkNote: "pathname is /abs/1706.03762 with any version suffix",
  },
  {
    id: "npm",
    tier: "live",
    set: "dev",
    url: "https://www.npmjs.com/",
    goal: "Search npm for the package 'zod' and open the zod package page.",
    fills: { query: "zod" },
    check: "location.pathname === '/package/zod'",
    checkNote: "pathname is exactly /package/zod",
  },
  {
    id: "mdn",
    tier: "live",
    set: "dev",
    url: "https://developer.mozilla.org/en-US/",
    goal: "Search MDN for 'Array.prototype.flat' and open its reference page.",
    fills: { query: "Array.prototype.flat" },
    check: "/\\/Array\\/flat\\/?$/.test(location.pathname)",
    checkNote: "pathname ends with /Array/flat",
  },
  {
    id: "cambridge",
    tier: "live",
    set: "dev",
    url: "https://dictionary.cambridge.org/",
    // The site greets a first visit with a consent dialog whose only dismissal
    // is "I Accept"; since ffdb1b9 an "accept" inside a consent banner is not a
    // risky click, so the goal no longer has to name it.
    goal: "Look up the word 'serendipity' in the Cambridge English dictionary and open its entry.",
    fills: { word: "serendipity" },
    check: `location.pathname === '${CAMBRIDGE}' || location.pathname === '${CAMBRIDGE}/'`,
    checkNote: `pathname is ${CAMBRIDGE}`,
  },
  {
    id: "huggingface",
    tier: "live",
    set: "dev",
    url: "https://huggingface.co/models",
    goal: "Show models matching 'whisper' sorted by most downloads.",
    fills: { query: "whisper" },
    check:
      "(() => { const p = new URLSearchParams(location.search); return location.pathname === '/models' && (p.get('search') || '').toLowerCase() === 'whisper' && p.get('sort') === 'downloads'; })()",
    checkNote: "/models with search=whisper and sort=downloads in the URL",
  },
  {
    id: "amazon",
    tier: "live",
    set: "dev",
    url: "https://www.amazon.com/",
    goal: "Search for 'usb c cable' and sort the results by price, low to high.",
    fills: { query: "usb c cable" },
    check:
      "(() => { const p = new URLSearchParams(location.search); return /^usb[ +-]?c cable$/i.test((p.get('k') || '').replace(/\\+/g, ' ')) && p.get('s') === 'price-asc-rank'; })()",
    checkNote:
      "search URL (on amazon.com or the locale it redirected to) with k=usb c cable and s=price-asc-rank",
    timeoutSec: 90,
  },
  {
    id: "hackernews",
    tier: "live",
    set: "dev",
    url: "https://news.ycombinator.com/",
    goal: "Go to the 'Show HN' section and open the comments page of its first story.",
    fills: {},
    // The comments page can't say whether its story was first on /show, so the
    // check fetches /show (same origin) and reads the first story ids. The
    // first three are accepted: the list can shift between the run and the check.
    check:
      "(async () => { if (location.pathname !== '/item') return false; const id = new URLSearchParams(location.search).get('id'); const html = await (await fetch('/show', { credentials: 'omit' })).text(); const ids = [...html.matchAll(/class=\"athing[^\"]*\" id=\"(\\d+)\"/g)].map((m) => m[1]).slice(0, 3); return ids.includes(id); })()",
    checkNote:
      "an /item?id= page whose id is among the first three stories of /show, fetched same-origin inside the check",
  },
  {
    id: "wolframalpha",
    tier: "live",
    set: "dev",
    url: "https://www.wolframalpha.com/",
    goal: "Compute the integral of x^2 sin x and stop when the result is shown.",
    fills: { query: "integrate x^2 sin x" },
    // Antiderivative: 2x sin(x) - (x^2 - 2) cos(x) + constant. The pods render
    // as images whose alt text carries the formula, so read img alts. Lenient
    // on form: any alt with sin, cos, an x^2 term and "constant".
    check:
      "(() => { const alts = [...document.querySelectorAll('img[alt]')].map((i) => i.alt); return /\\/input/.test(location.pathname) && /integrate/i.test(new URLSearchParams(location.search).get('i') || '') && alts.some((a) => /sin/.test(a) && /cos/.test(a) && /x\\^2|x²/.test(a) && /constant/.test(a)); })()",
    checkNote:
      "an /input?i=integrate… page with a result pod image whose alt text has sin, cos, an x^2 term and 'constant' (the indefinite integral pod: '2 x sin(x) - (x^2 - 2) cos(x) + constant')",
    timeoutSec: 90,
  },
  {
    id: "pydocs",
    tier: "live",
    set: "dev",
    url: "https://docs.python.org/3/",
    goal: "Search the Python docs for 'pathlib' and open the pathlib module page.",
    fills: { query: "pathlib" },
    check: "/\\/library\\/pathlib\\.html$/.test(location.pathname)",
    checkNote: "pathname ends with /library/pathlib.html",
  },
  {
    id: "pypi",
    tier: "live",
    set: "dev",
    url: "https://pypi.org/",
    goal: "Search PyPI for 'requests' and order the results by date last updated.",
    fills: { query: "requests" },
    // PyPI's "Order by" is a native <select name=o>: '' relevance, -created
    // date last updated, -zscore trending.
    check:
      "(() => { const p = new URLSearchParams(location.search); return location.pathname === '/search/' && (p.get('q') || '').toLowerCase() === 'requests' && p.get('o') === '-created'; })()",
    checkNote: "/search/ with q=requests and o=-created (the native select's 'Date last updated')",
  },
  {
    id: "datecalc",
    tier: "live",
    set: "dev",
    url: "https://www.calculator.net/date-calculator.html",
    goal: "Using the 'Days Between Two Dates' calculator, find the number of days from January 1, 2025 to March 1, 2026, and stop when the result is shown.",
    fills: { start_year: "2025", end_year: "2026" },
    // Month and day are native <select>s, the year a text field; Calculate
    // submits a GET with today=MM/DD/YYYY (start) and ageat=MM/DD/YYYY (end).
    check:
      "(() => { const p = new URLSearchParams(location.search); return /date-calculator\\.html$/.test(location.pathname) && p.get('today') === '01/01/2025' && p.get('ageat') === '03/01/2026' && /424 calendar days/.test(document.body.innerText); })()",
    checkNote:
      "the calculator's result URL has today=01/01/2025 and ageat=03/01/2026 (start and end dates) and the result shows '424 calendar days'",
  },

  // ── holdout2 (frozen 2026-09-27, before round 3; never run with `reins do`) ──
  {
    id: "fx-settings",
    tier: "fixture",
    set: "holdout2",
    url: "fixture:settings.html",
    goal: "In the account settings, open the Notifications tab, turn on 'Weekly digest emails' and save the changes.",
    fills: {},
    // Saved state is JSON in #saved-state; a toggled switch only changes the
    // pending state until "Save changes" is clicked. Every other setting must
    // keep its default, so flipping a neighbouring switch fails the check.
    check:
      "(() => { const s = JSON.parse(document.querySelector('#saved-state').value || '{}'); return s.weeklyDigest === true && s.productUpdates === true && s.mentionAlerts === false && s.securityAlerts === true && s.twoFactor === false && s.displayName === 'Sam Rivera' && document.querySelector('#save').disabled; })()",
    checkNote:
      "the saved settings (written only by 'Save changes') have weeklyDigest on and every other setting at its default, and Save is disabled again (nothing pending); toggling without saving, or toggling the wrong switch, stays false",
  },
  {
    id: "fx-orders",
    tier: "fixture",
    set: "holdout2",
    url: "fixture:orders.html",
    goal: "In the orders table, find the order placed by Nadia Okafor and open its details.",
    fills: {},
    // 23 orders, 8 per page, no search box: Nadia's order (ORD-1017) is row 9,
    // i.e. on page 2. Only the row's View button opens the detail view.
    check:
      "!document.querySelector('#detail').hidden && document.querySelector('#detail-id').textContent === 'ORD-1017' && document.querySelector('#detail-customer').textContent === 'Nadia Okafor'",
    checkNote:
      "the detail view is shown for ORD-1017 / Nadia Okafor (only reachable via page 2's View button); page 2 listed but not opened, or another order's details, stays false",
  },
  {
    id: "lit",
    tier: "live",
    set: "holdout2",
    url: "https://lit.dev/",
    goal: "Search the Lit docs for 'reactive properties' and open the 'Reactive properties' documentation page.",
    fills: { query: "reactive properties" },
    // lit.dev is built with Lit: the header's "Search" button, the modal, its
    // combobox input and the result listbox all live in nested shadow roots.
    check: "location.pathname === '/docs/components/properties/'",
    checkNote:
      "pathname is /docs/components/properties/ (the first search result for the query); the homepage, /docs/ and the cheat-sheet article stay false",
  },
  {
    id: "musicbrainz",
    tier: "live",
    set: "holdout2",
    url: "https://musicbrainz.org/",
    goal: "Search MusicBrainz for 'OK Computer' with the search type set to 'Release group'.",
    fills: { query: "OK Computer" },
    // The header search form is a text input + native <select name=type>
    // (default 'Artist') + submit; GET /search?query=…&type=…&method=indexed.
    check:
      "(() => { const p = new URLSearchParams(location.search); return location.pathname === '/search' && (p.get('query') || '').trim().toLowerCase() === 'ok computer' && p.get('type') === 'release_group' && document.querySelectorAll('table.tbl tbody tr').length > 0; })()",
    checkNote:
      "/search with query=ok computer, type=release_group (the native select's 'Release group') and a results table; the default type=artist stays false",
  },
  {
    id: "openlibrary",
    tier: "live",
    set: "holdout2",
    url: "https://openlibrary.org/",
    goal: "Search Open Library for 'the hobbit' and sort the results by 'Most Editions'.",
    fills: { query: "the hobbit" },
    // The results page's "Sort by" is an <ol-menu-popover> web component whose
    // role=menu of menuitemradio buttons renders inside its shadow root;
    // picking an item navigates to /search?q=…&sort=editions.
    check:
      "(() => { const p = new URLSearchParams(location.search); return location.pathname === '/search' && /hobbit/i.test(p.get('q') || '') && p.get('sort') === 'editions' && document.querySelectorAll('.searchResultItem').length > 0; })()",
    checkNote:
      "/search with q containing 'hobbit', sort=editions and result items; the relevance-sorted results page (no sort param) stays false",
  },
  {
    id: "crates",
    tier: "live",
    set: "holdout2",
    url: "https://crates.io/",
    goal: "Search crates.io for 'serde', open the serde crate and show its Versions list.",
    fills: { query: "serde" },
    // A client-rendered SPA: search results, the crate page and its in-page
    // Readme / Versions / Dependencies… navigation are all route changes.
    check:
      "location.pathname === '/crates/serde/versions' && [...document.querySelectorAll('a[href]')].some((a) => /^\\/crates\\/serde\\/\\d+\\.\\d+\\.\\d+$/.test(a.getAttribute('href')))",
    checkNote:
      "pathname is /crates/serde/versions and the page links to at least one /crates/serde/<version>; the search results and the crate's Readme page stay false",
  },
  {
    id: "iana",
    tier: "live",
    set: "holdout2",
    url: "https://www.iana.org/domains/root/db",
    goal: "In the Root Zone Database, open the record for the .ch top-level domain.",
    fills: {},
    // One static table of ~1600 TLDs with no search box: the .ch row is far
    // down the page (find/scroll), and each row's domain is a link.
    check: "location.pathname === '/domains/root/db/ch.html'",
    checkNote:
      "pathname is /domains/root/db/ch.html; the database page and another TLD's record stay false",
  },
  {
    id: "osm",
    tier: "live",
    set: "holdout2",
    url: "https://www.openstreetmap.org/",
    goal: "Search OpenStreetMap for 'Matterhorn' and open the result for the peak in Zermatt, Switzerland.",
    fills: { query: "Matterhorn" },
    // The search lists several peaks named Matterhorn (Switzerland, Antarctica,
    // Czechia, New Zealand…); clicking one opens /node/<id> in the sidebar
    // with its coordinates. Accept any node/way/relation whose title is
    // Matterhorn and whose coordinates are the Zermatt peak (45.976, 7.658).
    check:
      "/^\\/(node|way|relation)\\/\\d+$/.test(location.pathname) && /Matterhorn/.test(document.title) && /45\\.97\\d*,\\s*7\\.65\\d*/.test(document.body.innerText)",
    checkNote:
      "a /node|way|relation/<id> page titled Matterhorn whose sidebar shows coordinates 45.97…, 7.65… (the Swiss peak, node 26863664 today); the search results page and the Czech/Antarctic Matterhorn nodes stay false",
  },
];

export const TASK_IDS = TASKS.map((t) => t.id);
