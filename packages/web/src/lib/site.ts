/* Canonical off-site URLs and shared nav data, so the header, footer, and
   command menu never drift apart. */

export const REPO_URL = "https://github.com/karnstack/reins";
export const NPM_URL = "https://www.npmjs.com/package/@karnstack/reins";
export const X_URL = "https://x.com/gyankarn";
export const GITHUB_URL = "https://github.com/karngyan";

export const INSTALL_COMMAND = "npm i -g @karnstack/reins";

/** The step people skip. Named here so no page can quote it differently. */
export const SKILL_COMMAND = "npx skills add karnstack/reins";

export const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/reins/hnjcfgochepemjndccfblpmfmlblkofo";

/** Primary header links (kept short — the command menu covers the long tail). */
export const HEADER_LINKS = [
  { to: "/docs", label: "Docs" },
  { to: "/docs/commands", label: "Commands" },
  { to: "/docs/permissions", label: "Permissions" },
  { to: "/changelog", label: "Changelog" },
] as const;
