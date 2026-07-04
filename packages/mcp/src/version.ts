import { readFileSync } from "node:fs";

/**
 * Version of the reins-mcp package, read from package.json at runtime.
 * Resolves relative to this module, so it works both from src/ (tests) and
 * from dist/ (published package — dist/../package.json).
 */
export function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
