import cliRaw from "../../../cli/CHANGELOG.md?raw";
import extensionRaw from "../../../extension/CHANGELOG.md?raw";

export type ChangeType = "major" | "minor" | "patch";

export interface Change {
  type: ChangeType;
  commit?: string;
  text: string;
}

export interface Release {
  version: string;
  changes: Change[];
}

const SECTION_TYPES: Record<string, ChangeType> = {
  "Major Changes": "major",
  "Minor Changes": "minor",
  "Patch Changes": "patch",
};

/** Parses a changesets-generated CHANGELOG.md into releases. */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | undefined;
  let type: ChangeType = "patch";
  let change: Change | undefined;

  for (const line of markdown.split("\n")) {
    const version = line.match(/^## (.+)/)?.[1];
    if (version) {
      release = { version, changes: [] };
      releases.push(release);
      change = undefined;
      continue;
    }

    const section = line.match(/^### (.+)/)?.[1];
    if (section) {
      type = SECTION_TYPES[section] ?? "patch";
      change = undefined;
      continue;
    }

    const item = line.match(/^- (?:([0-9a-f]{7,40}): )?(.+)/);
    if (item?.[2] && release) {
      change = { type, commit: item[1], text: item[2] };
      release.changes.push(change);
      continue;
    }

    if (change && line.startsWith("  ") && line.trim()) {
      change.text += ` ${line.trim()}`;
    }
  }

  return releases;
}

export type PackageKey = "cli" | "extension";

export interface PackageChangelog {
  label: string;
  packageName: string;
  distribution: { label: string; href: string };
  releases: Release[];
}

export const CHANGELOGS: Record<PackageKey, PackageChangelog> = {
  cli: {
    label: "CLI",
    packageName: "@karnstack/reins",
    distribution: {
      label: "View on npm",
      href: "https://www.npmjs.com/package/@karnstack/reins",
    },
    releases: parseChangelog(cliRaw),
  },
  extension: {
    label: "Extension",
    packageName: "@reins/extension",
    distribution: {
      label: "View on the Chrome Web Store",
      href: "https://chromewebstore.google.com/detail/hnjcfgochepemjndccfblpmfmlblkofo",
    },
    releases: parseChangelog(extensionRaw),
  },
};
