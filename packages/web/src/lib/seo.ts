export const SITE_URL = "https://reins.tech";

/**
 * Per-page head tags: title, description, canonical, and Open Graph
 * overrides. Root-level tags (og:image, twitter:card, site defaults) live in
 * __root.tsx; TanStack dedupes by name/property so these win per page.
 */
export function seo({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  const url = path === "/" ? SITE_URL : `${SITE_URL}${path}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
