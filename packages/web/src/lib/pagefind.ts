/* Client-side full-text search over the prerendered docs, powered by Pagefind.
   The `/pagefind/` bundle is generated after `vite build` (see the build
   script) and served as a static asset, so it only exists in production. In
   dev — or if the fetch fails — every call resolves to an empty list and the
   command menu simply falls back to its curated items. */

export interface DocResult {
  /** Cleaned in-app path, e.g. `/docs/commands#interaction`. */
  url: string;
  /** Page title from the prerendered `<title>` / first heading. */
  title: string;
  /** HTML snippet with `<mark>` around the matched terms. */
  excerpt: string;
}

interface PagefindApi {
  init?: () => Promise<void>;
  search: (query: string) => Promise<{ results: Array<{ data: () => Promise<PagefindData> }> }>;
}

interface PagefindData {
  url: string;
  meta?: { title?: string };
  excerpt: string;
  sub_results?: Array<{ title: string; url: string; excerpt: string }>;
}

let apiPromise: Promise<PagefindApi | null> | null = null;

function loadPagefind(): Promise<PagefindApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!apiPromise) {
    // Build the URL at runtime so Vite doesn't try to resolve the (not-yet-
    // generated) module at build time.
    const base = import.meta.env.BASE_URL || "/";
    const url = `${base}pagefind/pagefind.js`;
    apiPromise = import(/* @vite-ignore */ url)
      .then(async (mod: PagefindApi) => {
        await mod.init?.();
        return mod;
      })
      .catch(() => null);
  }
  return apiPromise;
}

/** Turn a prerendered file path (`/docs/commands.html`) into an app route. */
function cleanUrl(url: string): string {
  let u = url.replace(/index\.html$/, "").replace(/\.html$/, "");
  if (u.length > 1 && u.endsWith("/")) u = u.slice(0, -1);
  return u || "/";
}

export async function searchDocs(query: string, limit = 6): Promise<DocResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pf = await loadPagefind();
  if (!pf) return [];

  const search = await pf.search(trimmed);
  const top = search.results.slice(0, limit);
  const data = await Promise.all(top.map((r) => r.data()));

  return data.map((d) => {
    // Prefer the best heading-level sub-result so the link jumps to the section.
    const sub = d.sub_results?.[0];
    return {
      url: cleanUrl(sub?.url ?? d.url),
      title: d.meta?.title ?? sub?.title ?? "Documentation",
      excerpt: sub?.excerpt ?? d.excerpt,
    };
  });
}
