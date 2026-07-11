import type { ReactNode } from "react";
import { CHANGELOGS, type ChangeType, type PackageKey } from "@/lib/changelog";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<ChangeType, string> = {
  major: "Major",
  minor: "Minor",
  patch: "Patch",
};

const TYPE_STYLES: Record<ChangeType, string> = {
  major: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  minor: "bg-primary/10 text-primary",
  patch: "bg-foreground/5 text-muted-foreground",
};

/** Renders `code` spans in a changelog entry as inline code. */
function InlineCode({ text }: { text: string }) {
  const parts = text.split("`");
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static text, order never changes
      <code key={i}>{part}</code>
    ) : (
      part
    ),
  ) as ReactNode;
}

export function ReleaseList({ packageKey }: { packageKey: PackageKey }) {
  const { releases } = CHANGELOGS[packageKey];

  return (
    <div className="divide-y divide-border">
      {releases.map((release, releaseIndex) => {
        const anchor = `${packageKey}-${release.version}`;
        return (
          <section
            key={release.version}
            className="grid gap-6 py-10 sm:grid-cols-[8rem_1fr] sm:gap-10 last:pb-0"
          >
            <div className="sm:sticky sm:top-24 sm:self-start">
              <h2 id={anchor} className="scroll-mt-20 font-mono text-xl font-semibold">
                <a href={`#${anchor}`} className="hover:underline">
                  v{release.version}
                </a>
              </h2>
              {releaseIndex === 0 && (
                <p className="mt-2">
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary sm:px-2 sm:py-0.5 sm:text-xs">
                    Latest
                  </span>
                </p>
              )}
            </div>
            {/* biome-ignore lint/a11y/noRedundantRoles: preflight strips list styling, so Safari/VoiceOver need the explicit role */}
            <ul role="list" className="flex flex-col gap-8">
              {release.changes.map((change, changeIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per release
                <li key={changeIndex} className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-sm font-medium sm:px-2 sm:py-0.5 sm:text-xs",
                        TYPE_STYLES[change.type],
                      )}
                    >
                      {TYPE_LABELS[change.type]}
                    </span>
                    {change.commit && (
                      <a
                        href={`https://github.com/karnstack/reins/commit/${change.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sm text-muted-foreground hover:text-foreground sm:text-xs"
                      >
                        {change.commit}
                      </a>
                    )}
                  </div>
                  <div className="prose max-w-[70ch]">
                    <p>
                      <InlineCode text={change.text} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
