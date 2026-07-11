import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import shellscript from "shiki/langs/shellscript.mjs";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";

// Sync core + JS regex engine keeps the highlighter usable during SSR render
// and hydration without async setup, and avoids shipping the wasm engine.
const highlighter = createHighlighterCoreSync({
  themes: [githubDarkDefault],
  langs: [shellscript],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

export function highlightShell(code: string): string {
  return highlighter.codeToHtml(code, {
    lang: "shellscript",
    theme: "github-dark-default",
    // Code blocks keep the dark surface in both themes; the github-dark
    // token colors assume it, so pin the bg rather than letting the page
    // show through.
    colorReplacements: { "#0d1117": "oklch(0.205 0 0)" },
  });
}
