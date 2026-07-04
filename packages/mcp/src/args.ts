/** Tiny dependency-free flag parser for the reins CLI. */

export interface ArgSpec {
  /** Flags that take no value (presence = true). */
  booleans?: string[];
  /** Flags that may repeat; collected into an array. */
  multi?: string[];
}

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true | string[]>;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[], spec: ArgSpec = {}): ParsedArgs {
  const booleans = new Set(spec.booleans ?? []);
  const multi = new Set(spec.multi ?? []);
  const positional: string[] = [];
  const flags: ParsedArgs["flags"] = {};

  const set = (name: string, value: string | true) => {
    if (multi.has(name)) {
      const existing = flags[name];
      if (Array.isArray(existing)) existing.push(String(value));
      else flags[name] = [String(value)];
      return;
    }
    flags[name] = value;
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq !== -1) {
      set(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const name = token.slice(2);
    if (booleans.has(name)) {
      set(name, true);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined) throw new UsageError(`missing value for --${name}`);
    set(name, next);
    i++;
  }
  return { positional, flags };
}
