/**
 * Fail the build if an em-dash or an en-dash reached anything a reader sees.
 *
 * The house style spells the pause out instead: a full stop when the second
 * half is a second idea, a colon when it explains the first half, commas for
 * an aside, brackets for a true parenthesis, and the word "to" for a range.
 * A plain hyphen is fine.
 *
 * What gets scanned is the build output under dist/client, not the sources.
 * The prerendered pages are exactly what a visitor is served, so they are the
 * only honest thing to read: copy that arrives from a route, a component, a
 * changelog, or public/ is all equally covered without this script needing to
 * know which is which. README.md is named outright because it is copy on npm
 * and on GitHub that the site never renders.
 *
 * Code comments keep their own voice and are never scanned.
 *
 * Run by `pnpm check:prose`, and by `pnpm build` once the site is built.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(WEB, "dist", "client");
const README = resolve(WEB, "..", "..", "README.md");

/**
 * What a hit is called. README.md lives outside dist/client, so the
 * `relative(DIST, ...)` the built assets use would print a path climbing out
 * of the build directory instead of the one somebody has to go and edit.
 */
const LABELS = new Map([[README, "README.md"]]);

/** The characters the house style forbids. */
const BANNED = [
  ["—", "em-dash"],
  ["–", "en-dash"],
];

/**
 * Extensions of the files a reader is served as text.
 *
 * An allowlist rather than a denylist, because the thing that must never be
 * scanned is a binary: og.png and favicon.png would report hits on whatever
 * bytes happen to sit where a dash would be. .js and .css are left off for
 * the same reason a source file is: they are compiled output, and any prose
 * in them is already being read in the page it renders. That also keeps
 * pagefind's index (.js and .pf_* under dist/client/pagefind) out of the way.
 */
const TEXT_EXT = [".html", ".txt", ".svg", ".xml"];

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Every text asset under dist/client, whatever put it there. */
async function targets(dir = DIST, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await targets(full, out);
      continue;
    }
    if (TEXT_EXT.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

if (!(await isDirectory(DIST))) {
  throw new Error("check-prose: no dist/client, run `pnpm build` first");
}

/** At most this many occurrences are printed. The exit code counts them all. */
const MAX_PRINTED = 40;

/** Characters either side of a hit to show, since a page is one long line. */
const WINDOW = 60;

/**
 * A readable window around one hit. Prerendered HTML is a single line tens of
 * kilobytes long, so a line slice shows markup from somewhere else entirely.
 * Whitespace is collapsed so the window stays on one terminal row.
 */
function context(text, at) {
  const before = text.slice(Math.max(0, at - WINDOW), at);
  const after = text.slice(at + 1, at + 1 + WINDOW);
  const squash = (s) => s.replace(/\s+/g, " ");
  const lead = at > WINDOW ? "…" : "";
  const tail = at + 1 + WINDOW < text.length ? "…" : "";
  return `${lead}${squash(before)}${text[at]}${squash(after)}${tail}`;
}

const prerendered = await targets();

/**
 * A dist/client with no HTML in it means the build did not finish, and
 * scanning only README.md would report clean having checked almost nothing.
 * Asked of `prerendered` and never of `files`, which is the whole point: the
 * README is appended below and is always readable, so a guard that counted
 * the scan list could be satisfied by one file that says nothing about
 * whether vite ran.
 */
if (!prerendered.some((file) => file.endsWith(".html"))) {
  throw new Error("check-prose: no prerendered pages under dist/client, did vite build run?");
}

const files = [...prerendered, README];

/** One entry per file that has hits, in scan order, each with every hit. */
const found = [];
let total = 0;

for (const file of files) {
  const text = await readFile(file, "utf8");
  const label = LABELS.get(file) ?? relative(DIST, file);
  const hits = [];

  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
      continue;
    }
    const banned = BANNED.find(([char]) => char === text[i]);
    if (!banned) continue;
    hits.push({ line, column: i - lineStart + 1, name: banned[1], context: context(text, i) });
  }

  if (hits.length > 0) {
    found.push({ label, hits });
    total += hits.length;
  }
}

if (total > 0) {
  console.error(`check-prose: ${total} dash(es) in copy a reader sees\n`);

  let printed = 0;
  for (const { label, hits } of found) {
    console.error(`  ${label}  (${hits.length})`);
    for (const hit of hits) {
      if (printed === MAX_PRINTED) break;
      console.error(`    ${label}:${hit.line}:${hit.column}  ${hit.name}  ${hit.context}`);
      printed += 1;
    }
    if (printed === MAX_PRINTED) break;
  }
  if (total > printed) console.error(`\n  … and ${total - printed} more`);

  console.error("\nUse a full stop, a colon, commas or brackets instead.");
  process.exit(1);
}

console.log(`check-prose: ${files.length} files, no em-dashes or en-dashes`);
