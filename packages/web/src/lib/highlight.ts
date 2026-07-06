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
    // Let the surrounding `.prose pre` surface color show through.
    colorReplacements: { "#0d1117": "transparent" },
  });
}
